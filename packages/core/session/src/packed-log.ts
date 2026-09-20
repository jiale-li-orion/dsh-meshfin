/**
 * Private packed storage for the logical Session event log.
 *
 * Consecutive stream deltas share one chunk row while every public read still
 * observes individual immutable SessionEvents at contiguous sequence numbers.
 *
 * @module @deepseek-ai/dsh-session/packed-log
 */

import { deepFreeze } from '@deepseek-ai/dsh-llm'
import {
  chunkRowAt,
  chunkRowLastTime,
  chunkRowValues,
  extendChunkRow,
  isChunkRow,
  mergeChunkRows,
  packChunkRuns,
  reverseChunkRowValues,
  storageRecordLength,
  storageRecordStart,
} from './chunk-rows.ts'
import type { StorageRecord } from './chunk-rows.ts'
import type { ChunkRow } from './chunk-rows.ts'
import type { SessionEvent, SessionEventType } from './types.ts'

interface TypeSpan {
  from: number
  to: number
}

interface PackedChunkRun {
  from: number
  to: number
  turn: number
  step: number
}

/** First span whose exclusive end is above `seq`. */
function firstSpanAfter(spans: readonly TypeSpan[], seq: number): number {
  let low = 0
  let high = spans.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if ((spans[middle] as TypeSpan).to <= seq) low = middle + 1
    else high = middle
  }
  return low
}

/** Last span whose inclusive start is below `seq`. */
function lastSpanBefore(spans: readonly TypeSpan[], seq: number): number {
  let low = 0
  let high = spans.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if ((spans[middle] as TypeSpan).from < seq) low = middle + 1
    else high = middle
  }
  return low - 1
}

/**
 * Append-only packed event storage used only by {@link Session}.
 *
 * Input events must already satisfy Session's envelope, sequence, JSON, and
 * immutability checks. Decoded chunk members are freshly deep-frozen before
 * they cross the private storage boundary.
 */
export class PackedSessionLog {
  private readonly records: StorageRecord[] = []
  private readonly spansByType = new Map<SessionEventType, TypeSpan[]>()
  private adoptedTail: { row: ChunkRow; lastTime: number } | undefined
  private mutableTail: StorageRecord | undefined
  private tailEvent: SessionEvent | undefined
  private logicalLength = 0

  /** Number of logical events in the log. */
  get length(): number {
    return this.logicalLength
  }

  /** Number of private storage records, exposed only for focused structural tests. */
  get recordCount(): number {
    return this.records.length
  }

  /**
   * Append one already accepted event.
   * @param event - immutable event at exactly the current logical length.
   */
  append(event: SessionEvent): void {
    this.sealAdoptedTail()
    if (event.seq !== this.logicalLength) {
      throw new Error(`packed session log expected seq ${this.logicalLength}, got ${event.seq}`)
    }

    const tailRecord = this.records.at(-1)
    if (tailRecord !== undefined
      && isChunkRow(tailRecord)
      && tailRecord === this.mutableTail
      && this.tailEvent !== undefined
      && extendChunkRow(tailRecord, this.tailEvent, event)) {
      // The existing row absorbed this logical event.
    } else {
      const beforeTail = this.records.at(-2)
      const tail = this.records.at(-1)
      if (beforeTail !== undefined && tail !== undefined
        && !isChunkRow(beforeTail) && !isChunkRow(tail)) {
        const packed = packChunkRuns([beforeTail, tail, event])
        const row = packed.length === 1 ? packed[0] : undefined
        if (row !== undefined && isChunkRow(row)) {
          this.records.splice(-2, 2, row)
          this.mutableTail = row
        } else {
          this.records.push(event)
          this.mutableTail = undefined
        }
      } else {
        this.records.push(event)
        this.mutableTail = undefined
      }
    }

    this.index(event)
    this.tailEvent = event
    this.logicalLength += 1
  }

  /**
   * Adopt one validated, exclusively owned storage record without expanding a
   * packed chunk row. Compatible adjacent rows coalesce in place before the
   * private representation is sealed.
   * @param record - record starting at the current logical length.
   */
  adopt(record: StorageRecord): void {
    const start = storageRecordStart(record)
    if (start !== this.logicalLength) {
      throw new Error(`packed session log expected seq ${this.logicalLength}, got ${start}`)
    }
    if (!isChunkRow(record)) {
      this.append(record)
      return
    }
    const end = start + storageRecordLength(record)
    if (this.adoptedTail !== undefined
      && mergeChunkRows(this.adoptedTail.row, this.adoptedTail.lastTime, record)) {
      this.adoptedTail.lastTime = chunkRowLastTime(record)
      // The mutable predecessor absorbed this physical write-batch boundary.
    } else {
      this.sealAdoptedTail()
      this.records.push(record)
      this.adoptedTail = { row: record, lastTime: chunkRowLastTime(record) }
    }
    this.indexSpan('assistant/chunk', start, end)
    this.mutableTail = undefined
    this.tailEvent = undefined
    this.logicalLength = end
  }

