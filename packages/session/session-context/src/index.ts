/** Host service for current model-context inspection and same-Session rewriting. */

import { createHash, randomUUID } from 'node:crypto'
import { scheduler } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage, errorChain } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  CompactionPreparationId,
  compactionPreparationDigest,
  isCompactCheckpointSource,
  toolPairingCutBalances,
} from '@deepseek-ai/dsh-compaction'
import type {
  CompactionEngine,
  CompactionCheckpointSource,
  CompactionId,
  CompactionPreparation,
  CompactionPreparationAttempt,
  CompactionPreparationCall,
  CompactionPreparationChunk,
  CompactionPreparationId as CompactionPreparationIdType,
  CompactionPreparationPlan,
  CompactionResult,
} from '@deepseek-ai/dsh-compaction'
import type { CompactionDirectory } from '@deepseek-ai/dsh-compaction/directory'
import { deriveEventMessage } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { TokenMeasurement, TokenSurfaceNode } from '@deepseek-ai/dsh-token-meter'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: resolves the required ctx.remoteAccess declaration of a Remote owner.
import type {} from '@deepseek-ai/dsh-api-remote-access'
import { ContextHistoryCursor, ContextRewriteId, ContextUnitId } from './brand.ts'
import type {
  ContextRewriteRequest,
  ContextRewriteResult,
  ContextPrepareRequest,
  ContextPreparation,
  ContextPreparationEditRequest,
  ContextPreparationRef,
  ContextHistoryReadRequest,
  ContextHistoryReadResult,
  ContextHistoryEntry,
  ContextHistorySearchRequest,
  ContextHistorySearchResult,
  ContextHistorySearchMatch,
  ContextInspectRequest,
  ContextSnapshot,
  ContextUnit,
  ContextUnitDetail,
  ContextUnitKind,
  ContextUnitRole,
  SessionContextConfig,
} from './types.ts'

export { ContextHistoryCursor, ContextRewriteId, ContextUnitId } from './brand.ts'
export type * from './types.ts'

const DEFAULT_PREVIEW_CHARS = 160
const DEFAULT_MAX_UNITS_PER_PAGE = 200
const DEFAULT_MAX_PREPARATIONS = 8
const DEFAULT_MAX_PRESERVATION_BRIEF_CHARS = 2_000
const DEFAULT_MAX_HISTORY_PAGE_BYTES = 64 * 1024
const DEFAULT_MAX_HISTORY_SEARCH_BYTES = 1024 * 1024
const DEFAULT_MAX_HISTORY_SEARCH_RESULTS = 50
const DEFAULT_MAX_HISTORY_SEARCH_QUERY_CHARS = 512
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

interface BuiltUnit {
  readonly view: ContextUnit
  readonly messages: readonly Message[]
}

interface UnitRange {
  readonly startIndex: number
  readonly endIndex: number
  readonly balanced: boolean
}

/** One capture of the current surface, its durable events, and its unit decomposition. */
interface SnapshotIndex {
  /** Current surface nodes in model-visible order. */
  readonly nodes: readonly SessionSeq[]
  /** Every durable event of the Session log, indexed by seq. */
  readonly events: readonly SessionEvent[]
  /** Monotonic count of committed positional surface replacements. */
  readonly replaceGeneration: number
  /** Seq of the latest positional surface replacement, or `null` before the first. */
  readonly generationSeq: SessionSeq | null
  readonly ranges: readonly UnitRange[]
}

interface PreparationState {
  readonly request: SessionEvent<'compaction/preparation/requested'>
  status: ContextPreparation['status']
  plan?: CompactionPreparationPlan
  attemptedCalls?: number
  attempts: CompactionPreparationAttempt[]
  calls: CompactionPreparationCall[]
  chunks: CompactionPreparationChunk[]
  summary: ContentBlock[]
  summarySource: ContextPreparation['summarySource']
  error?: string
  compactionId?: CompactionResult['compactionId']
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionContext: SessionContextService
  }
}

/** Current model-context inspection and rewrite service. */
export class SessionContextService extends TypertRemoteService {
  static inject = ['remoteAccess', 'sessions', 'tokenMeter', 'compactions']

  static Config: z<SessionContextConfig> = z.object({
    previewChars: z.number().step(1).min(32).default(DEFAULT_PREVIEW_CHARS),
    maxUnitsPerPage: z.number().step(1).min(1).default(DEFAULT_MAX_UNITS_PER_PAGE),
    maxPreparations: z.number().step(1).min(1).default(DEFAULT_MAX_PREPARATIONS),
    maxPreservationBriefChars: z.number().step(1).min(0).default(DEFAULT_MAX_PRESERVATION_BRIEF_CHARS),
    maxHistoryPageBytes: z.number().step(1).min(1024).default(DEFAULT_MAX_HISTORY_PAGE_BYTES),
    maxHistorySearchBytes: z.number().step(1).min(1024).default(DEFAULT_MAX_HISTORY_SEARCH_BYTES),
    maxHistorySearchResults: z.number().step(1).min(1).default(DEFAULT_MAX_HISTORY_SEARCH_RESULTS),
    maxHistorySearchQueryChars: z.number().step(1).min(1).default(DEFAULT_MAX_HISTORY_SEARCH_QUERY_CHARS),
  })

  private readonly previewChars: number
  private readonly maxUnitsPerPage: number
  private readonly maxPreparations: number
  private readonly maxPreservationBriefChars: number
  private readonly maxHistoryPageBytes: number
  private readonly maxHistorySearchBytes: number
  private readonly maxHistorySearchResults: number
  private readonly maxHistorySearchQueryChars: number
  private readonly unitRanges = new WeakMap<Session, {
    replaceGeneration: number
    nodeCount: number
    tailSeq: SessionSeq | null
    generationSeq: SessionSeq | null
    ranges: readonly UnitRange[]
  }>()

  constructor(ctx: Context, config: SessionContextConfig = {}) {
    super(ctx, 'sessionContext', { namespace: 'sessionContext' })
    this.previewChars = config.previewChars ?? DEFAULT_PREVIEW_CHARS
    this.maxUnitsPerPage = config.maxUnitsPerPage ?? DEFAULT_MAX_UNITS_PER_PAGE
    this.maxPreparations = config.maxPreparations ?? DEFAULT_MAX_PREPARATIONS
    this.maxPreservationBriefChars = config.maxPreservationBriefChars ?? DEFAULT_MAX_PRESERVATION_BRIEF_CHARS
    this.maxHistoryPageBytes = config.maxHistoryPageBytes ?? DEFAULT_MAX_HISTORY_PAGE_BYTES
    this.maxHistorySearchBytes = config.maxHistorySearchBytes ?? DEFAULT_MAX_HISTORY_SEARCH_BYTES
    this.maxHistorySearchResults = config.maxHistorySearchResults ?? DEFAULT_MAX_HISTORY_SEARCH_RESULTS
    this.maxHistorySearchQueryChars = config.maxHistorySearchQueryChars ?? DEFAULT_MAX_HISTORY_SEARCH_QUERY_CHARS
  }

