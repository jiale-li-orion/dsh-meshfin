/**
 * One read of the byte route from the browser side: the served media type
 * decides what is loaded, and a refusal becomes a state instead of content.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPreview } from '../src/client/preview.ts'

/** The URL every case reads; the route itself is built by the body. */
const URL = 'api/workbench/file?sessionId=s&path=%2Fw%2Ffile'

/**
 * Script the fetch the module under test performs.
 * @param respond - one answer per call, receiving the method and URL.
 * @returns the spy, so a case can assert what was requested and how often.
 */
function stubFetch(respond: (method: string, url: string) => Response) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => respond(init?.method ?? 'GET', input))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/**
 * A response carrying a media type and no body.
 * @param contentType - the `Content-Type` the route would serve.
 * @returns the response the stub answers with.
 */
function served(contentType: string): Response {
  return new Response(null, { status: 200, headers: { 'content-type': contentType } })
}

/**
 * A one-shot abort signal, as the tab body passes it.
 * @returns the signal.
 */
function lifetime(): AbortSignal {
  return new AbortController().signal
}

afterEach(() => { vi.unstubAllGlobals() })

describe('loadPreview', () => {
  it('classifies through HEAD and leaves a media file to its element', async () => {
    const fetchMock = stubFetch(() => served('image/png'))
    await expect(loadPreview(URL, lifetime())).resolves.toEqual({ kind: 'media', family: 'image', url: URL })
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(URL, { method: 'HEAD', signal: expect.any(AbortSignal) })
  })

  it('routes each remaining family the route serves', async () => {
    for (const [contentType, family] of [
      ['video/mp4', 'video'],
      ['audio/ogg', 'audio'],
      ['application/pdf', 'pdf'],
    ] as const) {
      stubFetch(() => served(contentType))
      await expect(loadPreview(URL, lifetime())).resolves.toEqual({ kind: 'media', family, url: URL })
    }
  })

  it('decodes text in a second request', async () => {
    const fetchMock = stubFetch(() => new Response('first line\nsecond', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }))
    await expect(loadPreview(URL, lifetime())).resolves.toEqual({ kind: 'text', text: 'first line\nsecond' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats JSON as text, because no element renders it raw', async () => {
    stubFetch(() => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } }))
    await expect(loadPreview(URL, lifetime())).resolves.toEqual({ kind: 'text', text: '{"a":1}' })
  })

  it('reports an unknown media type without reading its bytes', async () => {
    const fetchMock = stubFetch(() => served('application/octet-stream'))
    await expect(loadPreview(URL, lifetime())).resolves.toEqual({ kind: 'unsupported' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('names the refusals the route answers with', async () => {
    for (const [status, failure] of [[403, 'forbidden'], [404, 'not-found'], [500, 'unavailable']] as const) {
      stubFetch(() => new Response(null, { status }))
      await expect(loadPreview(URL, lifetime())).resolves.toEqual({ kind: 'failure', failure })
    }
  })

  it('reports a refusal of the text request too', async () => {
    stubFetch(method => method === 'HEAD' ? served('text/plain; charset=utf-8') : new Response(null, { status: 403 }))
    await expect(loadPreview(URL, lifetime())).resolves.toEqual({ kind: 'failure', failure: 'forbidden' })
  })

  it('lets a transport failure reject, so the caller can name it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    await expect(loadPreview(URL, lifetime())).rejects.toThrow('network down')
  })
})
