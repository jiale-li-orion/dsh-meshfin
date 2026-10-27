/** Explicit local-coordinate remapping; captured generations and owner-local counters remain opaque. */

import { createHash } from 'node:crypto'

import { SessionFormatError, sessionFormatCount } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatJsonObject, SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'
import { record } from './payload.ts'

/**
 * Remap only audited same-artifact references, preserving IDs and embedded model input.
 * @param event - validated source event.
 * @param seq - output event position.
 * @param mapping - earlier source positions mapped to output positions.
 * @returns the event in target coordinates.
 */
export function remapEvent(event: SessionFormatEvent, seq: number, mapping: readonly number[]): SessionFormatEvent {
  const one = (value: SessionFormatJsonValue | undefined): number => {
    const source = sessionFormatCount(value, 'source event reference')
    const target = mapping[source]
    if (source >= event.seq || target === undefined) throw new SessionFormatError('reference must name an earlier source event')
    return target
  }
  const list = (value: SessionFormatJsonValue | undefined): number[] => {
    if (!Array.isArray(value)) throw new SessionFormatError('sequence references must be an array')
    return value.map(one)
  }
  const range = (value: SessionFormatJsonValue | undefined): SessionFormatJsonObject => {
    const source = record(value, 'sequence range')
    return { ...source, start: one(source['start']), end: one(source['end']) }
  }
  let data = record(event.data, event.type)
  switch (event.type) {
    case 'agent/context-run/requested':
      data = { ...data, generationSeq: one(data['generationSeq']) }
      break
    case 'compaction/preparation/requested': {
      const shadowedSeqs = list(data['shadowedSeqs'])
      data = { ...data, start: one(data['start']), end: one(data['end']), shadowedSeqs,
        shadowedDigest: createHash('sha256').update(shadowedSeqs.join(',')).digest('base64url') }
      break
    }
    case 'compaction/preparation/planned':
    case 'compaction/preparation/ready':
      data = { ...data, chunks: (data['chunks'] as SessionFormatJsonObject[]).map(chunk => ({
        ...chunk, startSeq: one(chunk['startSeq']), endSeq: one(chunk['endSeq']),
      })) }
      break
    case 'context/rewrite':
      data = { ...data, replacementSeq: one(data['replacementSeq']), shadowedRange: range(data['shadowedRange']), shadowedSeqs: list(data['shadowedSeqs']) }
      break
    case 'command/done':
      if (data['sourceEventSeq'] !== undefined) data = { ...data, sourceEventSeq: one(data['sourceEventSeq']) }
      break
    case 'compaction/summary':
    case 'compaction/prune':
      data = { ...data, shadowedRange: range(data['shadowedRange']), shadowedSeqs: list(data['shadowedSeqs']) }
      break
    case 'session/title':
    case 'session/title-llm-request':
      data = { ...data, messageSeqs: list(data['messageSeqs']) }
      break
    // Delivery watermarks and session-reference captures identify their original generation.
    // Workflow seq, stream block indices, turn/step, and numeric tool JSON are not Session seqs.
  }
  return {
    ...event, seq, data,
    ...(event['sourceEventSeqs'] === undefined ? {} : { sourceEventSeqs: list(event['sourceEventSeqs']) }),
    ...(event['surfaceOp'] === undefined || event['surfaceOp'] === 'append'
      ? {} : { surfaceOp: range(event['surfaceOp']) }),
  }
}
