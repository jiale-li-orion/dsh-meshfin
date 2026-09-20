/**
 * Event-sourced session service: append-only session log, in-memory store, and
 * the derived LLM message history. Persistence is a plugin concern (subscribe
 * to `session/event`, drain on `session/flush`).
 *
 * @module @deepseek-ai/dsh-session
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { isAbsolute } from 'node:path'
import { performance } from 'node:perf_hooks'
import { scheduler } from 'node:timers/promises'
import { deepFreeze } from '@deepseek-ai/dsh-llm'
import { scopeOf, scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Scoped } from '@deepseek-ai/dsh-scope'
import type { Message } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId } from './types.ts'
import type { TypertLookup } from '@deepseek-ai/dsh-typert-protocol'
import type { CreateSessionOptions, EpochHeader, PrepareSessionOptions, RequestContext, SessionEvent, SessionEventMap, SessionEventType, SessionHeader, SurfaceIntent, SurfaceEventType } from './types.ts'
import { snapshotJsonValue } from './json.ts'
import { deriveEventMessage, SurfaceManager } from './surface.ts'
import type { SessionSurface } from './surface.ts'
import { canonicalHeader } from './request-header.ts'
import { PackedSessionLog } from './packed-log.ts'
import {
  adoptStorageRecord,
  isChunkRow,
  storageRecordLength,
  storageRecordStart,
} from './chunk-rows.ts'
import type { StorageRecord } from './chunk-rows.ts'

export * from './types.ts'
export { SessionPreparation } from './preparation.ts'
export type { SessionPreparationOptions } from './preparation.ts'
export type { AssistantMessage, ToolResultMessage, UserMessage } from '@deepseek-ai/dsh-llm'
export { isJsonValue, snapshotJsonValue } from './json.ts'
export type { JsonValue } from './json.ts'
export {
  interruptedTurnClosers,
  interruptedTurnClosersFromLog,
  interruptedTurnClosersFromRecords,
  TOOL_NOT_STARTED,
  TOOL_OUTCOME_UNKNOWN,
} from './repair.ts'
export {
  adoptStorageRecord,
  decodeStorageRecord,
  isChunkRow,
  packChunkRuns,
  storageRecordLength,
  storageRecordStart,
  storageRecordValues,
  storageRecordsValues,
} from './chunk-rows.ts'
export type { ChunkRow, StorageRecord } from './chunk-rows.ts'
export type { SessionSurface, SurfaceFoldReplacement, SurfaceFoldResult } from './surface.ts'
export { deriveEventMessage, foldSurface, isAppendSurfaceEvent, isReplacementSurfaceEvent, isSurfaceEvent, isSurfaceEligibleType } from './surface.ts'
export { canonicalHeader, foldRequestHeader, headerEquals } from './request-header.ts'
export { KNOWN_SESSION_EVENT_TYPES } from './known-event-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessions: SessionStore
  }

  interface Events {
    /**
     * Creation announcement during session publication. A synchronous throw vetoes and rolls
     * back with a paired disposal; detach requested during dispatch is deferred.
     * A returned-promise rejection is logged but cannot retroactively veto this
     * synchronous boundary.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
     * receive only sessions entered through that agent's context.
     * @param session - the session just entered and announced.
     * @dshScopeScan unsupported
     * @mode emit
     */
    'session/created'(this: Scoped<Session>, session: Session): void
    /**
     * Emitted once when an announced session leaves the store, including
     * publication rollback, but never for an entry whose creation announcement
     * did not begin. Listener failures are logged and contained.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) reuses the owner scope.
     * @param session - the session that is no longer live in the store.
     * @dshScopeScan unsupported
     * @mode emit
     */
    'session/disposed'(this: Scoped<Session>, session: Session): void
    /**
     * Post-commit, fire-and-forget append feed. The listener snapshot resolves
     * before the log push, but callbacks run after it; observer failures are
     * logged and contained without making the committed append fail.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
     * receive only events from sessions entered through that agent's context.
     * @param session - the session whose log grew.
     * @param event - the appended event, exactly as recorded.
     * @dshScopeScan unsupported
     * @mode emit
     */
    'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void
    /**
     * Awaited parallel durability checkpoint: every listener runs and the
     * caller awaits all of them, with no waterfall veto. Scope-filtered dispatch
     * (`@deepseek-ai/dsh-scope`) reuses the session's owner scope.
     * @param session - the session whose buffered events must reach durable storage.
     * @dshScopeScan unsupported
     * @mode parallel
     */
    'session/flush'(this: Scoped<Session>, session: Session): Promise<void> | void
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookupMap {
    session: TypertLookup<Session, SessionId>
  }
}

/** Validate and freeze one detached creation header in place. */
function validateSessionHeader(id: SessionId, input: unknown): SessionHeader {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('session header is not a plain JSON record')
  }
  const record = input as Record<string, unknown>
  if (record.version !== SESSION_FORMAT_VERSION) {
    throw new Error(`session header version must be ${SESSION_FORMAT_VERSION}, got ${String(record.version)}`)
  }
  if (record.id !== id) {
    throw new Error(`session header id "${String(record.id)}" does not match session id "${id}"`)
  }
  if (typeof record.createdAt !== 'number'
    || !Number.isSafeInteger(record.createdAt)
    || record.createdAt < 0) {
    throw new Error('session header createdAt must be a non-negative safe integer')
  }
  if (record.cwd !== undefined) {
    if (typeof record.cwd !== 'string') throw new Error('session header cwd must be a string')
    if (!isAbsolute(record.cwd)) {
      throw new Error(`session header cwd must be an absolute path, got "${record.cwd}"`)
    }
  }
  if (record.parentSession !== undefined && typeof record.parentSession !== 'string') {
    throw new Error('session header parentSession must be a string')
  }
  if (record.seedLength !== undefined
    && (typeof record.seedLength !== 'number' || !Number.isSafeInteger(record.seedLength) || record.seedLength < 0)) {
    throw new Error('session header seedLength must be a non-negative safe integer')
  }
  if (record.origin !== undefined && record.origin !== 'subagent') {
    throw new Error('session header origin must be "subagent"')
  }
  if (record.delegationDepth !== undefined
    && (typeof record.delegationDepth !== 'number' || !Number.isSafeInteger(record.delegationDepth) || record.delegationDepth < 0)) {
    throw new Error('session header delegationDepth must be a non-negative safe integer')
  }
  if (record.agentPreset !== undefined && typeof record.agentPreset !== 'string') {
    throw new Error('session header agentPreset must be a string')
  }
  return deepFreeze(record as unknown as SessionHeader)
}

/** Validate and freeze one exclusively owned persistence header in place. */
function validateRestoredSessionHeader(id: SessionId, input: unknown): SessionHeader {
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    const prototype = Reflect.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('session header is not a plain JSON record')
    }
  }
  return validateSessionHeader(id, input)
}

/** Detach, validate, and freeze the creation metadata published by a session. */
function snapshotSessionHeader(id: SessionId, source?: SessionHeader): SessionHeader {
  const input: unknown = source === undefined
    ? { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now() }
    : source
  const snapshot = snapshotJsonValue(input)
  if (snapshot === undefined) throw new Error('session header is not losslessly JSON-serializable')
  return validateSessionHeader(id, snapshot)
}

/**
 * Validate an exclusively owned event and deeply freeze its identified message
 * without copying the event. The caller transfers an object graph that no
 * producer retains and that shares no mutable children with another event.
 * Use {@link snapshotSessionEvent} when exclusive ownership is not guaranteed.
 * @param event - exclusively owned event imported across a trusted boundary.
 * @returns the same event object with a validated, deeply frozen message.
 */
export function adoptSessionEvent<T extends SessionEvent>(event: T): T {
  assertMessageEventShape(
    event,
    `session event at seq ${event.seq}`,
  )
  switch (event.type) {
    case 'user/message':
      deepFreeze(event.data)
      break
    case 'assistant/message':
    case 'tool/result':
      deepFreeze(event.data.message)
      break
    default:
      // SessionEventMap is merge-extensible; plugin-owned events carry no core message.
      break
  }
  return event
}

/**
 * Detach one event while preserving deep immutability for its identified message.
 * @param event - event imported across a query or persistence boundary.
 * @returns a detached event snapshot with a validated, deeply frozen message.
 */
export function snapshotSessionEvent<T extends SessionEvent>(event: T): T {
  return adoptSessionEvent(structuredClone(event))
}

