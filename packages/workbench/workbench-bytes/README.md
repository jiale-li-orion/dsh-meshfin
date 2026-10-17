# @deepseek-ai/dsh-workbench-bytes

English | [中文](README.zh.md)

The workbench byte route: one `webServer` prefix (`/workbench/file`) that streams a workspace file to the browser for the file panel's viewer. A request carries the session id and the path; the route passes the browser trust fence (`connection.isTrustedRequest`, which applies the deployment's `trustedHosts` policy) and the workspace fence (`dsh-workbench`'s `fenceSessionPath`, the same one the panel's listing uses), then streams from the resolved target's process path with `createReadStream`. `Range` requests are served as `206` with a `content-range`, an unsatisfiable range as `416`, and `HEAD` returns the headers without a body, so a video seeks and a large image loads without holding the file in memory.

## Uploads and ingest records

`POST /workbench/upload` accepts a file body and query parameters `sessionId`, `name`, and optional `device` and `ingestId`. The same browser trust check and workspace fence apply; files land in `uploads/<device>/`, using `unknown` when no source is declared. `maxUploadBytes` bounds the body, defaulting to 64 MiB. An upload returns its path and byte count without creating a user message.

A successful upload carrying `ingestId` records its path, byte count, SHA-256, client class, media type, and receipt time in `uploads/.dsh/ingest.json`. A retry of a completed request returns that record with `repeat: true` without reading the retry body, and a retry arriving while the same id is still being written waits for that attempt and is answered from its outcome instead of storing the bytes twice. IDs are data keys, including `constructor` and `__proto__`. Records are written under the index's writer lock and the index is replaced atomically, so two uploads accepted at once keep both records and no reader sees a partial file. A record whose fields do not validate, or whose path is not a plain file name inside its own bucket, is ignored while other valid records survive. Two uploads of one name claim separate files, because a path is taken by an exclusive create rather than by checking that it is free: simultaneous uploads cannot interleave into one file.

## Model Experience

None, as this package serves browser bytes; the model-facing workbench projections live in `dsh-tool-workbench`.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One range per request** — a multi-range header is ignored and the whole representation is served, because the viewers issue single ranges and multipart/byteranges responses would add a boundary encoder with no consumer.
- **Ingest recovery** — the uploaded file and its index record are not one transaction: a crash between them leaves a file that no record names, and the next attempt of that pick writes another copy rather than adopting it. A record is not revalidated against a file that was moved or modified afterwards, the recorded media type comes from the name rather than from the bytes, and expiration cleanup is not implemented.
- **The fence is the session's recorded working directory** — a session without one cannot be served, and a path outside it is refused with `403`.
