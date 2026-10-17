---
description: "Package map for the workbench family: the shared view the browser and the agent both mutate, the model-facing view tools over it, and the fenced byte route that feeds the file viewer."
kind: "package-group"
---

# workbench/ — shared workbench column

English | [中文](README.zh.md)

## Summary

The `workbench/` group backs one column of the product UI: whether it is open, which panel it shows, and the bytes its viewer renders. The state service owns the single committed view both planes mutate; the tool package is the model-facing consumer that opens, closes, and reports it; the byte package serves one workspace file at a time over the authenticated carrier. Mount all three to give an agent and a browser the same column, or the state service alone when only a client drives it.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Each package below provides one piece of the column; open a package page for its contract and configuration.

| Package | Role | ctx key |
|---|---|---|
| [`workbench/`](workbench/README.md) | Owns the shared view, the workspace fence, the media-type map, and the byte route's path | `ctx.workbench` |
| [`tool-workbench/`](tool-workbench/README.md) | The model-facing `workbench_open`, `workbench_close`, and `workbench_status` tools over that view | `workbench_open`, `workbench_close`, `workbench_status` |
| [`workbench-bytes/`](workbench-bytes/README.md) | Serves one workspace file per request to the browser viewer, with `Range` support | registers on `ctx.connection.fetch` |

<a id="related-documentation"></a>
## Related documentation

- [Workbench subsystem](../../docs/subsystems/workbench.md) — the shared-view, fence, and byte-route semantics these packages implement.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