/** Deep-freeze one acyclic JSON tree without consuming the JavaScript call stack. */
function freezeRestoredObject<T extends object>(value: T): T {
  const pending: object[] = [value]
  while (pending.length > 0) {
    // The non-empty check proves an object remains to visit.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const current = pending.pop()!
    Object.freeze(current)
    for (const key in current) {
      const child = (current as Record<string, unknown>)[key]
      if (child !== null && typeof child === 'object') pending.push(child)
    }
  }
  return value
}

/** Validate the fixed event envelope after one-pass JSON materialization. */
function assertSessionEventEnvelope(value: Record<string, unknown>, index: number): asserts value is SessionEvent {
  const event = value
  if (event['type'] === 'request/header-delta') {
    throw new Error(`seed event at index ${index} uses unsupported legacy request/header-delta format`)
  }
  for (const key in event) {
    switch (key) {
      case 'type':
      case 'seq':
      case 'time':
      case 'data':
      case 'surfaceOp':
      case 'sourceEventSeqs':
      case 'ignorable':
        break
      default:
        throw new Error(`seed event at index ${index} has an invalid event envelope`)
    }
  }
  const type = event['type']
  const seq = event['seq']
  const time = event['time']
  if (typeof type !== 'string'
    || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0
    || typeof time !== 'number' || !Number.isSafeInteger(time)
    || event['data'] === undefined
    || (event['ignorable'] !== undefined && event['ignorable'] !== true)) {
    throw new Error(`seed event at index ${index} has an invalid event envelope`)
  }
  switch (type) {
    case 'request/header':
    case 'user/message':
    case 'assistant/message':
    case 'tool/result':
      assertCurrentLlmShape(event, index)
      break
  }
}

/** Reject obsolete request headers and malformed messages at the seed/load boundary. */
function assertCurrentLlmShape(event: Record<string, unknown>, index: number): void {
  const data = event['data']
  const record = typeof data === 'object' && data !== null
    ? data as Record<string, unknown>
    : undefined
  if (event['type'] === 'request/header') {
    const header = record?.['header']
    const headerRecord = typeof header === 'object' && header !== null && !Array.isArray(header)
      ? header as Record<string, unknown>
      : undefined
    const config = headerRecord?.['config']
    if (!hasProviderModel(config)) throw new Error(`seed request/header at index ${index} lacks provider/model`)
    const configRecord = config as Record<string, unknown>
    const reasoningEffort = configRecord['reasoningEffort']
    if (reasoningEffort !== undefined
      && (typeof reasoningEffort !== 'string' || reasoningEffort.length === 0)) {
      throw new Error(`seed request/header at index ${index} has an invalid reasoningEffort`)
    }
    assertAdapterDefaults(headerRecord?.['adapterDefaults'], configRecord, index)
  }
  const type = event['type']
  if (type !== 'user/message' && type !== 'assistant/message'
    && type !== 'tool/result') return
  assertMessageEventShape(event, `seed ${type} at index ${index}`)
}

const allowedAdapterKeys = new Set(['reasoningEffort', 'maxTokens'])

/** Validate adapter-default markers imported from a durable request header. */
function assertAdapterDefaults(
  value: unknown,
  config: Record<string, unknown>,
  index: number,
): void {
  if (value === undefined) return
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`seed request/header at index ${index} has invalid adapterDefaults`)
  }
  const defaults = value as Record<string, unknown>
  if (Object.keys(defaults).some(key => !allowedAdapterKeys.has(key))
    || Object.values(defaults).some(marker => marker !== true)
    || defaults['reasoningEffort'] === true && config['reasoningEffort'] === undefined
    || defaults['maxTokens'] === true && config['maxTokens'] === undefined) {
    throw new Error(`seed request/header at index ${index} has invalid adapterDefaults`)
  }
}

/** Validate only the event-specific invariants needed to safely replay a message. */
function assertMessageEventShape(event: Record<string, unknown>, subject: string): void {
  const type = event['type']
  if (type !== 'user/message' && type !== 'assistant/message'
    && type !== 'tool/result') return
  const data = event['data']
  const record = typeof data === 'object' && data !== null
    ? data as Record<string, unknown>
    : undefined
  const message = type === 'user/message' ? record : record?.['message']
  if (typeof message !== 'object' || message === null
    || typeof (message as Record<string, unknown>)['id'] !== 'string'
    || (message as Record<string, unknown>)['id'] === '') {
    throw new Error(`${subject} lacks an identified message`)
  }
  const messageRecord = message as Record<string, unknown>
  const expectedRole = type === 'assistant/message' ? 'assistant' : 'user'
  if (messageRecord['role'] !== expectedRole) {
    throw new Error(`${subject} message must have role "${expectedRole}"`)
  }
  const source = messageRecord['source']
  if (typeof source !== 'object' || source === null
    || typeof (source as Record<string, unknown>)['kind'] !== 'string'
    || (source as Record<string, unknown>)['kind'] === '') {
    throw new Error(`${subject} message has invalid source`)
  }
  if (!Array.isArray(messageRecord['content'])) {
    throw new Error(`${subject} message has invalid content`)
  }
  const sourceRecord = source as Record<string, unknown>
  if (type === 'assistant/message') {
    if (sourceRecord['kind'] !== 'model' || !hasProviderModel(sourceRecord)) {
      throw new Error(`${subject} message must have model source`)
    }
    return
  }
  if (type !== 'tool/result') return
  if (sourceRecord['kind'] !== 'tool'
    || typeof sourceRecord['callId'] !== 'string'
    || sourceRecord['callId'] === '') {
    throw new Error(`${subject} message must have tool source`)
  }
  const content = messageRecord['content'] as unknown[]
  const block = content[0]
  if (content.length !== 1 || typeof block !== 'object' || block === null
    || (block as Record<string, unknown>)['type'] !== 'tool-result'
    || !Array.isArray((block as Record<string, unknown>)['content'])) {
    throw new Error(`${subject} message must contain one tool-result block`)
  }
  if ((block as Record<string, unknown>)['toolCallId'] !== sourceRecord['callId']) {
    throw new Error(`${subject} message has mismatched tool call ids`)
  }
}

/** Whether an unknown value carries the current provider/model pair. */
function hasProviderModel(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const pair = value as Record<string, unknown>
  return typeof pair['provider'] === 'string' && pair['provider'].length > 0
    && typeof pair['model'] === 'string' && pair['model'].length > 0
}

/** Reject request-header vocabulary removed with the legacy delta codec. */
function assertSupportedRequestHeader(type: string, data: unknown, location: string): void {
  if (type === 'request/header-delta') {
    throw new Error(`${location} uses unsupported legacy request/header-delta format`)
  }
  if (type === 'request/header'
    && data !== null && typeof data === 'object' && !Array.isArray(data)
    && (data as Record<string, unknown>)['reason'] === 'fallback') {
    throw new Error(`${location} uses unsupported legacy request/header reason "fallback"`)
  }
}

type SessionCallback = (...args: unknown[]) => unknown

/** Resolve one listener snapshot, including Cordis's internal dispatch checks. */
function collectSessionCallbacks(ctx: Context, args: unknown[]): SessionCallback[] {
  return [...ctx.events.dispatch('emit', args)] as SessionCallback[]
}

/** Invoke one resolved observe-only listener snapshot with per-listener containment. */
function invokeContainedSessionObservers(
  ctx: Context,
  name: 'session/event' | 'session/disposed',
  id: SessionId,
  args: unknown[],
  callbacks: SessionCallback[],
): void {
  for (const callback of callbacks) {
    try {
      const returned: unknown = callback(...args)
      void Promise.resolve(returned).catch((error: unknown) => {
        ctx.logger.warn(`session "${id}": ${name} listener rejected: ${String(error)}`)
      })
    } catch (error: unknown) {
      ctx.logger.warn(`session "${id}": ${name} listener threw: ${String(error)}`)
    }
  }
}

/** All mutable lifecycle state for one exact store entry. */
interface SessionEntry {
  readonly id: SessionId
  readonly session: Session
  readonly carrier: Scoped<Session>
  readonly emitCtx: Context
  announced: boolean
  announcing: boolean
  appending: boolean
  detachRequested: boolean
  detach(): void
}

/** One contiguous assistant-chunk interval sharing a turn and step. */
export interface SessionChunkRun {
  /** Inclusive first logical event sequence. */
  readonly from: number
  /** Exclusive logical event sequence. */
  readonly to: number
  /** Owning turn carried by every chunk in the interval. */
  readonly turn: number
  /** Owning step carried by every chunk in the interval. */
  readonly step: number
}

/** Store attachment for the append path; module-private to keep Session store-agnostic publicly. */
const attachments = new WeakMap<Session, SessionEntry>()

