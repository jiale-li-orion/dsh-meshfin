---
description: "共享的工作台视图，以及同级包读取的工作区围栏、媒体类型映射与字节路由路径，面向工作台栏与其文件查看器的维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workbench

[English](README.md) | 中文

## 概述

共享工作台状态服务。唯一的值——工作台栏是否打开、选中了哪个面板——是浏览器与 agent 两个平面共同的唯一权威：浏览器手势以 Remote 调用到达，`dsh-tool-workbench` 的工具写入同一个值，每次提交都发出 `workbench/changed`。视图不携带会话身份，因此每次调用只触及内置的 `global` 资源。该包还导出工作区围栏、扩展名到媒体类型的映射，以及字节路由的路径，使 `dsh-workbench-bytes` 与这里的 Remote 命名空间读同一份定义。

## 目录

- [Remote 命名空间](#remote-namespace)
- [导出的词表](#exported-vocabulary)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="remote-namespace"></a>
## Remote 命名空间

Remote 命名空间 `workbench` 暴露 `state`、`open`、`close`、`select` 与 `toggle`。每个方法提交共享视图、以已提交的值发出 `workbench/changed`，并把该值返回给调用方。不带面板的 `open` 保留当前选择，`close` 同样保留，`toggle` 只翻转 `open`。Typert 生成阶段从这些带装饰器的方法产出 `lib/typert.host.js` 与 `lib/typert.remote-client.js`。

浏览器通过转发事件白名单收到每一份已提交视图，而不是轮询。[工作台子系统页面](../../../docs/subsystems/workbench.zh.md)持有共享视图语义、工作区围栏，以及同级包提供的字节路由。

<a id="exported-vocabulary"></a>
## 导出的词表

`fenceSessionPath(ctx, sessionId, path)` 把一条路径解析到会话记录的工作目录之内；当会话没有记录工作目录、或目标落在其外时，抛出带 `WORKBENCH_OUTSIDE_WORKSPACE` 代码的 `WorkbenchFenceError`。`contentTypeForPath(path)` 按文件扩展名回答媒体类型，未知扩展名回落到 `application/octet-stream`。`WORKBENCH_FILE_PATH` 指名 `dsh-workbench-bytes` 注册的那条路由。

`@deepseek-ai/dsh-workbench-bytes` 从本包导入这三项，因此它提供的请求与本包解析的路径不会在工作区或媒体类型上给出不一致的答案。

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-workbench`, which writes this view and returns the committed state as an ordinary tool result.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **视图是进程全局的** — 每个已连接的浏览器与 agent 看到同一份打开／选中状态；按客户端隔离的视图暂缓到有消费方需要时。
- **围栏是会话记录的工作目录** — 没有记录工作目录的会话无法解析路径，因此在该会话成为当前会话前，字节路由没有可提供的内容。
- **媒体类型按扩展名判断** — 内容与扩展名不符的文件按名字定型；这正是浏览器需要的 `Content-Type` 与查看器路由依据。
- **只注册了文件路由** — `WORKBENCH_UPLOAD_PATH` 虽然导出，但没有插件提供该路径，因此本仓库没有工作台上传端点。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

无。

</details>
