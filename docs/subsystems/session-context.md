# Session Context

English | [中文](session-context.zh.md)

The current model-visible Session surface as an inspectable and replaceable product capability. [`@deepseek-ai/dsh-session-context`](../../packages/session/session-context) owns the Host service and Remote types. It reads `Session.surface` rather than the paged human transcript, so Context, Chat, and Trajectory stay separate projections of one append-only log.

Source: [`packages/session/session-context/src/types.ts`](../../packages/session/session-context/src/types.ts)

## Current units and snapshots

```ts type-equiv
/** Bounded metadata for one indivisible current-surface unit. */
interface ContextUnit {
  readonly id: ContextUnitId
  readonly startSeq: SessionSeq
  readonly endSeq: SessionSeq
  readonly kind: ContextUnitKind
  readonly role: ContextUnitRole
  readonly tokenCount: number
  readonly preview: string
  readonly time: number
  readonly balanced: boolean
  readonly editable: boolean
  readonly checkpointId?: CompactionId
}
```

```ts type-equiv
/** Current durable model-surface snapshot for one live Agent. */
interface ContextSnapshot {
  readonly sessionId: SessionId
  /** Events consumed by this capture; equal to the Session's next event seq. */
  readonly logRevision: SessionLogOffset
  readonly replaceGeneration: number
  /** Seq of the latest positional surface replacement, or null for the initial generation. */
  readonly generationSeq: SessionSeq | null
  readonly tailSeq: SessionSeq | null
  readonly totalTokens: number
  readonly surfaceTokens: number
  readonly route?: { readonly provider: string; readonly model: string }
  readonly unitCount: number
  readonly unitOffset: number
  readonly hasEarlierUnits: boolean
  readonly units: readonly ContextUnit[]
  readonly preparations: readonly ContextPreparation[]
}
```

Units follow current surface order and end only at tool-balanced cuts. `unitOffset` is the first returned unit's stable position in this snapshot; an earlier page can prepend only while generation identity and interval adjacency still match.

## Reviewed preparation

```ts type-equiv
/** Review-facing projection of one durable range compaction preparation. */
interface ContextPreparation {
  readonly preparationId: CompactionPreparationId
  readonly status: ContextPreparationStatus
  readonly startSeq: SessionSeq
  readonly endSeq: SessionSeq
  readonly unitCount: number
  readonly shadowedTokenCount: number
  readonly preservationBrief?: string
  readonly summary: string
  readonly summarySource: 'generated' | 'human' | 'model'
  readonly plan?: CompactionPreparationPlan
  readonly attemptedCalls?: number
  readonly completedCalls: number
  readonly chunkCount: number
  readonly createdAt: number
  readonly error?: string
  readonly compactionId?: CompactionId
}
```

`preparing` and `ready` leave the current surface unchanged. The optional plan reports the exact summarization route, direct or map/reduce strategy, context and input budgets, and output cap; `attemptedCalls` is absent only for older records that predate durable attempts. `committing` begins with the standard compaction lock; `committed` correlates the resulting checkpoint. A failed provider preparation or bracket close remains a durable failed record.

## Same-Session rewrite

```ts type-equiv
/** Structured same-Session rewrite request from UI or another trusted consumer. */
interface ContextRewriteRequest {
  readonly unitId: ContextUnitId
  readonly expectedTailSeq: SessionSeq
  readonly mode: ContextRewriteMode
  /** Replacement prose; the Host retains image blocks from the selected current message. */
  readonly text: string
}
```

```ts type-equiv
/** Committed rewrite result. */
interface ContextRewriteResult {
  readonly rewriteId: ContextRewriteId
  readonly replacementSeq: SessionSeq
  readonly previousGenerationSeq: SessionSeq | null
  readonly shadowedItemCount: number
  readonly shadowedTokenCount: number
}
```