/**
 * Immutable view of one captured prefix of a Session log.
 *
 * The cut does not grow after later appends. Point reads and iterators do not
 * allocate an event array; callers that require one request it explicitly with
 * {@link SessionLogCut.materialize}.
 */
export interface SessionLogCut {
  /** Number of events visible through this cut. */
  readonly length: number

  /**
   * Read one event by sequence number.
   * @param seq - non-negative safe integer sequence number.
   * @returns the event, or `undefined` when `seq` is beyond this cut.
   */
  at(seq: number): SessionEvent | undefined

  /**
   * Iterate a half-open event range in ascending sequence order.
   * @param from - inclusive sequence number; defaults to zero.
   * @param to - exclusive sequence number; defaults to this cut's length.
   * @returns an iterable that reads the selected events without materializing an event array.
   */
  values(from?: number, to?: number): Iterable<SessionEvent>

  /**
   * Iterate a half-open event range in descending sequence order.
   * @param from - inclusive lower sequence number; defaults to zero.
   * @param to - exclusive upper sequence number; defaults to this cut's length.
   * @returns an iterable that reads the selected events without materializing an event array.
   */
  reverseValues(from?: number, to?: number): Iterable<SessionEvent>

  /**
   * Iterate selected event types in ascending sequence order.
   * @param types - event types to include; duplicates have no effect.
   * @param from - inclusive sequence number; defaults to zero.
   * @param to - exclusive sequence number; defaults to this cut's length.
   * @returns matching events without decoding packed events of other types.
   */
  valuesOf<T extends SessionEventType>(
    types: readonly T[],
    from?: number,
    to?: number,
  ): Iterable<SessionEvent<T>>

  /**
   * Iterate selected event types in descending sequence order.
   * @param types - event types to include; duplicates have no effect.
   * @param from - inclusive lower sequence number; defaults to zero.
   * @param to - exclusive upper sequence number; defaults to this cut's length.
   * @returns matching events without decoding packed events of other types.
   */
  reverseValuesOf<T extends SessionEventType>(
    types: readonly T[],
    from?: number,
    to?: number,
  ): Iterable<SessionEvent<T>>

  /**
   * Iterate contiguous assistant-chunk intervals without materializing their
   * payload events. Adjacent chunks with the same turn and step form one run.
   * Consumers that need chunk payloads must use {@link valuesOf} instead.
   * @param from - inclusive sequence number; defaults to zero.
   * @param to - exclusive sequence number; defaults to this cut's length.
   * @returns immutable run summaries in ascending sequence order.
   */
  chunkRuns(from?: number, to?: number): Iterable<SessionChunkRun>

  /**
   * Materialize a half-open event range as a frozen array.
   * @param from - inclusive sequence number; defaults to zero.
   * @param to - exclusive sequence number; defaults to this cut's length.
   * @returns a frozen array containing only the selected events.
   */
  materialize(from?: number, to?: number): readonly SessionEvent[]
}

/**
 * Immutable current-surface snapshot captured with the exact Session log prefix
 * that produced it. Later appends do not extend the log reader or node list.
 */
export interface SessionSurfaceCut {
  /** Stable logical log prefix containing every referenced surface node. */
  readonly log: SessionLogCut
  /** Number of logical events visible through {@link log}. */
  readonly logRevision: number
  /** Surface replacement generation at capture time. */
  readonly replaceGeneration: number
  /** Seq of the replacement that created this generation, or null for the initial generation. */
  readonly generationSeq: number | null
  /** Current surface event sequences in model-visible positional order. */
  readonly nodes: readonly number[]
}

/**
 * Yield the captured events of the requested types across one validated
 * sequence range, in the caller's direction, without materializing the
 * filtered subset.
 * @param captured - frozen contiguous event array indexed by seq.
 * @param types - event types to include; duplicates have no effect.
 * @param range - inclusive start and exclusive end seq from `logRange`.
 * @param direction - `'forward'` walks `[start, end)` ascending; `'reverse'` walks it descending.
 * @returns matching events in the requested direction.
 */
function* eventsOfTypes<T extends SessionEventType>(
  captured: readonly SessionEvent[],
  types: readonly T[],
  range: readonly [number, number],
  direction: 'forward' | 'reverse',
): Generator<SessionEvent<T>> {
  const [start, end] = range
  const selected = new Set<SessionEventType>(types)
  const count = end - start
  for (let index = 0; index < count; index += 1) {
    const event = captured[direction === 'forward' ? start + index : end - 1 - index] as SessionEvent
    if (selected.has(event.type)) yield event as SessionEvent<T>
  }
}

/**
 * Capture an expanded immutable event array behind the {@link SessionLogCut}
 * read interface. This is the adapter for persistence implementations whose
 * native representation is already one event per element; packed Session logs
 * return their own indexed cut instead.
 *
 * The outer array is copied and frozen. Event objects must already be immutable
 * and contiguous because the adapter retains their references.
 * @param events - immutable events in ascending contiguous sequence order.
 * @returns a stable cut that never observes later array mutations.
 */
export function sessionLogCutFromEvents(events: readonly SessionEvent[]): SessionLogCut {
  const captured = Object.freeze([...events])
  for (let seq = 0; seq < captured.length; seq += 1) {
    if (captured[seq]?.seq !== seq) {
      throw new Error(`session log event at index ${String(seq)} has seq ${String(captured[seq]?.seq)}`)
    }
  }
  return Object.freeze({
    length: captured.length,
    at(seq: number): SessionEvent | undefined {
      assertLogSeq(seq)
      return captured[seq]
    },
    values(from?: number, to?: number): Iterable<SessionEvent> {
      const [start, end] = logRange(captured.length, from, to)
      return (function* (): Generator<SessionEvent> {
        for (let seq = start; seq < end; seq += 1) yield captured[seq] as SessionEvent
      })()
    },
    reverseValues(from?: number, to?: number): Iterable<SessionEvent> {
      const [start, end] = logRange(captured.length, from, to)
      return (function* (): Generator<SessionEvent> {
        for (let seq = end - 1; seq >= start; seq -= 1) yield captured[seq] as SessionEvent
      })()
    },
    valuesOf<T extends SessionEventType>(
      types: readonly T[],
      from?: number,
      to?: number,
    ): Iterable<SessionEvent<T>> {
      return eventsOfTypes(captured, types, logRange(captured.length, from, to), 'forward')
    },
    reverseValuesOf<T extends SessionEventType>(
      types: readonly T[],
      from?: number,
      to?: number,
    ): Iterable<SessionEvent<T>> {
      return eventsOfTypes(captured, types, logRange(captured.length, from, to), 'reverse')
    },
    chunkRuns(from?: number, to?: number): Iterable<SessionChunkRun> {
      const [start, end] = logRange(captured.length, from, to)
      return (function* (): Generator<SessionChunkRun> {
        let pending: { from: number; to: number; turn: number; step: number } | undefined
        const flush = function* (): Generator<SessionChunkRun> {
          if (pending !== undefined) {
            yield Object.freeze(pending)
            pending = undefined
          }
        }
        for (let seq = start; seq < end; seq += 1) {
          const event = captured[seq] as SessionEvent
          if (event.type !== 'assistant/chunk') {
            yield* flush()
            continue
          }
          if (pending !== undefined
            && pending.to === seq
            && pending.turn === event.data.turn
            && pending.step === event.data.step) {
            pending.to = seq + 1
          } else {
            yield* flush()
            pending = { from: seq, to: seq + 1, turn: event.data.turn, step: event.data.step }
          }
        }
        yield* flush()
      })()
    },
    materialize(from?: number, to?: number): readonly SessionEvent[] {
      const [start, end] = logRange(captured.length, from, to)
      return start === 0 && end === captured.length
        ? captured
        : Object.freeze(captured.slice(start, end))
    },
  })
}

/** Validate one point read before indexing the private log. */
function assertLogSeq(seq: number): void {
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw new RangeError(`session log seq must be a non-negative safe integer, got ${String(seq)}`)
  }
}

/** Resolve and validate a half-open range against one captured log length. */
function logRange(length: number, from = 0, to = length): readonly [number, number] {
  if (!Number.isSafeInteger(from)
    || !Number.isSafeInteger(to)
    || from < 0
    || from > to
    || to > length) {
    throw new RangeError(
      `session log range [${String(from)}, ${String(to)}) must satisfy 0 <= from <= to <= ${String(length)} with safe integers`,
    )
  }
  return [from, to]
}

/** Packed-log cut; the captured logical length hides every later append. */
class PackedSessionLogCut implements SessionLogCut {
  constructor(
    private readonly log: PackedSessionLog,
    public readonly length: number,
  ) {
    Object.freeze(this)
  }

