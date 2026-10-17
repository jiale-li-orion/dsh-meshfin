---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-17-session-context-rewrite

[English](2026-10-17-session-context-rewrite.md) | 中文

## 概述

新增仅记录日志的 `context/rewrite` 事件，记录一次已提交的同 Session 上下文替换：其持久化替换标识、替换消息的 seq、被遮蔽的确切 surface 区间与节点、决定后续后缀是否被取代的模式，以及被移除节点的路由计价总量。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-17-session-context-rewrite
baseline: false
changes:
  - root: "event:context/rewrite"
    previous: null
    after: "5d0ac8cc07cea04c25961bfe73490eb7f61d11900e28b9185b00341e22556e13"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新增事件根只增加词汇。本次变更前写入的 Session 仍可读取，因为没有任何已存事件或字段的含义改变。只声明该事件类型的新构建可以读取包含 `context/rewrite` 的日志：该类型是 `SessionEventMap` 的必读成员，因此旧读取方会拒绝该日志，而不是静默丢弃一条解释「当前模型上下文为何不再包含仅追加日志中仍存在的节点」的记录。替换本身仍是普通的 `user/message`，携带 `replace` surface 操作，所有已发布版本都能理解。

<a id="verification"></a>
## 验证

pnpm run gen-persistence-catalog 重新生成了清单、目录与 known-event-types.ts；pnpm run verify-persistence-catalog 报告生成产物为最新；pnpm exec vitest run packages/session/session-context 的 10 个测试全部通过，包括断言替换代次 seq 与保留仅追加原文的 rewrite 用例。

<a id="dev-note"></a>
## 开发备注

无。
