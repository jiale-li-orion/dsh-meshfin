import { describe, expect, it, vi } from 'vitest'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { ContextHistoryCursor, ContextUnitId } from '@deepseek-ai/dsh-session-context/brand'
import type { ContextSnapshot } from '@deepseek-ai/dsh-session-context/types'
import type { ContextPressureProjection } from '@deepseek-ai/dsh-token-meter/client'
import { SessionContextController } from '../src/client/controller.ts'
import type { SessionContextRemote } from '../src/client/controller.ts'

const SID = 'context-controller' as SessionId

function context(revision = 0): ContextSnapshot {
  return {
    sessionId: SID,
    logRevision: revision as SessionLogOffset,
    replaceGeneration: revision as SessionLogOffset,
    generationSeq: revision === 0 ? null : revision as SessionSeq,
    tailSeq: 3 as SessionSeq,
    totalTokens: 20,
    surfaceTokens: 16,
    unitCount: 1,
    unitOffset: 0,
    hasEarlierUnits: false,
    units: [{
      id: ContextUnitId('unit-1'),
      startSeq: 1 as SessionSeq,
      endSeq: 1 as SessionSeq,
      kind: 'message',
      role: 'user',
      tokenCount: 8,
      preview: 'hello',
      time: 1,
      balanced: true,
      editable: true,
    }],
    preparations: [],
  }
}

/**
 * Stand-in for the Session's `contextPressure` projection: its `projectedTokens`
 * is the Host's own figure for what the next request's prompt would cost.
 */
function pressureSource(initial?: number): {
  source: ObservableSnapshot<unknown>
  push: (tokens: number | undefined) => void
  notifyOnly: () => void
} {
  let snapshot: ContextPressureProjection | undefined = initial === undefined ? undefined : { projectedTokens: initial }
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of listeners) listener() }
  return {
    source: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    push: (tokens) => {
      snapshot = tokens === undefined ? undefined : { projectedTokens: tokens }
      notify()
    },
    notifyOnly: notify,
  }
}

function remote(): SessionContextRemote {
  return {
    inspect: vi.fn<SessionContextRemote['inspect']>(async () => ({ ok: true, value: context(1) })),
    readUnit: vi.fn<SessionContextRemote['readUnit']>(async () => ({
      ok: true,
      value: { unit: context().units[0]!, messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] },
    })),
    rewrite: vi.fn<SessionContextRemote['rewrite']>(async () => ({
      ok: true,
      value: { rewriteId: 'rewrite' as never, replacementSeq: 4 as SessionSeq, previousGenerationSeq: null, shadowedItemCount: 1, shadowedTokenCount: 8 },
    })),
    prepare: vi.fn<SessionContextRemote['prepare']>(async () => ({
      ok: true,
      value: {
        preparationId: 'prep' as never,
        status: 'ready',
        startSeq: 1 as SessionSeq,
        endSeq: 1 as SessionSeq,
        unitCount: 1,
        shadowedTokenCount: 8,
        summary: 'summary',
        summarySource: 'generated',
        attemptedCalls: 1,
        completedCalls: 1,
        chunkCount: 1,
        createdAt: 1,
      },
    })),
    editPreparation: vi.fn<SessionContextRemote['editPreparation']>(async (_id, request) => ({
      ok: true,
      value: {
        preparationId: request.preparationId,
        status: 'ready',
        startSeq: 1 as SessionSeq,
        endSeq: 1 as SessionSeq,
        unitCount: 1,
        shadowedTokenCount: 8,
        summary: request.text,
        summarySource: request.source,
        attemptedCalls: 1,
        completedCalls: 1,
        chunkCount: 1,
        createdAt: 1,
      },
    })),
    discardPreparation: vi.fn<SessionContextRemote['discardPreparation']>(async () => ({ ok: true, value: { discarded: true } })),
    commitPreparation: vi.fn<SessionContextRemote['commitPreparation']>(async () => ({
      ok: true,
      value: {
        compactionId: 'compact' as never,
        startSeq: 4 as SessionSeq,
        summarySeq: 5 as SessionSeq,
        endSeq: 7 as SessionSeq,
        summary: [{ type: 'text', text: 'summary' }],
        shadowedRange: { start: 1 as SessionSeq, end: 1 as SessionSeq },
        shadowedSeqs: [1 as SessionSeq],
        shadowedTokenCount: 8,
      },
    })),
    historyRead: vi.fn<SessionContextRemote['historyRead']>(async () => ({
      ok: true,
      value: { entries: [], complete: true, returnedBytes: 50 },
    })),
    historySearch: vi.fn<SessionContextRemote['historySearch']>(async () => ({
      ok: true,
      value: { matches: [], complete: true, scannedBytes: 20 },
    })),
  }
}