  /**
   * Return a bounded page from one immutable capture of the current durable model context.
   * @param agent - live Agent whose Session is inspected.
   * @param request - tail-first unit page bounds, capped by service configuration.
   * @param signal - cancellation for cooperative unit construction.
   * @returns token totals, current units, and recent durable preparations from the same capture.
   * @throws when cancelled, page bounds are invalid, or Session and token-meter captures disagree.
   */
  @Remote('inspect')
  async inspect(
    agent: Agent,
    request: ContextInspectRequest,
    signal: AbortSignal,
  ): Promise<ContextSnapshot> {
    signal.throwIfAborted()
    const indexed = this.captureSnapshotIndex(agent.session)
    const maximum = Math.min(request.maxUnits ?? this.maxUnitsPerPage, this.maxUnitsPerPage)
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error('context inspect maxUnits must be a positive integer')
    const end = request.beforeIndex ?? indexed.ranges.length
    if (!Number.isSafeInteger(end) || end < 0 || end > indexed.ranges.length) {
      throw new Error(`context inspect beforeIndex ${String(end)} is outside 0-${indexed.ranges.length}`)
    }
    const start = Math.max(0, end - maximum)
    const selectedRanges = indexed.ranges.slice(start, end)
    const firstSelected = selectedRanges[0]
    const preceding = end === 0 ? undefined : indexed.ranges[end - 1]
    if (firstSelected === undefined && end > 0 && preceding === undefined) {
      throw new Error('session-context unit index is inconsistent with its captured ranges')
    }
    const measurement = this.ctx.tokenMeter.measure(agent.session)
    const priced = pricedSurface(measurement, indexed.nodes)
    const units: BuiltUnit[] = []
    let yieldDeadline = performance.now() + 10
    for (const range of selectedRanges) {
      units.push(this.buildUnit(indexed, priced, range))
      if (performance.now() >= yieldDeadline) {
        await scheduler.yield()
        signal.throwIfAborted()
        yieldDeadline = performance.now() + 10
      }
    }
    const header = agent.session.requestHeader()
    const provider = header?.config.provider
    const model = header?.config.model
    const route = provider !== undefined && provider.length > 0 && model !== undefined && model.length > 0
      ? Object.freeze({ provider, model })
      : undefined
    return Object.freeze({
      sessionId: agent.session.id,
      logRevision: agent.session.seq,
      replaceGeneration: indexed.replaceGeneration,
      generationSeq: indexed.generationSeq,
      tailSeq: indexed.nodes.at(-1) ?? null,
      totalTokens: measurement.totalTokens,
      surfaceTokens: measurement.surfaceTokens,
      ...route === undefined ? {} : { route },
      unitCount: indexed.ranges.length,
      unitOffset: start,
      hasEarlierUnits: start > 0,
      units: Object.freeze(units.map(unit => unit.view)),
      preparations: Object.freeze(
        [...readPreparationStates(indexed.events).values()]
          .slice(-this.maxPreparations)
          .map(preparationView),
      ),
    })
  }

  /**
   * Return the complete model messages represented by one currently visible unit.
   * @param agent - live Agent whose current context owns the unit.
   * @param unitId - stable identity from a current inspection result.
   * @param signal - request cancellation.
   * @returns the current unit metadata and its complete model messages.
   * @throws when cancelled or when the unit is not part of the current context generation.
   */
  @Remote('readUnit')
  readUnit(agent: Agent, unitId: ContextUnitId, signal: AbortSignal): ContextUnitDetail {
    signal.throwIfAborted()
    const indexed = this.captureSnapshotIndex(agent.session)
    const range = indexed.ranges[findRangeIndex(indexed, unitId)]
    if (range === undefined) throw new Error(`context unit "${unitId}" is not current`)
    const measurement = this.ctx.tokenMeter.measure(agent.session)
    const unit = this.buildUnit(indexed, pricedSurface(measurement, indexed.nodes), range)
    signal.throwIfAborted()
    return Object.freeze({
      unit: unit.view,
      messages: Object.freeze(unit.messages.map(message => Object.freeze({
        role: message.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: message.content,
      }))),
    })
  }

  /**
   * Append a replacement for one editable unit or its dependent suffix and
   * flush the durable rewrite.
   * @param agent - live Agent whose current context is rewritten.
   * @param request - replacement text, mode, and expected tail.
   * @param signal - cancellation shared with idle maintenance admission.
   * @returns durable rewrite identity, replacement seq, and shadowed counts.
   * @throws when cancelled, the Agent is busy, or the selected unit, balance, editability, or tail has changed.
   */
  @Remote('rewrite')
  rewrite(agent: Agent, request: ContextRewriteRequest, signal: AbortSignal): Promise<ContextRewriteResult> {
    signal.throwIfAborted()
    return agent.runMaintenance(async (agentSignal) => {
      const operationSignal = AbortSignal.any([signal, agentSignal])
      operationSignal.throwIfAborted()
      const indexed = this.captureSnapshotIndex(agent.session)
      const unitIndex = findRangeIndex(indexed, request.unitId)
      const unit = indexed.ranges[unitIndex]
      if (unit === undefined) throw new Error(`context unit "${request.unitId}" changed before rewrite`)
      if (!unit.balanced) throw new Error(`context unit "${request.unitId}" has an open tool exchange`)
      const unitSeqs = rangeSeqs(indexed.nodes, unit)
      const unitBounds = sequenceBounds(unitSeqs, 'context rewrite unit')
      const source = indexed.events[unitBounds.start]
      if (source === undefined || !editableUnit(source, unitSeqs.length)) {
        throw new Error(`context unit "${request.unitId}" is not editable`)
      }
      const content = rewrittenContent(source, request.text)
      if ((indexed.nodes.at(-1) ?? null) !== request.expectedTailSeq) {
        throw new Error(
          `context tail changed before rewrite (expected ${String(request.expectedTailSeq)}, `
          + `current ${String(indexed.nodes.at(-1) ?? null)})`,
        )
      }

      const endUnitIndex = request.mode === 'patch' ? unitIndex : indexed.ranges.length - 1
      const endUnit = indexed.ranges[endUnitIndex]
      if (endUnit === undefined) throw new Error('context rewrite has no current target range')
      const shadowedSeqs = indexed.nodes.slice(unit.startIndex, endUnit.endIndex + 1)
      const shadowedBounds = sequenceBounds(shadowedSeqs, 'context rewrite range')
      const shadowedTokenCount = rangePrice(
        this.ctx.tokenMeter.measure(agent.session),
        indexed.nodes,
        unit.startIndex,
        endUnit.endIndex + 1,
      )
      const rewriteId = ContextRewriteId(randomUUID())
      const message = createUserMessage({
        content,
        source: { kind: 'user' },
      })
      const replacement = agent.session.append('user/message', message, {
        surfaceOp: {
          op: 'replace',
          startSeq: shadowedBounds.start,
          endSeq: shadowedBounds.end,
        },
        sourceEventSeqs: [...shadowedSeqs],
      })
      agent.session.append('context/rewrite', {
        rewriteId,
        mode: request.mode,
        replacementSeq: replacement.seq,
        shadowedRange: {
          start: shadowedBounds.start,
          end: shadowedBounds.end,
        },
        shadowedSeqs: [...shadowedSeqs],
        shadowedTokenCount,
      })
      await this.ctx.sessions.flush(agent.session)
      operationSignal.throwIfAborted()

      return Object.freeze({
        rewriteId,
        replacementSeq: replacement.seq,
        previousGenerationSeq: indexed.generationSeq,
        shadowedItemCount: shadowedSeqs.length,
        shadowedTokenCount,
      })
    })
  }