  at(seq: number): SessionEvent | undefined {
    assertLogSeq(seq)
    return seq < this.length ? this.log.at(seq) : undefined
  }

  values(from?: number, to?: number): Iterable<SessionEvent> {
    const [start, end] = logRange(this.length, from, to)
    return this.log.values(start, end)
  }

  reverseValues(from?: number, to?: number): Iterable<SessionEvent> {
    const [start, end] = logRange(this.length, from, to)
    return this.log.reverseValues(start, end)
  }

  valuesOf<T extends SessionEventType>(
    types: readonly T[],
    from?: number,
    to?: number,
  ): Iterable<SessionEvent<T>> {
    const [start, end] = logRange(this.length, from, to)
    return this.log.valuesOf(types, start, end)
  }

  reverseValuesOf<T extends SessionEventType>(
    types: readonly T[],
    from?: number,
    to?: number,
  ): Iterable<SessionEvent<T>> {
    const [start, end] = logRange(this.length, from, to)
    return this.log.reverseValuesOf(types, start, end)
  }

  chunkRuns(from?: number, to?: number): Iterable<SessionChunkRun> {
    const [start, end] = logRange(this.length, from, to)
    return this.log.chunkRuns(start, end)
  }

  materialize(from?: number, to?: number): readonly SessionEvent[] {
    const [start, end] = logRange(this.length, from, to)
    if (start !== 0 || end !== this.length) {
      return Object.freeze([...this.log.values(start, end)])
    }
    let snapshot = packedCutMaterializations.get(this)
    if (snapshot === undefined) {
      snapshot = Object.freeze([...this.log.values(0, this.length)])
      packedCutMaterializations.set(this, snapshot)
    }
    return snapshot
  }
}

/** Reuse one complete expansion for every consumer of the same immutable cut. */
const packedCutMaterializations = new WeakMap<PackedSessionLogCut, readonly SessionEvent[]>()

/** Internal CPU budget before a cold packed-log restore yields to host I/O. */
const RESTORE_YIELD_INTERVAL_MS = 10

interface RestoredSessionState {
  readonly log: PackedSessionLog
  readonly surfaceManager: SurfaceManager
}

/** Validate and commit one logical seed event into an unpublished Session state. */
function acceptSeedEventInto(
  log: PackedSessionLog,
  surfaceManager: SurfaceManager,
  source: SessionEvent,
  index: number,
  mode: 'snapshot' | 'restore',
): void {
  // The seed is a persistence/replay boundary: validate and detach the
  // complete event in one lossless-JSON pass unless ownership transferred.
  const snapshot = mode === 'restore' ? source : snapshotJsonValue(source)
  if (snapshot === undefined) {
    throw new Error(`seed event at index ${index} is not losslessly JSON-serializable`)
  }
  assertSessionEventEnvelope(snapshot, index)
  assertSupportedRequestHeader(snapshot.type, snapshot.data, `seed event at index ${index}`)
  if (snapshot.seq !== index) {
    throw new Error(`seed event at index ${index} has seq ${snapshot.seq} (expected ${index}); seed must be contiguous from 0`)
  }
  try {
    surfaceManager.validateNext(snapshot)
  } catch (error: unknown) {
    throw new Error(`invalid seed event at index ${index}: ${error instanceof Error ? error.message : 'invalid surface metadata'}`)
  }
  const accepted = mode === 'restore' ? freezeRestoredObject(snapshot) : deepFreeze(snapshot)
  log.append(accepted)
  surfaceManager.commitNext(accepted)
}

/** Transfer one parser-owned storage record into an unpublished Session state. */
function acceptStorageRecordInto(
  state: RestoredSessionState,
  records: StorageRecord[],
  recordIndex: number,
): void {
  const source = records[recordIndex] as StorageRecord
  // Release the parser's slot as soon as the private log retains or merges the
  // record so a cooperative restore does not keep both representations alive.
  Reflect.deleteProperty(records, recordIndex)
  const record = adoptStorageRecord(source)
  if (!isChunkRow(record)) {
    acceptSeedEventInto(state.log, state.surfaceManager, record, state.log.length, 'restore')
    return
  }
  const start = storageRecordStart(record)
  if (start !== state.log.length) {
    throw new Error(`seed event at index ${state.log.length} has seq ${start} (expected ${state.log.length}); seed must be contiguous from 0`)
  }
  const end = start + storageRecordLength(record)
  state.log.adopt(record)
  state.surfaceManager.commitNonSurfaceRange('assistant/chunk', start, end)
}

/** Finish parser-owned records and recovery events into one private packed state. */
function finishRestoredState(
  state: RestoredSessionState,
  tail: readonly SessionEvent[],
): RestoredSessionState {
  state.log.sealAdoptedTail()
  for (const source of tail) {
    acceptSeedEventInto(state.log, state.surfaceManager, source, state.log.length, 'restore')
  }
  return state
}

/** Restore parser-owned records synchronously for compatibility callers. */
function restoreStorageRecords(
  records: StorageRecord[],
  tail: readonly SessionEvent[],
): RestoredSessionState {
  const log = new PackedSessionLog()
  const state = { log, surfaceManager: new SurfaceManager(log) }
  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    acceptStorageRecordInto(state, records, recordIndex)
  }
  return finishRestoredState(state, tail)
}

/** Restore parser-owned records while bounding uninterrupted host-thread work. */
async function restoreStorageRecordsCooperatively(
  records: StorageRecord[],
  tail: readonly SessionEvent[],
): Promise<RestoredSessionState> {
  const log = new PackedSessionLog()
  const state = { log, surfaceManager: new SurfaceManager(log) }
  let yieldDeadline = performance.now() + RESTORE_YIELD_INTERVAL_MS
  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    acceptStorageRecordInto(state, records, recordIndex)
    if (recordIndex + 1 < records.length && performance.now() >= yieldDeadline) {
      await scheduler.yield()
      yieldDeadline = performance.now() + RESTORE_YIELD_INTERVAL_MS
    }
  }
  return finishRestoredState(state, tail)
}

/**
 * An event-sourced session: an append-only log of {@link SessionEvent}s.
 *
 * Plain class (not a Service) — create live instances via
 * `ctx.sessions.create()` and detached instances via {@link create}.
 * Seeding with an existing event log replays/forks a session.
 * @typert object
 */
export class Session {
  private readonly log: PackedSessionLog
  /** Single incremental owner of surface acceptance and projection state. */
  private readonly surfaceManager: SurfaceManager

  /** The ordered surface over this session's event log. */
  get surface(): SessionSurface {
    return this.surfaceManager
  }

  /**
   * Detached, deep-frozen creation metadata (format version, cwd, lineage,
   * seed boundary). Supplied by the store via `ctx.sessions.create()`. When a
   * `Session` is created without a store-owned header, a minimal header is
   * synthesized (stamped with the current {@link SESSION_FORMAT_VERSION}) so
   * `session.header` is always present. Kept out of the event log — it is a
   * storage concern, not replayable conversation state.
   */
  readonly header: SessionHeader

  /** The session identity, derived from its durable header's single copy. */
  get id(): SessionId {
    return this.header.id
  }

  /**
   * The first seq appended IN THIS PROCESS: the length of the constructor
   * seed (0 without one). Events with smaller seq values entered through
   * construction — replay, fork, or resume — and were never published on the
   * `session/event` firehose (constructor seeds do not emit), so consumers
   * that replay the log as a publication substitute (telemetry adoption)
   * start here. Distinct from `header.seedLength`, the DURABLE fork-lineage
   * boundary: a resumed session's constructor seed is its full stored log,
   * while its header keeps the original fork value — this field is the
   * in-process construction fact.
   *
   * Not persisted itself: a seeded session projects it into the log as the
   * `session/end-seed` event, which is what a consumer reading STORED history
   * reads. Locate the LAST such event, not necessarily one at this seq — a
   * seed already ending in one is not re-marked, so reopening an untouched
   * session leaves that event at a smaller seq than `firstLiveSeq`. Prefer
   * this field in-process: it is exact before the marker reaches storage.
   *
   * When this lifecycle appends the marker, it occupies this seq before the
   * store attaches and therefore does not publish either. Otherwise this seq
   * holds an ordinary published write.
   */
  readonly firstLiveSeq: number

  /**
   * Create a detached session by validating and snapshotting borrowed seed
   * events and storage metadata.
   * @param id - session identity.
   * @param seed - optional borrowed replay or fork events.
   * @param header - optional borrowed storage metadata.
   * @returns a detached session.
   */
  static create(id: SessionId, seed?: readonly SessionEvent[], header?: SessionHeader): Session {
    return new Session(id, seed, header)
  }

