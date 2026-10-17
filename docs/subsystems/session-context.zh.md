# Session Context

[English](session-context.md) | 中文

把当前模型可见 Session 表层作为可检查、可替换的产品能力。[`@deepseek-ai/dsh-session-context`](../../packages/session/session-context) 负责宿主服务与 Remote 类型。它读取 `Session.surface`，而不是分页的人类对话记录，因此 Context、Chat 与 Trajectory 是同一份仅追加日志的三种独立投影。

源码：[`packages/session/session-context/src/types.ts`](../../packages/session/session-context/src/types.ts)

## 当前单元与快照

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

单元遵循当前表层顺序，并且只在工具平衡切点结束。`unitOffset` 是该快照中第一个返回单元的稳定位置；只有代际身份与区间邻接关系仍然匹配时，较早页才能前插。

## 可评审 preparation

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

`preparing` 与 `ready` 不改变当前表层。可选 plan 会报告准确摘要路由、direct 或 map/reduce 策略、上下文与输入预算以及输出上限；只有早于持久尝试记录的旧数据才省略 `attemptedCalls`。`committing` 从标准压缩锁开始；`committed` 关联最终检查点。提供方 preparation 或 bracket 闭合失败会保留为持久 failed 记录。

## 同 Session 改写

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

`edit-and-continue` 替换选中单元到已加载尾部。`patch` 替换一个平衡单元。宿主会在 append 前校验单元、尾部、编辑权限与图片保留，随后追加替换用的用户消息与一条 `context/rewrite` 记录，写明被遮蔽的确切表层。改写不启动模型回合：替换内容就是该 Agent 下一次所服务请求的当前上下文。

## 检查点召回

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

召回沿 `compaction/summary.shadowedSeqs` 遍历，并可递归进入检查点替换消息。读取游标绑定检查点与递归模式；搜索游标还会绑定字面查询与大小写模式。完整读取响应受字节上限约束，搜索报告扫描的原文字节，而不是响应大小。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.zh.md) · [CompactionResult](compaction.zh.md)

Source: [`packages/session/session-context/src/index.ts`](../../packages/session/session-context/src/index.ts)
<!-- END GENERATED cordis-surface -->