  /**
   * Prepare a balanced current-unit range for durable review without changing model context.
   * A provider failure is recorded and returned as a failed preparation; cancellation still rejects.
   * @param agent - live Agent whose current context supplies the selected range and compaction route.
   * @param request - inclusive current-unit endpoints and optional preservation brief.
   * @param signal - cancellation for generation and durable progress recording.
   * @returns the ready or failed durable preparation after all progress is flushed.
   * @throws when cancelled, another preparation is active, or the selected range is stale or unbalanced.
   */
  @Remote('prepare')
  async prepare(
    agent: Agent,
    request: ContextPrepareRequest,
    signal: AbortSignal,
  ): Promise<ContextPreparation> {
    signal.throwIfAborted()
    const indexed = this.captureSnapshotIndex(agent.session)
    const startIndex = findRangeIndex(indexed, request.startUnitId)
    const endIndex = findRangeIndex(indexed, request.endUnitId)
    if (startIndex < 0 || endIndex < startIndex) throw new Error('context preparation range is no longer current')
    const first = indexed.ranges[startIndex]
    const last = indexed.ranges[endIndex]
    if (first === undefined || last === undefined) throw new Error('context preparation range is no longer current')
    if (!first.balanced || !last.balanced) throw new Error('context preparation range has an open tool exchange')
    const existing = [...readPreparationStates(indexed.events).values()].find(state => (
      state.status === 'preparing' || state.status === 'ready' || state.status === 'committing'
    ))
    if (existing !== undefined) {
      throw new Error(`context preparation "${existing.request.data.preparationId}" is still active`)
    }
    const preservationBrief = normalizedBrief(request.preservationBrief, this.maxPreservationBriefChars)
    const engine = compactionFor(this.ctx.compactions, agent)
    const shadowedSeqs = indexed.nodes.slice(first.startIndex, last.endIndex + 1)
    const shadowedBounds = sequenceBounds(shadowedSeqs, 'context preparation range')
    const shadowedTokenCount = rangePrice(
      this.ctx.tokenMeter.measure(agent.session),
      indexed.nodes,
      first.startIndex,
      last.endIndex + 1,
    )
    const preparationRequest = {
      preparationId: CompactionPreparationId(randomUUID()),
      start: shadowedBounds.start,
      end: shadowedBounds.end,
      shadowedSeqs: [...shadowedSeqs],
      shadowedDigest: compactionPreparationDigest(shadowedSeqs),
      shadowedTokenCount,
      unitCount: endIndex - startIndex + 1,
      ...preservationBrief === undefined ? {} : { preservationBrief },
    }
    const requested = agent.session.append('compaction/preparation/requested', preparationRequest)
    await this.ctx.sessions.flush(agent.session)
    let attemptedCalls = 0
    try {
      const prepared = await engine.prepareRegion(
        requested.data,
        agent,
        signal,
        async (progress) => {
          switch (progress.kind) {
            case 'planned':
              agent.session.append('compaction/preparation/planned', {
                preparationId: preparationRequest.preparationId,
                plan: progress.plan,
                chunks: progress.chunks,
              })
              break
            case 'attempt':
              attemptedCalls += 1
              agent.session.append('compaction/preparation/attempted', {
                preparationId: preparationRequest.preparationId,
                attempt: progress.attempt,
              })
              break
            case 'call':
              agent.session.append('compaction/preparation/call', {
                preparationId: preparationRequest.preparationId,
                call: progress.call,
              })
              break
          }
          await this.ctx.sessions.flush(agent.session)
        },
      )
      signal.throwIfAborted()
      agent.session.append('compaction/preparation/ready', {
        preparationId: preparationRequest.preparationId,
        chunks: prepared.chunks,
        summary: prepared.summary,
      })
      await this.ctx.sessions.flush(agent.session)
    } catch (error: unknown) {
      agent.session.append('compaction/preparation/failed', {
        preparationId: preparationRequest.preparationId,
        error: errorChain(error),
        attemptedCalls,
      })
      await this.ctx.sessions.flush(agent.session)
      signal.throwIfAborted()
    }
    return requirePreparationView(agent.session, preparationRequest.preparationId)
  }

  /**
   * Persist one reviewed summary edit while leaving current model context unchanged.
   * @param agent - live Agent whose Session owns the preparation.
   * @param request - ready preparation, non-blank replacement text, and edit source.
   * @param signal - request cancellation.
   * @returns the updated durable preparation after the edit is flushed.
   * @throws when cancelled, the preparation is missing or not ready, or the replacement text is blank.
   */
  @Remote('editPreparation')
  async editPreparation(
    agent: Agent,
    request: ContextPreparationEditRequest,
    signal: AbortSignal,
  ): Promise<ContextPreparation> {
    signal.throwIfAborted()
    const state = requirePreparationState(agent.session, request.preparationId)
    if (state.status !== 'ready') throw new Error(`context preparation "${request.preparationId}" is not ready`)
    if (request.text.trim().length === 0) throw new Error('context preparation summary must not be blank')
    agent.session.append('compaction/preparation/edited', {
      preparationId: request.preparationId,
      summary: [{ type: 'text', text: request.text }],
      source: request.source,
    })
    await this.ctx.sessions.flush(agent.session)
    signal.throwIfAborted()
    return requirePreparationView(agent.session, request.preparationId)
  }

  /**
   * Discard one ready or failed preparation without changing current model context.
   * @param agent - live Agent whose Session owns the preparation.
   * @param request - durable preparation identity.
   * @param signal - request cancellation.
   * @returns confirmation after the discard record is flushed.
   * @throws when cancelled or when the preparation is missing or not ready or failed.
   */
  @Remote('discardPreparation')
  async discardPreparation(
    agent: Agent,
    request: ContextPreparationRef,
    signal: AbortSignal,
  ): Promise<{ discarded: true }> {
    signal.throwIfAborted()
    const state = requirePreparationState(agent.session, request.preparationId)
    if (state.status !== 'ready' && state.status !== 'failed') {
      throw new Error(`context preparation "${request.preparationId}" cannot be discarded from ${state.status}`)
    }
    agent.session.append('compaction/preparation/discarded', { preparationId: request.preparationId })
    await this.ctx.sessions.flush(agent.session)
    signal.throwIfAborted()
    return { discarded: true }
  }

  /**
   * Commit one reviewed preparation after exact current-span revalidation.
   * @param agent - idle live Agent whose current context is replaced.
   * @param request - ready durable preparation identity.
   * @param signal - cancellation for compaction admission and commit.
   * @returns the standard compaction result after the replacement is committed.
   * @throws when cancelled, the Agent is busy, the preparation is not ready, or its selected span is stale.
   */
  @Remote('commitPreparation')
  commitPreparation(
    agent: Agent,
    request: ContextPreparationRef,
    signal: AbortSignal,
  ): Promise<CompactionResult> {
    return this.commitPreparationWithAdmission(agent, request, signal, 'idle')
  }

  /**
   * Commit a preparation inside its caller's already-open model turn.
   * @param agent - current tool execution owner.
   * @param request - durable preparation identity.
   * @param signal - current tool cancellation.
   * @returns the standard compaction result.
   */
  commitPreparationInTurn(
    agent: Agent,
    request: ContextPreparationRef,
    signal: AbortSignal,
  ): Promise<CompactionResult> {
    return this.commitPreparationWithAdmission(agent, request, signal, 'current-turn')
  }

  /**
   * Read one bounded page of exact checkpoint originals.
   * @param agent - live Agent whose append-only Session log contains the checkpoint.
   * @param request - checkpoint, traversal mode, cursor, and requested response-byte bound.
   * @param signal - cancellation for cooperative traversal.
   * @returns original-message fragments plus an opaque continuation cursor when more remain.
   * @throws when cancelled, bounds or cursor are invalid, the checkpoint is missing, or one entry cannot fit.
   */
  @Remote('historyRead')
  historyRead(
    agent: Agent,
    request: ContextHistoryReadRequest,
    signal: AbortSignal,
  ): Promise<ContextHistoryReadResult> {
    signal.throwIfAborted()
    const maximum = Math.min(request.maxBytes ?? this.maxHistoryPageBytes, this.maxHistoryPageBytes)
    if (!Number.isSafeInteger(maximum) || maximum < 1024) {
      throw new Error('history read maxBytes must be an integer of at least 1024')
    }
    return readCheckpointHistory(
      durableEvents(agent.session),
      request,
      maximum,
      signal,
    )
  }

  /**
   * Search one checkpoint's reachable originals with bounded literal scanning.
   * @param agent - live Agent whose append-only Session log contains the checkpoint.
   * @param request - checkpoint, literal query, traversal options, cursor, and result or scan bounds.
   * @param signal - cancellation for cooperative scanning.
   * @returns literal matches plus an opaque continuation cursor when the traversal is incomplete.
   * @throws when cancelled, query or bounds are invalid, the cursor mismatches, or the checkpoint is missing.
   */
  @Remote('historySearch')
  historySearch(
    agent: Agent,
    request: ContextHistorySearchRequest,
    signal: AbortSignal,
  ): Promise<ContextHistorySearchResult> {
    signal.throwIfAborted()
    const query = request.query
    if (query.length === 0 || graphemeCountExceeds(query, this.maxHistorySearchQueryChars)) {
      throw new Error(`history search query must contain 1-${this.maxHistorySearchQueryChars} characters`)
    }
    const maxResults = Math.min(request.maxResults ?? this.maxHistorySearchResults, this.maxHistorySearchResults)
    const maxScanBytes = Math.min(request.maxScanBytes ?? this.maxHistorySearchBytes, this.maxHistorySearchBytes)
    if (!Number.isSafeInteger(maxResults) || maxResults < 1) {
      throw new Error('history search maxResults must be a positive integer')
    }
    if (!Number.isSafeInteger(maxScanBytes) || maxScanBytes < 1024) {
      throw new Error('history search maxScanBytes must be an integer of at least 1024')
    }
    return searchCheckpointHistory(
      durableEvents(agent.session),
      request,
      maxResults,
      maxScanBytes,
      signal,
    )
  }