  /**
   * Restore a detached session by taking ownership of fresh persistence values.
   * The storage format, event envelopes, sequence continuity, surface transitions,
   * and header fields are validated before the restored objects are frozen.
   * @param id - restored session identity.
   * @param seed - fresh detached events whose ownership is transferred.
   * @param header - fresh detached metadata whose ownership is transferred.
   * @returns a restored detached session.
   */
  static fromRestore(id: SessionId, seed: readonly SessionEvent[], header: SessionHeader): Session {
    return new Session(id, seed, header, 'restore')
  }

  /**
   * Restore a detached session by taking ownership of validated storage
   * records. Packed chunk rows remain packed while Session revalidates their
   * encoding, logical sequence range, and the surrounding event stream.
   * @param id - restored session identity.
   * @param records - fresh storage records whose ownership is transferred.
   * @param tail - fresh logical events appended after the records, such as
   * deterministic crash-recovery closers.
   * @param header - fresh detached metadata whose ownership is transferred.
   * @returns a restored detached session.
   */
  static fromRestoreRecords(
    id: SessionId,
    records: StorageRecord[],
    tail: readonly SessionEvent[],
    header: SessionHeader,
  ): Session {
    validateRestoredSessionHeader(id, header)
    return new Session(id, undefined, header, 'restore', restoreStorageRecords(records, tail))
  }

  /**
   * Restore parser-owned storage records without monopolizing the host event
   * loop. The result is identical to {@link fromRestoreRecords}; only the
   * unpublished construction phase yields between bounded record batches.
   * @param id - restored session identity.
   * @param records - fresh storage records whose ownership is transferred.
   * @param tail - fresh logical recovery events appended after the records.
   * @param header - fresh detached metadata whose ownership is transferred.
   * @returns a restored detached session.
   */
  static async fromRestoreRecordsAsync(
    id: SessionId,
    records: StorageRecord[],
    tail: readonly SessionEvent[],
    header: SessionHeader,
  ): Promise<Session> {
    validateRestoredSessionHeader(id, header)
    const restored = await restoreStorageRecordsCooperatively(records, tail)
    return new Session(id, undefined, header, 'restore', restored)
  }

  private constructor(
    id: SessionId,
    seed?: readonly SessionEvent[],
    header?: SessionHeader,
    mode: 'snapshot' | 'restore' = 'snapshot',
    restoredState?: RestoredSessionState,
  ) {
    this.log = restoredState?.log ?? new PackedSessionLog()
    this.surfaceManager = restoredState?.surfaceManager ?? new SurfaceManager(this.log)
    const restoredHeader = mode === 'restore'
      ? validateRestoredSessionHeader(id, header)
      : undefined
    if (restoredState === undefined && seed !== undefined) {
      // Validate the seed to the SAME invariants `append` enforces, so a
      // replay/fork (`ctx.sessions.create(id, { seed })`) cannot construct a
      // live log that no persistence backend could store: each event's `data`
      // must be JSON-serializable, and `seq` must be contiguous from 0 (the
      // `seq = log.length` contract the whole system relies on). Without this,
      // a bad seed would surface only later as a backend rejection or a silent
      // divergence between the live log and disk.
      for (const [index, source] of seed.entries()) this.acceptSeedEvent(source, index, mode)
    }
    this.firstLiveSeq = this.log.length
    this.header = restoredHeader ?? snapshotSessionHeader(id, header)
    // Appended here so the marker is already in `events` when a backend
    // captures the creation seed: no load-time write. Re-marking is skipped
    // because a cold session is resumed on first touch, so repeatedly opening
    // one must not grow its log per open.
    if ((seed !== undefined || restoredState !== undefined)
      && this.log.at(this.log.length - 1)?.type !== 'session/end-seed') {
      this.append('session/end-seed', {})
    }
  }

  /** Validate and commit one logical seed event at the current log end. */
  private acceptSeedEvent(
    source: SessionEvent,
    index: number,
    mode: 'snapshot' | 'restore',
  ): void {
    acceptSeedEventInto(this.log, this.surfaceManager, source, index, mode)
  }

  /** Cached immutable public snapshot of the private append-only log. */
  private eventsSnapshot: readonly SessionEvent[] | undefined

  /** Cached O(1) cut of the current log end. */
  private logCut: SessionLogCut | undefined

  /** Cached immutable surface snapshot for the current log revision. */
  private surfaceCut: SessionSurfaceCut | undefined

  /**
   * Capture the current log end without materializing an event array.
   * @returns an immutable point/range reader that does not grow after append.
   */
  readLog(): SessionLogCut {
    this.logCut ??= new PackedSessionLogCut(this.log, this.log.length)
    return this.logCut
  }

  /**
   * Capture the current model-visible surface and the exact immutable log cut
   * that contains it. Capturing copies only the surface seq list, not the
   * logical event log, and repeated reads reuse one snapshot until append.
   * @returns a stable surface and log snapshot that does not grow later.
   */
  readSurface(): SessionSurfaceCut {
    if (this.surfaceCut !== undefined) return this.surfaceCut
    const log = this.readLog()
    const nodes = Object.freeze([...this.surfaceManager.nodes])
    this.surfaceCut = Object.freeze({
      log,
      logRevision: log.length,
      replaceGeneration: this.surfaceManager.replaceGeneration,
      generationSeq: this.surfaceManager.generationSeq,
      nodes,
    })
    return this.surfaceCut
  }

  /**
   * An immutable snapshot of the append-only event log. The snapshot is reused
   * until the next append; a previously returned array does not grow later.
   * Events and their nested data are deep-frozen at acceptance, so neither a
   * cast nor ordinary JavaScript can rewrite durable history.
   */
  get events(): readonly SessionEvent[] {
    this.eventsSnapshot ??= this.readLog().materialize()
    return this.eventsSnapshot
  }

  /** The next event's sequence number — always the log length (the `seq = log.length` contiguity contract). */
  get seq(): number {
    return this.log.length
  }

