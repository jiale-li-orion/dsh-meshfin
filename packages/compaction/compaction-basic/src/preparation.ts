/**
 * Model-capacity planning and position-local preparation over one stable
 * current-surface range.
 *
 * @module @deepseek-ai/dsh-compaction-basic/preparation
 */

import { createHash } from 'node:crypto'
import {
  compactionPreparationDigest,
  toolPairingCutBalances,
} from '@deepseek-ai/dsh-compaction'
import type {
  CompactionPreparation,
  CompactionPreparationAttempt,
  CompactionPreparationCall,
  CompactionPreparationChunk,
  CompactionPreparationPlan,
  CompactionPreparationProgress,
  CompactionPreparationRequest,
  CompactionPreparationStage,
} from '@deepseek-ai/dsh-compaction'
import { deriveEventMessage, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { rangeSummarizationMessage } from './summarizer.ts'
import type { RangeSummarizationInput, SummarizationInput, SummaryResult } from './summarizer.ts'

/** Token meter, resolved model capacity, output policy, concurrency, and provider hook. */
interface PreparationDependencies {
  readonly meter: TokenMeter
  readonly target: {
    readonly provider: string
    readonly model: string
    readonly contextWindow: number
    readonly maxOutputTokens?: number
  }
  readonly outputRatio: number
  readonly minOutputTokens: number
  readonly maxOutputTokens: number
  readonly concurrency: number
  summarize(
    input: SummarizationInput,
    maxTokens: number,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<SummaryResult>
}

/** One tool-pairing-balanced selected unit and its rendered document. */
interface CanonicalUnit {
  readonly startSeq: SessionSeq
  readonly endSeq: SessionSeq
  readonly tokens: number
  readonly document: string
}

/** One planned provider input with its durable descriptor. */
interface DocumentChunk {
  readonly descriptor: CompactionPreparationChunk
  readonly document: string
  readonly sourceChunkIndexes: readonly number[]
}

/** One partial summary awaiting reduction. */
interface ReductionValue {
  readonly summary: ContentBlock[]
  readonly chunkIndexes: number[]
}

/** One rendered reducer source group. */
interface ReductionDocument {
  readonly body: string
  readonly source: readonly number[]
}

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Produce a reviewable summary without mutating the Session surface.
 * @param dependencies - meter, resolved model capacity, output policy, concurrency, and provider hook.
 * @param request - durable selected-span facts recorded by the caller.
 * @param agent - Agent whose scoped summarizer runs the calls.
 * @param signal - cancellation forwarded to every call.
 * @param onProgress - durable recorder for the plan, attempts, and completed calls.
 * @returns deterministic chunks, call facts, and one final summary.
 */
export async function prepareSurfaceRegion(
  dependencies: PreparationDependencies,
  request: CompactionPreparationRequest,
  agent: Agent,
  signal: AbortSignal,
  onProgress: (progress: CompactionPreparationProgress) => Promise<void>,
): Promise<CompactionPreparation> {
  signal.throwIfAborted()
  const units = captureUnits(dependencies, request, agent)
  const directDocument = units.map(unit => unit.document).join('\n\n')
  const desiredOutputTokens = Math.min(
    dependencies.maxOutputTokens,
    Math.max(
      dependencies.minOutputTokens,
      Math.ceil(request.shadowedTokenCount * dependencies.outputRatio),
    ),
  )
  const modelOutputCap = dependencies.target.maxOutputTokens === undefined
    ? desiredOutputTokens
    : Math.min(desiredOutputTokens, dependencies.target.maxOutputTokens)
  const directInputTokens = estimateRangeInput(dependencies.meter, {
    kind: 'range',
    stage: 'direct',
    document: directDocument,
    ...request.preservationBrief === undefined ? {} : { preservationBrief: request.preservationBrief },
  })
  const directInputBudget = dependencies.target.contextWindow - modelOutputCap
  const emit = serialProgress(onProgress)
  if (directInputTokens <= directInputBudget) {
    const chunk = documentChunk(
      0,
      'direct',
      request.start,
      request.end,
      1,
      1,
      directInputTokens,
      directDocument,
      [0],
    )
    const plan = preparationPlan(
      dependencies,
      'direct',
      desiredOutputTokens,
      modelOutputCap,
      directInputTokens,
    )
    await emit({ kind: 'planned', plan, chunks: [chunk.descriptor] })
    const call = await executeChunk(
      dependencies,
      chunk,
      modelOutputCap,
      request.preservationBrief,
      agent,
      signal,
      emit,
    )
    return preparationResult(request, [chunk.descriptor], [call], call.summary)
  }

  // One map/reduce output occupies at most one quarter of the context. The
  // remaining three quarters can contain two maximum-size partial summaries,
  // their framing, and the next output, so every successful round can reduce.
  const outputTokenCap = Math.min(modelOutputCap, Math.floor(dependencies.target.contextWindow / 4))
  if (outputTokenCap < 1) {
    throw new Error(
      `range compaction model ${dependencies.target.provider}/${dependencies.target.model} `
      + `context window ${dependencies.target.contextWindow} cannot admit a summarization output`,
    )
  }
  const inputTokenBudget = dependencies.target.contextWindow - outputTokenCap
  const mapChunks = chunkUnits(
    dependencies.meter,
    units,
    inputTokenBudget,
    request.preservationBrief,
  )
  const plan = preparationPlan(
    dependencies,
    'map-reduce',
    desiredOutputTokens,
    outputTokenCap,
    directInputTokens,
  )
  await emit({
    kind: 'planned',
    plan,
    chunks: mapChunks.map(chunk => structuredClone(chunk.descriptor)),
  })

  const calls: CompactionPreparationCall[] = []
  const mapCalls = await mapConcurrent(mapChunks, dependencies.concurrency, async (chunk) => {
    const call = await executeChunk(
      dependencies,
      chunk,
      outputTokenCap,
      request.preservationBrief,
      agent,
      signal,
      emit,
    )
    calls.push(call)
    return call
  })
  let values: ReductionValue[] = mapCalls.map(call => ({
    summary: call.summary,
    chunkIndexes: [...call.chunkIndexes],
  }))
  const allChunks = [...mapChunks.map(chunk => chunk.descriptor)]
  let reductionRound = 0
  while (values.length > 1) {
    signal.throwIfAborted()
    reductionRound += 1
    if (reductionRound > 32) throw new Error('range compaction exceeded the reduction-round limit')
    const reductionChunks = reduceChunks(
      dependencies.meter,
      values,
      inputTokenBudget,
      request,
      allChunks.length,
    )
    if (reductionChunks.length >= values.length) {
      throw new Error(
        `range compaction cannot reduce ${values.length} partial summaries within the `
        + `${inputTokenBudget}-token model input budget`,
      )
    }
    allChunks.push(...reductionChunks.map(chunk => chunk.descriptor))
    const reducedCalls = await mapConcurrent(reductionChunks, dependencies.concurrency, async (chunk) => {
      const call = await executeChunk(
        dependencies,
        chunk,
        outputTokenCap,
        request.preservationBrief,
        agent,
        signal,
        emit,
      )
      calls.push(call)
      return call
    })
    values = reducedCalls.map(call => ({
      summary: call.summary,
      chunkIndexes: [...call.chunkIndexes],
    }))
  }
  const final = values[0]
  if (final === undefined) throw new Error('range compaction produced no summary calls')
  return preparationResult(
    request,
    allChunks,
    calls.sort((left, right) => left.index - right.index),
    final.summary,
  )
}

/** Build the immutable provider-capacity plan exposed to durable review. */
function preparationPlan(
  dependencies: PreparationDependencies,
  strategy: CompactionPreparationPlan['strategy'],
  desiredOutputTokens: number,
  outputTokenCap: number,
  directInputTokens: number,
): CompactionPreparationPlan {
  return {
    strategy,
    provider: dependencies.target.provider,
    model: dependencies.target.model,
    contextWindow: dependencies.target.contextWindow,
    ...dependencies.target.maxOutputTokens === undefined
      ? {}
      : { modelMaxOutputTokens: dependencies.target.maxOutputTokens },
    desiredOutputTokens,
    outputTokenCap,
    directInputTokens,
    inputTokenBudget: dependencies.target.contextWindow - outputTokenCap,
  }
}

/** Run one planned call after its exact envelope is durably recorded. */
async function executeChunk(
  dependencies: PreparationDependencies,
  chunk: DocumentChunk,
  maxTokens: number,
  preservationBrief: string | undefined,
  agent: Agent,
  signal: AbortSignal,
  emit: (progress: CompactionPreparationProgress) => Promise<void>,
): Promise<CompactionPreparationCall> {
  signal.throwIfAborted()
  const attempt: CompactionPreparationAttempt = {
    index: chunk.descriptor.index,
    stage: chunk.descriptor.stage,
    chunkIndexes: [...chunk.sourceChunkIndexes],
    inputTokens: chunk.descriptor.estimatedTokens,
    provider: dependencies.target.provider,
    model: dependencies.target.model,
    maxTokens,
  }
  await emit({ kind: 'attempt', attempt })
  const result = await dependencies.summarize({
    kind: 'range',
    stage: chunk.descriptor.stage,
    document: chunk.document,
    ...preservationBrief === undefined ? {} : { preservationBrief },
  }, maxTokens, agent, signal)
  if (result.provider !== attempt.provider || result.model !== attempt.model) {
    throw new Error(
      `range compaction planned ${attempt.provider}/${attempt.model}, but the summarizer reported `
      + `${result.provider}/${result.model}`,
    )
  }
  const call = callFrom(result, attempt)
  await emit({ kind: 'call', call })
  return call
}

/** Serialize durable progress writes while provider calls remain concurrent. */
function serialProgress(
  onProgress: (progress: CompactionPreparationProgress) => Promise<void>,
): (progress: CompactionPreparationProgress) => Promise<void> {
  let tail = Promise.resolve()
  return (progress) => {
    const next = tail.then(() => onProgress(progress))
    tail = next
    return next
  }
}

/** Capture, validate, balance, price, and render the selected stable surface. */
function captureUnits(
  dependencies: PreparationDependencies,
  request: CompactionPreparationRequest,
  agent: Agent,
): CanonicalUnit[] {
  const session = agent.session
  const nodes = session.surface.nodes
  const startIndex = nodes.indexOf(request.start)
  const endIndex = nodes.indexOf(request.end)
  if (startIndex < 0 || endIndex < startIndex) throw new Error('range preparation target is not current')
  const selected = nodes.slice(startIndex, endIndex + 1)
  if (compactionPreparationDigest(selected) !== request.shadowedDigest
    || selected.length !== request.shadowedSeqs.length
    || selected.some((seq, index) => seq !== request.shadowedSeqs[index])) {
    throw new Error('range preparation membership changed before summarization')
  }
  if (selected.length === 0) throw new Error('range preparation target is empty')
  const balances = toolPairingCutBalances(session)
  if (balances.length !== nodes.length + 1) {
    throw new Error('range preparation tool balance does not match the captured surface')
  }
  if (balances[startIndex] !== true) {
    throw new Error('range preparation start is not tool-pairing balanced')
  }
  if (balances[endIndex + 1] !== true) {
    throw new Error('range preparation end is not tool-pairing balanced')
  }
  const priced = dependencies.meter.measure(session).nodes.slice(startIndex, endIndex + 1)
  if (priced.length !== selected.length || priced.some((node, index) => node.seq !== selected[index])) {
    throw new Error('range preparation pricing does not match selected membership')
  }
  const pricedTotal = priced.reduce((sum, node) => sum + node.tokens, 0)
  if (pricedTotal !== request.shadowedTokenCount) {
    throw new Error('range preparation token price changed before summarization')
  }

  const units: CanonicalUnit[] = []
  let unitStart = 0
  for (let index = 0; index < selected.length; index += 1) {
    const seq = selected[index]
    if (seq === undefined) throw new Error('range preparation selected membership has a hole')
    if (balances[startIndex + index + 1] !== true && index + 1 < selected.length) continue
    const unitSeqs = selected.slice(unitStart, index + 1)
    const events = unitSeqs.map((unitSeq) => {
      // Selected seqs are current surface seqs, so each is a valid log index.
      // Existing Session history read; migration deferred.
      // oxlint-disable-next-line typescript/no-deprecated
      const event = session.eventAt(unitSeq)
      if (event === undefined) throw new Error(`range preparation surface seq ${unitSeq} is missing`)
      return event
    })
    const unitStartSeq = unitSeqs[0]
    const unitEndSeq = unitSeqs.at(-1)
    if (unitStartSeq === undefined || unitEndSeq === undefined) {
      throw new Error('range preparation constructed an empty balanced unit')
    }
    units.push({
      startSeq: unitStartSeq,
      endSeq: unitEndSeq,
      tokens: priced.slice(unitStart, index + 1).reduce((sum, node) => sum + node.tokens, 0),
      document: renderUnit(unitSeqs, events),
    })
    unitStart = index + 1
  }
  return units
}

/** Group balanced units under the resolved model input budget. */
function chunkUnits(
  meter: TokenMeter,
  units: readonly CanonicalUnit[],
  inputTokenBudget: number,
  preservationBrief?: string,
): DocumentChunk[] {
  assertRangeInputCanFit(meter, inputTokenBudget, 'map', preservationBrief)
  const chunks: DocumentChunk[] = []
  let pending: CanonicalUnit[] = []
  let pendingTokens = 0
  const flush = (): void => {
    if (pending.length === 0) return
    appendMapGroup(meter, chunks, pending, inputTokenBudget, preservationBrief)
    pending = []
    pendingTokens = 0
  }
  for (const unit of units) {
    if (pending.length > 0 && pendingTokens + unit.tokens > inputTokenBudget) flush()
    pending.push(unit)
    pendingTokens += unit.tokens
  }
  flush()
  if (chunks.length === 0) throw new Error('range compaction produced no map chunks')
  return chunks
}

/** Split an oversized group only at balanced unit boundaries. */
function appendMapGroup(
  meter: TokenMeter,
  chunks: DocumentChunk[],
  units: readonly CanonicalUnit[],
  inputTokenBudget: number,
  preservationBrief?: string,
): void {
  const first = units[0]
  const last = units.at(-1)
  if (first === undefined || last === undefined) throw new Error('range preparation lost a map chunk boundary')
  const document = units.map(unit => unit.document).join('\n\n')
  const inputTokens = estimateDocumentInput(meter, 'map', document, preservationBrief)
  if (inputTokens <= inputTokenBudget) {
    const index = chunks.length
    chunks.push(documentChunk(
      index,
      'map',
      first.startSeq,
      last.endSeq,
      1,
      1,
      inputTokens,
      document,
      [index],
    ))
    return
  }
  if (units.length > 1) {
    const middle = Math.ceil(units.length / 2)
    appendMapGroup(meter, chunks, units.slice(0, middle), inputTokenBudget, preservationBrief)
    appendMapGroup(meter, chunks, units.slice(middle), inputTokenBudget, preservationBrief)
    return
  }
  const documents = splitDocumentToFit(meter, document, inputTokenBudget, 'map', preservationBrief)
  for (const [part, value] of documents.entries()) {
    const index = chunks.length
    chunks.push(documentChunk(
      index,
      'map',
      first.startSeq,
      last.endSeq,
      part + 1,
      documents.length,
      estimateDocumentInput(meter, 'map', value, preservationBrief),
      value,
      [index],
    ))
  }
}

/** Build reducer documents under the same resolved model input budget. */
function reduceChunks(
  meter: TokenMeter,
  values: readonly ReductionValue[],
  inputTokenBudget: number,
  request: CompactionPreparationRequest,
  firstIndex: number,
): DocumentChunk[] {
  assertRangeInputCanFit(meter, inputTokenBudget, 'reduce', request.preservationBrief)
  const documents: ReductionDocument[] = values.map((value, index) => ({
    body: `<partial-summary index="${index}" source-chunks="${value.chunkIndexes.join(',')}">\n${summaryText(value.summary)}\n</partial-summary>`,
    source: value.chunkIndexes,
  }))
  const chunks: DocumentChunk[] = []
  let pending: ReductionDocument[] = []
  let pendingCharacters = 0
  const flush = (): void => {
    if (pending.length === 0) return
    appendReductionGroup(
      meter,
      chunks,
      pending,
      inputTokenBudget,
      request,
      firstIndex,
    )
    pending = []
    pendingCharacters = 0
  }
  for (const document of documents) {
    if (pending.length > 0 && pendingCharacters + document.body.length > inputTokenBudget * 4) flush()
    pending.push(document)
    pendingCharacters += document.body.length
  }
  flush()
  return chunks
}

/** Split reducer groups until each exact request fits the model. */
function appendReductionGroup(
  meter: TokenMeter,
  chunks: DocumentChunk[],
  documents: readonly ReductionDocument[],
  inputTokenBudget: number,
  request: CompactionPreparationRequest,
  firstIndex: number,
): void {
  const source = [...new Set(documents.flatMap(item => item.source))].sort((left, right) => left - right)
  const document = `${documents.map(item => item.body).join('\n\n')}\n<source-chunks>${source.join(',')}</source-chunks>`
  const inputTokens = estimateDocumentInput(meter, 'reduce', document, request.preservationBrief)
  if (inputTokens <= inputTokenBudget) {
    chunks.push(documentChunk(
      firstIndex + chunks.length,
      'reduce',
      request.start,
      request.end,
      1,
      1,
      inputTokens,
      document,
      source,
    ))
    return
  }
  if (documents.length <= 1) {
    throw new Error(
      `range compaction partial summary requires ${inputTokens} estimated input tokens, `
      + `exceeding the model budget ${inputTokenBudget}`,
    )
  }
  const middle = Math.ceil(documents.length / 2)
  appendReductionGroup(meter, chunks, documents.slice(0, middle), inputTokenBudget, request, firstIndex)
  appendReductionGroup(meter, chunks, documents.slice(middle), inputTokenBudget, request, firstIndex)
}

/** Split one canonical unit document at grapheme boundaries until every request fits. */
function splitDocumentToFit(
  meter: TokenMeter,
  document: string,
  inputTokenBudget: number,
  stage: Extract<CompactionPreparationStage, 'map' | 'reduce'>,
  preservationBrief?: string,
): string[] {
  const inputTokens = estimateDocumentInput(meter, stage, document, preservationBrief)
  if (inputTokens <= inputTokenBudget) return [document]
  const maximumChars = Math.max(1, Math.floor(document.length * inputTokenBudget / inputTokens))
  const parts = splitByGraphemeChars(document, maximumChars)
  if (parts.length <= 1) {
    throw new Error(
      `range compaction canonical unit requires ${inputTokens} estimated input tokens, `
      + `exceeding the model budget ${inputTokenBudget}`,
    )
  }
  return parts.flatMap(part => splitDocumentToFit(meter, part, inputTokenBudget, stage, preservationBrief))
}

/** Reject a context window that cannot fit the fixed range instruction itself. */
function assertRangeInputCanFit(
  meter: TokenMeter,
  inputTokenBudget: number,
  stage: Extract<CompactionPreparationStage, 'map' | 'reduce'>,
  preservationBrief?: string,
): void {
  const minimum = estimateDocumentInput(meter, stage, '', preservationBrief)
  if (minimum > inputTokenBudget) {
    throw new Error(
      `range compaction ${stage} instruction requires ${minimum} estimated input tokens, `
      + `exceeding the model budget ${inputTokenBudget}`,
    )
  }
}

/** Price the exact position-local request under the singleton token-meter heuristic. */
function estimateRangeInput(meter: TokenMeter, input: RangeSummarizationInput): number {
  return meter.estimateMessage(rangeSummarizationMessage(input))
}

/** Price a range document without needing the surrounding preparation dependencies. */
function estimateDocumentInput(
  meter: TokenMeter,
  stage: CompactionPreparationStage,
  document: string,
  preservationBrief?: string,
): number {
  return estimateRangeInput(meter, {
    kind: 'range',
    stage,
    document,
    ...preservationBrief === undefined ? {} : { preservationBrief },
  })
}

/** Canonical text representation of one tool-balanced current-surface unit. */
function renderUnit(seqs: readonly SessionSeq[], events: readonly SessionEvent[]): string {
  const messages = events.map(event => deriveEventMessage(event)).filter((message): message is Message => message !== null)
  return [
    `<context-unit start-seq="${seqs[0]}" end-seq="${seqs.at(-1)}">`,
    ...messages.map(renderMessage),
    '</context-unit>',
  ].join('\n')
}

/** Render one message and every content block without dropping literal values. */
function renderMessage(message: Message): string {
  // A tool result is its own message role, so its call correlation and outcome
  // belong on the element that carries them.
  const attributes = message.role === 'tool'
    ? ` role="tool" call-id=${JSON.stringify(message.toolCallId)} error="${message.isError === true}"`
    : ` role="${message.role}"`
  return [
    `<message${attributes}>`,
    ...message.content.map(renderBlock),
    '</message>',
  ].join('\n')
}

/** Render one content block so a literal value survives the flattening. */
function renderBlock(block: ContentBlock): string {
  switch (block.type) {
    case 'text': return `<text>\n${block.text}\n</text>`
    case 'reasoning': return `<reasoning>\n${block.text}\n</reasoning>`
    case 'image': return `<image>${JSON.stringify(block.attachment)}</image>`
    case 'file': return `<file>${JSON.stringify(block.attachment)}</file>`
    case 'tool-call': return `<tool-call name=${JSON.stringify(block.name)} id=${JSON.stringify(block.id)}>\n${block.arguments}\n</tool-call>`
    case 'tool-addition': return `<tool-addition name=${JSON.stringify(block.toolName)} />`
    case 'tool-removal': return `<tool-removal name=${JSON.stringify(block.toolName)} />`
    /* v8 ignore next -- merge-extensible block map: an unknown tag renders as its type so a plugin block is not silently dropped. */
    default: return `<${(block as ContentBlock | { readonly type: string }).type} />`
  }
}

/** Extract text-only summary output into one reducer document. */
function summaryText(summary: readonly ContentBlock[]): string {
  return summary.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

/** Build one immutable chunk descriptor and retain its document privately. */
function documentChunk(
  index: number,
  stage: CompactionPreparationStage,
  startSeq: SessionSeq,
  endSeq: SessionSeq,
  part: number,
  parts: number,
  estimatedTokens: number,
  document: string,
  sourceChunkIndexes: readonly number[],
): DocumentChunk {
  return {
    descriptor: {
      index,
      stage,
      startSeq,
      endSeq,
      part,
      parts,
      estimatedTokens,
      inputDigest: createHash('sha256').update(document).digest('base64url'),
    },
    document,
    sourceChunkIndexes: [...sourceChunkIndexes],
  }
}

/** Convert one provider result into the durable call vocabulary. */
function callFrom(
  result: SummaryResult,
  attempt: CompactionPreparationAttempt,
): CompactionPreparationCall {
  const provenance = result.llmStreamCall === true
    ? { rawOutput: structuredClone(result.rawOutput), llmStreamCall: true as const }
    : result.rawOutput === undefined ? {} : { rawOutput: structuredClone(result.rawOutput) }
  return {
    index: attempt.index,
    stage: attempt.stage,
    chunkIndexes: [...attempt.chunkIndexes],
    summary: structuredClone(result.summary),
    provider: result.provider,
    model: result.model,
    ...result.maxTokens === undefined ? {} : { maxTokens: result.maxTokens },
    ...result.usage === undefined ? {} : { usage: structuredClone(result.usage) },
    ...provenance,
  }
}

/** Build one detached preparation result. */
function preparationResult(
  request: CompactionPreparationRequest,
  chunks: readonly CompactionPreparationChunk[],
  calls: readonly CompactionPreparationCall[],
  summary: readonly ContentBlock[],
): CompactionPreparation {
  return {
    request: structuredClone(request),
    chunks: chunks.map(chunk => structuredClone(chunk)),
    calls: calls.map(call => structuredClone(call)),
    summary: summary.map(block => structuredClone(block)),
  }
}

/** Ordered result map with a fixed number of concurrently active workers. */
async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  const entries = values.entries()
  const failures: unknown[] = []
  const run = async (): Promise<void> => {
    while (failures.length === 0) {
      const next = entries.next()
      if (next.done) return
      const [index, value] = next.value
      try {
        results[index] = await worker(value, index)
      } catch (error: unknown) {
        failures.push(error)
        return
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run))
  if (failures.length > 0) throw failures[0]
  return results
}

/** Split one document by UTF-16 size without cutting a user-perceived character. */
function splitByGraphemeChars(value: string, maximumChars: number): string[] {
  const parts: string[] = []
  let start = 0
  let characters = 0
  for (const segment of GRAPHEME_SEGMENTER.segment(value)) {
    if (characters > 0 && characters + segment.segment.length > maximumChars) {
      parts.push(value.slice(start, segment.index))
      start = segment.index
      characters = 0
    }
    characters += segment.segment.length
  }
  if (start < value.length) parts.push(value.slice(start))
  return parts
}
