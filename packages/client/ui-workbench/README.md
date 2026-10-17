---
description: "The host-owned shared workbench view as one right-Sidebar tab: a control row that commits panel choices through the workbench Remote, and a media preview of one workspace file read through the workbench byte route."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workbench

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-workbench` presents the shared workbench view — one open flag and one selected panel id owned by the Host — as a single tab type in the right Sidebar. The tab body shows the committed value, offers the gestures that commit a new one, and previews one workspace file through the authenticated byte route. Because the view lives on the Host, a press here and an agent tool call converge on the same state; only "which file this browser previews" stays local to this package.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load the plugin through the web-app manifest, then open the `workbench` tab from the right Sidebar's add control. The plugin contributes no other seat: no header button, no composer control, and no column of its own.

### The shared view

The control row names every panel this package defines — currently one, `preview` — and commits a selection through `ctx.remote.workbench.select`. Two further controls commit `open` (reopen with the committed panel) and `close`; `toggle` flips the open flag. The status line reads the committed value: either `open` with the selected panel's label, or `closed`.

A commit from anywhere else — an agent tool call, another browser window, a Remote call — arrives as the `workbench/changed` push and moves the same three places: the control row, the status line, and the chip title. One `state()` read on load covers a page that connected after the commit, so a reload resumes the view instead of showing a default.

### The file preview

Below the control row, a path field takes one workspace path and previews it. The body builds `api/workbench/file?sessionId=<id>&path=<path>` for the tab's Session and the entered path, asks the route for the file's media type with a `HEAD` request, and then renders what that type calls for: an image, audio, video, or PDF element pointed at the same URL (so the browser streams the file itself), or text fetched once and shown in a preformatted block. A `403` (outside the Session's workspace), a `404` (nothing regular there), any other refusal, and an unreachable service each render their own localized line.

Which file is previewed is the tab store's own field: it survives a tab switch and never reaches the Host, because it is a fact about the browser in front of the screen rather than about the shared view.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Registration is the two-stage path any tab type uses. `workbenchDefinition()` registers a page type — no `patterns`, opened by kind `workbench`, `builtin` band — into `ctx.sidebarRightTabs`; the body registers into the keyed `sidebar.right.pane.tab` seat and the chip title into `sidebar.right.pane.tab.title`, both under the definition's `id`. Both stages sit inside the plugin's own `ctx.effect`, so unloading the plugin removes the type, the body, the title, and the dictionaries together.

The one projection is built at apply time, not per tab: the `workbench/changed` subscription, the initial `state()` read, and the four commit calls all live in `SharedWorkbenchView`, which publishes into a snapshot store the two seats read through the inject `hooks` compartment. A failed read or a failed commit changes nothing, so the last committed view stands rather than a synthetic one.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Registration, dictionaries, and the shared-view projection |
| [`src/client/shared-view.ts`](src/client/shared-view.ts) | The Remote face and the committed-view snapshot |
| [`src/client/definition.ts`](src/client/definition.ts) | The `workbench` tab type |
| [`src/client/panels.ts`](src/client/panels.ts) | The panel roster and the id-to-panel reading |
| [`src/client/store.ts`](src/client/store.ts) | The previewed path, browser-local per Session |
| [`src/client/bytes.ts`](src/client/bytes.ts) | The byte-route URL, media-type family, and refusal mapping |
| [`src/client/preview.ts`](src/client/preview.ts) | One read of the route, and what the bytes turned out to be |
| [`src/client/WorkbenchBody.tsx`](src/client/WorkbenchBody.tsx) | The control row, the status line, and the preview |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-workbench`](../../workbench/workbench/README.md) — the Host service that owns the view, its Remote namespace, and the route constants.
- [`dsh-workbench-bytes`](../../workbench/workbench-bytes/README.md) — the authenticated route that serves one workspace file's bytes.
- [`dsh-client-ui-sidebar-right`](../ui-sidebar-right/README.md) — the tab-type registry, the two seats this package fills, and the address rules.
- [`dsh-client-ui-sidebar-files`](../ui-sidebar-files/README.md) — the product's file tree, which this package deliberately does not duplicate.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders host-owned workbench state and one byte-route file preview in the browser, touching no prompt, message, schema, stream, or tool result. The agent's own control of the same view stays with the workbench's tools, which commit through the service the control row calls.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define current package constraints, not a task backlog.

- **The byte route path is restated, not imported.** A browser bundle cannot import the Host's `protocol.ts` as a value, so `WORKBENCH_FILE_ROUTE` repeats it in browser-relative form. A change to the Host constant must be mirrored here.
- **The previewed file is typed, not picked.** The package adds no file tree: a sibling panel that lists files would hand this one a path, and until then the human types it.
- **The control row has no rendering test.** Its face is covered through the inject factory; the elements it draws are covered only by the preview's own component spec.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tab carries no `keepMounted`: a body that unmounts mid-preview abandons its read, and the path field re-reads from the store when the tab comes back.

</details>
