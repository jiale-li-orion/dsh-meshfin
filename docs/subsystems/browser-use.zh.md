# 浏览器操作

[English](browser-use.md) | 中文

浏览器操作让模型检查并操作网页。`@deepseek-ai/dsh-browser-use` 拥有能力定义——`ctx.browserUse` 服务——而 `@deepseek-ai/dsh-browser-use-playwright-mcp` 是本发行版为 Playwright 浏览器工具挂载的提供方。

## 一个组合一个浏览器后端

定义只拥有一个注册名额。`register(name)` 占用该名额直到它的 disposer 运行，并返回该 disposer；第二次注册会抛错，**连重复当前名字也抛**，因此"未释放就重启"的提供方无法悄悄接管。名字在注册的整个生命周期内通过 `providerName` 公布——**包括资源正在关闭时**，所以释放后的名额永远不与仍在关闭的浏览器进程重叠。

接缝不定义工具、不定义传输、也不定义页面内容策略。提供方拥有自己的操作及其平台前提；不应触及在线会话或已登录配置的部署不应挂载任何提供方。

## 浏览器工具如何到达模型

浏览器服务端是外部的。在本基线上工具经由**按行**的 MCP 客户端到达，因此组合要在提供方旁边挂载一条伴生行（`@deepseek-ai/dsh-mcp-client` 启动 `@playwright/mcp`）；模型看到的是服务端自己的工具描述与结果，截图就是普通图片，由请求管线统一预算。

提供方拥有"启动还是附着"的决定，并在占用名额之前拒绝不可用的组合；`browserServerArgs` 推导出伴生行必须传入的参数，使**经过校验的选择与真正运行的服务端保持一致**。启动模式为整个组合拥有一个浏览器——`--isolated` 让它不进入用户自己的配置——而附着模式独占驱动一个已由调试端点暴露的浏览器。

```yaml
- id: mcp-playwright
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: playwright-mcp
    transport: stdio
    command: npx
    args: ['-y', '@playwright/mcp@0.0.80', '--browser', 'chromium', '--isolated', '--headless']
- name: '@deepseek-ai/dsh-browser-use'
- name: '@deepseek-ai/dsh-browser-use-playwright-mcp'
  config:
    mode: launch
    headless: true
```

附着模式把启动参数换成 `--cdp-endpoint <endpoint>` 并去掉 `--isolated`。浏览器二进制的安装（`npx playwright install chromium` 及其系统库）仍属于部署方；服务端会继承环境中的 `PLAYWRIGHT_MCP_*` 变量，因此组合应在该行的 `env` 映射中把这些变量置空，以保持本提供方的选择为准。

## 设计来源

吸收自官方 harness 的 browser use 组及其实验性提供方。保留其独占注册接缝、启动/附着配置与端点校验；官方的"按会话挂载 MCP"未移植，改为伴生行拥有进程、提供方拥有契约。本基线其实已具备 agent 级作用域注册（`createScope`、`agent.ctx`），但它的 MCP 客户端对每个 `serverName` 只在进程根上保留一次，所以"每会话一个服务端"需要各自不同的工具命名空间。Chrome DevTools 与 Stagehand 两个后端未移植：前者与 Chrome DevTools MCP 服务端作为普通行已提供的能力重复，后者引入本发行版并不依赖的托管服务。

另见：[`@deepseek-ai/dsh-browser-use`](../../packages/browser-use/browser-use/README.md) 与 [`@deepseek-ai/dsh-browser-use-playwright-mcp`](../../packages/browser-use/browser-use-playwright-mcp/README.md)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowseruse--browseruseregistry"></a>

### `ctx.browserUse` — `BrowserUseRegistry`

Owns the single optional provider registration of the browser-use capability.

```ts cordis-catalog
/**
 * Reserve the sole provider slot until the contribution is disposed.
 * A second registration fails even when it repeats the current name.
 * Providers must stop their tools and await owned browser work before
 * releasing this registration, so a released slot never overlaps a browser
 * process that is still shutting down.
 * @param name - provider-owned name used in registration diagnostics.
 * @returns the effect disposer for this exact registration.
 */
register(name: BrowserUseProviderName): () => Promise<void>
```

Source: [`packages/browser-use/browser-use/src/index.ts:22`](../../packages/browser-use/browser-use/src/index.ts)
<!-- END GENERATED cordis-surface -->
