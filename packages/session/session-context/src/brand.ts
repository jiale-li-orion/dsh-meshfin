/** Opaque identities owned by the session-context capability. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of one current-surface unit. */
export type ContextUnitId = Branded<'ContextUnitId'>

/** Stable identity of one same-Session context rewrite. */
export type ContextRewriteId = Branded<'ContextRewriteId'>

/** Opaque continuation state for bounded checkpoint history reads and searches. */
export type ContextHistoryCursor = Branded<'ContextHistoryCursor'>

/**
 * Brand a string as a {@link ContextUnitId}.
 * @param id - stable unit identity produced by Session Context.
 * @returns the branded unit identity.
 */
export function ContextUnitId(id: string): ContextUnitId {
  return id as ContextUnitId
}

/**
 * Brand a string as a {@link ContextRewriteId}.
 * @param id - durable rewrite identity.
 * @returns the branded rewrite identity.
 */
export function ContextRewriteId(id: string): ContextRewriteId {
  return id as ContextRewriteId
}

/**
 * Brand an encoded continuation state as a {@link ContextHistoryCursor}.
 * @param value - opaque cursor encoded by Session Context.
 * @returns the branded continuation cursor.
 */
export function ContextHistoryCursor(value: string): ContextHistoryCursor {
  return value as ContextHistoryCursor
}
