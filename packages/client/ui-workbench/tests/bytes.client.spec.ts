/**
 * Pure readings of the workbench byte route: the URL one file is fetched from,
 * the name it is labelled with, the family its served media type belongs to, and
 * the refusal a status stands for.
 */
import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { bytesFailureOf, contentFamilyOf, fileNameOf, workbenchFileUrl } from '../src/client/bytes.ts'

describe('workbenchFileUrl', () => {
  it('builds the browser-relative byte route for one Session and path', () => {
    expect(workbenchFileUrl(SessionId('session-1'), '/home/me/notes.md'))
      .toBe('api/workbench/file?sessionId=session-1&path=%2Fhome%2Fme%2Fnotes.md')
  })

  it('encodes a path so separators, spaces, and query punctuation survive decoding', () => {
    const url = workbenchFileUrl(SessionId('s'), '/w/a b?c#d.md')
    const query = new URLSearchParams(url.slice(url.indexOf('?') + 1))
    expect(query.get('path')).toBe('/w/a b?c#d.md')
    expect(query.get('sessionId')).toBe('s')
  })
})

describe('fileNameOf', () => {
  it('keeps the last segment', () => {
    expect(fileNameOf('/w/deep/notes.md')).toBe('notes.md')
  })

  it('returns a bare name unchanged', () => {
    expect(fileNameOf('notes.md')).toBe('notes.md')
  })

  it('returns the path itself when it has no segment after the last separator', () => {
    expect(fileNameOf('/w/deep/')).toBe('/w/deep/')
  })
})

describe('contentFamilyOf', () => {
  it('reads the media type without its parameters', () => {
    expect(contentFamilyOf('text/plain; charset=utf-8')).toBe('text')
    expect(contentFamilyOf(' AUDIO/OGG ')).toBe('audio')
  })

  it('routes every family the route serves', () => {
    expect(contentFamilyOf('image/png')).toBe('image')
    expect(contentFamilyOf('video/mp4')).toBe('video')
    expect(contentFamilyOf('application/pdf')).toBe('pdf')
    expect(contentFamilyOf('application/json; charset=utf-8')).toBe('text')
  })

  it('treats an unknown and an absent type as unrenderable', () => {
    expect(contentFamilyOf('application/octet-stream')).toBe('other')
    expect(contentFamilyOf('application/zip')).toBe('other')
    expect(contentFamilyOf(null)).toBe('other')
  })
})

describe('bytesFailureOf', () => {
  it('accepts a full and a ranged answer', () => {
    expect(bytesFailureOf(200)).toBeNull()
    expect(bytesFailureOf(206)).toBeNull()
  })

  it('names the route refusals and folds the rest into one', () => {
    expect(bytesFailureOf(403)).toBe('forbidden')
    expect(bytesFailureOf(404)).toBe('not-found')
    expect(bytesFailureOf(416)).toBe('unavailable')
    expect(bytesFailureOf(500)).toBe('unavailable')
  })
})
