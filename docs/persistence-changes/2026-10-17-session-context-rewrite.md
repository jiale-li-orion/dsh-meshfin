---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-17-session-context-rewrite

English | [中文](2026-10-17-session-context-rewrite.zh.md)

## Summary

Adds the log-only `context/rewrite` event, which records one committed same-Session context replacement: its durable rewrite identity, the replacement message seq, the exact surface span and nodes it shadowed, the mode that decided whether the dependent suffix was superseded, and the route-priced total of the removed nodes.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

A new event root only adds vocabulary. A session written before this change reads unchanged because no stored event or field changes meaning. A log containing `context/rewrite` is readable only by a build that declares it: the type is a required-on-read `SessionEventMap` member, so an older reader refuses the log instead of silently dropping a record that explains why current model context no longer contains nodes still present in the append-only log. The replacement itself is an ordinary `user/message` carrying a `replace` surface operation, which every release already understands.

<a id="verification"></a>
## Verification

pnpm run gen-persistence-catalog regenerated the inventory, catalog, and known-event-types.ts; pnpm run verify-persistence-catalog reports the generated artifacts up to date; pnpm exec vitest run packages/session/session-context passes 10 tests, including the rewrite cases that assert the replacement's generation seq and the retained append-only originals.

<a id="dev-note"></a>
## Dev Note

None.
