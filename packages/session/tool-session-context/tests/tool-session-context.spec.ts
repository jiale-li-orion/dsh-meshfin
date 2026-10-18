import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ContextUnitId } from '@deepseek-ai/dsh-session-context'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/index.ts'

function setup() {
  const ctx = new Context()
  void new SystemPrompt(ctx, {})
  void new ToolRuntime(ctx)
  const allUnits = Array.from({ length: 4 }, (_, index) => ({
    id: ContextUnitId(`unit-${index}`),
    startSeq: index,
    endSeq: index,
    kind: 'message' as const,
    role: 'user' as const,
    tokenCount: 20,
    preview: `unit ${index}`,
    time: index,
    balanced: true,
    editable: true,
  }))
  const inspect = vi.fn((_agent, request: { beforeIndex?: number; maxUnits?: number }) => {
    const end = request.beforeIndex ?? allUnits.length
    const start = Math.max(0, end - (request.maxUnits ?? 2))
    return Promise.resolve({
      sessionId: 'tool-session',
      logRevision: 9,
      replaceGeneration: 1,
      generationSeq: 7,
      tailSeq: 8,
      totalTokens: 100,
      surfaceTokens: 80,
      unitCount: allUnits.length,
      unitOffset: start,
      hasEarlierUnits: start > 0,
      units: allUnits.slice(start, end),
      preparations: [],
    })
  })
  const commitPreparationInTurn = vi.fn(() => Promise.resolve({
    compactionId: 'compaction-1',
    startSeq: 10,
    summarySeq: 11,
    endSeq: 13,
    summary: [{ type: 'text', text: 'summary' }],
    shadowedRange: { start: 1, end: 2 },
    shadowedSeqs: [1, 2],
    shadowedTokenCount: 40,
  }))
  ctx.provide('sessionContext', {
    inspect,
    readUnit: vi.fn(),
    prepare: vi.fn(),
    editPreparation: vi.fn(),
    commitPreparationInTurn,
    discardPreparation: vi.fn(),
    historyRead: vi.fn(),
    historySearch: vi.fn(),
  } as never)
  plugin.apply(ctx, { maxUnits: 2 })
  const agent = { id: 'tool-session' } as Agent
  const call = (name: string, args: unknown) => ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`call-${name}`),
    name,
    arguments: args,
    agent,
  })
  return { ctx, inspect, commitPreparationInTurn, agent, call }
}

describe('Session Context model tools', () => {
  it('registers the complete inspect, review, commit, and recall surface with guidance', async () => {
    const { ctx } = setup()
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'context_inspect',
      'context_read',
      'context_prepare',
      'context_edit_preparation',
      'context_commit',
      'context_discard_preparation',
      'history_read',
      'history_search',
    ])
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('context_prepare')
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('append-only log')
  })

  it('bounds context_inspect units and commits through the current-turn entry', async () => {
    const { inspect, commitPreparationInTurn, agent, call } = setup()
    const inspected = await call('context_inspect', { before_index: 4, limit: 99 })
    expect(inspected.isError).toBe(false)
    expect(inspected.value).toMatchObject({
      totalUnits: 4,
      unitOffset: 2,
      hasEarlierUnits: true,
      units: [{ preview: 'unit 2' }, { preview: 'unit 3' }],
    })
    expect(inspect).toHaveBeenCalledWith(
      agent,
      { beforeIndex: 4, maxUnits: 2 },
      expect.any(AbortSignal),
    )

    const committed = await call('context_commit', { preparation_id: 'prepared-1' })
    expect(committed.isError).toBe(false)
    expect(commitPreparationInTurn).toHaveBeenCalledWith(
      agent,
      { preparationId: 'prepared-1' },
      expect.any(AbortSignal),
    )
  })
})