  /** Seal an adopted row before a different record kind or live append follows. */
  sealAdoptedTail(): void {
    const row = this.adoptedTail?.row
    if (row === undefined) return
    Object.freeze(row.data.dt)
    if (row.type === 'tool-call-chunks') Object.freeze(row.data.args)
    else Object.freeze(row.data.texts)
    Object.freeze(row.data)
    Object.freeze(row)
    this.adoptedTail = undefined
  }

  /**
   * Read one logical event.
   * @param seq - sequence within the current log.
   * @returns the immutable event, or undefined beyond the current end.
   */
  at(seq: number): SessionEvent | undefined {
    if (seq < 0 || seq >= this.logicalLength) return undefined
    const index = this.recordIndexAt(seq)
    const record = this.records[index]
    if (record === undefined) return undefined
    if (!isChunkRow(record)) return record
    return deepFreeze(chunkRowAt(record, seq - record.seq0))
  }

  /**
   * Iterate a validated half-open logical range in ascending order.
   * @param from - inclusive sequence.
   * @param to - exclusive sequence.
   * @returns immutable logical events.
   */
  *values(from: number, to: number): Generator<SessionEvent> {
    if (from === to) return
    let index = this.recordIndexAt(from)
    while (index < this.records.length) {
      const record = this.records[index] as StorageRecord
      const start = storageRecordStart(record)
      if (start >= to) return
      const end = start + storageRecordLength(record)
      const selectedFrom = Math.max(from, start)
      const selectedTo = Math.min(to, end)
      if (selectedFrom < selectedTo) {
        if (isChunkRow(record)) {
          for (const event of chunkRowValues(record, selectedFrom - start, selectedTo - start)) {
            yield deepFreeze(event)
          }
        } else {
          yield record
        }
      }
      index += 1
    }
  }

  /**
   * Iterate a validated half-open logical range in descending order.
   * @param from - inclusive lower sequence.
   * @param to - exclusive upper sequence.
   * @returns immutable logical events in reverse order.
   */
  *reverseValues(from: number, to: number): Generator<SessionEvent> {
    if (from === to) return
    let index = this.recordIndexAt(to - 1)
    while (index >= 0) {
      const record = this.records[index] as StorageRecord
      const start = storageRecordStart(record)
      const end = start + storageRecordLength(record)
      if (end <= from) return
      const selectedFrom = Math.max(from, start)
      const selectedTo = Math.min(to, end)
      if (selectedFrom < selectedTo) {
        if (isChunkRow(record)) {
          for (const event of reverseChunkRowValues(record, selectedFrom - start, selectedTo - start)) {
            yield deepFreeze(event)
          }
        } else {
          yield record
        }
      }
      index -= 1
    }
  }

  /**
   * Iterate only selected event types over a validated logical range.
   * @param types - event types to include; duplicates have no effect.
   * @param from - inclusive sequence.
   * @param to - exclusive sequence.
   * @returns matching immutable events in sequence order.
   */
  *valuesOf<T extends SessionEventType>(
    types: readonly T[],
    from = 0,
    to = this.logicalLength,
  ): Generator<SessionEvent<T>> {
    const lists = this.typeCursors(types, from, 'forward')

    for (;;) {
      let selected: { spans: readonly TypeSpan[]; index: number } | undefined
      let selectedFrom = Number.POSITIVE_INFINITY
      for (const cursor of lists) {
        const span = cursor.spans[cursor.index]
        if (span === undefined) continue
        const candidate = Math.max(from, span.from)
        if (candidate < selectedFrom) {
          selected = cursor
          selectedFrom = candidate
        }
      }
      if (selected === undefined || selectedFrom >= to) return
      const span = selected.spans[selected.index] as TypeSpan
      const selectedTo = Math.min(span.to, to)
      for (const event of this.values(selectedFrom, selectedTo)) {
        yield event as SessionEvent<T>
      }
      selected.index += 1
    }
  }

