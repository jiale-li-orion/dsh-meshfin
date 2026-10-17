---
description: "面向模型的工作台视图控制：共享 ctx.workbench 视图上的 workbench_open、workbench_close 与 workbench_status。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-workbench

[English](README.md) | 中文

## 概述

共享工作台视图上面向模型的控制。`workbench_open` 打开该栏并可选择面板，`workbench_close` 关闭该栏并保留选择，`workbench_status` 报告已提交的视图。每次调用都写入浏览器渲染的同一个值，并返回一条指明该值的简短通知，因此 agent 调用与人的手势收敛到同一个状态，`workbench/changed` 把它带给两者。没有工具直接触碰浏览器，也没有面板内容到达模型。

## 目录

- [工具](#tools)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="tools"></a>
## 工具

`workbench_open` 接受可选的 `panel` id；省略时保留当前选择。`workbench_close` 关闭该栏并保留选择，因此下一次打开会回到它。`workbench_status` 只读取视图、不做改动。每个结果都携带通知 `text` 以及 `open`，选中面板时还带 `active`。

该视图是共享状态而非会话状态，因此三个工具对所有已连接的浏览器与 agent 都作用于同一栏。[工作台子系统页面](../../../docs/subsystems/workbench.zh.md)持有该视图，以及面板文件来源的字节路由。

<a id="model-experience"></a>
## Model Experience

### 工具 schema

#### 模型看到的内容

工具集可见时生成的 [`workbench_open`、`workbench_close` 与 `workbench_status` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-workbench)。

#### Token 影响

工具可见时每个请求的固定 schema 成本。

#### KV Cache 影响

工具定义与可见性不变时前缀稳定。注册生命周期或作用域限制可能从第一个变化的 schema token 起使复用失效。

### 结果与通知

#### 模型看到的内容

`workbench_open` 返回 `Workbench opened on panel "<id>".` 或 `Workbench opened; no panel selected.`；`workbench_close` 返回 `Workbench closed.`；`workbench_status` 返回当前视图对应的通知。每个结果还携带 `open`，选中时还带 `active`。

#### Token 影响

结果保留在父历史中直到压缩。通知只有一行；面板内容不会到达模型。

#### KV Cache 影响

只追加；新可见内容跟在可复用的请求前缀之后，不会使已有 KV-cache 条目失效。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **工具无法枚举面板**：面板 id 是浏览器 slot 注册表的键，因此模型必须被告知一个有效 id（或省略它），而不是自行发现。
- **没有面板内容工具**：通过工作台读取或编辑文件属于后续阶段；这些工具只驱动共享视图。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

无。

</details>