  /**
   * Append one typed event to the log and synchronously notify observers via
   * the store-owned, module-private publication hooks. The hot path never blocks
   * on I/O — persistence plugins buffer asynchronously. Once the event enters
   * the log, the append is committed: observer failures are logged and
   * contained per listener, so they do not change the return value or prevent
   * later listeners from observing the same accepted event.
   *
   * @param type - The event type (key of {@link SessionEventMap}).
   * @param data - The event payload; must be JSON-serializable.
   * @param opts - Surface metadata: `surfaceOp` controls how the event enters
   *   the ordered surface; `sourceEventSeqs` lists the seq numbers of earlier
   *   events this one derives from. REQUIRED for
   *   {@link SurfaceEventType} events (every message-producing event must
   *   declare how it joins the surface, the sole source of derived model
   *   history) and
   *   rejected by the compiler for non-surface types like `turn/start` or
   *   `assistant/chunk`.
   * @returns the logged event — its assigned `seq`/`time` plus the SNAPSHOT of
   *   `data` that entered the log, so reading `event.data` back sees the logged
   *   value, never the caller's still-mutable input.
   * @throws if `data` or surface metadata is not losslessly JSON-serializable
   *   (BigInt, function, symbol, undefined, negative zero, non-finite number,
   *   circular reference, sparse array, or an exotic object such as
   *   Map/Set/Date/class instance), or when the candidate violates the
   *   canonical surface contract (marker shape and eligibility, unique
   *   earlier source-event references, positional replacement validity, and complete
   *   shadowed-node coverage). One recursive pass reads, validates, and
   *   copies each nested value once, so a stateful getter cannot supply one value
   *   to validation and another to storage. The event log is the durable source
   *   of truth, so a bad event fails at the append site rather than later during
   *   a backend flush. A synchronous internal dispatch validation failure or an
   *   append reentered while this acceptance/publication boundary is open also
   *   rejects before the log changes.
   */
  append<T extends SessionEventType>(
    type: T,
    data: SessionEventMap[T],
    ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent] : []
  ): SessionEvent<T> {
    const surfaceOpts: SurfaceIntent | undefined = opts[0]
    const surfaceMetadata = {
      ...surfaceOpts?.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: surfaceOpts.sourceEventSeqs },
      ...surfaceOpts?.surfaceOp === undefined ? {} : { surfaceOp: surfaceOpts.surfaceOp },
    }
    const dataSnapshot = snapshotJsonValue(data)
    if (dataSnapshot === undefined) {
      throw new Error(`session event "${type}" carries non-JSON-serializable data`)
    }
    assertSupportedRequestHeader(type, dataSnapshot, `session event "${type}"`)
    const surfaceMetadataSnapshot = snapshotJsonValue(surfaceMetadata)
    if (surfaceMetadataSnapshot === undefined) {
      throw new Error(`session event "${type}" carries non-JSON-serializable surface metadata`)
    }
    const entry = attachments.get(this)
    if (entry?.appending) {
      throw new Error('session append cannot reenter while another append is being published')
    }
    const event = deepFreeze({
      type,
      seq: this.log.length,
      time: Date.now(),
      data: dataSnapshot,
      ...(surfaceMetadataSnapshot as { surfaceOp?: unknown; sourceEventSeqs?: unknown }),
    } as unknown as SessionEvent<T>)
    this.surfaceManager.validateNext(event as SessionEvent)

    if (entry !== undefined) entry.appending = true
    try {
      let callbacks: SessionCallback[] | undefined
      const callbackArgs: unknown[] = [this, event]
      if (entry !== undefined) {
        callbacks = collectSessionCallbacks(entry.emitCtx, [entry.carrier, 'session/event', ...callbackArgs])
      }
      this.log.append(event as SessionEvent)
      this.surfaceManager.commitNext(event as SessionEvent)
      this.eventsSnapshot = undefined
      this.logCut = undefined
      this.surfaceCut = undefined
      if (callbacks !== undefined && entry !== undefined) {
        invokeContainedSessionObservers(entry.emitCtx, 'session/event', entry.id, callbackArgs, callbacks)
      }
      return event
    } finally {
      if (entry !== undefined) {
        entry.appending = false
        if (entry.detachRequested && !entry.announcing) entry.detach()
      }
    }
  }

  /** Cached fold of the request-header events — see {@link requestHeader}. */
  private headerFold: EpochHeader | undefined
  /** Log position (events consumed) the header fold has reached. */
  private headerFoldSeq = 0

  /**
   * The {@link EpochHeader} in force after the log's last header event — the
   * header the NEXT request will be compared against — or undefined before
   * the first `request/header` snapshot. The live, incrementally-maintained
   * form of folding `session.readLog().valuesOf(['request/header'])`: each
   * header event is folded once, when first seen, so a per-step read costs
   * O(new events).
   * @returns the folded header, or undefined when no header event exists yet.
   */
  requestHeader(): EpochHeader | undefined {
    if (this.headerFoldSeq < this.log.length) {
      let header = this.headerFold
      for (const event of this.log.valuesOf(['request/header'], this.headerFoldSeq, this.log.length)) {
        header = canonicalHeader(event.data.header)
      }
      // Frozen on update: the fold is session state exposed by reference — a
      // consumer mutating it in place (instead of building a replacement)
      // would desync every later comparison against the log, so mutation
      // throws instead.
      this.headerFold = deepFreeze(header)
      this.headerFoldSeq = this.log.length
    }
    return this.headerFold
  }

  /** Cached fold of `request/context` events. */
  private contextFold: RequestContext | undefined
  private contextFoldSeq = 0

  /**
   * Return the latest resolved route metadata, or `undefined` before the first
   * `request/context` event. Each event is folded once.
   * @returns the latest immutable route metadata.
   */
  requestContext(): RequestContext | undefined {
    if (this.contextFoldSeq < this.log.length) {
      for (const event of this.log.valuesOf(['request/context'], this.contextFoldSeq, this.log.length)) {
        this.contextFold = deepFreeze({ ...event.data })
      }
      this.contextFoldSeq = this.log.length
    }
    return this.contextFold
  }

  /** The derived-message cache: frozen projections, extended per unseen node. */
  private derived: Message[] = []
  /** Surface position (nodes projected) the cache has reached. */
  private derivedNodes = 0
  /** {@link SurfaceManager.replaceGeneration} the cache was built under. */
  private derivedGeneration = 0

  /**
   * Derive the LLM message history by walking the ordered sequences of
   * message-producing events maintained by `surfaceOp` markers. The
   * surface is the single source of derived history: every message-producing
   * append records its `surfaceOp`, so a raw event with no marker (a chunk, a
   * turn boundary) is correctly absent, and a compaction `replace` deletes the
   * shadowed nodes from the derivation. The projection rules are
   * {@link deriveEventMessage}, folded per node.
   *
   * CACHED: each surface node is projected exactly once, when first seen — a
   * call costs O(new nodes), and a surface rewrite (a `replace`;
   * {@link SessionSurface.replaceGeneration}) rebuilds. The returned array is
   * a fresh snapshot per call (later appends never grow an array a caller
   * already holds); the `Message` objects in it are SHARED and **deep-frozen**.
   * Their content reuses the already frozen durable event data, so the cache
   * needs no second deep clone and consumers still cannot mutate the log.
   * @returns a fresh array of the shared, frozen derived history.
   */
  deriveMessages(): Message[] {
    const surface = this.surface
    const nodes = surface.nodes
    const generation = surface.replaceGeneration
    if (generation !== this.derivedGeneration) {
      this.derived = []
      this.derivedNodes = 0
      this.derivedGeneration = generation
    }
    for (let index = this.derivedNodes; index < nodes.length; index += 1) {
      const seq = nodes[index]
      /* v8 ignore next -- loop bounds are derived from this same node array. */
      if (seq === undefined) throw new Error(`session surface is missing node at index ${index}`)
      const event = this.log.at(seq)
      /* v8 ignore next -- surface nodes are validated seqs from this log. */
      if (event === undefined) throw new Error(`session surface references missing event at seq ${seq}`)
      const msg = this.deriveEventMessage(event)
      // A surface node is one of the five message-producing types, but an
      // empty-content assistant/message (a max-tokens step that hosts only
      // usage) derives to null and must not enter the transcript.
      if (msg) this.derived.push(msg)
    }
    this.derivedNodes = nodes.length
    return [...this.derived]
  }

  /**
   * Instance face of the pure per-node `deriveEventMessage` export from
   * `surface.ts`.
   * @param event - the event to project.
   * @returns the derived message, or null when the event produces none.
   */
  deriveEventMessage(event: SessionEvent): Message | null {
    return deriveEventMessage(event)
  }
}

interface SessionEventFoldCursor<State> {
  readonly state: State
  consumedEvents: number
}

/**
 * Lazily cached incremental fold over each Session object's append-only log.
 *
 * A caller reads current state through {@link SessionEventFold.read} and passes
 * committed `session/event` notifications to {@link SessionEventFold.advance}.
 * Notification delivery stays lazy: an unread Session receives no cache entry,
 * while an initialized fold consumes the delivered event directly and replays
 * only a missed prefix. An event already consumed by an earlier listener-side
 * read is ignored.
 *
 * The reducer owns transactional mutation. If it throws, it must leave `State`
 * retryable because the fold advances its watermark only after the reducer
 * returns successfully.
 */
export class SessionEventFold<State> {
  private readonly cursors = new WeakMap<Session, SessionEventFoldCursor<State>>()
  private readonly selectedTypes: readonly SessionEventType[]
  private readonly eventTypes: ReadonlySet<SessionEventType>

  /**
   * @param createState - create empty derived state for one Session object.
   * @param applyEvent - fold one event into that state without partial mutation on failure.
   * @param eventTypes - exact event types the reducer consumes; other events advance only the watermark.
   */
  constructor(
    private readonly createState: (session: Session) => State,
    private readonly applyEvent: (state: State, event: SessionEvent, session: Session) => void,
    eventTypes: readonly SessionEventType[],
  ) {
    this.eventTypes = new Set(eventTypes)
    this.selectedTypes = [...this.eventTypes]
  }

  /**
   * Replay an unseen suffix and return the current derived state.
   * @param session - session whose durable tail is folded.
   * @returns the cached mutable state owned by this fold.
   */
  read(session: Session): State {
    let cursor = this.cursors.get(session)
    if (cursor === undefined) {
      cursor = { state: this.createState(session), consumedEvents: 0 }
      this.cursors.set(session, cursor)
    }
    this.replay(session, cursor, session.seq)
    return cursor.state
  }

  /**
   * Consume one committed notification for an already initialized fold.
   * @param session - session that published the event.
   * @param event - committed event delivered by `session/event`.
   */
  advance(session: Session, event: SessionEvent): void {
    const cursor = this.cursors.get(session)
    if (cursor === undefined || event.seq < cursor.consumedEvents) return
    this.replay(session, cursor, event.seq)
    this.consume(cursor, session, event)
  }

