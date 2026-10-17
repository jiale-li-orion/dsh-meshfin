---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-17-reviewed-compaction

[English](2026-10-17-reviewed-compaction.md) | 中文

## 概述

审阅式范围压缩新增八个 durable 的 `compaction/preparation/*` 事件，并在既有压缩事件上新增可选的 `preparationId`/`summarySource` 字段，使一份准备好的摘要可以被审阅、编辑、丢弃或作为一次带括号的压缩提交。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-17-reviewed-compaction
baseline: false
changes:
  - root: "event:compaction/end"
    previous: "2026-09-11-initial"
    after: "4d3919957ede43aa31ce27dffa5efba3d208356a7abbfe0110c3df949d083fa6"
    decision: same-version
  - root: "event:compaction/preparation/attempted"
    previous: null
    after: "efd52579f6a5f5f5ce0d8a3b5305a51263e857a8811e48494fb265c0b7ae8890"
    decision: same-version
  - root: "event:compaction/preparation/call"
    previous: null
    after: "4c4f9b87693e7bfc268c74276688b623349346d41b5008463826e29f7304707e"
    decision: same-version
  - root: "event:compaction/preparation/discarded"
    previous: null
    after: "879478b4c386c46c589a3aa8a3324dbd6c80b409d5cd509e970b35a6a1b9e646"
    decision: same-version
  - root: "event:compaction/preparation/edited"
    previous: null
    after: "e9bf290e89fd4e44e20d8f278e1e115f3408fae45c91b1b693510bf6b8699b45"
    decision: same-version
  - root: "event:compaction/preparation/failed"
    previous: null
    after: "b6140f459b0b86a46c4e66d41adc2f9d87282b7c6ff8445ffd562f01a7772e5a"
    decision: same-version
  - root: "event:compaction/preparation/planned"
    previous: null
    after: "9f3d7e8251843c8950f92bd8f52c820d9485fcfec39350247a0379eabf79d9de"
    decision: same-version
  - root: "event:compaction/preparation/ready"
    previous: null
    after: "f69e6d9da606ba697f23804026f98248add7a84860f88f19347b639bf4be81e9"
    decision: same-version
  - root: "event:compaction/preparation/requested"
    previous: null
    after: "378cbd5f048342aeb4d07b8a9879164c634cfbbf37770ba1c9868d929e269fab"
    decision: same-version
  - root: "event:compaction/start"
    previous: "2026-09-11-initial"
    after: "f7849b2a519208cc2518372a384a6e71c8fc29e9fc67c23c257a33c9fa684aec"
    decision: same-version
  - root: "event:compaction/summary"
    previous: "2026-09-16-session-format-v4"
    after: "c84cbe1b1dc7c59d5153e663e7bc103a0797776307bfac39dc49c7067c865967"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新增内容要么是可选项，要么是全新的事件根，因此本次改动之前写入的会话仍可读取。包含新事件的日志只能被声明了这些事件的构建读取：本仓库声明了它们，生成的 `known-event-types.ts` 把它们记入当前格式的词汇表。没有已存事件改变含义，也不需要版本号提升。

<a id="verification"></a>
## 验证

在本记录下 `pnpm run verify-persistence-catalog` 与 `pnpm run verify-persistence-changes` 均通过；`pnpm exec vitest run packages/compaction` 覆盖准备生命周期（requested、planned、ready、edited、discarded、committed）以及既有压缩事务。

<a id="dev-note"></a>
## 开发备注

无。
