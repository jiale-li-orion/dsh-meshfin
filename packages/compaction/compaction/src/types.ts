/**
 * Compaction vocabulary: the result type and the `compaction/*` session events.
 * Those declaration-merged events record the lock and summary inputs without entering the surface, so they are not
 * surface events; a separate replacement `user/message` carries the summary.
 * Backend packages own configuration and retention policy; see the
 * [compaction reference](../README.md#understand-the-implementation).
 * @module @deepseek-ai/dsh-compaction/types
 */

import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { CompactionId, CompactionPreparationId } from './brand.ts'

export type { CompactionId, CompactionPreparationId }

/** Stable selected-span facts recorded before range summarization starts. */
export interface CompactionPreparationRequest {
  /** Review identity correlating the request, its calls, and the later bracket. */
  preparationId: CompactionPreparationId
  /** Inclusive first surface-node seq of the selected span. */
  start: SessionSeq
  /** Inclusive last surface-node seq of the selected span. */
  end: SessionSeq
  /** The selected surface seqs, in surface order. */
  shadowedSeqs: SessionSeq[]
  /** Digest of {@link CompactionPreparationRequest.shadowedSeqs}, rechecked before commit. */
  shadowedDigest: string
  /** Route-priced total of the selected span at request time. */
  shadowedTokenCount: number
  /** Number of tool-pairing-balanced units the selected span decomposes into. */
  unitCount: number
  /** Caller-supplied facts the summary must preserve. */
  preservationBrief?: string
}

/** Summarizer stage for one reviewed range preparation request. */
export type CompactionPreparationStage = 'direct' | 'map' | 'reduce'

/** Capacity-derived plan recorded before a range preparation makes provider calls. */
export interface CompactionPreparationPlan {
  /** One complete call, or bounded map chunks followed by reduce rounds. */
  strategy: 'direct' | 'map-reduce'
  /** The provider route the calls will use. */
  provider: string
  /** The model the calls will use. */
  model: string
  /** Combined input-and-output capacity resolved for that route. */
  contextWindow: number
  /** The route's declared per-request output cap, when the adapter declares one. */
  modelMaxOutputTokens?: number
  /** Output target derived from the selected span before model and context caps. */
  desiredOutputTokens: number
  /** The output cap every recorded call of this plan actually sends. */
  outputTokenCap: number
  /** Priced input of the one-call strategy, whether or not that strategy was chosen. */
  directInputTokens: number
  /** Input budget each map or reduce request must fit. */
  inputTokenBudget: number
}

/** One deterministic direct, map, or reducer input in a range preparation. */
export interface CompactionPreparationChunk {
  /** Position of this chunk among every chunk of the preparation. */
  index: number
  /** The summarizer stage this chunk feeds. */
  stage: CompactionPreparationStage
  /** First selected surface seq this chunk covers. */
  startSeq: SessionSeq
  /** Last selected surface seq this chunk covers. */
  endSeq: SessionSeq
  /** One-based part number when a single unit was split across chunks. */
  part: number
  /** Total parts that unit was split into. */
  parts: number
  /** Priced input of this exact chunk document. */
  estimatedTokens: number
  /** Digest of the exact chunk document, so a reviewer can detect a changed plan. */
  inputDigest: string
}

/** One provider call recorded before its stream starts. */
export interface CompactionPreparationAttempt {
  /** Position of this call among every call of the preparation. */
  index: number
  /** The summarizer stage this call performs. */
  stage: CompactionPreparationStage
  /** Chunk indexes this call summarizes or reduces. */
  chunkIndexes: number[]
  /** Priced input of the recorded chunk. */
  inputTokens: number
  /** The provider route the call is about to use. */
  provider: string
  /** The model the call is about to use. */
  model: string
  /** The generation cap the call sends. */
  maxTokens: number
}

