# @deepseek-ai/dsh-workbench

English | [中文](README.zh.md)

The shared workbench state service. One value — whether the workbench column is open and which panel is selected — is the single authority for both planes: browser gestures arrive as Remote calls, the `dsh-tool-workbench` tools write the same value, and every commit emits `workbench/changed`, so a client that selects that event receives each committed view instead of deriving its own. The Remote namespace `workbench` exposes `state`, `open`, `close`, `select`, and `toggle`; the view carries no session identity, so every call touches the built-in `global` resource. The package also exports the workspace fence `fenceSessionPath`, the extension-to-media-type mapping `contentTypeForPath`, and the `/api/workbench/file` and `/api/workbench/upload` route paths, so the Remote namespace here and the routes `dsh-workbench-bytes` serves read one vocabulary. The Typert pass emits `lib/typert.host.js` and `lib/typert.remote-client.js` from the decorated methods.

## Model Experience

None, as this package owns browser view state and the fence the byte routes share; the model-facing projections live in `dsh-tool-workbench`.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The view is process-global** — every connected browser and agent sees the same open/selection state; per-client views are deferred until a consumer needs them.
- **The fence is the session's recorded working directory** — a session without one cannot address a file, so the byte routes have nothing to serve until one is current.
- **The media type is extension-based** — a file whose content disagrees with its extension is typed by the name, which is what the browser needs for `Content-Type` and viewer routing.
