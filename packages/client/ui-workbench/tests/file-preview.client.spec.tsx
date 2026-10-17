// @vitest-environment jsdom
/**
 * What one preview shows for each served media type, and the failure line a
 * refusal produces. The route answers a `HEAD` first, so the family is read from
 * the response rather than guessed from the path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { FilePreview } from '../src/client/FilePreview.tsx'
import type { FilePreviewProps } from '../src/client/FilePreview.tsx'
import { en } from '../src/client/locales.ts'
import type { NS } from '../src/client/locales.ts'

/** The shipped English copy, standing in for the locale plugin's `t`. */
const translations = new Map(Object.entries(en))

const t: TranslateNS<typeof NS> = (key, params) => {
  const value = translations.get(key) ?? key
  return params === undefined ? value : Object.entries(params)
    .reduce((text, [name, replacement]) => text.replace(`{${name}}`, String(replacement)), value)
}

/**
 * Script the fetch the preview performs.
 * @param respond - one answer per call, receiving the method.
 * @returns the spy.
 */
function stubFetch(respond: (method: string) => Response) {
  const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => respond(init?.method ?? 'GET'))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/**
 * A response carrying a media type, with an optional body.
 * @param contentType - the `Content-Type` the route would serve.
 * @param body - response body; omitted for a bodyless answer.
 * @returns the response the stub answers with.
 */
function served(contentType: string, body?: string): Response {
  return new Response(body ?? null, { status: 200, headers: { 'content-type': contentType } })
}

/**
 * Props for one preview of `name`.
 * @param name - the file name shown in the label.
 * @param sessionId - Session the URL was built for.
 * @returns the component props.
 */
function props(name: string, sessionId = SessionId('session-1')): FilePreviewProps {
  return {
    url: `api/workbench/file?sessionId=${sessionId}&path=${encodeURIComponent(`/w/${name}`)}`,
    name,
    signal: new AbortController().signal,
    t,
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('FilePreview', () => {
  it('renders an image from the route URL', async () => {
    stubFetch(() => served('image/png'))
    render(<FilePreview {...props('photo.png')} />)
    const image = await screen.findByRole('img')
    expect(image.getAttribute('src')).toBe(props('photo.png').url)
    expect(image.getAttribute('alt')).toBe('Preview of photo.png')
  })

  it('renders decoded text in a preformatted block', async () => {
    stubFetch(() => served('text/plain; charset=utf-8', 'one\ntwo'))
    const { container } = render(<FilePreview {...props('notes.md')} />)
    await waitFor(() => { expect(container.querySelector('pre')?.textContent).toBe('one\ntwo') })
  })

  it('renders a PDF through an object element', async () => {
    stubFetch(() => served('application/pdf'))
    const { container } = render(<FilePreview {...props('doc.pdf')} />)
    await waitFor(() => { expect(container.querySelector('object')?.getAttribute('data')).toBe(props('doc.pdf').url) })
    expect(container.querySelector('object')?.getAttribute('aria-label')).toBe('Preview of doc.pdf')
  })

  it('renders audio and video with their own elements', async () => {
    stubFetch(() => served('audio/ogg'))
    const audio = render(<FilePreview {...props('clip.ogg')} />)
    await waitFor(() => { expect(audio.container.querySelector('audio')).not.toBeNull() })
    cleanup()
    stubFetch(() => served('video/mp4'))
    const video = render(<FilePreview {...props('clip.mp4')} />)
    await waitFor(() => { expect(video.container.querySelector('video')).not.toBeNull() })
  })

  it('names the refusal a 403 stands for', async () => {
    stubFetch(() => new Response(null, { status: 403 }))
    render(<FilePreview {...props('outside.txt')} />)
    expect(await screen.findByText(en['error.forbidden'])).toBeDefined()
  })

  it('names the refusal a 404 stands for', async () => {
    stubFetch(() => new Response(null, { status: 404 }))
    render(<FilePreview {...props('gone.txt')} />)
    expect(await screen.findByText(en['error.notFound'])).toBeDefined()
  })

  it('says so when the media type has no viewer here', async () => {
    stubFetch(() => served('application/octet-stream'))
    render(<FilePreview {...props('archive.zip')} />)
    expect(await screen.findByText(en['preview.unsupported'])).toBeDefined()
  })

  it('reports an unreachable service instead of staying on the loading line', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    render(<FilePreview {...props('notes.md')} />)
    expect(await screen.findByText(en['error.network'])).toBeDefined()
  })
})
