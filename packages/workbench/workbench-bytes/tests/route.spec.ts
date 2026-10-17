/**
 * The workbench byte route driven one request at a time: the status matrix
 * (200/206/400/403/404/416), HEAD, the range matrix, and the streaming body
 * read from the resolved target's process path.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WORKBENCH_FILE_PATH } from '@deepseek-ai/dsh-workbench'
import { afterEach, describe, expect, it } from 'vitest'
import { serveWorkbenchFile } from '../src/index.ts'

const SESSION = SessionId('session-bytes-test')
const OUTSIDE = SessionId('session-outside-test')
const BODY = 'hello workbench bytes\n'

let root: string | undefined
let outside: string | undefined
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const directory of [root, outside]) {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  }
  root = undefined
  outside = undefined
})

/**
 * Build the two services the route reads: a real local filesystem rooted at a
 * temp workspace, and a session store answering one in-workspace session and
 * one session rooted elsewhere.
 * @returns the route's context.
 */
async function bench(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-workbench-bytes-'))
  await mkdir(join(root, 'media'))
  await writeFile(join(root, 'media', 'note.txt'), BODY)
  outside = await mkdtemp(join(tmpdir(), 'dsh-workbench-outside-'))
  const workspaces = { inWorkspace: root, elsewhere: outside }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  ctx.provide('sessions', {
    get: (id: SessionId) => {
      if (id === SESSION) return { header: { cwd: workspaces.inWorkspace } }
      if (id === OUTSIDE) return { header: { cwd: workspaces.elsewhere } }
      return undefined
    },
  } as never)
  return ctx
}

/**
 * Call the route as the carrier would.
 * @param ctx - the route's context.
 * @param query - the request's query string, after `?`.
 * @param init - method and headers.
 * @returns the route's response.
 */
async function call(ctx: Context, query: string, init: RequestInit = {}): Promise<Response> {
  return serveWorkbenchFile(ctx, new Request(`http://host${WORKBENCH_FILE_PATH}?${query}`, init))
}

describe('workbench byte route', () => {
  it('serves the whole file with a length and an accepted range', async () => {
    const ctx = await bench()
    const res = await call(ctx, `sessionId=${SESSION}&path=media/note.txt`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('content-length')).toBe(String(BODY.length))
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(await res.text()).toBe(BODY)
  })

  it('answers HEAD with the same headers and no body', async () => {
    const ctx = await bench()
    const res = await call(ctx, `sessionId=${SESSION}&path=media/note.txt`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe(String(BODY.length))
    expect(await res.text()).toBe('')
  })

  it('serves a closed range as 206 with the selected bytes', async () => {
    const ctx = await bench()
    const res = await call(ctx, `sessionId=${SESSION}&path=media/note.txt`, { headers: { range: 'bytes=0-4' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 0-4/${String(BODY.length)}`)
    expect(res.headers.get('content-length')).toBe('5')
    expect(await res.text()).toBe('hello')
  })

  it('serves an open-ended range to the last byte', async () => {
    const ctx = await bench()
    const res = await call(ctx, `sessionId=${SESSION}&path=media/note.txt`, { headers: { range: 'bytes=6-' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 6-${String(BODY.length - 1)}/${String(BODY.length)}`)
    expect(await res.text()).toBe(BODY.slice(6))
  })

  it('serves a suffix range from the end of the file', async () => {
    const ctx = await bench()
    const res = await call(ctx, `sessionId=${SESSION}&path=media/note.txt`, { headers: { range: 'bytes=-5' } })
    expect(res.status).toBe(206)
    expect(await res.text()).toBe(BODY.slice(-5))
  })

  it('ignores a malformed range and serves the whole file', async () => {
    const ctx = await bench()
    const res = await call(ctx, `sessionId=${SESSION}&path=media/note.txt`, { headers: { range: 'items=0-4' } })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(BODY)
  })

  it('answers an unsatisfiable range with 416 and the representation size', async () => {
    const ctx = await bench()
    const res = await call(ctx, `sessionId=${SESSION}&path=media/note.txt`, {
      headers: { range: `bytes=${String(BODY.length)}-` },
    })
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe(`bytes */${String(BODY.length)}`)
  })

  it('refuses a path outside the session workspace', async () => {
    const ctx = await bench()
    expect((await call(ctx, `sessionId=${SESSION}&path=../escape.txt`)).status).toBe(403)
  })

  it('refuses another workspace\'s file named by absolute path', async () => {
    const ctx = await bench()
    const foreign = join(root ?? '', 'media', 'note.txt')
    expect((await call(ctx, `sessionId=${OUTSIDE}&path=${encodeURIComponent(foreign)}`)).status).toBe(403)
  })

  it('refuses a session the store does not know', async () => {
    const ctx = await bench()
    expect((await call(ctx, 'sessionId=session-unknown&path=media/note.txt')).status).toBe(403)
  })

  it('answers 404 for a missing file and for a directory', async () => {
    const ctx = await bench()
    expect((await call(ctx, `sessionId=${SESSION}&path=media/missing.txt`)).status).toBe(404)
    expect((await call(ctx, `sessionId=${SESSION}&path=media`)).status).toBe(404)
  })

  it('answers 400 when the session or the path is absent', async () => {
    const ctx = await bench()
    expect((await call(ctx, 'path=media/note.txt')).status).toBe(400)
    expect((await call(ctx, `sessionId=${SESSION}`)).status).toBe(400)
  })
})