  /**
   * Iterate only selected event types over a validated logical range in
   * descending sequence order.
   * @param types - event types to include; duplicates have no effect.
   * @param from - inclusive lower sequence.
   * @param to - exclusive upper sequence.
   * @returns matching immutable events in reverse sequence order.
   */
  *reverseValuesOf<T extends SessionEventType>(
    types: readonly T[],
    from = 0,
    to = this.logicalLength,
  ): Generator<SessionEvent<T>> {
    const lists = this.typeCursors(types, to, 'reverse')

    for (;;) {
      let selected: { spans: readonly TypeSpan[]; index: number } | undefined
      let selectedTo = Number.NEGATIVE_INFINITY
      for (const cursor of lists) {
        const span = cursor.spans[cursor.index]
        if (span === undefined) continue
        const candidate = Math.min(to, span.to)
        if (candidate > selectedTo) {
          selected = cursor
          selectedTo = candidate
        }
      }
      if (selected === undefined || selectedTo <= from) return
      const span = selected.spans[selected.index] as TypeSpan
      const selectedFrom = Math.max(from, span.from)
      for (const event of this.reverseValues(selectedFrom, selectedTo)) {
        yield event as SessionEvent<T>
      }
      selected.index -= 1
    }
  }

  /**
   * Iterate contiguous assistant-chunk ranges without decoding packed members.
   * Adjacent records with the same turn and step form one semantic run even
   * when their chunk payload kinds or storage rows differ.
   * @param from - inclusive sequence.
   * @param to - exclusive sequence.
   * @returns chunk ranges in ascending sequence order.
   */
  *chunkRuns(from: number, to: number): Generator<Readonly<PackedChunkRun>> {
    if (from === to) return
    let pending: PackedChunkRun | undefined
    const flush = function* (): Generator<Readonly<PackedChunkRun>> {
      if (pending !== undefined) {
        yield Object.freeze(pending)
        pending = undefined
      }
    }
    let index = this.recordIndexAt(from)
    while (index < this.records.length) {
      const record = this.records[index] as StorageRecord
      const start = storageRecordStart(record)
      if (start >= to) break
      const end = start + storageRecordLength(record)
      const selectedFrom = Math.max(from, start)
      const selectedTo = Math.min(to, end)
      const chunk = isChunkRow(record)
        ? record.data
        : record.type === 'assistant/chunk'
          ? record.data
          : undefined
      if (chunk === undefined) {
        yield* flush()
      } else if (pending !== undefined
        && pending.to === selectedFrom
        && pending.turn === chunk.turn
        && pending.step === chunk.step) {
        pending.to = selectedTo
      } else {
        yield* flush()
        pending = { from: selectedFrom, to: selectedTo, turn: chunk.turn, step: chunk.step }
      }
      index += 1
    }
    yield* flush()
  }

  /** Record one event in the compact per-type contiguous-span index. */
  private index(event: SessionEvent): void {
    this.indexSpan(event.type, event.seq, event.seq + 1)
  }

  /** Record one contiguous type range in the compact index. */
  private indexSpan(type: SessionEventType, from: number, to: number): void {
    let spans = this.spansByType.get(type)
    if (spans === undefined) {
      spans = []
      this.spansByType.set(type, spans)
    }
    const tail = spans.at(-1)
    if (tail?.to === from) tail.to = to
    else spans.push({ from, to })
  }

  /**
   * Build one merge cursor per requested type, seeding each type's span index
   * at the first span after the boundary when ascending and at the last span
   * before it when descending.
   * @param types - event types to include; duplicates have no effect.
   * @param boundary - exclusive upper seq when ascending, inclusive upper seq when descending.
   * @param direction - iteration direction the cursors feed.
   * @returns a seeded cursor per requested type that has indexed spans.
   */
  private typeCursors(
    types: readonly SessionEventType[],
    boundary: number,
    direction: 'forward' | 'reverse',
  ): Array<{ spans: readonly TypeSpan[]; index: number }> {
    const lists: Array<{ spans: readonly TypeSpan[]; index: number }> = []
    const seen = new Set<SessionEventType>()
    for (const type of types) {
      if (seen.has(type)) continue
      seen.add(type)
      const spans = this.spansByType.get(type)
      if (spans === undefined) continue
      lists.push({
        spans,
        index: direction === 'forward' ? firstSpanAfter(spans, boundary) : lastSpanBefore(spans, boundary),
      })
    }
    return lists
  }

  /** Locate the record whose logical range contains `seq`. */
  private recordIndexAt(seq: number): number {
    let low = 0
    let high = this.records.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (storageRecordStart(this.records[middle] as StorageRecord) <= seq) low = middle + 1
      else high = middle
    }
    return low - 1
  }
}
