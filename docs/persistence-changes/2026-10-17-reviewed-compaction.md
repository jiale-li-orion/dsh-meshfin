---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-17-reviewed-compaction

English | [中文](2026-10-17-reviewed-compaction.zh.md)

## Summary

Reviewed range compaction adds eight durable `compaction/preparation/*` events and optional `preparationId`/`summarySource` fields on the existing compaction events, so a prepared summary can be reviewed, edited, discarded, or committed as one bracketed compaction.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

All additions are optional or are new event roots, so a session written before this change still reads. A log containing the new events is readable only by a build that declares them: this repository declares them, and the generated `known-event-types.ts` records them as the current format's vocabulary. No stored event changes meaning and no version bump is implied.

<a id="verification"></a>
## Verification

`pnpm run verify-persistence-catalog` and `pnpm run verify-persistence-changes` pass against this record; `pnpm exec vitest run packages/compaction` covers the preparation lifecycle (requested, planned, ready, edited, discarded, committed) and the existing compaction transactions.

<a id="dev-note"></a>
## Dev Note

None.
