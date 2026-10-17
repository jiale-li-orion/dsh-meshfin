---
description: "The shared workbench view plus the workspace fence, media-type map, and byte-route path its sibling packages read, for maintainers of the workbench column and its file viewer."
kind: "package-reference"
---

# @deepseek-ai/dsh-workbench

English | [中文](README.zh.md)

## Summary

The shared workbench state service. One value — whether the workbench column is open and which panel is selected — is the single authority for both planes: browser gestures arrive as Remote calls, the `dsh-tool-workbench` tools write the same value, and every commit emits `workbench/changed`. The view carries no session identity, so every call touches the built-in `global` resource. The package also exports the workspace fence, the extension-to-media-type map, and the byte route's path, so `dsh-workbench-bytes` and the Remote namespace read one definition.

## Table of Contents

- [Remote namespace](#remote-namespace)
- [Exported vocabulary](#exported-vocabulary)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="remote-namespace"></a>
## Remote namespace

The Remote namespace `workbench` exposes `state`, `open`, `close`, `select`, and `toggle`. Each method commits the shared view, emits `workbench/changed` with the committed value, and returns that value to the caller. `open` with no panel keeps the current selection, `close` keeps it too, and `toggle` flips only `open`. The Typert pass emits `lib/typert.host.js` and `lib/typert.remote-client.js` from the decorated methods.

The browser receives each committed view through the forwarded-event allowlist rather than by polling. [The workbench subsystem page](../../../docs/subsystems/workbench.md) owns the shared-view semantics, the workspace fence, and the byte route the sibling packages serve.

<a id="exported-vocabulary"></a>
## Exported vocabulary

`fenceSessionPath(ctx, sessionId, path)` resolves one path inside a session's recorded working directory, raising `WorkbenchFenceError` with code `WORKBENCH_OUTSIDE_WORKSPACE` when the session records none or the target falls outside it. `contentTypeForPath(path)` answers the media type for a file extension, falling back to `application/octet-stream`. `WORKBENCH_FILE_PATH` names the route `dsh-workbench-bytes` registers.

`@deepseek-ai/dsh-workbench-bytes` imports all three from this package, so a request it serves and a path this package resolves cannot disagree about the workspace or the media type.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-workbench`, which writes this view and returns the committed state as an ordinary tool result.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The view is process-global** — every connected browser and agent sees the same open/selection state; per-client views are deferred until a consumer needs them.
- **The fence is the session's recorded working directory** — a session without one cannot resolve a path, so the byte route has nothing to serve until one is current.
- **The media type is extension-based** — a file whose content disagrees with its extension is typed by the name, which is what the browser needs for `Content-Type` and viewer routing.
- **Only the file route is registered** — `WORKBENCH_UPLOAD_PATH` is exported but no plugin serves that path, so this repository has no workbench upload endpoint.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
