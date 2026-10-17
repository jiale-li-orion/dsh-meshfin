# 工作台

[English](workbench.md) | 中文

`@deepseek-ai/dsh-workbench` 持有共享的工作台视图：工作台栏是否打开、选中了哪个面板。浏览器与 agent 都修改这同一个值——浏览器手势以 Remote 调用到达，`@deepseek-ai/dsh-tool-workbench` 通过 `workbench_open`／`workbench_close` 写入同一个值，每次提交都发出 `workbench/changed`，Web 客户端通过转发事件白名单消费它。该包还导出 `@deepseek-ai/dsh-workbench-bytes` 读取的三个值：工作区围栏 `fenceSessionPath`、扩展名到媒体类型的映射 `contentTypeForPath`，以及 `/api/workbench/file` 路由路径。

来源：[`packages/workbench/workbench/src/types.ts`](../../packages/workbench/workbench/src/types.ts)

## 共享视图

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

## 工作区围栏

`fenceSessionPath(ctx, sessionId, path)` 经 `ctx.fs` 把一条路径解析到该会话记录的 `cwd` 之内：`path: null` 解析到根，相对路径相对记录目录解析，一次请求由下面这个二元组界定。没有记录工作目录的会话、或落在其外的目标，会抛出带 `WORKBENCH_OUTSIDE_WORKSPACE` 代码的 `WorkbenchFenceError`，而不是完成解析，因此拒绝会指明出问题的路径而不是把它送出去。`contentTypeForPath(path)` 把文件扩展名映射为字节路由作为 `Content-Type` 提供的媒体类型，扩展名未知或缺失时回答 `application/octet-stream`，因此两个平面都不必自行从文件名推导类型。

```ts type-equiv
/** One fenced resolution: the workspace root and the requested target inside it. */
interface FencedSessionPath {
  /** The session's recorded working directory, resolved through `fs`. */
  root: FsTarget
  /** The requested path; equal to `root` when `path` was null. */
  target: FsTarget
}
```

## 字节

`@deepseek-ai/dsh-workbench-bytes` 在共享的 `/api` 通道上注册一条精确的 Fetch 路由（`WORKBENCH_FILE_PATH`），方法为 `GET` 与 `HEAD`。承载通道在处理器运行前套用自身的信任与认证策略，因此只有属主 Peer 能到达该路由；处理器随后套用工作区围栏。正文从解析出的目标的进程路径流式输出，而不是把文件整体读入：`Range` 请求回答 `206` 并带 `content-range`，不可满足的范围回答 `416`，`HEAD` 只回头部不带正文。畸形、多范围或未知单位的请求头会被忽略并返回完整表示；缺少 `sessionId` 或 `path` 回答 `400`，被围栏拒绝的路径回答 `403`，目标不是普通文件则回答 `404`。

## 事件

`workbench/changed` 在每次提交时携带已提交的视图。该事件是单向、仅载荷的，因此转发事件白名单可以把它原样投递给浏览器。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
