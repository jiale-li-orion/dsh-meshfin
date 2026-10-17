/** Range parsing for the workbench byte route. */

import { describe, expect, it } from 'vitest'
import { parseRange } from '../src/range.ts'

describe('parseRange', () => {
  it('serves the whole representation when no range is requested', () => {
    expect(parseRange(undefined, 100)).toEqual({ kind: 'full' })
  })

  it('parses a closed, an open-ended, and a suffix range', () => {
    expect(parseRange('bytes=0-3', 100)).toEqual({ kind: 'partial', start: 0, end: 3 })
    expect(parseRange('bytes=10-', 100)).toEqual({ kind: 'partial', start: 10, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ kind: 'partial', start: 90, end: 99 })
  })

  it('clamps an end past the representation and a suffix longer than it', () => {
    expect(parseRange('bytes=0-9999', 100)).toEqual({ kind: 'partial', start: 0, end: 99 })
    expect(parseRange('bytes=-9999', 100)).toEqual({ kind: 'partial', start: 0, end: 99 })
  })

  it('reports a well-formed range that selects nothing as unsatisfiable', () => {
    expect(parseRange('bytes=100-', 100)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=-0', 100)).toEqual({ kind: 'unsatisfiable' })
    // A zero-length representation has no satisfiable byte range.
    expect(parseRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' })
  })

  it('ignores a malformed, unknown-unit, or multi-range header', () => {
    for (const header of ['bytes=abc', 'items=0-3', 'bytes=0-1,3-4', 'bytes=', 'bytes=-', 'bytes=5-2', 'bytes= 1-2-3']) {
      expect(parseRange(header, 100)).toEqual({ kind: 'full' })
    }
    // A reversed range selects nothing the client asked for; the whole body is
    // the only useful answer, and an empty 416 would be worse.
    expect(parseRange('bytes=5-2', 100)).toEqual({ kind: 'full' })
  })

  it('tolerates surrounding whitespace in the header value', () => {
    expect(parseRange('  bytes=0-3  ', 100)).toEqual({ kind: 'partial', start: 0, end: 3 })
  })
})
