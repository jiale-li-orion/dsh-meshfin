import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity shared by one compact start/summary/checkpoint/end transaction. */
export type CompactionId = Branded<'CompactionId'>

/** Stable identity of one durable range-summary preparation. */
export type CompactionPreparationId = Branded<'CompactionPreparationId'>

/**
 * Brand an implementation-minted compaction identity.
 * @param id - opaque transaction identity.
 * @returns the same string, branded; no validation is performed.
 */
export function CompactionId(id: string): CompactionId {
  return id as CompactionId
}

/**
 * Brand an implementation-minted preparation identity.
 * @param id - opaque preparation identity.
 * @returns the same string, branded; no validation is performed.
 */
export function CompactionPreparationId(id: string): CompactionPreparationId {
  return id as CompactionPreparationId
}