  /**
   * Capture the current surface, its durable events, and the unit decomposition.
   * The surface nodes and the log are two views of one Session state, so both are
   * read before any unit is built; the unit list is reused until the surface
   * position, the node count, or the surface tail changes.
   * @param session - Session whose current model surface is captured.
   * @returns the surface nodes, durable events, generation identity, and balanced ranges.
   * @throws when the tool-pairing balance does not describe the captured surface.
   */
  private captureSnapshotIndex(session: Session): SnapshotIndex {
    const nodes = session.surface.nodes
    const events = durableEvents(session)
    const tailSeq = nodes.at(-1) ?? null
    const cached = this.unitRanges.get(session)
    if (cached !== undefined
      && cached.replaceGeneration === session.surface.replaceGeneration
      && cached.nodeCount === nodes.length
      && cached.tailSeq === tailSeq) {
      return {
        nodes,
        events,
        replaceGeneration: session.surface.replaceGeneration,
        generationSeq: cached.generationSeq,
        ranges: cached.ranges,
      }
    }
    const balances = toolPairingCutBalances(session)
    if (balances.length !== nodes.length + 1) {
      throw new Error('session-context tool balance does not match the captured Session surface')
    }
    const ranges: UnitRange[] = []
    let start = 0
    for (let index = 0; index < nodes.length; index += 1) {
      const seq = nodes[index]
      if (seq === undefined) continue
      const balanced = balances[index + 1]
      if (balanced === undefined) throw new Error('session-context tool balance has no trailing cut')
      if (!balanced && index + 1 < nodes.length) continue
      ranges.push(Object.freeze({
        startIndex: start,
        endIndex: index,
        balanced,
      }))
      start = index + 1
    }
    const frozen = Object.freeze(ranges)
    const replaceGeneration = session.surface.replaceGeneration
    const generationSeq = latestReplacementSeq(events)
    this.unitRanges.set(session, {
      replaceGeneration,
      nodeCount: nodes.length,
      tailSeq,
      generationSeq,
      ranges: frozen,
    })
    return { nodes, events, replaceGeneration, generationSeq, ranges: frozen }
  }

  private commitPreparationWithAdmission(
    agent: Agent,
    request: ContextPreparationRef,
    signal: AbortSignal,
    admission: 'idle' | 'current-turn',
  ): Promise<CompactionResult> {
    signal.throwIfAborted()
    const state = requirePreparationState(agent.session, request.preparationId)
    if (state.status !== 'ready') throw new Error(`context preparation "${request.preparationId}" is not ready`)
    return compactionFor(this.ctx.compactions, agent).commitPrepared(
      preparationValue(state),
      state.summary,
      state.summarySource,
      admission,
      agent,
      signal,
    )
  }

  private buildUnit(
    indexed: SnapshotIndex,
    priced: readonly TokenSurfaceNode[],
    range: UnitRange,
  ): BuiltUnit {
    const seqs = rangeSeqs(indexed.nodes, range)
    const events = seqs.map((seq) => {
      const event = indexed.events[seq]
      if (event === undefined) throw new Error(`session-context surface seq ${String(seq)} is missing`)
      return event
    })
    const messages = Object.freeze(events
      .map(event => deriveEventMessage(event))
      .filter((message): message is Message => message !== null))
    const first = events[0]
    const last = events.at(-1)
    if (first === undefined || last === undefined) throw new Error('session-context constructed an empty unit')
    const tokenCount = priced
      .slice(range.startIndex, range.endIndex + 1)
      .reduce((total, node) => total + node.tokens, 0)
    const kind = unitKind(first, seqs.length)
    const role = unitRole(first, messages[0])
    const checkpointId = checkpointIdOf(first)
    const view = Object.freeze({
      id: unitIdOf(seqs),
      startSeq: first.seq,
      endSeq: last.seq,
      kind,
      role,
      tokenCount,
      preview: previewMessages(messages, this.previewChars, role),
      time: first.time,
      balanced: range.balanced,
      editable: range.balanced && editableUnit(first, seqs.length),
      ...checkpointId === undefined ? {} : { checkpointId },
    })
    return { view, messages }
  }
}

/** Materialize only one selected unit's surface membership. */
function rangeSeqs(nodes: readonly SessionSeq[], range: UnitRange): readonly SessionSeq[] {
  return nodes.slice(range.startIndex, range.endIndex + 1)
}

/**
 * Materialize this Session's committed events once for one request. Surface
 * nodes are event seqs and recall pages cite historical seqs, so both readers
 * resolve positions against the same array. The Session is the only source of
 * committed events; the storage-backed asynchronous reader the deprecation
 * decision targets does not exist yet.
 * @param session - Session whose committed events are read.
 * @returns frozen events indexed by seq, per the Session contiguity contract.
 */
function durableEvents(session: Session): readonly SessionEvent[] {
  // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
  return session.snapshotEvents()
}

/**
 * Identify the surface generation: the latest event that replaced a surface
 * range. The live surface exposes only a replacement count, so the generating
 * seq is derived from the committed log instead of a surface field.
 * @param events - committed events of one Session.
 * @returns the replacing event's seq, or `null` before the first replacement.
 */
function latestReplacementSeq(events: readonly SessionEvent[]): SessionSeq | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') return event.seq
  }
  return null
}

/**
 * Price the current surface once and prove the meter described the same nodes.
 * @param measurement - one route-aware measurement of the Session.
 * @param nodes - surface nodes captured from the same Session state.
 * @returns priced nodes positionally aligned with `nodes`.
 * @throws when the meter priced a different surface than the captured one.
 */
function pricedSurface(
  measurement: TokenMeasurement,
  nodes: readonly SessionSeq[],
): readonly TokenSurfaceNode[] {
  const priced = measurement.nodes
  if (priced.length !== nodes.length || priced.some((node, index) => node.seq !== nodes[index])) {
    throw new Error('session-context token prices do not match the captured Session surface')
  }
  return priced
}

/**
 * Sum the route-priced tokens of one half-open current-surface index range.
 * @param measurement - one route-aware measurement of the Session.
 * @param nodes - surface nodes captured from the same Session state.
 * @param start - first surface index, inclusive.
 * @param end - last surface index plus one.
 * @returns the summed request price of that span.
 */
function rangePrice(
  measurement: TokenMeasurement,
  nodes: readonly SessionSeq[],
  start: number,
  end: number,
): number {
  return pricedSurface(measurement, nodes)
    .slice(start, end)
    .reduce((total, node) => total + node.tokens, 0)
}

/** Resolve an opaque id to one current unit without hashing every unrelated range. */
function findRangeIndex(indexed: SnapshotIndex, unitId: ContextUnitId): number {
  const match = /^(\d+):(\d+):[A-Za-z0-9_-]+$/.exec(unitId)
  if (match?.[1] === undefined || match[2] === undefined) return -1
  const start = Number(match[1])
  const end = Number(match[2])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return -1
  const index = indexed.ranges.findIndex(range => (
    indexed.nodes[range.startIndex] === start
      && indexed.nodes[range.endIndex] === end
  ))
  if (index < 0) return -1
  const range = indexed.ranges[index]
  if (range === undefined) return -1
  return unitIdOf(rangeSeqs(indexed.nodes, range)) === unitId ? index : -1
}

function unitIdOf(seqs: readonly SessionSeq[]): ContextUnitId {
  const bounds = sequenceBounds(seqs, 'context unit')
  const digest = createHash('sha256').update(seqs.join(',')).digest('base64url')
  return ContextUnitId(`${String(bounds.start)}:${String(bounds.end)}:${digest}`)
}

/** Require the positional endpoints of one non-empty surface membership list. */
function sequenceBounds(seqs: readonly SessionSeq[], subject: string): { start: SessionSeq; end: SessionSeq } {
  const start = seqs[0]
  const end = seqs.at(-1)
  if (start === undefined || end === undefined) throw new Error(`${subject} is empty`)
  return { start, end }
}

/** User-authored or prior context-rewrite prose that can be edited without forging model claims. */
function editableUnit(event: SessionEvent, length: number): event is SessionEvent<'user/message'> {
  return length === 1
    && event.type === 'user/message'
    && !isCompactCheckpointSource(event.data.source)
    && event.data.source.kind === 'user'
    && event.data.content.every(block => block.type === 'text' || block.type === 'image')
}