/** One completed summarizer call, recorded independently of its completion order. */
export type CompactionPreparationCall = {
  /** Position of this call among every call of the preparation. */
  index: number
  /** The summarizer stage this call performed. */
  stage: CompactionPreparationStage
  /** Chunk indexes this call summarized or reduced. */
  chunkIndexes: number[]
  /** Safe text-only summary blocks this call returned. */
  summary: ContentBlock[]
  /** The provider route that answered. */
  provider: string
  /** The model that answered. */
  model: string
  /** The generation cap the call sent. */
  maxTokens?: number
  /** Provider-reported usage for this call, when emitted. */
  usage?: TokenUsage
} & (
  | {
    /** Complete provider output before the backend's safe summary projection. */
    rawOutput: ContentBlock[]
    /** Identifies exactly one call through this context's `ctx.llm.stream()`. */
    llmStreamCall: true
  }
  | {
    /** Optional complete output from an unmarked template, remote, or other summarizer. */
    rawOutput?: ContentBlock[]
    /** An unmarked summary does not identify a call through this context's LLM seam. */
    llmStreamCall?: never
  }
)

/** Complete generated preparation ready for review or a revalidated commit. */
export interface CompactionPreparation {
  /** The durable request these chunks and calls were produced for. */
  request: CompactionPreparationRequest
  /** Every deterministic chunk of the plan. */
  chunks: CompactionPreparationChunk[]
  /** Every completed call, ordered by index. */
  calls: CompactionPreparationCall[]
  /** The generated final summary, before any review edit. */
  summary: ContentBlock[]
}

/** Durable progress emitted before and during range preparation calls. */
export type CompactionPreparationProgress =
  | {
    /** The selected capacity-derived strategy and its initial chunks. */
    kind: 'planned'
    plan: CompactionPreparationPlan
    chunks: CompactionPreparationChunk[]
  }
  | {
    /** One provider call's exact envelope, recorded before its stream starts. */
    kind: 'attempt'
    attempt: CompactionPreparationAttempt
  }
  | {
    /** One completed provider call. */
    kind: 'call'
    call: CompactionPreparationCall
  }

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Marks the start of a compaction — log-only, holds the lock until
     * `compaction/end`. A numbered owner is strictly enclosed by that open turn;
     * `null` identifies a standalone manual transaction between turns.
     */
    'compaction/start': {
      compactionId: CompactionId
      sourceCommandId?: CommandId
      /** Reviewed preparation whose summary this bracket commits, when it commits one. */
      preparationId?: CompactionPreparationId
      turn: number | null
    }
    /**
     * Completed summary, its inputs, and its model call facts — log-only, no surfaceOp.
     * The summary content is in `data.summary`; the actual surface replacement
     * is performed by the immediately following `user/message` event that
     * shadows the compacted range. That adjacency is contractual — the
     * shadowed pricing fields are the replacement's shadow price, so a
     * consumer may pair a replacement with the metering event directly
     * before it (`compaction/prune` documents the shared protocol).
     */
    'compaction/summary': {
      compactionId: CompactionId
      sourceCommandId?: CommandId
      /** Reviewed preparation this summary was produced or reviewed under. */
      preparationId?: CompactionPreparationId
      /** Whether the summary is generated output or a review edit of one. */
      summarySource?: 'generated' | 'human' | 'model'
      summary: ContentBlock[]
      shadowedRange: { start: SessionSeq; end: SessionSeq }
      shadowedSeqs: SessionSeq[]
      shadowedTokenCount: number
      /** The provider route that wrote the summary. */
      provider: string
      /**
       * The model that wrote the summary — the summarize call's envelope,
       * reported by the backend that made the call, logged so the one-shot
       * request is reconstructable from log + code and "which model wrote
       * this summary" has a durable answer (the reconstructability Agent Note).
       */
      model: string
      /** The generation cap the summarize call sent, when one applied. */
      maxTokens?: number
      /** Provider-reported token usage for the summarization request, when emitted. */
      usage?: TokenUsage
    } & (
      | {
        /** Complete provider output before the backend's safe summary projection. */
        rawOutput: ContentBlock[]
        /** Identifies exactly one call through this context's `ctx.llm.stream()`. */
        llmStreamCall: true
      }
      | {
        /** Optional complete output from an unmarked template, remote, or other summarizer. */
        rawOutput?: ContentBlock[]
        /** An unmarked summary does not identify a call through this context's LLM seam. */
        llmStreamCall?: never
      }
    )
    /**
     * Marks the end of a compaction — log-only, releases the lock. Its owner
     * matches `compaction/start`; `error` records an unsuccessful attempt.
     */
    'compaction/end': {
      compactionId: CompactionId
      sourceCommandId?: CommandId
      /** Reviewed preparation whose commit attempt this close belongs to. */
      preparationId?: CompactionPreparationId
      turn: number | null
      error?: string
    }
    /**
     * Shadow price of one model-free prune replacement — log-only, no
     * surfaceOp. The shared shadow-price protocol: a surface `replace` event
     * is priced by the metering event immediately before it (`compaction/summary`
     * for a summarizing compaction, this event for a prune), which states the
     * heuristic token price of the exact replaced range so a pure consumer
     * can subtract it without retaining per-node prices. The replacement MUST
     * be appended synchronously right after this event.
     */
    'compaction/prune': {
      /** The replaced range's first and last surface-node seqs (a surface-position span, like {@link CompactionResult.shadowedRange}). */
      shadowedRange: { start: SessionSeq; end: SessionSeq }
      /** The seqs of all shadowed surface nodes, in surface order. */
      shadowedSeqs: SessionSeq[]
      /** Heuristic price of the shadowed content under the token-meter's fixed estimator. */
      shadowedTokenCount: number
    }
    /** Durable range selection recorded before any preparation provider call. */
    'compaction/preparation/requested': CompactionPreparationRequest
    /** Capacity-derived strategy and initial deterministic chunks — log-only, written before the first call. */
    'compaction/preparation/planned': {
      preparationId: CompactionPreparationId
      plan: CompactionPreparationPlan
      chunks: CompactionPreparationChunk[]
    }
    /** One provider call's exact envelope, appended before its stream starts. */
    'compaction/preparation/attempted': {
      preparationId: CompactionPreparationId
      attempt: CompactionPreparationAttempt
    }
    /** One completed direct, map, or reduction call in a durable preparation. */
    'compaction/preparation/call': {
      preparationId: CompactionPreparationId
      call: CompactionPreparationCall
    }
    /** Generated summary and deterministic chunk plan ready for review. */
    'compaction/preparation/ready': {
      preparationId: CompactionPreparationId
      chunks: CompactionPreparationChunk[]
      summary: ContentBlock[]
    }
    /** Review-time summary replacement; the latest edit is the commit candidate. */
    'compaction/preparation/edited': {
      preparationId: CompactionPreparationId
      summary: ContentBlock[]
      source: 'human' | 'model'
    }
    /** Terminal preparation failure before any surface mutation. */
    'compaction/preparation/failed': {
      preparationId: CompactionPreparationId
      error: string
      /** Exact attempted-call count at the time of failure. */
      attemptedCalls?: number
    }
    /** Review discarded a ready or failed preparation without changing the surface. */
    'compaction/preparation/discarded': {
      preparationId: CompactionPreparationId
    }
  }
}

