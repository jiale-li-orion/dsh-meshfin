import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  CompactionPreparationId,
  compactionPreparationDigest,
} from '@deepseek-ai/dsh-compaction'
import type { CompactionPreparationProgress, CompactionPreparationRequest } from '@deepseek-ai/dsh-compaction'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { SummarizationInput, SummaryResult } from '../src/summarizer.ts'

class PreparationEngine extends BasicCompactionEngine {
  readonly inputs: SummarizationInput[] = []
  readonly outputCaps: number[] = []
  active = 0
  maxActive = 0
  contextWindow = 512
  modelMaxOutputTokens = 32

  protected override async summarize(
    input: SummarizationInput,
    _agent: Agent,
    _signal?: AbortSignal,
    maxTokens?: number,
  ): Promise<SummaryResult> {
    this.inputs.push(input)
    if (maxTokens !== undefined) this.outputCaps.push(maxTokens)
    this.active += 1
    this.maxActive = Math.max(this.maxActive, this.active)
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    this.active -= 1
    const stage = input.kind === 'range' ? input.stage : 'prefix'
    return {
      summary: [{ type: 'text', text: `${stage} summary ${this.inputs.length}` }],
      provider: 'preparation-test',
      model: 'preparation-test',
      ...maxTokens === undefined ? {} : { maxTokens },
    }
  }

  protected override resolvePreparationTarget(): Promise<{
    provider: string
    model: string
    contextWindow: number
    maxOutputTokens: number
  }> {
    return Promise.resolve({
      provider: 'preparation-test',
      model: 'preparation-test',
      contextWindow: this.contextWindow,
      maxOutputTokens: this.modelMaxOutputTokens,
    })
  }
}

function harness(payloadRepeats = 100): { ctx: Context; engine: PreparationEngine; agent: Agent } {
  const ctx = new Context()
  void new SessionStore(ctx)
  // The registry is a required injection of TokenMeter (its projection units
  // register in the constructor); mount it synchronously.
  new SessionProjectionRegistry(ctx)
  void new TokenMeter(ctx)
  const engine = new PreparationEngine(ctx, {
    auto: false,
    maxTokens: 32,
    preparationConcurrency: 2,
  })
  const session = ctx.sessions.create(SessionId('prepared-range'))
  for (let index = 0; index < 4; index += 1) {
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `message-${index} ${'payload '.repeat(payloadRepeats)}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
  }
  const agent = {
    id: session.id,
    session,
    ctx,
    options: { provider: 'preparation-test', model: 'preparation-test' },
    runMaintenance: <T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> =>
      task(new AbortController().signal),
  } as Agent
  return { ctx, engine, agent }
}

function request(agent: Agent): CompactionPreparationRequest {
  const nodes = [...agent.session.surface.nodes]
  const measurement = agent.ctx.tokenMeter.measure(agent.session)
  return {
    preparationId: CompactionPreparationId('prepared-range-1'),
    start: nodes[0]!,
    end: nodes[2]!,
    shadowedSeqs: nodes.slice(0, 3),
    shadowedDigest: compactionPreparationDigest(nodes.slice(0, 3)),
    shadowedTokenCount: measurement.nodes.slice(0, 3).reduce((sum, node) => sum + node.tokens, 0),
    unitCount: 3,
    preservationBrief: 'Keep exact message labels.',
  }
}

describe('reviewed range preparation', () => {
  it('uses bounded concurrent map/reduce calls and mutates no surface before commit', async () => {
    const { engine, agent } = harness()
    const before = [...agent.session.surface.nodes]
    const progress: CompactionPreparationProgress[] = []
    const prepared = await engine.prepareRegion(
      request(agent),
      agent,
      new AbortController().signal,
      (item) => {
        progress.push(item)
        return Promise.resolve()
      },
    )

    expect(agent.session.surface.nodes).toEqual(before)
    expect(agent.session.surface.replaceGeneration).toBe(0)
    expect(prepared.chunks.filter(chunk => chunk.stage === 'map')).toHaveLength(3)
    expect(prepared.calls.some(call => call.stage === 'reduce')).toBe(true)
    expect(progress[0]).toMatchObject({ kind: 'planned', plan: { strategy: 'map-reduce' } })
    expect(progress.filter(item => item.kind === 'attempt')).toHaveLength(prepared.calls.length)
    expect(progress.filter(item => item.kind === 'call')).toHaveLength(prepared.calls.length)
    expect(engine.outputCaps.every(cap => cap === 32)).toBe(true)
    expect(engine.maxActive).toBe(2)

    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'later append outside the prepared span' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const result = await engine.commitPrepared(
      prepared,
      [{ type: 'text', text: 'reviewed compact summary' }],
      'human',
      'idle',
      agent,
      new AbortController().signal,
    )

    expect(result.shadowedSeqs).toEqual(before.slice(0, 3))
    expect(agent.session.deriveMessages().at(-1)?.content).toEqual([
      { type: 'text', text: 'later append outside the prepared span' },
    ])
    const summary = [...agent.session.snapshotEvents()]
      .reverse()
      .find(event => event.type === 'compaction/summary')
    expect(summary?.data).toMatchObject({
      preparationId: prepared.request.preparationId,
      summarySource: 'human',
    })
  })

  it('uses one direct call when the complete selected request and dynamic output cap fit', async () => {
    const { engine, agent } = harness(25_000)
    engine.contextWindow = 1_000_000
    engine.modelMaxOutputTokens = 256_000
    const progress: CompactionPreparationProgress[] = []

    const prepared = await engine.prepareRegion(
      request(agent),
      agent,
      new AbortController().signal,
      (item) => {
        progress.push(item)
        return Promise.resolve()
      },
    )

    const expectedCap = Math.max(16_000, Math.ceil(prepared.request.shadowedTokenCount / 4))
    expect(prepared.chunks).toHaveLength(1)
    expect(prepared.chunks[0]).toMatchObject({ stage: 'direct', index: 0 })
    expect(prepared.calls).toHaveLength(1)
    expect(prepared.calls[0]).toMatchObject({ stage: 'direct', maxTokens: expectedCap })
    expect(engine.inputs).toHaveLength(1)
    expect(engine.outputCaps).toEqual([expectedCap])
    expect(progress[0]).toMatchObject({
      kind: 'planned',
      plan: {
        strategy: 'direct',
        contextWindow: 1_000_000,
        modelMaxOutputTokens: 256_000,
        outputTokenCap: expectedCap,
      },
    })
  })

  it('rejects changed selected membership before opening a compaction bracket', async () => {
    const { engine, agent } = harness()
    const prepared = await engine.prepareRegion(
      request(agent),
      agent,
      new AbortController().signal,
      () => Promise.resolve(),
    )
    const first = agent.session.surface.nodes[0]!
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'replacement' }],
      source: { kind: 'user' },
    }), {
      surfaceOp: { op: 'replace', startSeq: first, endSeq: first },
      sourceEventSeqs: [first],
    })

    await expect(engine.commitPrepared(
      prepared,
      [{ type: 'text', text: 'reviewed compact summary' }],
      'generated',
      'idle',
      agent,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'changed' })
    expect(agent.session.snapshotEvents()
      .some(event => event.type === 'compaction/start'
        && event.data.preparationId === prepared.request.preparationId)).toBe(false)
  })
})