`edit-and-continue` replaces the selected unit through the loaded tail. `patch` replaces one balanced unit. The Host validates the unit, tail, edit authority, and image retention before append, then appends the replacement user message and one `context/rewrite` record stating the exact shadowed surface. The rewrite starts no model turn: the replacement is current context for the next request the Agent serves.

## Checkpoint recall

```ts type-equiv
/** One canonical fragment of an original model-visible message. */
interface ContextHistoryEntry {
  readonly checkpointId: CompactionId
  readonly seq: SessionSeq
  /** Model role of the recalled original; upstream keeps tool results as their own messages. */
  readonly role: Message['role']
  /** UTF-16 offset in the canonical serialized message. */
  readonly offset: number
  readonly text: string
  readonly complete: boolean
  readonly nestedCheckpointId?: CompactionId
}
```

```ts type-equiv
/** Bounded checkpoint-original page. */
interface ContextHistoryReadResult {
  readonly entries: readonly ContextHistoryEntry[]
  readonly nextCursor?: ContextHistoryCursor
  readonly complete: boolean
  readonly returnedBytes: number
}
```

```ts type-equiv
/** One checkpoint-addressed literal match. */
interface ContextHistorySearchMatch {
  readonly checkpointId: CompactionId
  readonly seq: SessionSeq
  /** UTF-16 offset in the canonical serialized message. */
  readonly offset: number
  readonly snippet: string
  readonly nestedCheckpointId?: CompactionId
}
```

```ts type-equiv
/** Bounded literal-search page. */
interface ContextHistorySearchResult {
  readonly matches: readonly ContextHistorySearchMatch[]
  readonly nextCursor?: ContextHistoryCursor
  readonly complete: boolean
  readonly scannedBytes: number
}
```

Recall follows `compaction/summary.shadowedSeqs`, with optional recursive entry into checkpoint replacement messages. Read cursors bind the checkpoint and recursion mode; search cursors additionally bind the literal query and case mode. The complete read response is byte-bounded, and search reports scanned original bytes rather than response size.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessioncontext--sessioncontextservice"></a>

### `ctx.sessionContext` — `SessionContextService`

Current model-context inspection and rewrite service.