/** Preserve server-authorized images while replacing every prose block at the first prose position. */
function rewrittenContent(event: SessionEvent<'user/message'>, text: string): ContentBlock[] {
  const content: ContentBlock[] = []
  let proseWritten = false
  for (const block of event.data.content) {
    if (block.type === 'image') {
      content.push(block)
      continue
    }
    if (block.type !== 'text') throw new Error('context rewrite source contains non-editable content')
    if (proseWritten) continue
    if (text.length > 0) content.push({ type: 'text', text })
    proseWritten = true
  }
  if (!proseWritten && text.length > 0) content.push({ type: 'text', text })
  if (content.length === 0) throw new Error('context rewrite must retain an image or non-empty text')
  return content
}

function unitKind(first: SessionEvent, length: number): ContextUnitKind {
  if (first.type === 'user/message' && isCompactCheckpointSource(first.data.source)) return 'checkpoint'
  if (length > 1
    || (first.type === 'assistant/message'
      && first.data.message.content.some(block => block.type === 'tool-call'))) return 'tool-exchange'
  return 'message'
}

function unitRole(first: SessionEvent, message: Message | undefined): ContextUnitRole {
  if (message?.role === 'assistant') return 'assistant'
  if (first.type === 'user/message' && first.data.source.kind === 'user') return 'user'
  return 'context'
}

/** Read canonical compaction identity from one checkpoint replacement. */
function checkpointIdOf(event: SessionEvent): CompactionCheckpointSource['compactionId'] | undefined {
  if (event.type !== 'user/message' || !isCompactCheckpointSource(event.data.source)) return undefined
  return event.data.source.compactionId
}

interface HistoryCursorFrame {
  id: string
  index: number
  offset: number
}

interface HistoryCursorState {
  version: 2
  root: string
  recursive: boolean
  operation: 'read' | 'search'
  requestKey: string
  stack: HistoryCursorFrame[]
}

interface OriginalItem {
  readonly checkpointId: CompactionId
  readonly seq: SessionSeq
  readonly role: 'user' | 'assistant'
  readonly text: OriginalText
  readonly nestedCheckpointId?: CompactionId
}

/** Canonical readable message text retained as borrowed pieces instead of one expanded string. */
interface OriginalText {
  readonly parts: readonly string[]
  readonly length: number
}

/** Read one complete-result-bounded page from a checkpoint traversal. */
async function readCheckpointHistory(
  events: readonly SessionEvent[],
  request: ContextHistoryReadRequest,
  maxBytes: number,
  signal: AbortSignal,
): Promise<ContextHistoryReadResult> {
  const recursive = request.recursive === true
  let state = historyCursorState(request.checkpointId, recursive, 'read', '', request.cursor)
  const summaries = summaryEvents(events)
  requireSummary(summaries, request.checkpointId)
  const entries: ContextHistoryEntry[] = []
  let yieldDeadline = performance.now() + 10
  while (true) {
    signal.throwIfAborted()
    normalizeHistoryStack(state, summaries)
    const item = currentOriginal(events, summaries, state)
    if (item === undefined) return buildHistoryReadResult(entries, state)
    const frame = requireHistoryFrame(state)
    if (frame.offset >= item.text.length) {
      state = advancedHistoryState(state, item, 0, true)
      continue
    }
    const prefix = originalTextPrefix(item.text, frame.offset, maxBytes)
    const ascii = /^[\x00-\x7F]*$/u.test(prefix.text)
    const ends = ascii ? undefined : graphemePrefixEnds(prefix.text, 0, maxBytes)
    const boundaryCount = ends?.length ?? prefix.text.length
    if (boundaryCount === 0) {
      if (entries.length > 0) return buildHistoryReadResult(entries, state)
      throw new Error(`history read maxBytes ${maxBytes} is too small for one response entry`)
    }
    let low = 0
    let high = boundaryCount
    while (low < high) {
      const count = Math.ceil((low + high) / 2)
      const end = ends?.[count - 1] ?? count
      const consumed = end
      const complete = frame.offset + end === item.text.length
      const nextState = advancedHistoryState(state, item, consumed, complete)
      const candidate: ContextHistoryEntry = {
        checkpointId: item.checkpointId,
        seq: item.seq,
        role: item.role,
        offset: frame.offset,
        text: prefix.text.slice(0, end),
        complete,
        ...item.nestedCheckpointId === undefined ? {} : { nestedCheckpointId: item.nestedCheckpointId },
      }
      const result = buildHistoryReadResult([...entries, candidate], nextState)
      if (result.returnedBytes <= maxBytes) low = count
      else high = count - 1
    }
    if (low === 0) {
      if (entries.length > 0) return buildHistoryReadResult(entries, state)
      throw new Error(`history read maxBytes ${maxBytes} is too small for one response entry`)
    }
    const end = ends?.[low - 1] ?? low
    const consumed = end
    const complete = frame.offset + end === item.text.length
    entries.push({
      checkpointId: item.checkpointId,
      seq: item.seq,
      role: item.role,
      offset: frame.offset,
      text: prefix.text.slice(0, end),
      complete,
      ...item.nestedCheckpointId === undefined ? {} : { nestedCheckpointId: item.nestedCheckpointId },
    })
    state = advancedHistoryState(state, item, consumed, complete)
    if (!complete) return buildHistoryReadResult(entries, state)
    if (performance.now() >= yieldDeadline) {
      await scheduler.yield()
      yieldDeadline = performance.now() + 10
    }
  }
}

/** Search one traversal in bounded chunks with overlap for cross-chunk literal matches. */
async function searchCheckpointHistory(
  events: readonly SessionEvent[],
  request: ContextHistorySearchRequest,
  maxResults: number,
  maxScanBytes: number,
  signal: AbortSignal,
): Promise<ContextHistorySearchResult> {
  const recursive = request.recursive === true
  const caseSensitive = request.caseSensitive === true
  const requestKey = createHash('sha256')
    .update(JSON.stringify({ query: request.query, caseSensitive }))
    .digest('base64url')
  let state = historyCursorState(request.checkpointId, recursive, 'search', requestKey, request.cursor)
  const summaries = summaryEvents(events)
  requireSummary(summaries, request.checkpointId)
  const matches: ContextHistorySearchMatch[] = []
  const pattern = literalSearchPattern(request.query, caseSensitive)
  let scannedBytes = 0
  let yieldDeadline = performance.now() + 10
  while (scannedBytes < maxScanBytes && matches.length < maxResults) {
    signal.throwIfAborted()
    normalizeHistoryStack(state, summaries)
    const item = currentOriginal(events, summaries, state)
    if (item === undefined) break
    const frame = requireHistoryFrame(state)
    if (frame.offset >= item.text.length) {
      state = advancedHistoryState(state, item, 0, true)
      continue
    }
    const budget = maxScanBytes - scannedBytes
    const prefix = originalTextPrefix(item.text, frame.offset, budget, 'scalar')
    if (prefix.text.length === 0) {
      throw new Error(`history search maxScanBytes ${maxScanBytes} is too small to advance this search`)
    }
    const segment = prefix.text
    const segmentComplete = prefix.end === item.text.length
    const overlapStart = Math.max(0, segment.length - Math.max(0, request.query.length - 1))
    const safeEnd = segmentComplete ? segment.length : scalarBoundaryAtOrBefore(segment, overlapStart)
    if (!segmentComplete && safeEnd === 0) {
      throw new Error(`history search maxScanBytes ${maxScanBytes} is too small to preserve query overlap`)
    }
    pattern.lastIndex = 0
    let consumedForLimit: number | undefined
    while (matches.length < maxResults) {
      const match = pattern.exec(segment)
      if (match === null || (!segmentComplete && match.index >= safeEnd)) break
      const absoluteOffset = frame.offset + match.index
      matches.push({
        checkpointId: item.checkpointId,
        seq: item.seq,
        offset: absoluteOffset,
        snippet: snippetAt(
          segment,
          match.index,
          match[0].length,
          frame.offset > 0,
          prefix.end < item.text.length,
        ),
        ...item.nestedCheckpointId === undefined ? {} : { nestedCheckpointId: item.nestedCheckpointId },
      })
      if (matches.length >= maxResults) {
        consumedForLimit = scalarBoundaryAtOrAfter(segment, match.index + match[0].length)
      }
    }
    scannedBytes += Buffer.byteLength(segment)
    const consumed = consumedForLimit
      ?? (segmentComplete ? segment.length : safeEnd)
    state = advancedHistoryState(state, item, consumed, segmentComplete && consumed === segment.length)
    if (consumedForLimit !== undefined) break
    if (performance.now() >= yieldDeadline) {
      await scheduler.yield()
      yieldDeadline = performance.now() + 10
    }
  }
  normalizeHistoryStack(state, summaries)
  return Object.freeze({
    matches: Object.freeze(matches),
    ...state.stack.length === 0 ? {} : { nextCursor: encodeHistoryCursor(state) },
    complete: state.stack.length === 0,
    scannedBytes,
  })
}

