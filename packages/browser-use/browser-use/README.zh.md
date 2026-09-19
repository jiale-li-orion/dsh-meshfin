# @deepseek-ai/dsh-browser-use

[English](README.md) | 中文

browser-use 能力定义（`ctx.browserUse`）。一个组合**最多挂载一个**让模型检查并操作网页的 provider；这条 seam 拥有那个唯一名额，而每个 provider 自己拥有它的操作、工具与平台要求。

## 服务契约

- `register(name)` 占用那唯一名额直到它的 disposer 运行，并返回该 disposer。第二次注册会抛错——**包括重复当前名字的注册**，因此一个未释放就重启的 provider 无法悄悄接管。
- `providerName` 公布已注册的名字，并在 provider 资源关闭期间继续保持公布；注册释放后清空。
- provider 必须在释放注册**之前**停掉自己的工具并等待其拥有的浏览器工作结束，因此释放后的名额永远不会与仍在关闭的浏览器进程重叠。

这条 seam 不定义任何工具、传输与页面内容策略：`@deepseek-ai/dsh-browser-use-playwright-mcp` 为 Playwright 浏览器工具占用该名额，另一个 provider 也可以为别的浏览器后端这样做。

## 配置

无。该服务以裸行挂载，配置由各 provider 自带。

## 开发注记

吸收自官方 harness 的 browser-use 组（`packages/browser-use/browser-use`）：独占式注册的设计与诊断信息是他们的，本包把它们重述在本 fork 的 rc.7 seam 之上。官方实验组的**按 Session 挂载浏览器**需要更新的 scope API，不在本次移植范围内。

## 模型体验

无：本包不贡献任何提示、工具、消息或 provider 请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与推迟项

- **一个组合一个浏览器后端**——独占名额就是契约，所以同一进程里两个后端需要第二个组合，而不是两个 provider。
- **自身没有页面内容策略**——provider 可以读取、导航或提交什么，属于该 provider 与部署的审批策略；本定义刻意不携带任何策略。
- **没有按 Session 的浏览器**——已挂载后端的工具同时服务所有 Session。要做到每个 Session 一个浏览器，需要一个把服务端命名空间限定到 Session 的 MCP 客户端：本基线的客户端对每个 `serverName` 只在进程根上保留一次，因此同命名空间的第二个实例会在加载时失败。
