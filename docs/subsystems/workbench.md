# Workbench

English | [中文](workbench.zh.md)

`@deepseek-ai/dsh-workbench` owns the shared workbench view: whether the workbench column is open and which panel is selected. The browser and the agent both mutate that one value — browser gestures arrive as Remote calls, `@deepseek-ai/dsh-tool-workbench` writes the same value through `workbench_open`/`workbench_close`, and every commit emits `workbench/changed`, which the web client consumes through the forwarded-event allowlist. The service also answers the file panel's directory listings, fenced to the calling session's recorded working directory and resolved through `ctx.fs`; `@deepseek-ai/dsh-workbench-bytes` serves the listed files' bytes over that same fence.

Source: [`packages/workbench/workbench/src/types.ts`](../../packages/workbench/workbench/src/types.ts)

## Shared view

```ts type-equiv
/**
 * The shared workbench view. Both the browser and agent tools mutate this one
 * value, so a human gesture and a model tool call converge on the same state.
 */
interface WorkbenchView {
  /** Whether the workbench column is open. */
  open: boolean
  /**
   * Selected panel id, or `null` when nothing is selected. The host stores the
   * id opaquely: panel membership belongs to the browser's slot registry, so an
   * unknown id is the client's to interpret (it falls back to the first panel).
   */
  active: string | null
}
```

## Fenced listing

`listDir(sessionId, path)` resolves the session's recorded `cwd` as the fence and lists through the `fs` capability, so the panel sees the tree the agent operates in and nothing outside it. A session without a recorded working directory, or a path that escapes it, is refused with `WORKBENCH_OUTSIDE_WORKSPACE` rather than served. The same `fenceSessionPath` resolves the byte route's requests, so a path a panel may list is exactly a path a viewer may stream.

```ts type-equiv
/** One child of a listed directory. */
interface WorkbenchDirEntry {
  /** Basename inside the listed directory. */
  name: string
  /** Whether the child is a regular file, a directory, or something else. */
  type: 'file' | 'directory' | 'other'
  /** Backend display path, safe to render. */
  path: string
  /** Byte size of a regular file when the backend reports one. */
  size?: number
  /**
   * Media type of a regular file, chosen from its extension by
   * `contentTypeForPath`; absent for directories and other entries. The viewer
   * chain routes on it and the byte route serves it as `Content-Type`, so the
   * browser never re-derives a type from the name.
   */
  mediaType?: string
}
```

```ts type-equiv
/**
 * One directory listing, fenced to a session's recorded working directory.
 * `root` is that directory; every entry path is inside it.
 */
interface WorkbenchListing {
  /** The session's recorded working directory the listing is fenced to. */
  root: string
  /** The listed directory (equal to `root` for the top level). */
  path: string
  /**
   * Path prefix serving every entry's bytes, carrying no query. A client builds
   * `fileRoute?sessionId=<id>&path=<entry path>` for the viewer, so the byte
   * route's location has one home instead of a constant per plane.
   */
  fileRoute: string
  /**
   * Route a client POSTs an uploaded file to: `uploadRoute?sessionId=<id>&name=<name>`
   * with the bytes as the body. The file lands in this workspace's `uploads/`
   * directory and the response names the path it was written to.
   */
  uploadRoute: string
  /** Children in backend order. */
  entries: readonly WorkbenchDirEntry[]
}
```

## Bytes and the viewer

`@deepseek-ai/dsh-workbench-bytes` registers one `webServer` prefix (`/workbench/file`) that streams a workspace file to the browser. A request passes the browser trust fence (`connection.isTrustedRequest`, the deployment's `trustedHosts` policy) and then the workspace fence, and the body is streamed from the resolved target's process path rather than read whole: `Range` requests answer `206` with a `content-range`, an unsatisfiable range answers `416`, and `HEAD` returns the headers alone. A malformed, multi-range, or unknown-unit header is ignored and the whole representation is served.

The viewer itself is the `workbench.viewer` chain seat the workbench shell declares: `@deepseek-ai/dsh-client-ui-workbench` registers one entry per media family (`image/*`, `audio/*`, `video/*`) whose selector elects the listing's `mediaType`, and a type nothing elects falls to the shell's no-preview notice. Which file a window previews is browser-local (the shell store); only the column's open state and the panel choice are shared with the host and the agent.

## Events

`workbench/changed` carries the committed view on every commit. The event is one-way and payload-only, so the forwarded-event allowlist can deliver it to a browser verbatim; the invariant companion asserts each payload equals the state the service holds.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkbench--workbenchservice"></a>

### `ctx.workbench` — `WorkbenchService`

The shared workbench service: one mutable view, one commit path, one event. The view carries no session identity, so every Remote call touches the built-in `global` resource and the package registers no resource kind.

```ts cordis-catalog
/**
 * Read the current view.
 * @returns a detached copy of the committed view.
 */
@Remote('state') state(): WorkbenchView

/**
 * Open the workbench, optionally selecting a panel.
 * @param panelId - panel id to select, or null to keep the current selection.
 * @returns the committed view.
 */
@Remote('open') open(panelId: string | null): WorkbenchView

/**
 * Close the workbench. The selection is kept, so reopening returns to it.
 * @returns the committed view.
 */
@Remote('close') close(): WorkbenchView

/**
 * Select a panel and open the workbench.
 * @param panelId - panel id to select.
 * @returns the committed view.
 */
@Remote('select') select(panelId: string): WorkbenchView

/**
 * Toggle the workbench column: open with the current selection, or close.
 * @returns the committed view.
 */
@Remote('toggle') toggle(): WorkbenchView
```

Source: [`packages/workbench/workbench/src/index.ts`](../../packages/workbench/workbench/src/index.ts)

<a id="workbench-events"></a>

### `workbench/*` events

<a id="workbenchchanged--emit"></a>

#### `workbench/changed` — emit

The shared workbench view changed. Emitted on every commit — a browser gesture, an agent tool call, or a Remote call — so a client can apply the committed value instead of deriving its own.

```ts cordis-catalog
/**
 * The shared workbench view changed. Emitted on every commit — a browser
 * gesture, an agent tool call, or a Remote call — so a client can apply the
 * committed value instead of deriving its own.
 * @param view - the committed view state.
 * @mode emit
 */
'workbench/changed'(view: WorkbenchView): void
```

Source: [`packages/workbench/workbench/src/types.ts`](../../packages/workbench/workbench/src/types.ts)
<!-- END GENERATED cordis-surface -->
