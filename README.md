# Cloudflare FFmpeg streaming demo

A React + Vite frontend and Cloudflare Worker that stream raw JPEG/PNG uploads through FFmpeg in a Cloudflare Container and return WebP output.

> Status: deployed as a minimal reproduction of a Cloudflare Containers streaming issue. The inbound RPC stream currently disconnects when streamed into `container.exec()` while stdout is returned over the same RPC invocation.

## Intended request path

```text
React or curl → Worker /convert → RPC ReadableStream
  → Container exec(FFmpeg) stdin → FFmpeg stdout
  → RPC ReadableStream → Worker Response
```

The Worker conversion path must not fully buffer the upload or write it to a temporary file. The React client may materialize the returned response as a `Blob` to display it.

## Prerequisites

- Cloudflare Workers Paid plan
- Node.js and pnpm
- Docker-compatible CLI and running engine
- Wrangler authentication

## Setup

```bash
pnpm install
pnpm run cf-typegen
```

## Development

```bash
pnpm dev
```

The Cloudflare Vite plugin runs the React frontend and Worker integration. Once Containers are configured in `wrangler.jsonc`, it also handles local Container development. Use the local URL printed by Vite.

API checks:

```bash
curl -i http://localhost:5173/health

curl --fail-with-body \
  -H 'content-type: image/jpeg' \
  --data-binary @samples/source.jpg \
  http://localhost:5173/convert \
  --output /tmp/converted.webp
```

If Vite selects another port, use that port instead.

## Validation and deployment

```bash
pnpm run cf-typegen
pnpm lint
pnpm build
pnpm deploy
```

The intended implementation follows Cloudflare's documented `container.exec()` stdin and stdout streaming APIs. In the deployed environment, FFmpeg starts but the inbound RPC body fails with `{ retryable: true }` / `Network connection lost`, leaving no valid output.
