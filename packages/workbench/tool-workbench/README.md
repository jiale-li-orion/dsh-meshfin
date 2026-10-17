# @deepseek-ai/dsh-tool-workbench

English | [中文](README.zh.md)

The model-facing workbench view controls over `ctx.workbench`: `workbench_open`, `workbench_close`, and `workbench_status`. Each call writes the same shared view the browser renders and returns a short notice naming the committed state; none of them touches the browser directly, so an agent call and a human gesture converge on one state and the `workbench/changed` event carries it to both.

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

- **The tools cannot enumerate panels** — panel ids are the browser's slot-registry keys, so the model must be told a valid id (or omit it) rather than discover one.
- **No panel content tools** — reading or editing files through the workbench is a later phase; these tools only drive the shared view.
