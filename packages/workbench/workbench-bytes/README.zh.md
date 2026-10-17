---
description: "受围栏保护的工作台文件路由：经 fs 能力把单个工作区文件流式送给浏览器查看器，支持 Range／206／416。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workbench-bytes

[English](README.md) | 中文

## 概述

工作台的字节路由。一条精确的 Fetch 路由——`/api/workbench/file?sessionId=<id>&path=<path>` 上的 `GET` 与 `HEAD`——把工作区文件流式送给浏览器里的文件查看器。承载通道只放行属主 Peer，处理器套用 `dsh-workbench` 导出的工作区围栏，正文从解析出的目标的进程路径流式输出并支持 `Range`，因此视频可以拖动进度、大图可以边下边看，而不需要把整个文件读进内存。

## 目录

- [路由](#route)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="route"></a>
## 路由

插件通过 `ctx.connection.fetch.register` 在共享的 `/api` 通道上注册一条路由，路径为 `WORKBENCH_FILE_PATH`，方法为 `GET` 与 `HEAD`。承载通道在处理器运行前套用自身的信任与认证策略，因此只有属主 Peer 能到达该路由。处理器随后用 `fenceSessionPath` 解析请求，并从 `ctx.fs.processPath(target)` 流式输出。

每个回答都带由 `contentTypeForPath` 得出的 `content-type` 与 `cache-control: no-store`。缺少 `sessionId` 或 `path` 回答 `400`，被围栏拒绝的请求回答 `403`，目标不是普通文件则回答 `404`。大小已知时响应还带 `content-length` 与 `accept-ranges: bytes`；`Range` 请求回答 `206` 并带 `content-range`，不可满足的范围回答 `416` 并带 `content-range: bytes */<size>`，`HEAD` 只回头部不带正文。[工作台子系统页面](../../../docs/subsystems/workbench.zh.md)持有围栏与媒体类型映射。

<a id="model-experience"></a>
## Model Experience

None, as this package serves browser bytes and the model-facing workbench projections live in `dsh-tool-workbench`.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **一次请求只支持一个范围** — 多范围请求头会被忽略并返回整个表示；查看器只发单范围，而 multipart/byteranges 响应要额外写一个边界编码器，目前没有消费者。
- **围栏是会话记录的工作目录** — 没有记录工作目录的会话无法被服务，目录之外的路径以 `403` 拒绝。
- **媒体类型来自文件名** — `contentTypeForPath` 读取扩展名，因此内容与名字不符的文件按名字的类型提供。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

无。

</details>
