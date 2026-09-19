# @deepseek-ai/dsh-computer-use

[English](README.md) | 中文

computer-use 能力定义（`ctx.computerUse`）。一个组合**最多挂载一个**让模型观察并操作桌面的 provider；这条 seam 拥有那个唯一名额，而每个 provider 自己拥有它的操作、工具与平台要求。

## 服务契约

- `register(name)` 占用那唯一名额直到它的 disposer 运行，并返回该 disposer。第二次注册会抛错——**包括重复当前名字的注册**，因此一个未释放就重启的 provider 无法悄悄接管。
- `providerName` 公布已注册的名字，并在 provider 资源关闭期间继续保持公布；注册释放后清空。
- provider 必须在释放注册**之前**停掉自己的工具并等待其拥有的工作结束，因此释放后的名额永远不会与正在关闭的桌面会话重叠。

这条 seam 不定义任何工具与传输：`@deepseek-ai/dsh-computer-use-cua-driver` 为 Cua Driver 桌面占用该名额，另一个 provider 也可以为别的桌面这样做。

## 配置

无。该服务以裸行挂载，配置由各 provider 自带。


## 开发注记

吸收自官方 harness 的 computer-use 组（`packages/computer-use/computer-use`）：独占式注册的设计与诊断信息是他们的，本包把它们重述在本 fork 的 rc.7 seam 之上。官方实验组里 provider 的**按 Session 挂载**需要更新的 scope API，不在本次移植范围内。

## 模型体验

无：本包不贡献任何提示、工具、消息或 provider 请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与推迟项

- **一个组合一个桌面**——独占名额就是契约，所以同一进程里两个桌面需要第二个组合，而不是两个 provider。
- **自身没有审批 seam**——桌面动作是否需要 `ctx.approval` 由 provider 决定；本定义刻意不携带策略。
