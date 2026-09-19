# Computer use

[English](computer-use.md) | 中文

computer use 让模型观察并操作桌面。`@deepseek-ai/dsh-computer-use` 拥有能力定义——`ctx.computerUse` 服务——而 `@deepseek-ai/dsh-computer-use-cua-driver` 是本发行版为 [Cua Driver](https://github.com/trycua/cua) 桌面挂载的 provider。

## 一个组合一个桌面

该定义只拥有一个注册名额。`register(name)` 占用它直到自己的 disposer 运行，并返回该 disposer；第二次注册会抛错——**包括重复当前名字的注册**，因此一个未释放就重启的 provider 无法悄悄接管。名字在整个注册生命周期内通过 `providerName` 公布——包括 provider 资源正在关闭时——所以释放后的名额永远不会与正在关闭的桌面会话重叠。

这条 seam 不定义工具、传输与审批策略：操作与平台要求归 provider，而审批策略与"桌面输入控制"不匹配的部署就不该挂载它。

## 桌面如何抵达模型

驱动是外部的。在本基线里工具经由行作用域的 MCP 客户端抵达，所以组合要在 provider 旁边挂一个伴生行（`@deepseek-ai/dsh-mcp-client`，`command: cua-driver, args: [mcp]`）；模型看到的就是驱动自己的工具描述与结果。截图就是普通图片：经持久化附件存储抵达，并由请求管线像其他任何图片一样计入预算——这也是 provider 在缺少附件服务与声明 `image` 输入的模型路由时拒绝激活的原因。

```yaml
- id: mcp-cua-driver
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: cua-driver
    transport: stdio
    command: cua-driver
    args: [mcp]
- name: '@deepseek-ai/dsh-computer-use'
- name: '@deepseek-ai/dsh-computer-use-cua-driver'
```

驱动的安装与平台授权留在那个程序自己身上：在"Windows 桌面 + WSL harness"这套里，它属于 Windows 侧，并由父 shell 可达。

## 设计来源

吸收自官方 harness 的 computer-use 组及其实验性 Cua Driver provider。保留了它们的独占式注册 seam 与截图前提；官方的"按 Session 挂载 MCP"需要比本基线更新的 scope API，未移植；native（进程内 SDK）provider **刻意不移植**，因为它的崩溃会终止 harness 进程。

另见：[`@deepseek-ai/dsh-computer-use`](../../packages/computer-use/computer-use/README.md) 与 [`@deepseek-ai/dsh-computer-use-cua-driver`](../../packages/computer-use/computer-use-cua-driver/README.md)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcomputeruse--computeruseregistry"></a>

### `ctx.computerUse` — `ComputerUseRegistry`

Owns the single optional provider registration of the computer-use capability.

```ts cordis-catalog
/**
 * Reserve the sole provider slot until the contribution is disposed.
 * A second registration fails even when it repeats the current name.
 * Providers must stop their tools and await owned work before releasing this
 * registration, so a released slot never overlaps a closing desktop session.
 * @param name - provider-owned name used in registration diagnostics.
 * @returns the effect disposer for this exact registration.
 */
register(name: ComputerUseProviderName): () => Promise<void>
```

Source: [`packages/computer-use/computer-use/src/index.ts:25`](../../packages/computer-use/computer-use/src/index.ts)
<!-- END GENERATED cordis-surface -->
