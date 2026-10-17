# `@deepseek-ai/dsh-client-ui-context`

English | [中文](README.zh.md)

Browser plugin for inspecting and changing the current model Context without changing the append-origin Chat transcript. It contributes the Context Conversation View, an action inside the composer's context-occupancy panel, a Chat rewrite marker, and per-Session controller and viewing state.

## User workflow

Context appears as a Conversation View beside Chat, in the Session header's View strip. The header shows the current Context version, routed provider/model, unit count, and token estimates for conversation messages, system prompt, tool schemas, and the estimated total.

The unit list is virtualized and initially reads a bounded tail page. Each row shows role, non-default kind, durable seq span, estimated tokens, and a bounded preview. “Load earlier context” prepends a page only while it still joins the same generation; otherwise the controller refreshes the current tail.

Each row starts with a visible selection check. Click the check or row to choose one unit, Shift-click another row to extend the contiguous range, or use “Select from here to end” to extend the first selected unit through the current Context tail. The selection bar reports unit and token totals. A range containing an unfinished tool exchange cannot be compacted.

### Edit and continue

Every editable user prompt has a direct edit action. It opens a dialog populated from a point read. “Edit and continue” replaces that row through the current tail and starts a model turn from the corrected Context. Assistant messages, background injections, checkpoints, and tool exchanges remain read-only.

“Patch this item only” retains later replies. The dialog requires an explicit acknowledgement that those replies were produced from the old value. Images remain Host-authorized; clearing all prose is allowed only when an image remains.

Chat keeps every original row and adds a durable “Model context updated” marker linking back to Context. Files, processes, network effects, approvals, jobs, goals, and other external state are not rolled back.

### Compact a selected range

“Compact selection” opens one recoverable dialog that remains the home for admission, generation progress, failure, summary editing, regeneration, and commit. It shows the selected range, summarization model, direct or map/reduce strategy, context and input budgets, output cap, attempted and completed calls, chunks, summary origin, and editable Markdown.

Closing the dialog preserves the durable preparation and local summary draft; a header action reopens it without moving the user to the start of a long Context list. The user can save an edit, regenerate, discard, or commit. Commit is enabled only for a non-blank summary and succeeds only if the Host revalidates the selected range. A concurrent mutation leaves the preparation visible with an actionable error rather than applying it to different content.

### Recall checkpoint originals

A checkpoint detail drawer shows the framed summary and offers recursive original-message paging plus literal search. Original messages and search results have separate sections. Reads and searches can continue through opaque cursors without loading the complete provenance at once.

## Architecture

`SessionContextController` is the React-free object layer for Remote calls, cancellation, deduplication, stale-page repair, and immutable output. It subscribes to the Session's `contextPressure` projection only while the Context view is mounted, and refreshes when that Host-computed prompt figure moves — the figure changes exactly when the current surface gains or loses priced nodes. Preparation mutations refresh explicitly after they settle.

The slot registration owns a per-session persisted viewing store for selection, detail, editor, preparation, and summary-draft state. Business components receive framework hooks, store actions, and narrowed callbacks through the standard four-share slot contract; they receive no Cordis context or Remote service object.

The composer's occupancy panel renders contributed action rows through its own slot, so this plugin reaches the panel without owning the meter. Selecting the Context View from that row goes through `ctx.conversation.requestView`, the same per-Session selection the header's View strip writes; the shell only answers it for a Session whose Conversation is mounted.

The plugin registers all contributions through the owning fiber. Unloading it removes the Context View, the occupancy action, the Chat renderer, the Conversation Definition, dictionaries, controllers, and stores without changing Host Session data.

## Model Experience

### Context inspection UI

#### What the model sees

The model sees nothing from opening, paging, selecting, or expanding the Context view because these actions perform Host reads only and add no Session event or request content.

#### Token effect

Zero direct tokens. Displayed counts are estimates of content already owned by Session, system-prompt, and tool-schema producers.

#### KV Cache effect

Read-only UI actions do not change the request or its reusable prefix.

### Human rewrite and compaction actions

#### What the model sees

A successful rewrite or compaction changes the Host-owned current Session surface through `ctx.sessionContext`. Edit-and-continue starts the next request from the committed replacement; preparation and review alone change nothing.

#### Token effect

Rewrite substitutes the selected current content, while committed compaction requires a smaller checkpoint. The UI itself adds no model-visible framing beyond the Host operation it invokes.

#### KV Cache effect

The invoked Host replacement preserves reuse before the changed surface position and invalidates it from that position. UI drafts and failed or discarded preparations have no cache effect.

## Known Limitations and Deferred Work

- **Current generation only** — Chat and Trajectory retain prior evidence, but the Context tab does not yet switch between historical generations or restore one as current.
- **Loaded-range selection** — a range can include only units currently loaded in the virtual list; the user must load earlier pages before selecting them.
- **No semantic recall UI** — checkpoint search is literal and in-session, matching the Host capability.
- **No execution-world undo** — the warnings disclose that context changes cannot revert external effects.
