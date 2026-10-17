---
description: "The fenced workbench file route: streams one workspace file to the browser viewer with Range/206/416 support through the fs capability."
kind: "package-reference"
---

# @deepseek-ai/dsh-workbench-bytes

English | [中文](README.zh.md)

## Summary

The workbench byte route. One exact Fetch route — `GET` and `HEAD` on `/api/workbench/file?sessionId=<id>&path=<path>` — streams a workspace file to the browser's file viewer. The carrier admits only owner Peers, the handler applies the workspace fence `dsh-workbench` exports, and the body streams from the resolved target's process path with `Range` support, so a video seeks and a large image loads without the file being held in memory.

## Table of Contents

- [Route](#route)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="route"></a>
## Route

The plugin registers one route on the shared `/api` channel through `ctx.connection.fetch.register`, at `WORKBENCH_FILE_PATH` for `GET` and `HEAD`. The physical carrier applies its trust and authentication policy before the handler runs, so only owner Peers reach the route. The handler then resolves the request through `fenceSessionPath` and streams from `ctx.fs.processPath(target)`.

Every answer carries `content-type` from `contentTypeForPath` and `cache-control: no-store`. A missing `sessionId` or `path` answers `400`, a fenced-out request answers `403`, and a target that is not a regular file answers `404`. With a known size the response also carries `content-length` and `accept-ranges: bytes`; a `Range` request answers `206` with a `content-range`, an unsatisfiable range answers `416` with `content-range: bytes */<size>`, and `HEAD` returns the headers without a body. [The workbench subsystem page](../../../docs/subsystems/workbench.md) owns the fence and the media-type map.

<a id="model-experience"></a>
## Model Experience

None, as this package serves browser bytes and the model-facing workbench projections live in `dsh-tool-workbench`.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One range per request** — a multi-range header is ignored and the whole representation is served, because the viewers issue single ranges and a multipart/byteranges response would add a boundary encoder with no consumer.
- **The fence is the session's recorded working directory** — a session without one cannot be served, and a path outside it is refused with `403`.
- **The media type comes from the name** — `contentTypeForPath` reads the extension, so a file whose content disagrees with its name is served under the name's type.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
