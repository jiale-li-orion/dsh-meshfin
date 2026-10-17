---
description: "检查并改写准确的当前模型可见 Session 表层、并召回检查点原文的宿主服务，供 Context 视图与其模型工具的维护者阅读。"
kind: "package-reference"
---

# `@deepseek-ai/dsh-session-context`

[English](README.md) | 中文

## 概述

用于检查和修改准确的当前模型可见 Session 表层的宿主服务。它从 `Session.surface` 派生 Context，绝不从已分页的人类 transcript（文本记录）派生，并在仅追加日志中保留每条已被取代的消息。Context 视图读取有界的平衡单元分页，并附带路由计价、代际与持久 preparation；评审流程可以改写单个单元，或 prepare、edit、discard、commit 一段范围压缩；检查点召回按页读取压缩所遮蔽的精确原文。每次替换都会追加一条仅日志记录，因此任何读取方都不必猜测某个节点为何离开当前上下文。

## 目录

- [服务 API](#service-api)
- [Context 单元与代际](#context-units-and-generations)
- [持久性与权限](#durability-and-authority)
- [性能](#performance)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

## 配置

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `previewChars` | `160` | 一条单元预览中的最大字素簇数。 |
| `maxUnitsPerPage` | `200` | 一页检查最多返回的当前单元数。 |
| `maxPreparations` | `8` | 快照携带的最近 preparation 投影上限。 |
| `maxPreservationBriefChars` | `2000` | 范围保留说明中的最大字素簇数。 |
| `maxHistoryPageBytes` | `65536` | 一次检查点原文读取响应的完整 JSON 字节上限。 |
| `maxHistorySearchBytes` | `1048576` | 一次搜索最多扫描的原文 UTF-8 字节数。 |
| `maxHistorySearchResults` | `50` | 一次搜索最多返回的字面匹配数。 |
| `maxHistorySearchQueryChars` | `512` | 一条字面查询中的最大字素簇数。 |

<a id="service-api"></a>
## 服务 API

`ctx.sessionContext` 寻址一项实时 Agent，并导出生成的 Typert 宿主与 Client Remote contribution。

- `inspect(agent, request, signal)` 捕获一份稳定表层 cut，返回从尾部开始的一页工具平衡单元、token 总量、路由元数据、代际状态和最近的持久 preparation。`beforeIndex` 是排他单元位置；`maxUnits` 受配置上限约束。
- `readUnit(agent, unitId, signal)` 返回一个当前单元的完整消息。它会拒绝陈旧、已遮蔽、格式错误或工具交换尚未闭合的身份。
- `rewrite(agent, request, signal)` 执行空闲状态下的同 Session 替换。`edit-and-continue` 遮蔽选中单元到当前尾部，`patch` 只遮蔽该单元。请求必须指向已加载尾部，并且只有用户编写的单消息单元可编辑。宿主保留图片块并替换文字。改写不会启动模型轮次：替换内容成为 Agent 下一次所服务请求的当前上下文。
- `prepare(agent, request, signal)` 持久记录一项选中的平衡范围、准确模型容量计划、每次调用尝试，以及每次完成的 direct 或 map/reduce 调用，但不修改表层。失败的评审投影会区分尝试次数与完成次数。同一时间只能有一项 preparing、ready 或 committing preparation。
- `editPreparation()`、`discardPreparation()` 与 `commitPreparation()` 修改、丢弃或提交持久评审状态。Commit 会在短暂空闲 maintenance 中重新校验成员关系、digest、价格、工具平衡与摘要缩减，再 flush 标准压缩 bracket。
- `commitPreparationInTurn()` 在模型工具已经打开的轮次中执行同样的重新校验提交。
- `historyRead()` 在完整响应字节上限内递归渲染一个检查点遮蔽的准确消息。不透明游标只对同一检查点、递归模式和读取操作有效。
- `historySearch()` 对同一批原文执行有界字面搜索。其游标还绑定查询与大小写模式，不能用于其他搜索。

缺失或重复的检查点身份、格式错误的生命周期顺序、陈旧单元、陈旧范围 preparation 和无效上限都会快速失败。系统会在修改前以及协作式检查或召回让出点观察取消信号。

<a id="context-units-and-generations"></a>
## Context 单元与代际

单元遵循当前表层顺序，并且只在工具平衡切点结束。一条用户或 assistant 消息通常形成一个单元；assistant 工具调用及其全部结果形成不可分割的 `tool-exchange`；压缩替换形成 `checkpoint` 单元。

单元 id 编码端点 seq 与准确有序成员关系的 digest。无关的仅日志追加不会改变 id；所表示的表层成员变化时，id 会改变。

每次位置表层替换都会递增 `replaceGeneration`。`generationSeq` 是最近一次替换表层区间的事件的 seq，因实时表层只暴露替换次数而由已提交日志派生；初始代际为 `null`。这些值均由回放派生，不会创建另一份持久 transcript。

<a id="durability-and-authority"></a>
## 持久性与权限

改写与压缩会追加替换消息及相关生命周期事实。它们不会删除旧消息、撤销文件系统或进程副作用，也不会改写 Chat。每次改写会 flush 替换消息与一条仅日志的 `context/rewrite` 记录，后者说明被遮蔽的确切区间，因此「某个节点为何不在当前模型上下文中」始终可以从仅追加日志重建。

检查点召回只会解析目标 Session 中持久 `compaction/summary` 所引用的 seq。附件引用保持原有已授权值；该服务不会增加跨 Session 读取路径或第二套历史存储。

<a id="performance"></a>
## 性能

检查使用一次表层捕获、缓存的工具平衡位置，按 seq 索引已提交事件，并通过 `TokenMeter.measure()` 对当前表层只计一次价。它不会访问 `Session.events`、解码无关的打包分片，或为有界页面复制全部已计价表层节点。

范围 preparation 与 commit 只复制选中的位置。召回从借用的内容块片段组装规范可读文本，在字素簇边界拆分读取，在 Unicode 标量边界扫描搜索页，并在长操作期间协作式让出。

<a id="model-experience"></a>
## 模型体验

### 同 Session 改写

#### 模型看到什么

下一次请求会在所选表层位置看到替换后的 user-role 消息。`edit-and-continue` 省略依赖后缀，`patch` 保留后缀。系统不会加入合成继续文字。

#### Token 影响

替换消息的估算价格会取代准确被遮蔽节点的价格。之后的模型输出正常追加，`shadowedTokenCount` 报告被移除的估算量。

#### KV Cache 影响

第一个被替换消息之前仍可复用，从该位置开始失效。Patch 虽保留后缀内容，但前缀变化后仍需重新处理它。

### 可评审范围压缩

#### 模型看到什么

Preparation 不改变任何输入。Commit 用标准带框架压缩检查点替换已评审范围；之后的上下文仍位于其后，并在冲突时优先。

#### Token 影响

当完整所选请求与动态输出上限能够放入摘要模型时，Preparation 只发出一次直接辅助调用；只有超窗请求才使用 map/reduce。成功 commit 要求带框架检查点的估算量小于所选范围，并按差值降低之后的对话历史输入。

#### KV Cache 影响

Preparation 是独立请求。Commit 保留范围之前的复用资格，并使对话请求从范围起点失效。

### 检查点召回

#### 模型看到什么

服务本身不增加请求内容。工具消费方可以把选中的准确原文作为普通工具结果返回到上下文尾部。

#### Token 影响

宿主读取直接产生零 token。消费方把召回内容发给模型时，只支付有界返回结果的成本。

#### KV Cache 影响

宿主读取不影响 cache 状态。被召回工具结果会追加在既有请求前缀之后。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **需要实时 Agent** — Remote lookup 寻址 Agent-backed Session；该服务不会直接检查任意已持久化但尚未加载的日志。
- **仅支持会话内字面召回** — 搜索不提供正则、语义排序或跨会话索引。
- **启发式表层计价** — 当权威提供方用量无法为单个节点计价时，单元与被遮蔽 token 数使用共享固定估算器。
- **外部副作用保持当前状态** — 改写模型上下文不会恢复文件、进程、网络状态、审批、后台任务或目标。
- **改写不触发续跑** — 改写只替换上下文，不启动模型轮次；Agent 在下一次请求时使用替换结果。上游没有「不携带消息」的续跑入口。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