```ts cordis-catalog
/**
 * Return a bounded page from one immutable capture of the current durable model context.
 * @param agent - live Agent whose Session is inspected.
 * @param request - tail-first unit page bounds, capped by service configuration.
 * @param signal - cancellation for cooperative unit construction.
 * @returns token totals, current units, and recent durable preparations from the same capture.
 * @throws when cancelled, page bounds are invalid, or Session and token-meter captures disagree.
 */
@Remote('inspect') async inspect( agent: Agent, request: ContextInspectRequest, signal: AbortSignal, ): Promise<ContextSnapshot>

/**
 * Return the complete model messages represented by one currently visible unit.
 * @param agent - live Agent whose current context owns the unit.
 * @param unitId - stable identity from a current inspection result.
 * @param signal - request cancellation.
 * @returns the current unit metadata and its complete model messages.
 * @throws when cancelled or when the unit is not part of the current context generation.
 */
@Remote('readUnit') readUnit(agent: Agent, unitId: ContextUnitId, signal: AbortSignal): ContextUnitDetail

/**
 * Append a replacement for one editable unit or its dependent suffix and
 * flush the durable rewrite.
 * @param agent - live Agent whose current context is rewritten.
 * @param request - replacement text, mode, and expected tail.
 * @param signal - cancellation shared with idle maintenance admission.
 * @returns durable rewrite identity, replacement seq, and shadowed counts.
 * @throws when cancelled, the Agent is busy, or the selected unit, balance, editability, or tail has changed.
 */
@Remote('rewrite') rewrite(agent: Agent, request: ContextRewriteRequest, signal: AbortSignal): Promise<ContextRewriteResult>

/**
 * Prepare a balanced current-unit range for durable review without changing model context.
 * A provider failure is recorded and returned as a failed preparation; cancellation still rejects.
 * @param agent - live Agent whose current context supplies the selected range and compaction route.
 * @param request - inclusive current-unit endpoints and optional preservation brief.
 * @param signal - cancellation for generation and durable progress recording.
 * @returns the ready or failed durable preparation after all progress is flushed.
 * @throws when cancelled, another preparation is active, or the selected range is stale or unbalanced.
 */
@Remote('prepare') async prepare( agent: Agent, request: ContextPrepareRequest, signal: AbortSignal, ): Promise<ContextPreparation>

/**
 * Persist one reviewed summary edit while leaving current model context unchanged.
 * @param agent - live Agent whose Session owns the preparation.
 * @param request - ready preparation, non-blank replacement text, and edit source.
 * @param signal - request cancellation.
 * @returns the updated durable preparation after the edit is flushed.
 * @throws when cancelled, the preparation is missing or not ready, or the replacement text is blank.
 */
@Remote('editPreparation') async editPreparation( agent: Agent, request: ContextPreparationEditRequest, signal: AbortSignal, ): Promise<ContextPreparation>

/**
 * Discard one ready or failed preparation without changing current model context.
 * @param agent - live Agent whose Session owns the preparation.
 * @param request - durable preparation identity.
 * @param signal - request cancellation.
 * @returns confirmation after the discard record is flushed.
 * @throws when cancelled or when the preparation is missing or not ready or failed.
 */
@Remote('discardPreparation') async discardPreparation( agent: Agent, request: ContextPreparationRef, signal: AbortSignal, ): Promise<{ discarded: true }>

/**
 * Commit one reviewed preparation after exact current-span revalidation.
 * @param agent - idle live Agent whose current context is replaced.
 * @param request - ready durable preparation identity.
 * @param signal - cancellation for compaction admission and commit.
 * @returns the standard compaction result after the replacement is committed.
 * @throws when cancelled, the Agent is busy, the preparation is not ready, or its selected span is stale.
 */
@Remote('commitPreparation') commitPreparation( agent: Agent, request: ContextPreparationRef, signal: AbortSignal, ): Promise<CompactionResult>

/**
 * Commit a preparation inside its caller's already-open model turn.
 * @param agent - current tool execution owner.
 * @param request - durable preparation identity.
 * @param signal - current tool cancellation.
 * @returns the standard compaction result.
 */
commitPreparationInTurn( agent: Agent, request: ContextPreparationRef, signal: AbortSignal, ): Promise<CompactionResult>

/**
 * Read one bounded page of exact checkpoint originals.
 * @param agent - live Agent whose append-only Session log contains the checkpoint.
 * @param request - checkpoint, traversal mode, cursor, and requested response-byte bound.
 * @param signal - cancellation for cooperative traversal.
 * @returns original-message fragments plus an opaque continuation cursor when more remain.
 * @throws when cancelled, bounds or cursor are invalid, the checkpoint is missing, or one entry cannot fit.
 */
@Remote('historyRead') historyRead( agent: Agent, request: ContextHistoryReadRequest, signal: AbortSignal, ): Promise<ContextHistoryReadResult>

/**
 * Search one checkpoint's reachable originals with bounded literal scanning.
 * @param agent - live Agent whose append-only Session log contains the checkpoint.
 * @param request - checkpoint, literal query, traversal options, cursor, and result or scan bounds.
 * @param signal - cancellation for cooperative scanning.
 * @returns literal matches plus an opaque continuation cursor when the traversal is incomplete.
 * @throws when cancelled, query or bounds are invalid, the cursor mismatches, or the checkpoint is missing.
 */
@Remote('historySearch') historySearch( agent: Agent, request: ContextHistorySearchRequest, signal: AbortSignal, ): Promise<ContextHistorySearchResult>
```

Types: [Agent](core.md) · [CompactionResult](compaction.md)

Source: [`packages/session/session-context/src/index.ts`](../../packages/session/session-context/src/index.ts)
<!-- END GENERATED cordis-surface -->
