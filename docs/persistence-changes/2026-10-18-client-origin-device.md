---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-18-client-origin-device

English | [中文](2026-10-18-client-origin-device.zh.md)

## Summary

The durable `user-rpc` prompt source gains an optional `clientDevice` class, and the `client-origin` context provider registers its own user-message source kind to report that class to the model.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

All four affected roots gain the same two additions: an optional `clientDevice` string on the `kind: 'user'` prompt source and one attribution-only source kind, `client-origin`, for the statement the provider appends at the step that opens a turn. A reader that predates the field reads such a message as an ordinary user prompt: `clientDevice` is optional JSON metadata beside `rpcId` and `clientTimeZone`, the discriminator stays `kind: 'user'`, and nothing consults the field unless the provider is mounted. A log written without the provider contains no `client-origin` message, and its absent `clientDevice` keeps the previous behavior — no class is recorded and the provider adds nothing. A current reader reading an older log finds no `clientDevice`, so it states no client class rather than guessing a device; the `client-origin` kind is merge-extensible and declared `@persistenceAttribution`, so a reader that does not know it preserves the message content unchanged, which is plain model-facing text. `SESSION_FORMAT_VERSION` is unchanged: the field is optional, the new kind is attribution-only, and no existing discriminator changes meaning.

<a id="verification"></a>
## Verification

`pnpm run gen-persistence-catalog` rewrote `docs/persistence-catalog.md`, its Chinese sibling, both i18n records, `packages/core/session/src/known-event-types.ts` and `docs/persistence-schema.json`; `pnpm run verify-persistence-catalog` then reported them up to date. `pnpm run verify-persistence-changes` reported these eight paths as the established optional-property-added and attribution-kind-added same-version cases, and accepts this record (`74 roots match 19 history records`). `pnpm exec tsc -b packages/context/client-origin/tsconfig.json packages/api/session-controller/tsconfig.host.json packages/llm/llm/tsconfig.json` exits 0. `pnpm exec vitest run packages/context/client-origin packages/api/session-controller packages/llm/llm` reports 2390 of 2391 tests passing; the new derivation, pre-step, device-class and durable-source tests all pass, and the single failure is `projection-discovery.host.spec.ts`, which imports the unbuilt artifact `@deepseek-ai/dsh-session-format/lib/index.js` and touches nothing this change alters.

<a id="dev-note"></a>
## Dev Note

None.
