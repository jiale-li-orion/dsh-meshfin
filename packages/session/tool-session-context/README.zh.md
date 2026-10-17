---
description: "八项面向模型的 Context 工具：有界检查、可评审范围压缩与有界检查点召回，全部基于 `ctx.sessionContext`。"
kind: "package-reference"
---

# `@deepseek-ai/dsh-tool-session-context`

[English](README.md) | 中文

## 概述

这些工具让模型查看并管理自己的上下文。`context_inspect` 返回下一次请求将要发送的确切单元的有界分页，附带计价并按工具平衡切点分组；`context_prepare` 记录一段范围的可评审摘要且不改变任何内容，只有 `context_commit` 才会替换它。`history_read` 与 `history_search` 按页读取压缩所遮蔽的精确原文。寻址任何操作的值——单元、preparation、检查点、游标——都来自前一次结果，模型不会自行构造。召回会加入普通上下文，因此调用方只应请求任务所需的内容。

## 目录

- [工具](#tools)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----


面向模型的 Consumer，负责当前 Context 检查、可评审范围压缩与检查点召回。权限、持久性、陈旧状态校验和上限都委托给 [`ctx.sessionContext`](../session-context/README.zh.md)。

<a id="tools"></a>
## 配置

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `maxUnits` | `100` | 一次 `context_inspect` 最多请求的单元数。 |
| `historyBytes` | `32768` | 传给 `history_read` 的完整响应字节请求。 |
| `searchBytes` | `524288` | 一次 `history_search` 最多扫描的原文字节数。 |
| `searchResults` | `20` | 一次 `history_search` 最多返回的字面匹配数。 |

## 工具

生成的[工具 schema 目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-session-context)负责准确描述与 JSON Schema。

| 工具 | 操作 |
|---|---|
| `context_inspect` | 从尾部开始读取一页有界的当前平衡单元、token 价格、代际、检查点和 preparation。 |
| `context_read` | 读取一个当前单元 id 的完整内容。 |
| `context_prepare` | 生成并持久记录可评审摘要，但不改变当前 Context。 |
| `context_edit_preparation` | 用模型编写的 Markdown 替换一项 ready preparation 的完整摘要。 |
| `context_commit` | 在当前轮次中重新校验并提交已评审 preparation。 |
| `context_discard_preparation` | 丢弃 ready 或 failed preparation，但不改变 Context。 |
| `history_read` | 读取一页有界的准确检查点原文，并可展开嵌套检查点。 |
| `history_search` | 对同一批可达原文执行有界字面搜索。 |

每项操作都需要 `exec.agent`；非 Agent 调用会失败。只读操作支持并发。修改操作通过所属 Agent 或持久 preparation 生命周期串行化。不透明的单元、preparation、检查点和游标值必须来自先前工具结果，不能自行推测。

## 系统提示词指导

插件注册以下稳定提示词章节：

```markdown
Use context_inspect to see the exact durable conversation context used by the next request; Chat history may include shadowed messages that are absent here.
For range compaction, call context_prepare first. It records and returns a reviewable summary without changing context. Inspect or edit that summary, then call context_commit only when it preserves the needed facts.
Compaction and rewrite never delete the append-only log or roll back files, processes, network effects, approvals, goals, or other external state.
Use history_read or history_search with a checkpoint_id to recover exact shadowed originals. Returned tool results become ordinary new context, so recall only what the task needs.
```

<a id="model-experience"></a>
## 模型体验

### 工具 schema 与指导

#### 模型看到什么

当该插件位于 Agent 组合中时，模型会收到生成[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-session-context)中的八项 schema，以及上文逐字引用的稳定指导。

#### Token 影响

Schema 与指导增加固定请求前缀成本。`maxUnits`、历史字节、搜索字节与结果数会限制数据相关工具结果。

#### KV Cache 影响

只要插件配置与工具集合不变，schema 和指导前缀就保持稳定。增加、移除或重新配置插件可能从第一个变化的 schema 或提示词 token 开始使复用失效。

### 检查与召回结果

#### 模型看到什么

成功读取会返回 JSON 元数据、当前消息、规范检查点原文或字面匹配片段。召回只返回请求的有界页面，不会自动注入完整检查点。

#### Token 影响

每项结果都会作为普通工具结果追加，并在之后步骤中重复发送，直到被替换或压缩。配置的字节与条目上限只限制单次调用，不限制反复调用的累计成本。

#### KV Cache 影响

工具结果追加在可复用请求前缀之后。之后的上下文替换可能从所选替换位置开始使复用失效。

### 可评审压缩修改

#### 模型看到什么

Preparation 不改变任何对话消息。`context_commit` 用标准带框架检查点替换所选范围；同一轮次的之后步骤会从已提交 Context 派生。

#### Token 影响

Preparation 会支付一次或多次辅助摘要调用成本。Commit 要求带框架检查点小于所选范围，从而降低之后的历史输入。

#### KV Cache 影响

辅助调用彼此独立。已提交替换会保留范围之前的前缀，并使对话请求从范围起点失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **没有面向模型的消息改写工具** — 同 Session edit-and-continue 当前属于 Web 人工操作；模型可以检查、压缩和召回，但不能直接改写任意当前用户消息。
- **仅支持字面召回** — Consumer 不暴露正则、语义或跨会话搜索。
- **反复读取会累积** — 返回原文会成为普通工具结果；模型必须只请求需要的页面，或在之后再次压缩。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
