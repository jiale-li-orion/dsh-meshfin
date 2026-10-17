/**
 * Stable helpers shared by durable compaction preparation producers and consumers.
 * @module @deepseek-ai/dsh-compaction/preparation
 */

import { createHash } from 'node:crypto'

/**
 * Digest one exact ordered surface membership list.
 * @param shadowedSeqs - current surface seqs in positional order.
 * @returns a stable base64url SHA-256 digest.
 */
export function compactionPreparationDigest(shadowedSeqs: readonly number[]): string {
  return createHash('sha256').update(shadowedSeqs.join(',')).digest('base64url')
}