  /** Replay selected event types in `[consumedEvents, end)` from one stable log cut. */
  private replay(session: Session, cursor: SessionEventFoldCursor<State>, end: number): void {
    if (cursor.consumedEvents >= end) return
    if (typeof session.readLog === 'function') {
      const cut = session.readLog()
      for (const event of cut.valuesOf(this.selectedTypes, cursor.consumedEvents, end)) {
        this.apply(cursor, session, event)
      }
    } else {
      // Structural Agent stubs and pre-readLog integrations can still supply
      // the legacy in-memory event view. Real Session instances always take
      // the bounded cut above, so this compatibility seam never materializes
      // a persisted log.
      for (const event of session.events.slice(cursor.consumedEvents, end)) {
        if (this.eventTypes.has(event.type)) this.apply(cursor, session, event)
      }
    }
    cursor.consumedEvents = end
  }

  /** Apply a selected event or skip it while preserving the complete-log watermark. */
  private consume(cursor: SessionEventFoldCursor<State>, session: Session, event: SessionEvent): void {
    if (this.eventTypes.has(event.type)) this.apply(cursor, session, event)
    else cursor.consumedEvents = event.seq + 1
  }

  /** Advance the watermark only after one successful reducer call. */
  private apply(cursor: SessionEventFoldCursor<State>, session: Session, event: SessionEvent): void {
    this.applyEvent(cursor.state, event, session)
    cursor.consumedEvents = event.seq + 1
  }
}

/** A fork source: either the live session object or its live store id. */
export type SessionForkSource = Session | SessionId

/**
 * Rejection codes for session forking: the fork source id is unknown to the
 * live store (`SESSION_NOT_FOUND`) or names a session object that is not the
 * store's live instance (`SESSION_NOT_LIVE`); the requested child id is
 * already taken (`SESSION_ALREADY_EXISTS`); the boundary is not a contiguous
 * existing seq (`INVALID_BOUNDARY`); or the selected prefix ends inside an
 * open turn (`OPEN_TURN`).
 */
export type SessionForkErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_NOT_LIVE'
  | 'SESSION_ALREADY_EXISTS'
  | 'INVALID_BOUNDARY'
  | 'OPEN_TURN'

/** Typed error for session fork rejections. */
export class SessionForkError extends Error {
  constructor(message: string, public readonly code: SessionForkErrorCode) {
    super(message)
    this.name = 'SessionForkError'
  }
}

/**
 * In-memory session store (`ctx.sessions`).
 *
 * Persistence is intentionally not implemented here — persistence plugins
 * subscribe to `session/event` and flush on `session/flush` / dispose.
 */
export class SessionStore extends Service {
  private store = new Map<SessionId, SessionEntry>()
  private counter = 0

  constructor(ctx: Context) {
    super(ctx, 'sessions')
    ctx.inject(['typert'], (typeCtx) => {
      typeCtx.typert.lookups.register('session', {
        parameter: 'session',
        wire: 'sessionId',
        hostTypeSymbol: '@deepseek-ai/dsh-session#Session',
        wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
        resolve: sessionId => this.get(sessionId),
      })
    })
  }

  /**
   * Create a session owned by the calling fiber: disposing that fiber stops
   * event notification and removes the session from the store. `options.seed`
   * populates the session with a copy of those events (replay/fork);
   * `options.meta` attaches creation metadata (validated absolute `cwd`, seed
   * and parent lineage, and delegation depth) as the immutable
   * {@link SessionHeader} (the store fills `version`/`id`/`createdAt`).
   *
   * For an agent whose session must be torn down IN ORDER with its loop (so the
   * loop's final events are published before the store attachment ends), do NOT use this
   * — fold the session lifecycle into the agent's own effect via
   * {@link prepare} + {@link enter} + {@link announce} (see
   * `dsh-agent-loop`'s creation transaction).
   *
   * @param id - the session id; omitted, the store mints `session-<n>`.
   * @param options - seed events and/or creation metadata for the header.
   * @returns the live session, already entered and announced.
   * @throws if a session with `id` already exists, metadata is not a plain
   *   lossless-JSON record with valid scalar fields, or `meta.cwd` is a
   *   non-absolute path (storage backends key directories off it).
   */
  create(id?: SessionId, options?: CreateSessionOptions): Session {
    const session = this.prepare(id, options)
    // Single effect owned by the calling fiber. Yield the detach BEFORE
    // announcing so a throwing `session/created` listener rolls the attach back
    // (the generator effect disposes already-yielded disposers on a throw)
    // instead of leaking the store entry and its publication hooks.
    this.ctx.effect(function* (this: SessionStore) {
      yield this.enter(session)
      this.announce(session)
    }.bind(this), 'sessions.create()')
    return session
  }

