---
description: "The eight model-facing Context tools: bounded inspection, reviewed range compaction, and bounded checkpoint recall over `ctx.sessionContext`."
kind: "package-reference"
---

# `@deepseek-ai/dsh-tool-session-context`

English | [中文](README.zh.md)

## Summary

These tools let the model look at and manage its own context. `context_inspect` returns a bounded page of the exact units the next request will send, priced and grouped at tool-balanced cuts; `context_prepare` records a reviewable summary of one range without changing anything, and only `context_commit` replaces it. `history_read` and `history_search` page the exact originals a compaction shadowed. Every value that addresses an operation — unit, preparation, checkpoint, cursor — comes from a preceding result, so the model never constructs one. Recall adds ordinary context, so a caller should ask for what the task needs.

## Table of Contents

- [Tools](#tools)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----


Model-facing Consumer for current Context inspection, reviewed range compaction, and checkpoint recall. It delegates authority, durability, stale-state checks, and bounds to [`ctx.sessionContext`](../session-context/README.md).

<a id="tools"></a>
## Configuration

| Field | Default | Meaning |
|---|---:|---|
| `maxUnits` | `100` | Maximum units one `context_inspect` call may request. |
| `historyBytes` | `32768` | Complete response-byte request passed to `history_read`. |
| `searchBytes` | `524288` | Maximum original bytes one `history_search` call may scan. |
| `searchResults` | `20` | Maximum literal matches one `history_search` call may return. |

## Tools

The generated [tool schema catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-session-context) owns exact descriptions and JSON Schemas.

| Tool | Operation |
|---|---|
| `context_inspect` | Read a bounded tail-first page of current balanced units, token prices, generations, checkpoints, and preparations. |
| `context_read` | Read complete content for one current unit id. |
| `context_prepare` | Generate and durably record a reviewable summary without changing current Context. |
| `context_edit_preparation` | Replace the complete summary of one ready preparation with model-authored Markdown. |
| `context_commit` | Revalidate and commit a reviewed preparation inside the current turn. |
| `context_discard_preparation` | Discard a ready or failed preparation without changing Context. |
| `history_read` | Read one bounded page of exact checkpoint originals, optionally expanding nested checkpoints. |
| `history_search` | Perform bounded literal search over the same reachable originals. |

Every operation requires `exec.agent`; a non-Agent invocation fails. Read-only operations are concurrency-safe. Mutation operations serialize through the owning Agent or the durable preparation lifecycle. Opaque unit, preparation, checkpoint, and cursor values must come from preceding tool results rather than being inferred.

## System-prompt guidance

The plugin registers one stable prompt section:

```markdown
Use context_inspect to see the exact durable conversation context used by the next request; Chat history may include shadowed messages that are absent here.
For range compaction, call context_prepare first. It records and returns a reviewable summary without changing context. Inspect or edit that summary, then call context_commit only when it preserves the needed facts.
Compaction and rewrite never delete the append-only log or roll back files, processes, network effects, approvals, goals, or other external state.
Use history_read or history_search with a checkpoint_id to recover exact shadowed originals. Returned tool results become ordinary new context, so recall only what the task needs.
```

<a id="model-experience"></a>
## Model Experience

### Tool schemas and guidance

#### What the model sees

The model receives the eight schemas in the generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-session-context) plus the stable guidance quoted above while this plugin is in its Agent composition.

#### Token effect

The schemas and guidance add a fixed request-prefix cost. `maxUnits`, history bytes, search bytes, and result count bound data-dependent tool results.

#### KV Cache effect

The schema and guidance prefix is stable while the plugin configuration and tool set are unchanged. Adding, removing, or reconfiguring the plugin can invalidate reuse from the first changed schema or prompt token.

### Inspection and recall results

#### What the model sees

Successful reads return JSON metadata, current messages, canonical checkpoint originals, or literal-match snippets. Recall returns only the requested bounded page; it does not inject the complete checkpoint automatically.

#### Token effect

Each result appends as an ordinary tool result and is resent on later steps until replaced or compacted. The configured byte and item limits cap one call, not the cumulative cost of repeated calls.

#### KV Cache effect

Tool results append after the reusable request prefix. Later context replacement may invalidate reuse from the selected replacement position.

### Reviewed compaction mutations

#### What the model sees

Preparation changes no conversation message. `context_commit` replaces the selected range with the standard framed checkpoint; subsequent steps in the same turn derive from that committed Context.

#### Token effect

Preparation pays for one or more auxiliary summarizer calls. Commit requires the framed checkpoint to be smaller than the selected range, reducing future history input.

#### KV Cache effect

Auxiliary calls are independent. A committed replacement preserves the prefix before the range and invalidates the conversation request from the range start.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No model-facing message rewrite tool** — same-Session edit-and-continue is currently a human Web action; the model can inspect, compact, and recall but cannot directly rewrite an arbitrary current user message.
- **Literal recall only** — the Consumer exposes no regex, semantic, or cross-session search.
- **Repeated reads accumulate** — returned originals become normal tool results; the model must request only needed pages or compact them later.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
