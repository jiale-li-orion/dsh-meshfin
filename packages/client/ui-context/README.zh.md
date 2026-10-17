---
description: "Context Conversation View：一个会话下一次模型请求由哪些单元构成、对可编辑单元的一次持久改写，以及提交前对已准备压缩的审阅。"
kind: "package-reference"
---

# `@deepseek-ai/dsh-client-ui-context`

[English](README.md) | 中文

用于检查和修改当前模型 Context、同时保持仅追加来源 Chat transcript（文本记录）不变的浏览器插件。它贡献 Context Conversation View、输入框上下文占用面板中的一项操作、Chat 改写标记，以及每 Session 控制器和查看状态。

## 目录

- [概述](#summary)
- [用户流程](#user-workflow)
- [架构](#architecture)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="summary"></a>
## 概述

与 Chat 并列的 Context Conversation View 展示下一次模型请求由哪些单元构成，允许对一个可编辑单元做持久改写，并在提交前审阅已准备的压缩。

<a id="user-workflow"></a>
## 用户流程

Context 作为 Conversation View 与 Chat 并列，位于 Session 头部的 View 切换条。标题区展示当前 Context 版本、已路由提供方／模型、单元数，以及对话消息、系统提示词、工具 schema 与估算总量的 token 估算。

单元列表使用虚拟化，初始只读取有界尾页。每行展示角色、非默认类型、持久 seq 范围、估算 token 与有界预览。“加载更早上下文”只会在较早页仍能与同一代际相接时前插；否则控制器会刷新当前尾部。

每行开头都有明确的勾选按钮。点击勾选按钮或行正文可选择一个单元；按住 Shift 点击另一行可扩展两者之间的连续范围；“从这里选到末尾”会把第一个选中单元一直扩展到当前 Context 尾部。选择栏展示单元与 token 总量。包含未结束工具交换的范围不能压缩。

### 编辑并继续

每条可编辑的用户提示词都直接提供编辑操作，并打开由点读内容填充的对话框。“编辑并继续”替换该行到当前尾部，并从修正后的 Context 启动模型轮次。助手消息、后台注入、检查点与工具交换仍为只读。

“仅修补此条”会保留后续回答。对话框要求用户显式确认这些回答基于旧值生成。图片继续由宿主授权；只有在仍保留图片时，才允许清空全部文字。

Chat 保留每条原始记录，并增加链接回 Context 的持久“模型上下文已更新”标记。文件、进程、网络副作用、审批、后台任务、目标和其他外部状态都不会回滚。

### 压缩所选范围

“压缩所选”会打开一个可恢复对话框；准入、生成进度、失败、摘要编辑、重新生成与提交始终在这里完成。它会展示所选范围、摘要模型、direct 或 map/reduce 策略、上下文与输入预算、输出上限、尝试与完成调用次数、分片、摘要来源和可编辑 Markdown。

关闭对话框会保留持久 preparation 与本地摘要草稿；页头操作可以重新打开它，不会把用户移回很长 Context 列表的开头。用户可以保存修改、重新生成、丢弃或提交。只有非空摘要才能提交，并且只有宿主重新校验所选范围成功后才会生效。并发修改会让 preparation 保持可见并显示可操作错误，而不会把它应用到其他内容。

### 召回检查点原文

检查点详情抽屉展示带框架摘要，并提供递归原始消息分页和字面搜索。原始消息与搜索结果分区展示。读取与搜索可以通过不透明游标继续，而无需一次加载完整来源记录。

<a id="architecture"></a>
## 架构

`SessionContextController` 是负责 Remote 调用、取消、去重、陈旧页面修复和不可变输出的 React-free 对象层。它只在 Context 视图挂载时订阅 Session 的 `contextPressure` projection，并在该宿主计算的提示词数值变化时刷新——当前表面增减计价节点时，这个数值恰好会变。preparation 变更在结算后显式刷新。

Slot 注册拥有一份按 Session 持久化的查看 store，保存选择、详情、编辑器、preparation 与摘要草稿状态。业务组件通过标准四类 props share 接收框架 hook、store action 和收窄回调；它们不会接收 Cordis context 或 Remote 服务对象。

输入框的上下文占用面板通过自身 slot 渲染其他功能贡献的操作行，因此本插件无需拥有 meter 即可进入该面板。从该行选中 Context View 走 `ctx.conversation.requestView`，与头部 View 切换条写入的是同一份按 Session 的选择；shell 只会为 Conversation 已挂载的 Session 应答它。

插件通过所属 fiber 注册全部 contribution。卸载会移除 Context View、占用面板操作、Chat renderer、Conversation Definition、字典、控制器和 store，但不会改变宿主 Session 数据。

<a id="model-experience"></a>
## 模型体验

### Context 检查 UI

#### 模型看到什么

打开、分页、选择或展开 Context 视图不会让模型看到任何新增内容，因为这些操作只执行宿主读取，不会增加 Session 事件或请求内容。

#### Token 影响

直接产生零 token。界面展示的是 Session、系统提示词和工具 schema 生产方已经拥有内容的估算量。

#### KV Cache 影响

只读 UI 操作不会改变请求或可复用前缀。

### 人工改写与压缩操作

#### 模型看到什么

成功改写或压缩会通过 `ctx.sessionContext` 改变宿主拥有的当前 Session 表层。Edit-and-continue 从已提交替换启动下一次请求；单独 preparation 与评审不会改变任何输入。

#### Token 影响

改写会替换选中的当前内容，已提交压缩则要求检查点更小。除了所调用宿主操作自身的内容，UI 不增加模型可见框架。

#### KV Cache 影响

所调用宿主替换会保留变更表层位置之前的复用，并从该位置开始使复用失效。UI 草稿以及失败或已丢弃的 preparation 不影响 cache。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **仅当前代际** — Chat 与 Trajectory 会保留过去证据，但 Context tab 尚不能切换历史代际或把某一代重新设为当前代。
- **只能选择已加载范围** — 范围只能包含虚拟列表中当前已加载的单元；用户必须先加载较早页面。
- **没有语义召回 UI** — 检查点搜索与宿主能力一致，只支持会话内字面搜索。
- **不能撤销执行世界** — 警告会说明上下文变更无法还原外部副作用。

<a id="dev-note"></a>
### 开发备注

无。