  /**
   * Build a session WITHOUT entering it into the store — validate the id/cwd and
   * construct the {@link Session} (with its immutable {@link SessionHeader}).
   * Pairs with {@link enter} + {@link announce}: a caller that owns a composite
   * `ctx.effect` (the agent factory) folds the session lifecycle into that ONE
   * effect so a fiber unload tears the session + agent down as a single ORDERED
   * chain rather than as racing sibling effects — which would remove the publication hooks
   * before the driver's closing events commit, dropping them.
   *
   * @param id - the session id; omitted, the store mints `session-<n>`.
   * @param options - seed events and/or creation metadata for the header. With
   *   `seedSource: 'persistence'`, metadata and events must be fresh detached
   *   graphs whose ownership transfers to this call: they are validated and
   *   frozen in place through {@link Session.fromRestore}, so the caller must
   *   retain no mutable aliases.
   * @returns the constructed session, NOT yet in the store.
   * @throws if a session with `id` already exists, metadata is not a plain
   *   lossless-JSON record with valid scalar fields, or `meta.cwd` is a
   *   non-absolute path.
   */
  prepare(id?: SessionId, options?: PrepareSessionOptions): Session {
    let sessionId: SessionId
    if (id === undefined) {
      do sessionId = SessionId(`session-${++this.counter}`)
      while (this.store.has(sessionId))
    } else {
      sessionId = SessionId(id)
    }
    if (this.store.has(sessionId)) throw new Error(`session "${sessionId}" already exists`)
    if (options?.seedSource === 'persistence') {
      return Session.fromRestore(sessionId, options.seed, options.meta)
    }
    const seed = options?.seed
    const meta = options?.meta
    const header: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: meta?.createdAt ?? Date.now(),
      ...meta?.cwd === undefined ? {} : { cwd: meta.cwd },
      ...meta?.parentSession === undefined ? {} : { parentSession: meta.parentSession },
      ...meta?.seedLength === undefined ? {} : { seedLength: meta.seedLength },
      ...meta?.origin === undefined ? {} : { origin: meta.origin },
      ...meta?.delegationDepth === undefined ? {} : { delegationDepth: meta.delegationDepth },
      ...meta?.agentPreset === undefined ? {} : { agentPreset: meta.agentPreset },
    }
    return Session.create(sessionId, seed, header)
  }

  /**
   * Enter a {@link prepare}d session into the store: install the module-private
   * append publication hooks and add it to the store. Returns the DETACH
   * disposer (hooks + store removal). Does NOT emit `session/created` —
   * the caller yields this disposer inside its effect and THEN calls
   * {@link announce}, so a throwing `session/created` listener rolls the attach
   * back instead of leaking it.
   *
   * Re-checks the id for a duplicate: `prepare` and `enter` are public
   * cross-package primitives and a caller may interleave arbitrary work (or
   * another create) between them, so a stale prepared session must NOT overwrite
   * a live store entry of the same id — its detach disposer would later delete
   * the REAL session. The {@link create} convenience and the agent factory call
   * the two back-to-back so they never trip this, but the public API cannot
   * assume that.
   *
   * @param session - a {@link prepare}d session not yet in the store.
   * @returns the detach disposer (publication hooks + store removal). When called from
   *   a synchronous `session/created` listener, removal and disposal wait until
   *   that creation dispatch unwinds.
   * @throws if a session with this id is already in the store.
   */
  enter(session: Session): () => void {
    const id = session.id
    const carrier = scopeTarget(session, scopeOf(this.ctx))
    // This is the authoritative collision boundary after arbitrary unpublished
    // preparation. Only one exact same-id transaction can publish.
    if (this.store.has(id)) throw new Error(`session "${id}" already exists`)
    if (attachments.has(session)) throw new Error(`session "${id}" is already attached to a store`)
    const entry: SessionEntry = {
      id,
      session,
      carrier,
      emitCtx: this.ctx,
      announced: false,
      announcing: false,
      appending: false,
      detachRequested: false,
      detach: () => { this.detachEntered(entry) },
    }
    this.store.set(id, entry)
    attachments.set(session, entry)
    let entered = true
    const detach = (): void => {
      if (!entered) return
      entered = false
      // A lifecycle listener may own the advanced detach capability. Keep the
      // entry and its publication hooks live until synchronous creation or append
      // publication unwinds, then publish the paired disposal edge.
      if (entry.announcing || entry.appending) {
        entry.detachRequested = true
        return
      }
      entry.detach()
    }
    return detach
  }

  /** Remove one exact entered session and emit its paired disposal when announced. */
  private detachEntered(entry: SessionEntry): void {
    entry.detachRequested = false
    // A stale capability cannot remove observers or storage belonging to a
    // later same-id lifecycle.
    /* v8 ignore next -- enter() rejects replacement while this single-shot detach capability is live. */
    if (this.store.get(entry.id) !== entry) return
    this.store.delete(entry.id)
    attachments.delete(entry.session)
    if (entry.announced) this.emitDisposed(entry)
  }

  /** Emit `session/created` exactly once for an {@link enter}ed session (with
   * the carrier {@link enter} captured). Separate from {@link enter} so the
   * caller can yield the detach disposer first (rollback safety — see
   * {@link enter}).
   * @param session - the entered session to announce to listeners.
   * @throws if the session is not live or its announcement already began,
   *   including a reentrant call from a creation listener. */
  announce(session: Session): void {
    const entry = this.liveEntryFor(session)
    if (entry.announced || entry.announcing) {
      throw new Error(`session "${entry.id}" was already announced`)
    }
    // Mark before emit: Cordis emit may deliver to earlier listeners and then
    // throw. Rollback must still pair that partial creation with disposal, and
    // a listener cannot recursively create a second lifecycle edge.
    entry.announced = true
    const callbackArgs: unknown[] = [session]
    entry.announcing = true
    try {
      const callbacks = collectSessionCallbacks(this.ctx, [entry.carrier, 'session/created', session])
      for (const callback of callbacks) {
        // Synchronous throws intentionally propagate and veto publication; the
        // yielded detach then emits the paired disposal edge. An async function
        // is nevertheless assignable to a void listener, so observe its returned
        // promise: rejection is too late to roll back and must be logged instead
        // of becoming unhandled.
        const returned: unknown = callback(...callbackArgs)
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`session "${entry.id}": session/created listener rejected: ${String(error)}`)
        })
      }
    } finally {
      entry.announcing = false
      if (entry.detachRequested && !entry.appending) entry.detach()
    }
  }

  /** Emit the paired teardown notification with per-listener containment. */
  private emitDisposed(entry: SessionEntry): void {
    const callbackArgs: unknown[] = [entry.session]
    try {
      const callbacks = collectSessionCallbacks(this.ctx, [entry.carrier, 'session/disposed', entry.session])
      invokeContainedSessionObservers(this.ctx, 'session/disposed', entry.id, callbackArgs, callbacks)
    } catch (error: unknown) {
      this.ctx.logger.warn(`session "${entry.id}": session/disposed dispatch threw: ${String(error)}`)
    }
  }

  /**
   * Dispatch the awaited `session/flush` durability checkpoint for `session`,
   * with the carrier captured at {@link enter}. THE flush entry point: the
   * store owns the carrier, so callers (the checkpoint policy's per-request
   * barrier, goal-round-driver's idle checkpoint, teardown drains, and consumers
   * that flush themselves before reading storage) must come through here
   * rather than dispatch a raw `ctx.parallel('session/flush', …)` — one owner,
   * one spelling, and the scoped-dispatch invariant can pin it.
   * @param session - the session whose buffered events must reach durable storage.
   * @returns whether at least one durability listener participated, after every
   *   listener has settled successfully.
   * @throws the first registered listener failure after every listener settles.
   */
  async flush(session: Session): Promise<boolean> {
    const { carrier } = this.liveEntryFor(session)
    const callbackArgs: unknown[] = [session]
    const callbacks = collectSessionCallbacks(this.ctx, [carrier, 'session/flush', session])
    const results = await Promise.allSettled(callbacks.map((callback) => {
      try {
        return callback(...callbackArgs)
      } catch (error: unknown) {
        // Preserve the listener's exact rejection value; flush is a caller-owned
        // failure boundary, and Cordis listeners may throw arbitrary values.
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors
        return Promise.reject(error)
      }
    }))
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure !== undefined) throw failure.reason
    return callbacks.length > 0
  }

  /** Return the exact live entry; detached/prepared objects reject. */
  private liveEntryFor(session: Session): SessionEntry {
    const entry = attachments.get(session)
    if (entry === undefined || this.store.get(entry.id) !== entry) {
      throw new Error(`session "${session.id}" is not live in this store`)
    }
    return entry
  }

  /**
   * Look up a live session.
   * @param id - the session id to look up.
   * @returns the session, or undefined when no live session has that id.
   */
  get(id: SessionId): Session | undefined {
    return this.store.get(id)?.session
  }

  /**
   * All live sessions, in creation order.
   * @returns a fresh array; mutating it does not affect the store.
   */
  list(): Session[] {
    return [...this.store.values()].map(entry => entry.session)
  }

  /**
   * Create a live child session from a stable prefix of a live source.
   * `boundary` is an inclusive source event seq; omitted means the source's
   * current last event. The selected slice may end with a between-turn event
   * but must not end inside an open turn.
   *
   * @param source - Live source session object or id.
   * @param boundary - Inclusive source event seq to fork through; omitted means
   *   the source's current last event, and omitted on an empty source forks an
   *   empty child.
   * @param childSessionId - Optional child session id; omitted delegates to
   *   `SessionStore`'s id policy.
   * @returns The created live child session.
   */
  fork(source: SessionForkSource, boundary?: number, childSessionId?: SessionId): Session {
    if (childSessionId !== undefined && this.get(childSessionId) !== undefined) {
      throw new SessionForkError(`session "${childSessionId}" already exists`, 'SESSION_ALREADY_EXISTS')
    }
    const liveSource = this._resolveForkSource(source)
    const seed = this._forkSeed(liveSource, boundary)
    return this.create(childSessionId, {
      seed,
      meta: {
        ...liveSource.header.cwd !== undefined ? { cwd: liveSource.header.cwd } : {},
        parentSession: liveSource.id,
        seedLength: seed.length,
      },
    })
  }

  private _forkSeed(session: Session, requestedBoundary: number | undefined): SessionEvent[] {
    const log = session.readLog()
    const lastEvent = log.length === 0 ? undefined : log.at(log.length - 1)
    let boundary: number
    if (requestedBoundary !== undefined) {
      boundary = requestedBoundary
    } else {
      if (lastEvent === undefined) return []
      boundary = lastEvent.seq
    }
    if (!Number.isSafeInteger(boundary) || boundary < 0) {
      throw new SessionForkError(
        `fork boundary for session "${session.id}" must be a non-negative safe integer, got ${String(boundary)}`,
        'INVALID_BOUNDARY',
      )
    }
    if (boundary >= log.length) {
      const lastSeq = lastEvent?.seq
      throw new SessionForkError(
        `fork boundary ${boundary} does not exist in session "${session.id}" (last seq: ${lastSeq ?? 'none'})`,
        'INVALID_BOUNDARY',
      )
    }

    const boundaryEvent = log.at(boundary)
    if (boundaryEvent === undefined || boundaryEvent.seq !== boundary) {
      throw new SessionForkError(
        `fork boundary ${boundary} does not match a contiguous event seq in session "${session.id}"`,
        'INVALID_BOUNDARY',
      )
    }
    let lastTurnBoundary: SessionEvent<'turn/start' | 'turn/end'> | undefined
    for (const event of log.reverseValuesOf(['turn/start', 'turn/end'], 0, boundary + 1)) {
      lastTurnBoundary = event
      break
    }
    if (lastTurnBoundary?.type === 'turn/start') {
      throw new SessionForkError(
        `fork boundary ${boundary} in session "${session.id}" ends inside open turn ${lastTurnBoundary.data.turn}`,
        'OPEN_TURN',
      )
    }

    return [...log.values(0, boundary + 1)]
  }

  private _resolveForkSource(source: SessionForkSource): Session {
    if (typeof source === 'string') {
      const session = this.get(source)
      if (session === undefined) throw new SessionForkError(`session "${source}" not found`, 'SESSION_NOT_FOUND')
      return session
    }

    const live = this.get(source.id)
    if (live === undefined) {
      throw new SessionForkError(`session "${source.id}" not found`, 'SESSION_NOT_FOUND')
    }
    if (live !== source) throw new SessionForkError(`session "${source.id}" is not the live store instance`, 'SESSION_NOT_LIVE')
    return source
  }

}

export default SessionStore