/** Build a read response and converge its self-reported complete JSON byte count. */
function buildHistoryReadResult(
  entries: readonly ContextHistoryEntry[],
  state: HistoryCursorState,
): ContextHistoryReadResult {
  const complete = state.stack.length === 0
  const nextCursor = complete ? undefined : encodeHistoryCursor(state)
  let returnedBytes = 0
  let result: ContextHistoryReadResult
  for (let iteration = 0; iteration < 4; iteration += 1) {
    result = {
      entries,
      ...nextCursor === undefined ? {} : { nextCursor },
      complete,
      returnedBytes,
    }
    const measured = Buffer.byteLength(JSON.stringify(result))
    if (measured === returnedBytes) return Object.freeze(result)
    returnedBytes = measured
  }
  result = {
    entries,
    ...nextCursor === undefined ? {} : { nextCursor },
    complete,
    returnedBytes,
  }
  return Object.freeze(result)
}

/** Index only durable compaction summaries by transaction id. */
function summaryEvents(events: readonly SessionEvent[]): Map<CompactionId, SessionEvent<'compaction/summary'>> {
  const summaries = new Map<CompactionId, SessionEvent<'compaction/summary'>>()
  for (const event of events) {
    if (event.type !== 'compaction/summary') continue
    if (summaries.has(event.data.compactionId)) {
      throw new Error(`checkpoint "${event.data.compactionId}" has duplicate summary records`)
    }
    summaries.set(event.data.compactionId, event)
  }
  return summaries
}

function requireSummary(
  summaries: ReadonlyMap<CompactionId, SessionEvent<'compaction/summary'>>,
  checkpointId: CompactionId,
): SessionEvent<'compaction/summary'> {
  const summary = summaries.get(checkpointId)
  if (summary === undefined) throw new Error(`checkpoint "${checkpointId}" was not found in this session`)
  return summary
}

/** Resolve the current traversal item without advancing its frame. */
function currentOriginal(
  events: readonly SessionEvent[],
  summaries: ReadonlyMap<CompactionId, SessionEvent<'compaction/summary'>>,
  state: HistoryCursorState,
): OriginalItem | undefined {
  const frame = state.stack.at(-1)
  if (frame === undefined) return undefined
  const checkpointId = frame.id as CompactionId
  const summary = requireSummary(summaries, checkpointId)
  const seq = summary.data.shadowedSeqs[frame.index]
  if (seq === undefined) return undefined
  const event = events[seq]
  if (event === undefined) throw new Error(`checkpoint "${checkpointId}" cites missing seq ${seq}`)
  const derived = deriveEventMessage(event)
  const message = derived ?? (event.type === 'assistant/message' ? event.data.message : null)
  if (message === null) throw new Error(`checkpoint "${checkpointId}" cites non-message seq ${seq}`)
  const nestedCheckpointId = checkpointIdOf(event)
  return {
    checkpointId,
    seq,
    role: message.role === 'assistant' ? 'assistant' : 'user',
    text: originalMessageText(message),
    ...nestedCheckpointId === undefined ? {} : { nestedCheckpointId },
  }
}

/** Build a stable readable representation without copying large block strings. */
function originalMessageText(message: Message): OriginalText {
  const parts = [`<message role=${JSON.stringify(message.role)}>\n`]
  for (const block of message.content) appendOriginalBlock(parts, block)
  parts.push('</message>')
  return {
    parts: Object.freeze(parts),
    length: parts.reduce((total, part) => total + part.length, 0),
  }
}

/** Append one content block's exact values to the canonical recall text. */
function appendOriginalBlock(parts: string[], block: ContentBlock): void {
  switch (block.type) {
    case 'text':
      parts.push('<text>\n', block.text, '\n</text>\n')
      break
    case 'reasoning':
      parts.push('<reasoning>\n', block.text, '\n</reasoning>\n')
      break
    case 'image':
      parts.push('<image>', JSON.stringify(block.attachment), '</image>\n')
      break
    case 'tool-call':
      parts.push(
        `<tool-call name=${JSON.stringify(block.name)} id=${JSON.stringify(block.id)}>\n`,
        block.arguments,
        '\n</tool-call>\n',
      )
      break
    case 'file':
      parts.push('<file>', JSON.stringify(block.attachment), '</file>\n')
      break
    case 'tool-addition':
      parts.push(`<tool-addition name=${JSON.stringify(block.toolName)} />\n`)
      break
    case 'tool-removal':
      parts.push(`<tool-removal name=${JSON.stringify(block.toolName)} />\n`)
      break
    default:
      /* v8 ignore next -- merge-extensible block map: an unknown tag renders as its type so a plugin block is not silently dropped. */
      parts.push(`<${(block as ContentBlock | { readonly type: string }).type} />\n`)
      break
  }
}

/** Advance one frame and optionally enter the originals of a nested checkpoint. */
function advancedHistoryState(
  source: HistoryCursorState,
  item: OriginalItem,
  consumed: number,
  complete: boolean,
): HistoryCursorState {
  const state = structuredClone(source)
  const frame = requireHistoryFrame(state)
  if (!complete) {
    frame.offset += consumed
    return state
  }
  frame.index += 1
  frame.offset = 0
  if (state.recursive && item.nestedCheckpointId !== undefined
    && !state.stack.some(candidate => candidate.id === item.nestedCheckpointId)) {
    if (state.stack.length >= 64) throw new Error('nested checkpoint depth exceeds 64 levels')
    state.stack.push({ id: item.nestedCheckpointId, index: 0, offset: 0 })
  }
  return state
}

/** Pop completed frames so cursor completion is canonical. */
function normalizeHistoryStack(
  state: HistoryCursorState,
  summaries: ReadonlyMap<CompactionId, SessionEvent<'compaction/summary'>>,
): void {
  while (state.stack.length > 0) {
    const frame = requireHistoryFrame(state)
    const summary = requireSummary(summaries, frame.id as CompactionId)
    if (frame.index < summary.data.shadowedSeqs.length) return
    state.stack.pop()
  }
}