describe('SessionContextController', () => {
  it('refreshes only while active and only when the prompt pressure figure moves', async () => {
    const pressure = pressureSource(40)
    const api = remote()
    const controller = new SessionContextController(api, SID, pressure.source)
    const release = controller.activate()
    await vi.waitFor(() => { expect(api.inspect).toHaveBeenCalledOnce() })
    expect(controller.getSnapshot().status).toBe('ready')

    pressure.notifyOnly()
    await Promise.resolve()
    expect(api.inspect).toHaveBeenCalledOnce()

    pressure.push(64)
    await vi.waitFor(() => { expect(api.inspect).toHaveBeenCalledTimes(2) })
    release()
    pressure.push(96)
    await Promise.resolve()
    expect(api.inspect).toHaveBeenCalledTimes(2)
  })

  it('refuses a second preparation operation while one is in flight', async () => {
    const pressure = pressureSource(40)
    const api = remote()
    let settle!: (result: Awaited<ReturnType<SessionContextRemote['prepare']>>) => void
    vi.mocked(api.prepare).mockImplementation(() => new Promise((resolve) => { settle = resolve }))
    const controller = new SessionContextController(api, SID, pressure.source)
    const release = controller.activate()
    await vi.waitFor(() => { expect(api.inspect).toHaveBeenCalledOnce() })

    const pending = controller.prepare({
      startUnitId: ContextUnitId('unit-1'),
      endUnitId: ContextUnitId('unit-1'),
    })
    await vi.waitFor(() => { expect(controller.getSnapshot().preparationOperation).toBe('prepare') })
    await expect(controller.discardPreparation({ preparationId: 'prep' as never }))
      .resolves.toMatchObject({ ok: false, error: { code: 'busy' } })
    settle({
      ok: true,
      value: {
        preparationId: 'prep' as never,
        status: 'ready',
        startSeq: 1 as SessionSeq,
        endSeq: 1 as SessionSeq,
        unitCount: 1,
        shadowedTokenCount: 8,
        summary: 'summary',
        summarySource: 'generated',
        attemptedCalls: 1,
        completedCalls: 1,
        chunkCount: 1,
        createdAt: 1,
      },
    })
    await expect(pending).resolves.toMatchObject({ ok: true })
    release()
  })

  it('caches unit reads and routes rewrite, preparation, commit, and recall through one view', async () => {
    const pressure = pressureSource(40)
    const api = remote()
    const controller = new SessionContextController(api, SID, pressure.source)
    const release = controller.activate()
    await vi.waitFor(() => { expect(controller.getSnapshot().status).toBe('ready') })

    await controller.readUnit(ContextUnitId('unit-1'))
    await controller.readUnit(ContextUnitId('unit-1'))
    expect(api.readUnit).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().details.get(ContextUnitId('unit-1'))?.messages).toHaveLength(1)

    await expect(controller.rewrite({ unitId: ContextUnitId('unit-1'), text: 'edited', mode: 'patch' }))
      .resolves.toMatchObject({ ok: true })
    await expect(controller.prepare({ startUnitId: ContextUnitId('unit-1'), endUnitId: ContextUnitId('unit-1') }))
      .resolves.toMatchObject({ ok: true })
    await expect(controller.editPreparation({ preparationId: 'prep' as never, text: 'edited summary', source: 'human' }))
      .resolves.toMatchObject({ ok: true })
    await expect(controller.commitPreparation({ preparationId: 'prep' as never }))
      .resolves.toMatchObject({ ok: true })
    await expect(controller.readHistory('compact' as never)).resolves.toMatchObject({ ok: true })
    await expect(controller.searchHistory('compact' as never, 'needle')).resolves.toMatchObject({ ok: true })

    expect(api.rewrite).toHaveBeenCalledOnce()
    expect(api.prepare).toHaveBeenCalledOnce()
    expect(api.editPreparation).toHaveBeenCalledOnce()
    expect(api.commitPreparation).toHaveBeenCalledOnce()
    expect(api.historyRead).toHaveBeenCalledOnce()
    expect(api.historySearch).toHaveBeenCalledOnce()
    release()
    controller.dispose()
  })

  it('prepends an earlier unit page only while the stable surface identity matches', async () => {
    const pressure = pressureSource(40)
    const api = remote()
    const tail = {
      ...context(2),
      unitCount: 2,
      unitOffset: 1,
      hasEarlierUnits: true,
      units: [{ ...context().units[0]!, id: ContextUnitId('unit-2'), startSeq: 2 as SessionSeq, endSeq: 2 as SessionSeq, preview: 'tail' }],
    }
    const older = {
      ...tail,
      unitOffset: 0,
      hasEarlierUnits: false,
      units: [{ ...context().units[0]!, id: ContextUnitId('unit-1'), preview: 'older' }],
    }
    vi.mocked(api.inspect)
      .mockResolvedValueOnce({ ok: true, value: tail })
      .mockResolvedValueOnce({ ok: true, value: older })
    const controller = new SessionContextController(api, SID, pressure.source)
    const release = controller.activate()
    await vi.waitFor(() => { expect(controller.getSnapshot().context?.unitOffset).toBe(1) })
    const result = await controller.loadEarlier()
    expect(result).toMatchObject({ ok: true })
    expect(controller.getSnapshot().context).toMatchObject({
      unitOffset: 0,
      hasEarlierUnits: false,
    })
    expect(controller.getSnapshot().context?.units.map(unit => unit.preview)).toEqual(['older', 'tail'])
    release()
  })

  it('refreshes the tail instead of installing an older page from a changed surface', async () => {
    const pressure = pressureSource(40)
    const api = remote()
    const tail = {
      ...context(2),
      unitCount: 2,
      unitOffset: 1,
      hasEarlierUnits: true,
      units: [{ ...context().units[0]!, id: ContextUnitId('tail-unit'), preview: 'tail' }],
    }
    const stalePage = {
      ...tail,
      replaceGeneration: 3 as SessionLogOffset,
      tailSeq: 9 as SessionSeq,
      unitOffset: 0,
      units: [{ ...context().units[0]!, id: ContextUnitId('stale-unit'), preview: 'stale older page' }],
    }
    const refreshed = {
      ...stalePage,
      unitOffset: 1,
      units: [{ ...context().units[0]!, id: ContextUnitId('fresh-tail'), preview: 'fresh tail' }],
    }
    vi.mocked(api.inspect)
      .mockResolvedValueOnce({ ok: true, value: tail })
      .mockResolvedValueOnce({ ok: true, value: stalePage })
      .mockResolvedValueOnce({ ok: true, value: refreshed })
    const controller = new SessionContextController(api, SID, pressure.source)
    const release = controller.activate()
    await vi.waitFor(() => { expect(controller.getSnapshot().context?.unitOffset).toBe(1) })

    await expect(controller.loadEarlier()).resolves.toMatchObject({ ok: true, value: refreshed })
    expect(controller.getSnapshot().context?.units.map(unit => unit.preview)).toEqual(['fresh tail'])
    expect(api.inspect).toHaveBeenCalledTimes(3)
    release()
  })

  it('coalesces original fragments and continues one query-bound search', async () => {
    const pressure = pressureSource(40)
    const api = remote()
    vi.mocked(api.historyRead).mockResolvedValue({
      ok: true,
      value: {
        entries: [
          { checkpointId: 'compact' as never, seq: 1 as SessionSeq, role: 'user', offset: 0, text: 'first ', complete: false },
          { checkpointId: 'compact' as never, seq: 1 as SessionSeq, role: 'user', offset: 6, text: 'second', complete: true },
        ],
        complete: true,
        returnedBytes: 100,
      },
    })
    vi.mocked(api.historySearch)
      .mockResolvedValueOnce({
        ok: true,
        value: {
          matches: [{ checkpointId: 'compact' as never, seq: 1 as SessionSeq, offset: 0, snippet: 'first' }],
          nextCursor: ContextHistoryCursor('next'),
          complete: false,
          scannedBytes: 100,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          matches: [{ checkpointId: 'compact' as never, seq: 1 as SessionSeq, offset: 10, snippet: 'second' }],
          complete: true,
          scannedBytes: 80,
        },
      })
    const controller = new SessionContextController(api, SID, pressure.source)

    await controller.readHistory('compact' as never)
    expect(controller.getSnapshot().histories.get('compact' as never)?.entries).toEqual([
      expect.objectContaining({ offset: 0, text: 'first second', complete: true }),
    ])
    await controller.searchHistory('compact' as never, 'needle')
    await controller.searchHistory('compact' as never, 'needle', true)
    expect(controller.getSnapshot().searches.get('compact' as never)?.matches.map(match => match.offset)).toEqual([0, 10])
    expect(api.historySearch).toHaveBeenLastCalledWith(
      SID,
      expect.objectContaining({ query: 'needle', cursor: ContextHistoryCursor('next') }),
      expect.any(AbortSignal),
    )
  })
})
