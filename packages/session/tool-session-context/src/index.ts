/** Model-facing current-context management and checkpoint recall tools. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CompactionId, CompactionPreparationId } from '@deepseek-ai/dsh-compaction'
import { ContextHistoryCursor, ContextUnitId } from '@deepseek-ai/dsh-session-context'
// Type-only: resolves the required ctx.sessionContext declaration.
import type {} from '@deepseek-ai/dsh-session-context'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'tool-session-context'
export const inject = ['tools', 'systemPrompt', 'sessionContext']

const DEFAULT_MAX_UNITS = 100
const DEFAULT_HISTORY_BYTES = 32 * 1024
const DEFAULT_SEARCH_BYTES = 512 * 1024
const DEFAULT_SEARCH_RESULTS = 20

/** Deployment bounds for model-facing Context reads. */
export interface Config {
  /** Maximum units returned by one model-facing context inspection. */
  maxUnits?: number
  /** Maximum complete JSON bytes returned by one model-facing history page. */
  historyBytes?: number
  /** Maximum original-message bytes scanned by one model-facing literal search. */
  searchBytes?: number
  /** Maximum matches returned by one model-facing literal search. */
  searchResults?: number
}

export const Config: z<Config> = z.object({
  maxUnits: z.number().step(1).min(1).default(DEFAULT_MAX_UNITS),
  historyBytes: z.number().step(1).min(1024).default(DEFAULT_HISTORY_BYTES),
  searchBytes: z.number().step(1).min(1024).default(DEFAULT_SEARCH_BYTES),
  searchResults: z.number().step(1).min(1).default(DEFAULT_SEARCH_RESULTS),
})

const JSON_OUTPUT = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

const GUIDANCE = [
  'Use context_inspect to see the exact durable conversation context used by the next request; Chat history may include shadowed messages that are absent here.',
  'For range compaction, call context_prepare first. It records and returns a reviewable summary without changing context. Inspect or edit that summary, then call context_commit only when it preserves the needed facts.',
  'Compaction and rewrite never delete the append-only log or roll back files, processes, network effects, approvals, goals, or other external state.',
  'Use history_read or history_search with a checkpoint_id to recover exact shadowed originals. Returned tool results become ordinary new context, so recall only what the task needs.',
].join('\n')

