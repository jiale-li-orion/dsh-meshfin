---
description: "工作台家族的包映射：浏览器与 agent 共同修改的共享视图、其上面向模型的视图工具，以及馈送查看器的受围栏字节路由。"
kind: "package-group"
---

# workbench/ — 共享工作台栏

[English](README.md) | 中文

## 概述

`workbench/` 组支撑产品 UI 中的一栏：它是否打开、显示哪个面板，以及查看器渲染的字节。状态服务持有两个平面共同修改的单一已提交视图；工具包是该视图上面向模型的消费方，负责打开、关闭与报告；字节包经已认证的承载通道一次提供一个工作区文件。三个包一起挂载，agent 与浏览器就共享同一栏；只有客户端驱动时，单独挂载状态服务即可。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

下面每个包提供该栏的一部分；包页面负责各自的约定与配置。

| 包 | 职责 | ctx key |
|---|---|---|
| [`workbench/`](workbench/README.zh.md) | 持有共享视图、工作区围栏、媒体类型映射与字节路由路径 | `ctx.workbench` |
| [`tool-workbench/`](tool-workbench/README.zh.md) | 该视图上面向模型的 `workbench_open`、`workbench_close` 与 `workbench_status` 工具 | `workbench_open`, `workbench_close`, `workbench_status` |
| [`workbench-bytes/`](workbench-bytes/README.zh.md) | 每次请求把一个工作区文件提供给浏览器查看器，支持 `Range` | 注册到 `ctx.connection.fetch` |

<a id="related-documentation"></a>
## 相关文档

- [工作台子系统](../../docs/subsystems/workbench.zh.md)——这些包实现的共享视图、围栏与字节路由语义。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

无。

</details>