/** Start or validate an opaque continuation cursor. */
function historyCursorState(
  checkpointId: CompactionId,
  recursive: boolean,
  operation: HistoryCursorState['operation'],
  requestKey: string,
  cursor: ContextHistoryReadRequest['cursor'],
): HistoryCursorState {
  if (cursor === undefined) {
    return {
      version: 2,
      root: checkpointId,
      recursive,
      operation,
      requestKey,
      stack: [{ id: checkpointId, index: 0, offset: 0 }],
    }
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch (error: unknown) {
    throw new Error('invalid checkpoint history cursor', { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid checkpoint history cursor')
  }
  const candidate = value as Record<string, unknown>
  const rawStack = candidate['stack']
  if (candidate['version'] !== 2 || candidate['root'] !== checkpointId || candidate['recursive'] !== recursive
    || candidate['operation'] !== operation || candidate['requestKey'] !== requestKey
    || !Array.isArray(rawStack) || rawStack.length > 64) {
    throw new Error('checkpoint history cursor does not match this request')
  }
  const stack = rawStack.map((frame) => {
    if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) {
      throw new Error('invalid checkpoint history cursor frame')
    }
    const raw = frame as Record<string, unknown>
    const id = raw['id']
    const index = raw['index']
    const offset = raw['offset']
    if (typeof id !== 'string' || id.length === 0
      || !isNonNegativeSafeInteger(index)
      || !isNonNegativeSafeInteger(offset)) {
      throw new Error('invalid checkpoint history cursor frame')
    }
    return { id, index, offset }
  })
  return { version: 2, root: checkpointId, recursive, operation, requestKey, stack }
}

function encodeHistoryCursor(state: HistoryCursorState): ContextHistoryCursor {
  return ContextHistoryCursor(Buffer.from(JSON.stringify(state)).toString('base64url'))
}

/** Return the active traversal frame after a caller has established non-completion. */
function requireHistoryFrame(state: HistoryCursorState): HistoryCursorFrame {
  const frame = state.stack.at(-1)
  if (frame === undefined) throw new Error('checkpoint history traversal has no active frame')
  return frame
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Grapheme endpoints in one bounded UTF-8 prefix, expressed as absolute UTF-16 offsets. */
function graphemePrefixEnds(value: string, start: number, maxBytes: number): number[] {
  const ends: number[] = []
  let bytes = 0
  for (const part of GRAPHEME_SEGMENTER.segment(value.slice(start))) {
    const nextBytes = bytes + Buffer.byteLength(part.segment)
    if (nextBytes > maxBytes) break
    bytes = nextBytes
    ends.push(start + part.index + part.segment.length)
  }
  return ends
}

/** Largest grapheme-aligned UTF-8 prefix under one byte budget. */
function utf8GraphemePrefix(value: string, start: number, maxBytes: number): { text: string; end: number } {
  const scalar = utf8ScalarPrefix(value, start, maxBytes)
  const end = /^[\x00-\x7F]*$/u.test(scalar.text)
    ? scalar.end
    : graphemeBoundaryAtOrBefore(value, scalar.end)
  return { text: value.slice(start, end), end }
}

/** Read a bounded prefix from borrowed canonical pieces without expanding the complete message. */
function originalTextPrefix(
  value: OriginalText,
  start: number,
  maxBytes: number,
  alignment: 'grapheme' | 'scalar' = 'grapheme',
): { text: string; end: number } {
  if (!isNonNegativeSafeInteger(start) || start > value.length) {
    throw new Error(`checkpoint history offset ${String(start)} is outside 0-${value.length}`)
  }
  let remainingOffset = start
  let partIndex = 0
  while (partIndex < value.parts.length) {
    const part = value.parts[partIndex]
    if (part === undefined) break
    if (remainingOffset < part.length) break
    remainingOffset -= part.length
    partIndex += 1
  }
  const fragments: string[] = []
  let bytes = 0
  let consumed = 0
  for (let index = partIndex; index < value.parts.length; index += 1) {
    const part = value.parts[index]
    if (part === undefined) break
    const localStart = index === partIndex ? remainingOffset : 0
    if (localStart >= part.length) continue
    const prefix = alignment === 'grapheme'
      ? utf8GraphemePrefix(part, localStart, maxBytes - bytes)
      : utf8ScalarPrefix(part, localStart, maxBytes - bytes)
    if (prefix.text.length === 0) break
    fragments.push(prefix.text)
    bytes += Buffer.byteLength(prefix.text)
    consumed += prefix.text.length
    if (prefix.end < part.length) break
  }
  return { text: fragments.join(''), end: start + consumed }
}

/** Largest Unicode-scalar-aligned UTF-8 prefix under one byte budget. */
function utf8ScalarPrefix(value: string, start: number, maxBytes: number): { text: string; end: number } {
  if (start > 0 && isLowSurrogate(value.charCodeAt(start)) && isHighSurrogate(value.charCodeAt(start - 1))) {
    throw new Error('checkpoint search cursor splits a Unicode scalar')
  }
  let low = 0
  let high = Math.min(value.length - start, maxBytes)
  while (low < high) {
    const count = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(start, start + count)) <= maxBytes) low = count
    else high = count - 1
  }
  let end = start + low
  if (end > start && end < value.length
    && isHighSurrogate(value.charCodeAt(end - 1)) && isLowSurrogate(value.charCodeAt(end))) {
    end -= 1
  }
  return { text: value.slice(start, end), end }
}

/** Compile one escaped literal matcher while preserving match offsets in the original text. */
function literalSearchPattern(query: string, caseSensitive: boolean): RegExp {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escaped, caseSensitive ? 'gu' : 'giu')
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xD800 && value <= 0xDBFF
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xDC00 && value <= 0xDFFF
}

/** Last Unicode scalar boundary at or before one UTF-16 offset. */
function scalarBoundaryAtOrBefore(value: string, offset: number): number {
  if (offset > 0 && offset < value.length
    && isHighSurrogate(value.charCodeAt(offset - 1)) && isLowSurrogate(value.charCodeAt(offset))) {
    return offset - 1
  }
  return offset
}

/** First Unicode scalar boundary at or after one UTF-16 offset. */
function scalarBoundaryAtOrAfter(value: string, offset: number): number {
  if (offset > 0 && offset < value.length
    && isHighSurrogate(value.charCodeAt(offset - 1)) && isLowSurrogate(value.charCodeAt(offset))) {
    return offset + 1
  }
  return offset
}

/** Last grapheme boundary at or before one UTF-16 offset. */
function graphemeBoundaryAtOrBefore(value: string, offset: number): number {
  if (offset <= 0) return 0
  if (offset >= value.length) return value.length
  const containing = GRAPHEME_SEGMENTER.segment(value).containing(offset)
  if (containing === undefined || containing.index === offset) return offset
  return containing.index
}

/** Bounded grapheme context around one match in a bounded search segment. */
function snippetAt(
  value: string,
  offset: number,
  matchLength: number,
  leadingOmitted: boolean,
  trailingOmitted: boolean,
): string {
  const segments = GRAPHEME_SEGMENTER.segment(value)
  let start = Math.min(offset, value.length)
  for (let count = 0; count < 80 && start > 0; count += 1) {
    const previous = segments.containing(start - 1)
    if (previous === undefined) break
    start = previous.index
  }
  let end = Math.min(value.length, offset + matchLength)
  if (end > 0) {
    const containing = segments.containing(end - 1)
    if (containing !== undefined) end = Math.max(end, containing.index + containing.segment.length)
  }
  for (let count = 0; count < 80 && end < value.length; count += 1) {
    const next = segments.containing(end)
    if (next === undefined) break
    end = next.index + next.segment.length
  }
  return `${leadingOmitted || start > 0 ? '…' : ''}${value.slice(start, end)}${trailingOmitted || end < value.length ? '…' : ''}`
}

const PREPARATION_EVENT_TYPES: ReadonlySet<string> = new Set([
  'compaction/preparation/requested',
  'compaction/preparation/planned',
  'compaction/preparation/attempted',
  'compaction/preparation/call',
  'compaction/preparation/ready',
  'compaction/preparation/edited',
  'compaction/preparation/failed',
  'compaction/preparation/discarded',
  'compaction/start',
  'compaction/end',
])

