# Workbench

English | [中文](workbench.zh.md)

`@deepseek-ai/dsh-workbench` owns the shared workbench view: whether the workbench column is open and which panel is selected. The browser and the agent both mutate that one value — browser gestures arrive as Remote calls, `@deepseek-ai/dsh-tool-workbench` writes the same value through `workbench_open`/`workbench_close`, and every commit emits `workbench/changed`, which the web client consumes through the forwarded-event allowlist. The package also exports the three values `@deepseek-ai/dsh-workbench-bytes` reads: the workspace fence `fenceSessionPath`, the extension-to-media-type mapping `contentTypeForPath`, and the `/api/workbench/file` route path.

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

## Workspace fence

`fenceSessionPath(ctx, sessionId, path)` resolves one path inside the session's recorded `cwd` through `ctx.fs`: `path: null` resolves to the root, a relative path resolves against the recorded directory, and a request is fenced by the pair below. A session that records no working directory, or a target outside it, raises `WorkbenchFenceError` with code `WORKBENCH_OUTSIDE_WORKSPACE` instead of resolving, so a refusal names the offending path rather than serving it. `contentTypeForPath(path)` maps the file extension to the media type the byte route serves as `Content-Type`, and answers `application/octet-stream` for an unknown or absent extension, so neither plane re-derives a type from the name.

```ts type-equiv
/** One fenced resolution: the workspace root and the requested target inside it. */
interface FencedSessionPath {
  /** The session's recorded working directory, resolved through `fs`. */
  root: FsTarget
  /** The requested path; equal to `root` when `path` was null. */
  target: FsTarget
}
```

## Bytes

`@deepseek-ai/dsh-workbench-bytes` registers one exact Fetch route on the shared `/api` channel (`WORKBENCH_FILE_PATH`) for `GET` and `HEAD`. The carrier applies its trust and authentication policy before the handler runs, so only owner Peers reach the route; the handler then applies the workspace fence. The body streams from the resolved target's process path rather than reading the file whole: `Range` requests answer `206` with a `content-range`, an unsatisfiable range answers `416`, and `HEAD` returns the headers without a body. A malformed, multi-range, or unknown-unit header is ignored and the whole representation is served; a missing `sessionId` or `path` answers `400`, a fenced-out path answers `403`, and a target that is not a regular file answers `404`.

## Events

`workbench/changed` carries the committed view on every commit. The event is one-way and payload-only, so the forwarded-event allowlist can deliver it to a browser verbatim.

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
