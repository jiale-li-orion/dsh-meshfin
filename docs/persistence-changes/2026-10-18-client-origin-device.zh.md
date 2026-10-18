---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-18-client-origin-device

[English](2026-10-18-client-origin-device.md) | 中文

## 概述

持久的 `user-rpc` prompt 来源新增可选的 `clientDevice` 客户端类别；`client-origin` 上下文 provider 注册自己的用户消息来源 kind，把该类别告知模型。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-18-client-origin-device
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "e7e66f7145e4d211ec93cdad11dcf1e06a7db953d82aa091878e1097aed344fb"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "5edcf96942683e1dc2858f463624e59a900c81ae3011e5c8d1ced843666f4d45"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "866684c5abdd1a1118e332a8aef792ec58f54929c2ad3f4792abbe845a3ced34"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "320c4b7ca503009246fb421c1aba9483036294b959e64ef3e380a4d27a70717d"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

受影响的四个 root 都得到相同的两处新增：`kind: 'user'` prompt 来源上可选的时间客户端类别字符串 `clientDevice`，以及一个仅作归因的来源 kind `client-origin`，承载 provider 在开启轮次的 step 追加的那条消息。早于该字段的读取方把这类消息当作普通用户 prompt 读取：`clientDevice` 是与 `rpcId`、`clientTimeZone` 并列的可选 JSON 元数据，判别式仍是 `kind: 'user'`，未挂载该 provider 时没有任何代码读取该字段。未挂载 provider 的日志不含 `client-origin` 消息，其缺失的 `clientDevice` 保持原有行为——不记录类别，provider 也不追加内容。当前读取方读旧日志时找不到 `clientDevice`，因此不声明客户端类别，也不猜测设备；`client-origin` kind 可合并扩展并标注了 `@persistenceAttribution`，不认识它的读取方原样保留消息内容，而该内容就是普通的模型可见文本。`SESSION_FORMAT_VERSION` 不变：字段可选，新 kind 仅作归因，且既有判别式的含义没有变化。

<a id="verification"></a>
## 验证

`pnpm run gen-persistence-catalog` 重写了 `docs/persistence-catalog.md`、中文版本、两份 i18n 记录、`packages/core/session/src/known-event-types.ts` 与 `docs/persistence-schema.json`；随后 `pnpm run verify-persistence-catalog` 报告其已是最新。`pnpm run verify-persistence-changes` 把这八条路径列为既定的 optional-property-added 与 attribution-kind-added 同版本情形，并接受本记录（`74 roots match 19 history records`）。`pnpm exec tsc -b packages/context/client-origin/tsconfig.json packages/api/session-controller/tsconfig.host.json packages/llm/llm/tsconfig.json` 退出码为 0。`pnpm exec vitest run packages/context/client-origin packages/api/session-controller packages/llm/llm` 报告 2391 个测试中 2390 个通过；新增的类别推导、pre-step、客户端类别与持久来源测试全部通过，唯一失败的是 `projection-discovery.host.spec.ts`，它导入尚未构建的产物 `@deepseek-ai/dsh-session-format/lib/index.js`，与本次改动无关。

<a id="dev-note"></a>
## 开发备注

无。
