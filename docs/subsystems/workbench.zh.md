# 工作台

[English](workbench.md) | 中文

`@deepseek-ai/dsh-workbench` 持有共享的工作台视图：工作台栏是否打开、选中了哪个面板。浏览器与 agent 都修改这同一个值——浏览器手势以 Remote 调用到达，`@deepseek-ai/dsh-tool-workbench` 通过 `workbench_open`／`workbench_close` 写入同一个值，每次提交都发出 `workbench/changed`，Web 客户端通过转发事件白名单消费它。该服务还回答文件面板的目录列举，以调用会话记录的工作目录为围栏、经 `ctx.fs` 解析；`@deepseek-ai/dsh-workbench-bytes` 用同一道围栏提供被列举文件的字节。

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

## 受围栏保护的列举

`listDir(sessionId, path)` 以会话记录的 `cwd` 为围栏，并经 `fs` 能力列举，因此面板看到的正是 agent 操作的那棵树，且不会超出它。没有记录工作目录的会话、或逃出该目录的路径，会以 `WORKBENCH_OUTSIDE_WORKSPACE` 被拒绝，而不是被服务。字节路由的请求由同一个 `fenceSessionPath` 解析，所以「面板能列出的路径」正好等于「查看器能流式读取的路径」。

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

## 字节与查看器

`@deepseek-ai/dsh-workbench-bytes` 注册一条 `webServer` 前缀（`/workbench/file`），把工作区文件流式送给浏览器。请求先过浏览器信任栅栏（`connection.isTrustedRequest`，即部署的 `trustedHosts` 策略），再过工作区栅栏，正文从解析出的目标进程路径流式输出而不是整文件读入：`Range` 请求返回 `206` 加 `content-range`，不可满足的范围返回 `416`，`HEAD` 只回头部。畸形、多范围或未知单位的请求头会被忽略并返回完整表示。

查看器本身是工作台外壳声明的 `workbench.viewer` 链式座位：`@deepseek-ai/dsh-client-ui-workbench` 为每个媒体族（`image/*`、`audio/*`、`video/*`）注册一条，其选择器选中列举里的 `mediaType`，没有条目认领的类型落到外壳的「无预览」提示。某个窗口在预览哪个文件属于浏览器本地状态（外壳 store）；只有栏的开关与面板选择与 host 和 agent 共享。

## 事件

`workbench/changed` 在每次提交时携带已提交的视图。该事件是单向、仅载荷的，因此转发事件白名单可以把它原样投递给浏览器；不变式伴随插件断言每个载荷都等于服务持有的状态。

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
