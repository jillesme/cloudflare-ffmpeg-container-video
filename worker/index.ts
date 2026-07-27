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

    // start() returns immediately when the container is already running.
    await this.start();

    const process = await this.ctx.container!.exec(
      [
        "ffmpeg",
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
        // Ignore diagnostics so an unread stderr pipe cannot block FFmpeg or
        // accidentally be combined with the binary WebP output.
        stderr: "ignore",
      },
    );

    // Consume the inbound RPC stream before returning from this method. RPC
    // releases argument streams when a method returns, so leaving this pump in
    // waitUntil() can disconnect FFmpeg's stdin before the upload reaches it.
    try {
      await input.pipeTo(process.stdin!);
    } catch (error) {
      console.error("FFmpeg input stream failed", { pid: process.pid, error });
      process.kill();
      throw error;
    }

    return new Response(process.stdout, {
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

    // Number(null) is 0 and Number("nonsense") is NaN, so both a missing and an
    // unparseable Content-Length fall through to the streaming path.
    if (Number(request.headers.get("content-length")) > MAX_DECLARED_BYTES) {
      return new Response("Image is too large", { status: 413 });
    }

    if (!request.body) {
      return new Response("Request body required", { status: 400 });
    }

    // Cloning converts the native incoming body into a stream implementation
    // that can cross RPC and feed container.exec(). Cancel the unused tee branch
    // so it does not buffer the upload.
    const clonedRequest = request.clone();
    void request.body.cancel();

    const container = getContainer(env.FFMPEG_CONTAINER, "image-converter");
    return container.convertToWebP(clonedRequest);
  },
} satisfies ExportedHandler<Env>;