/** Result of a successful compaction operation. */
export interface CompactionResult {
  /** Stable identity shared by this compaction's complete durable lifecycle. */
  compactionId: CompactionId
  /** Human command that initiated this compaction, when it was manual. */
  sourceCommandId?: CommandId
  /** The seq of the appended `compaction/start` event. */
  startSeq: SessionSeq
  /** The seq of the appended `compaction/summary` event. */
  summarySeq: SessionSeq
  /** The seq of the appended `compaction/end` event. */
  endSeq: SessionSeq
  /** The summary content blocks produced by the backend. */
  summary: ContentBlock[]
  /**
   * The surface-boundary pair that was shadowed: the seqs of the first
   * (`start`) and last (`end`) surface nodes of the replaced range. A
   * surface-POSITION span, not a numeric seq interval — after a prior replace
   * lands a fresh high-seq summary node at an older range's position, `start`
   * can be GREATER than `end`. {@link CompactionResult.shadowedSeqs} is the
   * authoritative set of shadowed nodes, in surface order.
   */
  shadowedRange: { start: SessionSeq; end: SessionSeq }
  /** The seqs of all shadowed surface nodes, in surface order. */
  shadowedSeqs: SessionSeq[]
  /** Estimated token count of the shadowed content. */
  shadowedTokenCount: number
}
