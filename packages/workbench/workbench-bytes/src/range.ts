/**
 * One HTTP `Range` request reduced to the bytes it may serve. Parsing is pure
 * so the whole range matrix (open-ended, suffix, unsatisfiable, malformed,
 * multi-range) is unit-testable without a socket.
 * @module @deepseek-ai/dsh-workbench-bytes/range
 */

/** What one `Range` header selects from a known-size representation. */
export type RangeSelection =
  /** Serve the whole representation with `200`. */
  | { readonly kind: 'full' }
  /** Serve `[start, end]` inclusive with `206`. */
  | { readonly kind: 'partial'; readonly start: number; readonly end: number }
  /** The header is well formed but selects nothing; answer `416`. */
  | { readonly kind: 'unsatisfiable' }

const BYTES_RANGE = /^bytes=(\d*)-(\d*)$/
const FULL: RangeSelection = { kind: 'full' }

/**
 * Parse one `Range` header against a known representation size.
 *
 * A malformed or unsupported header (unknown unit, multiple ranges, junk) is
 * ignored, which RFC 9110 allows and is the only safe reading: refusing a
 * request the client could retry without a range costs a round trip. A
 * well-formed range that selects nothing is `unsatisfiable` so the caller can
 * answer `416` with the representation size.
 * @param header - the raw `Range` header value, or undefined when absent.
 * @param size - representation size in bytes.
 * @returns the selection the caller may serve.
 */
export function parseRange(header: string | undefined, size: number): RangeSelection {
  if (header === undefined) return FULL
  const match = BYTES_RANGE.exec(header.trim())
  if (match === null) return FULL
  const [, rawStart = '', rawEnd = ''] = match
  if (rawStart === '' && rawEnd === '') return FULL
  // A zero-length representation has no satisfiable range, and a suffix of zero
  // bytes selects nothing.
  if (size === 0) return { kind: 'unsatisfiable' }
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (suffix === 0) return { kind: 'unsatisfiable' }
    return { kind: 'partial', start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(rawStart)
  if (start >= size) return { kind: 'unsatisfiable' }
  if (rawEnd === '') return { kind: 'partial', start, end: size - 1 }
  const end = Number(rawEnd)
  if (end < start) return FULL
  return { kind: 'partial', start, end: Math.min(end, size - 1) }
}
