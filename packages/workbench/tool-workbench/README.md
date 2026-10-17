---
description: "The model-facing workbench view controls: workbench_open, workbench_close, and workbench_status over the shared ctx.workbench view."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-workbench

English | [中文](README.zh.md)

## Summary

The model-facing controls for the shared workbench view. `workbench_open` opens the column and optionally selects a panel, `workbench_close` closes it while keeping the selection, and `workbench_status` reports the committed view. Each call writes the same value the browser renders and returns a short notice naming it, so an agent call and a human gesture converge on one state and `workbench/changed` carries it to both. No tool touches the browser, and no panel content reaches the model.

## Table of Contents

- [Tools](#tools)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="tools"></a>
## Tools

`workbench_open` takes an optional `panel` id; omitting it keeps the current selection. `workbench_close` closes the column and keeps the selection, so the next open returns to it. `workbench_status` reads the view without changing it. Every result carries the notice `text` plus `open` and, when a panel is selected, `active`.

The view is shared state rather than session state, so all three tools act on the same column for every connected browser and agent. [The workbench subsystem page](../../../docs/subsystems/workbench.md) owns that view and the byte route the panel's files come from.

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The generated [`workbench_open`, `workbench_close`, and `workbench_status` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-workbench) while this tool set is visible.

#### Token effect

Fixed schema cost on each request where the tools are visible.

#### KV Cache effect

Prefix-stable while tool definitions and visibility are unchanged. Registration lifecycle or scoped restrictions may invalidate reuse from the first changed schema token.

### Results and notices

#### What the model sees

`workbench_open` returns `Workbench opened on panel "<id>".` or `Workbench opened; no panel selected.`; `workbench_close` returns `Workbench closed.`; `workbench_status` returns the notice for the current view. Each result also carries `open` and, when selected, `active`.

#### Token effect

Results remain in parent history until compaction. The notice is one short line; no panel content reaches the model.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The tools cannot enumerate panels** — panel ids are the browser's slot-registry keys, so the model must be told a valid id (or omit it) rather than discover one.
- **No panel content tools** — reading or editing files through the workbench is a later phase; these tools only drive the shared view.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