/** Register Context inspection, preparation, commit, and recall tools. */
export function apply(ctx: Context, config: Config = {}): void {
  const maxUnits = config.maxUnits ?? DEFAULT_MAX_UNITS
  const historyBytes = config.historyBytes ?? DEFAULT_HISTORY_BYTES
  const searchBytes = config.searchBytes ?? DEFAULT_SEARCH_BYTES
  const searchResults = config.searchResults ?? DEFAULT_SEARCH_RESULTS
  ctx.systemPrompt.section({
    name: 'tool:session-context',
    order: ctx.systemPrompt.getSectionOrder('TOOL_SESSION_CONTEXT'),
    text: GUIDANCE,
  })

  ctx.tools.register(defineTool({
    name: 'context_inspect',
    description: 'Inspect the exact current model-visible context as balanced units, token prices, generations, checkpoints, and pending reviewed preparations.',
    parameters: {
      before_index: { type: 'integer', description: 'Exclusive unit index for an earlier page. Omit to read the current tail.' },
      limit: { type: 'integer', description: `Maximum units to return, capped at ${maxUnits}.` },
    },
    output: JSON_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec): Promise<JsonValue> {
      const agent = requireAgent(exec.agent)
      const limit = Math.min(args.limit ?? maxUnits, maxUnits)
      if (args.before_index !== undefined && (!Number.isSafeInteger(args.before_index) || args.before_index < 0)) {
        throw new Error('before_index must be a non-negative safe integer')
      }
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('limit must be a positive safe integer')
      const snapshot = await ctx.sessionContext.inspect(agent, {
        ...args.before_index === undefined ? {} : { beforeIndex: args.before_index },
        maxUnits: limit,
      }, exec.signal)
      return asJson({
        sessionId: snapshot.sessionId,
        generation: snapshot.replaceGeneration,
        generationSeq: snapshot.generationSeq,
        totalTokens: snapshot.totalTokens,
        surfaceTokens: snapshot.surfaceTokens,
        totalUnits: snapshot.unitCount,
        unitOffset: snapshot.unitOffset,
        hasEarlierUnits: snapshot.hasEarlierUnits,
        units: snapshot.units,
        preparations: snapshot.preparations,
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Inspect current context' }),
  }))

  ctx.tools.register(defineTool({
    name: 'context_read',
    description: 'Read the complete current content of one unit_id returned by context_inspect.',
    parameters: {
      unit_id: { type: 'string', required: true, description: 'Opaque current Context unit id.' },
    },
    output: JSON_OUTPUT,
    isConcurrencySafe: () => true,
    execute: (args, exec): Promise<JsonValue> => Promise.resolve(asJson(ctx.sessionContext.readUnit(
      requireAgent(exec.agent),
      ContextUnitId(args.unit_id),
      exec.signal,
    ))),
    presentCall: () => ({ card: 'generic', title: 'Read context unit' }),
  }))

  ctx.tools.register(defineTool({
    name: 'context_prepare',
    description: 'Generate and durably record a reviewable summary for a contiguous balanced unit range without changing current context.',
    parameters: {
      start_unit_id: { type: 'string', required: true, description: 'First unit id from context_inspect.' },
      end_unit_id: { type: 'string', required: true, description: 'Last unit id from context_inspect.' },
      preservation_brief: { type: 'string', description: 'Exact facts, literals, or artifacts the summary must preserve.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec): Promise<JsonValue> {
      return asJson(await ctx.sessionContext.prepare(requireAgent(exec.agent), {
        startUnitId: ContextUnitId(args.start_unit_id),
        endUnitId: ContextUnitId(args.end_unit_id),
        ...args.preservation_brief === undefined ? {} : { preservationBrief: args.preservation_brief },
      }, exec.signal))
    },
    presentCall: () => ({ card: 'generic', title: 'Prepare context compaction' }),
  }))

  ctx.tools.register(defineTool({
    name: 'context_edit_preparation',
    description: 'Replace the review summary of one ready preparation. This still does not change current context.',
    parameters: {
      preparation_id: { type: 'string', required: true, description: 'Opaque preparation id from context_prepare or context_inspect.' },
      summary: { type: 'string', required: true, description: 'Complete replacement checkpoint Markdown.' },
    },
    output: JSON_OUTPUT,
    execute: async (args, exec): Promise<JsonValue> => asJson(await ctx.sessionContext.editPreparation(
      requireAgent(exec.agent),
      { preparationId: CompactionPreparationId(args.preparation_id), text: args.summary, source: 'model' },
      exec.signal,
    )),
    presentCall: () => ({ card: 'generic', title: 'Edit prepared context summary' }),
  }))

  ctx.tools.register(defineTool({
    name: 'context_commit',
    description: 'Commit one reviewed preparation inside the current turn. This replaces its exact range in future model context; originals remain recallable in the append-only log.',
    parameters: {
      preparation_id: { type: 'string', required: true, description: 'Ready preparation id.' },
    },
    output: JSON_OUTPUT,
    execute: async (args, exec): Promise<JsonValue> => asJson(await ctx.sessionContext.commitPreparationInTurn(
      requireAgent(exec.agent),
      { preparationId: CompactionPreparationId(args.preparation_id) },
      exec.signal,
    )),
    presentCall: () => ({ card: 'generic', title: 'Commit context compaction' }),
  }))

  ctx.tools.register(defineTool({
    name: 'context_discard_preparation',
    description: 'Discard one ready or failed preparation without changing current context.',
    parameters: {
      preparation_id: { type: 'string', required: true, description: 'Preparation id to discard.' },
    },
    output: JSON_OUTPUT,
    execute: async (args, exec): Promise<JsonValue> => asJson(await ctx.sessionContext.discardPreparation(
      requireAgent(exec.agent),
      { preparationId: CompactionPreparationId(args.preparation_id) },
      exec.signal,
    )),
    presentCall: () => ({ card: 'generic', title: 'Discard context preparation' }),
  }))

  ctx.tools.register(defineTool({
    name: 'history_read',
    description: 'Read a bounded page of exact originals shadowed by one checkpoint, optionally expanding nested checkpoints recursively.',
    parameters: {
      checkpoint_id: { type: 'string', required: true, description: 'Checkpoint id from context_inspect.' },
      cursor: { type: 'string', description: 'Opaque nextCursor from the previous history_read page.' },
      recursive: { type: 'boolean', description: 'Expand nested checkpoints. Defaults to true.' },
    },
    output: JSON_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec): Promise<JsonValue> => asJson(await ctx.sessionContext.historyRead(
      requireAgent(exec.agent),
      {
        checkpointId: CompactionId(args.checkpoint_id),
        recursive: args.recursive ?? true,
        maxBytes: historyBytes,
        ...args.cursor === undefined ? {} : { cursor: ContextHistoryCursor(args.cursor) },
      },
      exec.signal,
    )),
    presentCall: () => ({ card: 'generic', title: 'Read checkpoint originals' }),
  }))

  ctx.tools.register(defineTool({
    name: 'history_search',
    description: 'Search exact originals reachable from one checkpoint with a bounded literal query.',
    parameters: {
      checkpoint_id: { type: 'string', required: true, description: 'Checkpoint id from context_inspect.' },
      query: { type: 'string', required: true, description: 'Literal text to find.' },
      cursor: { type: 'string', description: 'Opaque nextCursor from the previous search page.' },
      case_sensitive: { type: 'boolean', description: 'Use exact case. Defaults to false.' },
      recursive: { type: 'boolean', description: 'Search nested checkpoints. Defaults to true.' },
    },
    output: JSON_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec): Promise<JsonValue> => asJson(await ctx.sessionContext.historySearch(
      requireAgent(exec.agent),
      {
        checkpointId: CompactionId(args.checkpoint_id),
        query: args.query,
        recursive: args.recursive ?? true,
        caseSensitive: args.case_sensitive ?? false,
        maxResults: searchResults,
        maxScanBytes: searchBytes,
        ...args.cursor === undefined ? {} : { cursor: ContextHistoryCursor(args.cursor) },
      },
      exec.signal,
    )),
    presentCall: () => ({ card: 'generic', title: 'Search checkpoint originals' }),
  }))
}

function requireAgent(agent: Agent | undefined): Agent {
  if (agent === undefined) throw new Error('Session Context tools require an Agent-backed session')
  return agent
}

function asJson(value: unknown): JsonValue {
  return value as JsonValue
}
