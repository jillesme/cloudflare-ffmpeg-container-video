import { Container, getContainer } from "@cloudflare/containers";

const MAX_DECLARED_BYTES = 10 * 1024 * 1024;

export class FFmpegContainer extends Container {
  sleepAfter = "10m";
  enableInternet = false;

  async convertToWebP(request: Request): Promise<Response> {
    const input = request.body;
    if (!input) {
      return new Response("Request body required", { status: 400 });
    }

    if (!this.ctx.container?.running) {
      await this.start();
    }

    const runtime = this.ctx.container;
    if (!runtime) {
      throw new Error("Container runtime was not available");
    }

    const process = await runtime.exec(
      [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-vf",
        "scale=960:-2",
        "-frames:v",
        "1",
        "-c:v",
        "libwebp",
        "-quality",
        "80",
        "-compression_level",
        "6",
        "-f",
        "image2pipe",
        "pipe:1",
      ],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const stdin = process.stdin;
    const stdout = process.stdout;
    const stderr = process.stderr;
    if (!stdin || !stdout || !stderr) {
      process.kill();
      throw new Error("FFmpeg standard streams were not available");
    }

    console.log("Started FFmpeg", { pid: process.pid });

    // Consume the inbound RPC stream before returning from this method. RPC
    // releases argument streams when a method returns, so leaving this pump in
    // waitUntil() can disconnect FFmpeg's stdin before the upload reaches it.
    try {
      await input.pipeTo(stdin);
      console.log("Finished streaming input to FFmpeg", { pid: process.pid });
    } catch (error) {
      console.error("FFmpeg input stream failed", { pid: process.pid, error });
      process.kill();
      throw error;
    }

    // FFmpeg diagnostics must be drained so they cannot block the process. Keep
    // only a bounded prefix for observability; binary output stays on stdout.
    this.ctx.waitUntil(
      (async () => {
        const reader = stderr.getReader();
        const decoder = new TextDecoder();
        let diagnostics = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (diagnostics.length < 4096) {
            diagnostics += decoder.decode(value, { stream: true }).slice(
              0,
              4096 - diagnostics.length,
            );
          }
        }
        diagnostics += decoder.decode().slice(0, 4096 - diagnostics.length);

        const exitCode = await process.exitCode;
        console.log("FFmpeg exited", { pid: process.pid, exitCode });
        if (diagnostics) {
          console.error("FFmpeg diagnostics", {
            pid: process.pid,
            diagnostics,
          });
        }
      })().catch((error: unknown) => {
        console.error("Failed to monitor FFmpeg", { pid: process.pid, error });
      }),
    );

    return new Response(stdout, {
      headers: {
        "content-type": "image/webp",
        "cache-control": "no-store",
        "content-disposition": "inline; filename=converted.webp",
      },
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { allow: "GET" },
        });
      }
      return Response.json({ ok: true });
    }

    if (url.pathname !== "/convert") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "POST" },
      });
    }

    const type = request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();

    if (type !== "image/jpeg" && type !== "image/png") {
      return new Response("Send a raw JPEG or PNG body", { status: 415 });
    }

    const contentLength = request.headers.get("content-length");
    if (contentLength !== null) {
      const declaredLength = Number(contentLength);
      if (!Number.isFinite(declaredLength) || declaredLength < 0) {
        return new Response("Invalid Content-Length", { status: 400 });
      }
      if (declaredLength > MAX_DECLARED_BYTES) {
        return new Response("Image is too large", { status: 413 });
      }
    }

    if (!request.body) {
      return new Response("Request body required", { status: 400 });
    }

    const container = getContainer(env.FFMPEG_CONTAINER, "image-converter");

    // Transfer the Request and Response together so RPC keeps both body
    // streams attached to the same invocation for the full conversion.
    return container.convertToWebP(request);
  },
} satisfies ExportedHandler<Env>;
