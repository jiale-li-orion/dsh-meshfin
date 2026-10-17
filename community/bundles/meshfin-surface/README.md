# @muwinds/dsh-meshfin-surface

English | [中文](README.zh.md)

This distribution's own capabilities as one optional bundle. Selecting it adds three things a stock DeepSeek Harness profile does not have: a Context view beside Chat that shows what the next model request is built from, lets one editable unit be rewritten durably, and reviews a prepared compaction before it commits; the model-facing tools that drive the same operations; and a Workbench view the browser and the agent both mutate, whose preview reads one workspace file through an authenticated Range route.

## Use this package

Install it into a profile and restart:

```sh
dsh plugin --profile web add ./community/bundles/meshfin-surface
```

The bundle inserts seven rows: `session-context` and `tool-session-context` with the `ui-context` view; `workbench`, `workbench-bytes` and `tool-workbench` with the `ui-workbench` tab. Every row is removable by id from a profile patch, and the bundle installs nothing else.

## What each surface means

- **Context view.** A person sees the units a request is built from and can rewrite one editable unit; the rewrite is durable and the next request uses it. The model gains `context_inspect`, `context_read`, `context_prepare`, `context_edit_preparation`, `context_commit`, `context_discard_preparation`, `history_read` and `history_search`, which inspect the same units, prepare and commit a reviewed compaction, and recall what a checkpoint shadowed.
- **Workbench view.** One committed value — open flag and selected panel — lives on the Host. A browser gesture and an agent `workbench_open` call move the same value, and every commit emits `workbench/changed`, so both sides converge. The preview streams a workspace file through `/api/workbench/file`, which is authenticated by the connection carrier and fenced to the session workspace.

## Known Limitations and Deferred Work

- The Workbench renders one file preview and its panel list; the file tree, uploads, theme and market panels stay with the official sidebar and settings surfaces.
- Rewritten units report the `user` role: upstream has no catch-all message-source kind for a synthetic rewrite, so the durable `context/rewrite` record carries the identity instead.
- Recall reads replay through one snapshot of the session log per call; there is no storage-backed asynchronous reader yet.

## Dev Note

None.