/** Fold only preparation and correlated compaction lifecycle events. */
function readPreparationStates(events: readonly SessionEvent[]): Map<CompactionPreparationIdType, PreparationState> {
  const states = new Map<CompactionPreparationIdType, PreparationState>()
  for (const event of events) {
    if (!PREPARATION_EVENT_TYPES.has(event.type)) continue
    switch (event.type) {
      case 'compaction/preparation/requested':
        if (states.has(event.data.preparationId)) {
          throw new Error(`context preparation "${event.data.preparationId}" was requested more than once`)
        }
        states.set(event.data.preparationId, {
          request: event,
          status: 'preparing',
          attempts: [],
          calls: [],
          chunks: [],
          summary: [],
          summarySource: 'generated',
        })
        break
      case 'compaction/preparation/planned': {
        const state = requirePreparationFoldState(states, event.data.preparationId, event.type)
        if (state.status !== 'preparing' || state.plan !== undefined) {
          throw new Error(`context preparation "${event.data.preparationId}" was planned from ${state.status}`)
        }
        state.plan = event.data.plan
        state.chunks = event.data.chunks
        state.attemptedCalls = state.attempts.length
        break
      }
      case 'compaction/preparation/attempted': {
        const state = requirePreparationFoldState(states, event.data.preparationId, event.type)
        if (state.status !== 'preparing') {
          throw new Error(`context preparation "${event.data.preparationId}" attempted a call from ${state.status}`)
        }
        if (state.attempts.some(attempt => attempt.index === event.data.attempt.index)) {
          throw new Error(`context preparation "${event.data.preparationId}" repeated attempt index ${event.data.attempt.index}`)
        }
        state.attempts.push(event.data.attempt)
        state.attemptedCalls = Math.max(state.attemptedCalls ?? 0, state.attempts.length)
        break
      }
      case 'compaction/preparation/call': {
        const state = requirePreparationFoldState(states, event.data.preparationId, event.type)
        if (state.status !== 'preparing') {
          throw new Error(`context preparation "${event.data.preparationId}" recorded a call from ${state.status}`)
        }
        if (state.calls.some(call => call.index === event.data.call.index)) {
          throw new Error(`context preparation "${event.data.preparationId}" repeated call index ${event.data.call.index}`)
        }
        state.calls.push(event.data.call)
        state.attemptedCalls = Math.max(state.attemptedCalls ?? 0, state.calls.length)
        break
      }
      case 'compaction/preparation/ready': {
        const state = requirePreparationFoldState(states, event.data.preparationId, event.type)
        if (state.status !== 'preparing') {
          throw new Error(`context preparation "${event.data.preparationId}" became ready from ${state.status}`)
        }
        state.status = 'ready'
        state.chunks = event.data.chunks
        state.summary = event.data.summary
        state.summarySource = 'generated'
        delete state.error
        break
      }
      case 'compaction/preparation/edited': {
        const state = requirePreparationFoldState(states, event.data.preparationId, event.type)
        if (state.status !== 'ready') {
          throw new Error(`context preparation "${event.data.preparationId}" was edited from ${state.status}`)
        }
        state.summary = event.data.summary
        state.summarySource = event.data.source
        break
      }
      case 'compaction/preparation/failed': {
        const state = requirePreparationFoldState(states, event.data.preparationId, event.type)
        if (state.status !== 'preparing') {
          throw new Error(`context preparation "${event.data.preparationId}" failed from ${state.status}`)
        }
        state.status = 'failed'
        state.error = event.data.error
        if (event.data.attemptedCalls !== undefined) {
          if (!Number.isSafeInteger(event.data.attemptedCalls) || event.data.attemptedCalls < 0
            || event.data.attemptedCalls < state.attempts.length
            || event.data.attemptedCalls < state.calls.length) {
            throw new Error(`context preparation "${event.data.preparationId}" has an invalid attempted-call count`)
          }
          state.attemptedCalls = event.data.attemptedCalls
        }
        break
      }
      case 'compaction/preparation/discarded': {
        const state = requirePreparationFoldState(states, event.data.preparationId, event.type)
        if (state.status !== 'ready' && state.status !== 'failed') {
          throw new Error(`context preparation "${event.data.preparationId}" was discarded from ${state.status}`)
        }
        state.status = 'discarded'
        break
      }
      case 'compaction/start': {
        const preparationId = event.data.preparationId
        if (preparationId === undefined) break
        const state = requirePreparationFoldState(states, preparationId, event.type)
        if (state.status !== 'ready') {
          throw new Error(`context preparation "${preparationId}" started commit from ${state.status}`)
        }
        state.status = 'committing'
        state.compactionId = event.data.compactionId
        break
      }
      case 'compaction/end': {
        const preparationId = event.data.preparationId
        if (preparationId === undefined) break
        const state = requirePreparationFoldState(states, preparationId, event.type)
        if (state.status !== 'committing' || state.compactionId !== event.data.compactionId) {
          throw new Error(`context preparation "${preparationId}" ended without its matching commit start`)
        }
        state.compactionId = event.data.compactionId
        if (event.data.error === undefined) {
          state.status = 'committed'
          delete state.error
        } else {
          state.status = 'failed'
          state.error = event.data.error
        }
        break
      }
      default:
        break
    }
  }
  return states
}

/** Require a preparation lifecycle owner for one correlated durable event. */
function requirePreparationFoldState(
  states: ReadonlyMap<CompactionPreparationIdType, PreparationState>,
  preparationId: CompactionPreparationIdType,
  eventType: string,
): PreparationState {
  const state = states.get(preparationId)
  if (state === undefined) {
    throw new Error(`${eventType} references unknown context preparation "${preparationId}"`)
  }
  return state
}

/** Build the bounded review projection of one durable preparation. */
function preparationView(state: PreparationState): ContextPreparation {
  return Object.freeze({
    preparationId: state.request.data.preparationId,
    status: state.status,
    startSeq: state.request.data.start,
    endSeq: state.request.data.end,
    unitCount: state.request.data.unitCount,
    shadowedTokenCount: state.request.data.shadowedTokenCount,
    ...state.request.data.preservationBrief === undefined
      ? {}
      : { preservationBrief: state.request.data.preservationBrief },
    summary: blocksText(state.summary),
    summarySource: state.summarySource,
    ...state.plan === undefined ? {} : { plan: structuredClone(state.plan) },
    ...state.attemptedCalls === undefined ? {} : { attemptedCalls: state.attemptedCalls },
    completedCalls: state.calls.length,
    chunkCount: state.chunks.length,
    createdAt: state.request.time,
    ...state.error === undefined ? {} : { error: state.error },
    ...state.compactionId === undefined ? {} : { compactionId: state.compactionId },
  })
}

function requirePreparationState(session: Session, preparationId: CompactionPreparationIdType): PreparationState {
  const state = readPreparationStates(durableEvents(session)).get(preparationId)
  if (state === undefined) throw new Error(`context preparation "${preparationId}" was not found`)
  return state
}

function requirePreparationView(session: Session, preparationId: CompactionPreparationIdType): ContextPreparation {
  return preparationView(requirePreparationState(session, preparationId))
}

/** Reconstruct the provider-neutral preparation passed to a revalidating commit. */
function preparationValue(state: PreparationState): CompactionPreparation {
  return {
    request: structuredClone(state.request.data),
    chunks: structuredClone(state.chunks),
    calls: structuredClone(state.calls).sort((left, right) => left.index - right.index),
    summary: structuredClone(state.summary),
  }
}

/** Resolve the exact Agent-scoped compaction provider. */
function compactionFor(directory: CompactionDirectory, agent: Agent): CompactionEngine {
  return directory.resolve(agent)
}

/** Trim and bound a preservation brief by user-perceived characters. */
function normalizedBrief(value: string | undefined, maximum: number): string | undefined {
  const trimmed = value?.trim()
  if (trimmed === undefined || trimmed.length === 0) return undefined
  if (graphemeCountExceeds(trimmed, maximum)) {
    throw new Error(`context preparation brief exceeds ${maximum} characters`)
  }
  return trimmed
}

/** Concatenate text blocks from a reviewed preparation summary. */
function blocksText(blocks: readonly ContentBlock[]): string {
  return blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

function previewMessages(messages: readonly Message[], maximum: number, role: ContextUnitRole): string {
  const text = messages.flatMap(message => message.content.map(blockText)).join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
  const fallback = `${role} message`
  return truncateGraphemes(text.length === 0 ? fallback : text, maximum)
}

/** Whether a string contains more than one configured number of grapheme clusters. */
function graphemeCountExceeds(value: string, maximum: number): boolean {
  let count = 0
  for (const _part of GRAPHEME_SEGMENTER.segment(value)) {
    count += 1
    if (count > maximum) return true
  }
  return false
}

/** Truncate to a grapheme budget while reserving the final position for an ellipsis. */
function truncateGraphemes(value: string, maximum: number): string {
  if (maximum < 1) return ''
  const ends: number[] = []
  for (const part of GRAPHEME_SEGMENTER.segment(value)) {
    ends.push(part.index + part.segment.length)
    if (ends.length > maximum) break
  }
  if (ends.length <= maximum) return value
  const end = maximum === 1 ? 0 : (ends[maximum - 2] ?? 0)
  return `${value.slice(0, end)}…`
}

function blockText(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return block.text
    case 'tool-call':
      return `tool call ${block.name}`
    case 'image':
    case 'file':
      return `[${block.type}]`
    case 'tool-addition':
    case 'tool-removal':
      return `tool ${block.type === 'tool-addition' ? 'addition' : 'removal'} ${block.toolName}`
    default:
      /* v8 ignore next -- merge-extensible block map: an unknown tag renders as its type so a plugin block is not silently dropped. */
      return `[${(block as ContentBlock | { readonly type: string }).type}]`
  }
}

export default SessionContextService
