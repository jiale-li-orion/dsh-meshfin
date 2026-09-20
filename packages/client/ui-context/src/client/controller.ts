/** React-free per-session object layer for Session Context Remote reads and rewrites. */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionFace, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ContextPrepareRequest,
  ContextHistoryReadRequest,
  ContextHistoryEntry,
  ContextHistoryReadResult,
  ContextHistorySearchRequest,
  ContextHistorySearchResult,
  ContextInspectRequest,
  ContextPreparation,
  ContextPreparationCommitResult,
  ContextPreparationEditRequest,
  ContextPreparationRef,
  ContextRewriteMode,
  ContextRewriteResult,
  ContextSnapshot,
  ContextUnitDetail,
  ContextUnitId,
} from '@deepseek-ai/dsh-session-context/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** Generated Remote subset used by one Context controller. */
export interface SessionContextRemote {
  inspect: (
    sessionId: SessionId,
    request: ContextInspectRequest,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ContextSnapshot>>
  readUnit: (
    sessionId: SessionId,
    unitId: ContextUnitId,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ContextUnitDetail>>
  rewrite: (
    sessionId: SessionId,
    request: {
      unitId: ContextUnitId
      expectedTailSeq: number
      mode: ContextRewriteMode
      text: string
      continue: boolean
    },
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ContextRewriteResult>>
  prepare: (
    sessionId: SessionId,
    request: ContextPrepareRequest,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ContextPreparation>>
  editPreparation: (
    sessionId: SessionId,
    request: ContextPreparationEditRequest,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ContextPreparation>>
  discardPreparation: (
    sessionId: SessionId,
    request: ContextPreparationRef,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<{ discarded: true }>>
  commitPreparation: (
    sessionId: SessionId,
    request: ContextPreparationRef,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ContextPreparationCommitResult>>
  historyRead: (
    sessionId: SessionId,
    request: ContextHistoryReadRequest,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ContextHistoryReadResult>>
  historySearch: (
    sessionId: SessionId,
    request: ContextHistorySearchRequest,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ContextHistorySearchResult>>
}

/** Load state of the authoritative Context snapshot. */
export type ContextControllerStatus = 'cold' | 'loading' | 'ready' | 'error'

/** Immutable controller output consumed by the Context view. */
export interface ContextControllerView {
  status: ContextControllerStatus
  context: ContextSnapshot | null
  details: ReadonlyMap<ContextUnitId, ContextUnitDetail>
  detailLoading: ReadonlySet<ContextUnitId>
  loadingEarlier: boolean
  rewriteUnitId: ContextUnitId | null
  preparationOperation: 'prepare' | 'edit' | 'discard' | 'commit' | null
  histories: ReadonlyMap<ContextHistoryReadRequest['checkpointId'], ContextHistoryReadResult>
  historyLoading: ReadonlySet<ContextHistoryReadRequest['checkpointId']>
  searches: ReadonlyMap<ContextHistoryReadRequest['checkpointId'], ContextHistorySearchResult>
  searchLoading: ReadonlySet<ContextHistoryReadRequest['checkpointId']>
  lastRewrite: ContextRewriteResult | null
  error: string | null
}

/** Settled controller operation without thrown transport errors. */
export type ContextActionResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }

type ContextFailure = { ok: false; error: { code: string; message: string } }

const EMPTY_DETAILS: ReadonlyMap<ContextUnitId, ContextUnitDetail> = new Map()
const EMPTY_LOADING: ReadonlySet<ContextUnitId> = new Set()
const EMPTY_HISTORIES: ReadonlyMap<ContextHistoryReadRequest['checkpointId'], ContextHistoryReadResult> = new Map()
const EMPTY_HISTORY_LOADING: ReadonlySet<ContextHistoryReadRequest['checkpointId']> = new Set()
const EMPTY_SEARCHES: ReadonlyMap<ContextHistoryReadRequest['checkpointId'], ContextHistorySearchResult> = new Map()
const INITIAL_VIEW: ContextControllerView = Object.freeze({
  status: 'cold',
  context: null,
  details: EMPTY_DETAILS,
  detailLoading: EMPTY_LOADING,
  loadingEarlier: false,
  rewriteUnitId: null,
  preparationOperation: null,
  histories: EMPTY_HISTORIES,
  historyLoading: EMPTY_HISTORY_LOADING,
  searches: EMPTY_SEARCHES,
  searchLoading: EMPTY_HISTORY_LOADING,
  lastRewrite: null,
  error: null,
})

/** Convert a Remote carrier failure into one stable UI result. */
function remoteFailure(_error: { code: string; message: string }): ContextFailure {
  return { ok: false, error: { code: _error.code, message: _error.message } }
}

/** Convert an unknown rejected promise into a non-throwing UI result. */
function thrownFailure(error: unknown): ContextFailure {
  return {
    ok: false,
    error: {
      code: 'transport',
      message: error instanceof Error ? error.message : 'Session Context request failed',
    },
  }
}

/** Coalesce adjacent fragments of one serialized original for readable recall output. */
function mergeHistoryEntries(entries: readonly ContextHistoryEntry[]): ContextHistoryEntry[] {
  const merged: ContextHistoryEntry[] = []
  for (const entry of entries) {
    const previous = merged.at(-1)
    if (previous !== undefined
      && previous.checkpointId === entry.checkpointId
      && previous.seq === entry.seq
      && previous.role === entry.role
      && previous.nestedCheckpointId === entry.nestedCheckpointId
      && previous.offset + previous.text.length === entry.offset) {
      merged[merged.length - 1] = {
        ...previous,
        text: previous.text + entry.text,
        complete: entry.complete,
      }
    } else {
      merged.push(entry)
    }
  }
  return merged
}

/** One Session's lazily active Context reader and mutation coordinator. */
export class SessionContextController implements HostObservable<ContextControllerView> {
  private view = INITIAL_VIEW
  private readonly listeners = new Set<() => void>()
  private activeReaders = 0
  private unsubscribeSession: (() => void) | undefined
  private observedSurfaceRevision: number | null = null
  private refreshRequested = false
  private refreshPromise: Promise<ContextActionResult<ContextSnapshot>> | null = null
  private refreshAbort: AbortController | undefined
  private loadEarlierPromise: Promise<ContextActionResult<ContextSnapshot>> | null = null
  private loadEarlierAbort: AbortController | undefined
  private readonly detailPromises = new Map<ContextUnitId, Promise<ContextActionResult<ContextUnitDetail>>>()
  private readonly detailAborts = new Map<ContextUnitId, AbortController>()
  private rewritePromise: Promise<ContextActionResult<ContextRewriteResult>> | null = null
  private rewriteAbort: AbortController | undefined
  private preparationPromise: Promise<unknown> | null = null
  private preparationAbort: AbortController | undefined
  private readonly historyAborts = new Map<ContextHistoryReadRequest['checkpointId'], AbortController>()
  private readonly searchAborts = new Map<ContextHistoryReadRequest['checkpointId'], AbortController>()
  private readonly searchQueries = new Map<ContextHistoryReadRequest['checkpointId'], string>()
  private disposed = false

  /**
   * @param remote - generated Session Context Remote namespace.
   * @param sessionId - Session addressed by every operation.
   * @param session - resident client Session used for surface changes and active preparation progress.
   */
  constructor(
    private readonly remote: SessionContextRemote,
    private readonly sessionId: SessionId,
    private readonly session: SessionFace,
  ) {}

  /** Return the cached immutable controller output. */
  getSnapshot = (): ContextControllerView => this.view

  /** Subscribe to output replacement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Activate Host reads while the Context view is mounted.
   * @returns an idempotent release callback.
   */
  activate(): () => void {
    if (this.disposed) return () => {}
    this.activeReaders += 1
    if (this.activeReaders === 1) {
      this.observedSurfaceRevision = this.session.getSnapshot().surfaceRevision
      this.unsubscribeSession = this.session.subscribe(() => { this.onSessionChange() })
      void this.refresh()
    }
    let active = true
    return () => {
      if (!active) return
      active = false
      this.activeReaders -= 1
      if (this.activeReaders !== 0) return
      this.unsubscribeSession?.()
      this.unsubscribeSession = undefined
      this.refreshRequested = false
      this.refreshAbort?.abort()
      this.loadEarlierAbort?.abort()
      for (const abort of this.detailAborts.values()) abort.abort()
      for (const abort of this.historyAborts.values()) abort.abort()
      for (const abort of this.searchAborts.values()) abort.abort()
    }
  }

  /**
   * Refresh the authoritative current Context, collapsing concurrent and mid-flight invalidations.
   * @returns the last snapshot or carrier failure observed by the refresh loop.
   */
  refresh(): Promise<ContextActionResult<ContextSnapshot>> {
    if (this.disposed) return Promise.resolve(remoteFailure({ code: 'disposed', message: 'Context controller is disposed' }))
    this.refreshRequested = true
    if (this.refreshPromise !== null) return this.refreshPromise
    const pending = this.runRefreshLoop()
    this.refreshPromise = pending
    return pending.finally(() => { this.refreshPromise = null })
  }

  /**
   * Load one earlier stable unit page and prepend it to the current tail window.
   * @returns the merged current snapshot, or a settled failure after stale pages trigger a tail refresh.
   */
  loadEarlier(): Promise<ContextActionResult<ContextSnapshot>> {
    if (this.loadEarlierPromise !== null) return this.loadEarlierPromise
    const current = this.view.context
    if (current === null || !current.hasEarlierUnits) {
      return Promise.resolve(remoteFailure({ code: 'context-complete', message: 'All current context units are loaded' }))
    }
    const abort = new AbortController()
    this.loadEarlierAbort = abort
    this.publish({ ...this.view, loadingEarlier: true, error: null })
    const pending = this.loadEarlierPage(current, abort.signal).finally(() => {
      if (this.loadEarlierAbort === abort) this.loadEarlierAbort = undefined
      this.publish({ ...this.view, loadingEarlier: false })
    })
    this.loadEarlierPromise = pending
    return pending.finally(() => { this.loadEarlierPromise = null })
  }

  private async loadEarlierPage(
    current: ContextSnapshot,
    signal: AbortSignal,
  ): Promise<ContextActionResult<ContextSnapshot>> {
    try {
      const carried = await this.remote.inspect(this.sessionId, {
        beforeIndex: current.unitOffset,
      }, signal)
      if (!carried.ok) {
        const failed = remoteFailure(carried.error)
        this.publish({ ...this.view, error: failed.error.message })
        return failed
      }
      if (signal.aborted || this.disposed) {
        return remoteFailure({ code: 'cancelled', message: 'Earlier context loading was cancelled' })
      }
      const page = carried.value
      const sameSurface = page.tailSeq === current.tailSeq
        && page.replaceGeneration === current.replaceGeneration
      const contiguous = page.unitOffset + page.units.length === current.unitOffset
      if (!sameSurface || !contiguous) return await this.refresh()
      const merged = {
        ...current,
        unitOffset: page.unitOffset,
        hasEarlierUnits: page.hasEarlierUnits,
        units: [...page.units, ...current.units],
      }
      this.publish({ ...this.view, context: merged, status: 'ready', error: null })
      return { ok: true, value: merged }
    } catch (error) {
      if (signal.aborted || this.disposed) {
        return remoteFailure({ code: 'cancelled', message: 'Earlier context loading was cancelled' })
      }
      const failed = thrownFailure(error)
      this.publish({ ...this.view, error: failed.error.message })
      return failed
    }
  }

  /**
   * Read one complete current unit, sharing duplicate expansion requests.
   * @param unitId - current Context unit identity.
   * @returns the authoritative unit detail or a settled failure.
   */
  readUnit(unitId: ContextUnitId): Promise<ContextActionResult<ContextUnitDetail>> {
    const cached = this.view.details.get(unitId)
    if (cached !== undefined) return Promise.resolve({ ok: true, value: cached })
    const existing = this.detailPromises.get(unitId)
    if (existing !== undefined) return existing
    const abort = new AbortController()
    this.detailAborts.set(unitId, abort)
    this.publish({
      ...this.view,
      detailLoading: new Set([...this.view.detailLoading, unitId]),
      error: null,
    })
    const pending = this.loadUnit(unitId, abort.signal).finally(() => {
      this.detailPromises.delete(unitId)
      this.detailAborts.delete(unitId)
      const loading = new Set(this.view.detailLoading)
      loading.delete(unitId)
      this.publish({ ...this.view, detailLoading: loading })
    })
    this.detailPromises.set(unitId, pending)
    return pending
  }

  /**
   * Commit one current-unit rewrite against the latest loaded tail.
   * @param request - target, text, suffix policy, and continuation choice.
   * @returns the committed rewrite or a settled failure.
   */
  rewrite(request: {
    unitId: ContextUnitId
    text: string
    mode: ContextRewriteMode
    continue: boolean
  }): Promise<ContextActionResult<ContextRewriteResult>> {
    if (this.rewritePromise !== null) return this.rewritePromise
    const context = this.view.context
    if (context === null || context.tailSeq === null) {
      return Promise.resolve(remoteFailure({ code: 'context-stale', message: 'Current context is unavailable' }))
    }
    const abort = new AbortController()
    this.rewriteAbort = abort
    this.publish({ ...this.view, rewriteUnitId: request.unitId, lastRewrite: null, error: null })
    const pending = this.commitRewrite(request, context.tailSeq, abort.signal).finally(() => {
      this.rewriteAbort = undefined
      this.publish({ ...this.view, rewriteUnitId: null })
    })
    this.rewritePromise = pending
    return pending.finally(() => { this.rewritePromise = null })
  }

  /**
   * Prepare one contiguous current-unit range for review.
   * @param request - current range endpoints and optional preservation brief.
   * @returns the durable preparation or a settled carrier or operation failure.
   */
  prepare(request: ContextPrepareRequest): Promise<ContextActionResult<ContextPreparation>> {
    return this.runPreparationOperation('prepare', signal => this.remote.prepare(this.sessionId, request, signal))
  }

  /**
   * Persist one review edit.
   * @param request - ready preparation identity, replacement summary, and edit source.
   * @returns the updated preparation or a settled carrier or operation failure.
   */
  editPreparation(request: ContextPreparationEditRequest): Promise<ContextActionResult<ContextPreparation>> {
    return this.runPreparationOperation('edit', signal => this.remote.editPreparation(this.sessionId, request, signal))
  }

  /**
   * Discard one ready or failed preparation.
   * @param request - durable preparation identity.
   * @returns discard confirmation or a settled carrier or operation failure.
   */
  discardPreparation(request: ContextPreparationRef): Promise<ContextActionResult<{ discarded: true }>> {
    return this.runPreparationOperation('discard', signal => this.remote.discardPreparation(this.sessionId, request, signal))
  }

  /**
   * Commit one reviewed preparation after Host revalidation.
   * @param request - ready durable preparation identity.
   * @returns the committed compaction result or a settled carrier or operation failure.
   */
  commitPreparation(request: ContextPreparationRef): Promise<ContextActionResult<ContextPreparationCommitResult>> {
    return this.runPreparationOperation('commit', signal => this.remote.commitPreparation(this.sessionId, request, signal))
  }

  /**
   * Read or continue recursive originals for one checkpoint.
   * @param checkpointId - checkpoint whose exact shadowed originals are read.
   * @param more - continue from the stored cursor instead of replacing the current page.
   * @returns the accumulated bounded history or a settled carrier or operation failure.
   */
  async readHistory(
    checkpointId: ContextHistoryReadRequest['checkpointId'],
    more = false,
  ): Promise<ContextActionResult<ContextHistoryReadResult>> {
    const previous = this.view.histories.get(checkpointId)
    if (more && (previous === undefined || previous.nextCursor === undefined)) {
      return remoteFailure({ code: 'history-complete', message: 'Checkpoint history is already complete' })
    }
    this.historyAborts.get(checkpointId)?.abort()
    const abort = new AbortController()
    this.historyAborts.set(checkpointId, abort)
    this.publish({
      ...this.view,
      historyLoading: new Set([...this.view.historyLoading, checkpointId]),
      error: null,
    })
    try {
      const carried = await this.remote.historyRead(this.sessionId, {
        checkpointId,
        recursive: true,
        ...more && previous?.nextCursor !== undefined ? { cursor: previous.nextCursor } : {},
      }, abort.signal)
      if (!carried.ok) return this.settleRemoteFailure(carried.error)
      const entries = mergeHistoryEntries(more && previous !== undefined
        ? [...previous.entries, ...carried.value.entries]
        : carried.value.entries)
      const value = { ...carried.value, entries }
      const histories = new Map(this.view.histories)
      histories.set(checkpointId, value)
      this.publish({ ...this.view, histories })
      return { ok: true, value }
    } catch (error) {
      return this.settleThrownFailure(abort.signal, error)
    } finally {
      this.releaseCheckpointOperation(this.historyAborts, checkpointId, abort, 'historyLoading')
    }
  }

  /**
   * Search recursively reachable originals for one checkpoint.
   * @param checkpointId - checkpoint whose reachable originals are searched.
   * @param query - literal text matched by the Host search.
   * @param more - continue the same stored query from its cursor.
   * @returns the accumulated bounded matches or a settled carrier or operation failure.
   */
  async searchHistory(
    checkpointId: ContextHistorySearchRequest['checkpointId'],
    query: string,
    more = false,
  ): Promise<ContextActionResult<ContextHistorySearchResult>> {
    const previous = this.view.searches.get(checkpointId)
    const previousQuery = this.searchQueries.get(checkpointId)
    if (more && (previous === undefined || previous.nextCursor === undefined || previousQuery !== query)) {
      return remoteFailure({ code: 'search-complete', message: 'Checkpoint search has no matching continuation' })
    }
    this.searchAborts.get(checkpointId)?.abort()
    const abort = new AbortController()
    this.searchAborts.set(checkpointId, abort)
    this.publish({
      ...this.view,
      searchLoading: new Set([...this.view.searchLoading, checkpointId]),
      error: null,
    })
    try {
      const carried = await this.remote.historySearch(this.sessionId, {
        checkpointId,
        query,
        recursive: true,
        ...more && previous?.nextCursor !== undefined ? { cursor: previous.nextCursor } : {},
      }, abort.signal)
      if (!carried.ok) return this.settleRemoteFailure(carried.error)
      const value = more && previous !== undefined
        ? { ...carried.value, matches: [...previous.matches, ...carried.value.matches] }
        : carried.value
      const searches = new Map(this.view.searches)
      searches.set(checkpointId, value)
      this.searchQueries.set(checkpointId, query)
      this.publish({ ...this.view, searches })
      return { ok: true, value }
    } catch (error) {
      return this.settleThrownFailure(abort.signal, error)
    } finally {
      this.releaseCheckpointOperation(this.searchAborts, checkpointId, abort, 'searchLoading')
    }
  }

  /** Stop every local observer and in-flight Remote call. */
  dispose(): void {
    this.disposed = true
    this.unsubscribeSession?.()
    this.unsubscribeSession = undefined
    this.refreshAbort?.abort()
    this.loadEarlierAbort?.abort()
    this.rewriteAbort?.abort()
    this.preparationAbort?.abort()
    for (const abort of this.detailAborts.values()) abort.abort()
    for (const abort of this.historyAborts.values()) abort.abort()
    for (const abort of this.searchAborts.values()) abort.abort()
    this.listeners.clear()
  }

  private onSessionChange(): void {
    const revision = this.session.getSnapshot().surfaceRevision
    const surfaceChanged = revision !== this.observedSurfaceRevision
    if (!surfaceChanged && this.view.preparationOperation === null) return
    if (surfaceChanged) this.observedSurfaceRevision = revision
    if (this.activeReaders > 0) void this.refresh()
  }

  private async runRefreshLoop(): Promise<ContextActionResult<ContextSnapshot>> {
    let result: ContextActionResult<ContextSnapshot> = remoteFailure({
      code: 'context-unavailable',
      message: 'Current context is unavailable',
    })
    while (this.refreshRequested && !this.disposed && this.activeReaders > 0) {
      this.refreshRequested = false
      this.refreshAbort?.abort()
      const abort = new AbortController()
      this.refreshAbort = abort
      this.publish({ ...this.view, status: 'loading', error: null })
      try {
        const carried = await this.remote.inspect(this.sessionId, {}, abort.signal)
        if (this.refreshInvalidated(abort.signal)) continue
        if (!carried.ok) {
          result = remoteFailure(carried.error)
          this.publish({ ...this.view, status: 'error', error: carried.error.message })
          continue
        }
        result = { ok: true, value: carried.value }
        const currentIds = new Set(carried.value.units.map(unit => unit.id))
        const currentCheckpointIds = new Set(carried.value.units.flatMap(unit => (
          unit.checkpointId === undefined ? [] : [unit.checkpointId]
        )))
        const details = new Map(
          [...this.view.details].filter(([unitId]) => currentIds.has(unitId)),
        )
        const histories = new Map(
          [...this.view.histories].filter(([checkpointId]) => currentCheckpointIds.has(checkpointId)),
        )
        const searches = new Map(
          [...this.view.searches].filter(([checkpointId]) => currentCheckpointIds.has(checkpointId)),
        )
        for (const checkpointId of this.searchQueries.keys()) {
          if (!currentCheckpointIds.has(checkpointId)) this.searchQueries.delete(checkpointId)
        }
        for (const [checkpointId, controller] of this.historyAborts) {
          if (!currentCheckpointIds.has(checkpointId)) controller.abort()
        }
        for (const [checkpointId, controller] of this.searchAborts) {
          if (!currentCheckpointIds.has(checkpointId)) controller.abort()
        }
        this.publish({
          ...this.view,
          status: 'ready',
          context: carried.value,
          details,
          histories,
          searches,
          error: null,
        })
      } catch (error) {
        if (this.refreshInvalidated(abort.signal)) continue
        result = thrownFailure(error)
        this.publish({ ...this.view, status: 'error', error: result.error.message })
      }
    }
    return result
  }

  /** Whether disposal or a superseding refresh invalidated one awaited result. */
  private refreshInvalidated(signal: AbortSignal): boolean {
    return signal.aborted || this.disposed
  }

  private async loadUnit(
    unitId: ContextUnitId,
    signal: AbortSignal,
  ): Promise<ContextActionResult<ContextUnitDetail>> {
    try {
      const carried = await this.remote.readUnit(this.sessionId, unitId, signal)
      if (!carried.ok) return remoteFailure(carried.error)
      if (signal.aborted || this.disposed) return remoteFailure({ code: 'cancelled', message: 'Unit read was cancelled' })
      if (this.view.context?.units.some(unit => unit.id === unitId) !== true) {
        return remoteFailure({ code: 'context-stale', message: 'This unit is no longer in the current context' })
      }
      const details = new Map(this.view.details)
      details.set(unitId, carried.value)
      this.publish({ ...this.view, details, error: null })
      return { ok: true, value: carried.value }
    } catch (error) {
      if (signal.aborted || this.disposed) return remoteFailure({ code: 'cancelled', message: 'Unit read was cancelled' })
      const failed = thrownFailure(error)
      this.publish({ ...this.view, error: failed.error.message })
      return failed
    }
  }

  /**
   * Publish one Remote carrier failure as the view error and settle it.
   * @param error - the carrier failure carried by the result union.
   * @returns the settled UI failure.
   */
  private settleRemoteFailure(error: { code: string; message: string }): ContextFailure {
    const failed = remoteFailure(error)
    this.publish({ ...this.view, error: failed.error.message })
    return failed
  }

  /**
   * Settle one rejected Remote call, publishing it as the view error unless its
   * signal was aborted or the controller was disposed.
   * @param signal - the operation's abort signal.
   * @param error - the rejected value.
   * @returns the settled UI failure.
   */
  private settleThrownFailure(signal: AbortSignal, error: unknown): ContextFailure {
    const failed = thrownFailure(error)
    if (!signal.aborted && !this.disposed) this.publish({ ...this.view, error: failed.error.message })
    return failed
  }

  /**
   * Release one settled paged checkpoint operation: drop its abort slot and
   * clear its loading flag. A superseded operation publishes nothing.
   * @param aborts - registry of in-flight aborts for this operation's checkpoints.
   * @param checkpointId - checkpoint the operation addressed.
   * @param abort - the operation's own controller.
   * @param loadingKey - the view flag naming this operation's in-flight checkpoints.
   */
  private releaseCheckpointOperation(
    aborts: Map<ContextHistoryReadRequest['checkpointId'], AbortController>,
    checkpointId: ContextHistoryReadRequest['checkpointId'],
    abort: AbortController,
    loadingKey: 'historyLoading' | 'searchLoading',
  ): void {
    if (aborts.get(checkpointId) !== abort) return
    aborts.delete(checkpointId)
    const loading = new Set(this.view[loadingKey])
    loading.delete(checkpointId)
    this.publish(loadingKey === 'historyLoading'
      ? { ...this.view, historyLoading: loading }
      : { ...this.view, searchLoading: loading })
  }

  private async commitRewrite(
    request: { unitId: ContextUnitId; text: string; mode: ContextRewriteMode; continue: boolean },
    expectedTailSeq: number,
    signal: AbortSignal,
  ): Promise<ContextActionResult<ContextRewriteResult>> {
    try {
      const carried = await this.remote.rewrite(this.sessionId, {
        ...request,
        expectedTailSeq,
      }, signal)
      if (!carried.ok) return this.settleRemoteFailure(carried.error)
      this.publish({ ...this.view, lastRewrite: carried.value, error: null })
      if (this.activeReaders > 0) await this.refresh()
      return { ok: true, value: carried.value }
    } catch (error) {
      return this.settleThrownFailure(signal, error)
    }
  }

  /** Serialize preparation mutations and refresh their durable projection after settlement. */
  private runPreparationOperation<T>(
    kind: Exclude<ContextControllerView['preparationOperation'], null>,
    operation: (signal: AbortSignal) => Promise<RemoteResult<T>>,
  ): Promise<ContextActionResult<T>> {
    if (this.preparationPromise !== null) {
      return Promise.resolve(remoteFailure({ code: 'busy', message: 'Another context preparation operation is active' }))
    }
    const abort = new AbortController()
    this.preparationAbort = abort
    this.publish({ ...this.view, preparationOperation: kind, error: null })
    const pending = (async (): Promise<ContextActionResult<T>> => {
      try {
        const carried = await operation(abort.signal)
        if (!carried.ok) return this.settleRemoteFailure(carried.error)
        if (this.activeReaders > 0) await this.refresh()
        return { ok: true, value: carried.value }
      } catch (error) {
        return this.settleThrownFailure(abort.signal, error)
      }
    })().finally(() => {
      this.preparationAbort = undefined
      this.publish({ ...this.view, preparationOperation: null })
    })
    this.preparationPromise = pending
    return pending.finally(() => { this.preparationPromise = null })
  }

  /** Replace the output and contain subscriber failures at the object-layer boundary. */
  private publish(view: ContextControllerView): void {
    if (this.disposed) return
    this.view = Object.freeze(view)
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[ui-context] subscriber threw:', error)
      }
    }
  }
}
