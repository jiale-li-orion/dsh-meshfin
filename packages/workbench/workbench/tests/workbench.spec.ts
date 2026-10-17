/**
 * Real-composition account of the shared workbench service: the plugin mounts
 * through the real Loader plugin protocol beside the local filesystem backend
 * and a session record, commits emit the view they stored, and the workspace
 * fence the byte routes share resolves every path the panel may address.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { SessionId } from '@deepseek-ai/dsh-session'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import WorkbenchService, { fenceSessionPath, WorkbenchFenceError } from '../src/index.ts'
import { contentTypeForPath, DEFAULT_CONTENT_TYPE } from '../src/content-type.ts'
import type { WorkbenchView } from '../src/types.ts'

const SESSION = SessionId('session-workbench-test')
const OTHER_SESSION = SessionId('session-workbench-other')

let root: string | undefined
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot the service over a real temp workspace and one session record.
 * @returns the context and the mounted workbench service.
 */
async function harness() {
  root = await mkdtemp(join(tmpdir(), 'dsh-workbench-'))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'README.md'), 'hello\n')
  await writeFile(join(root, 'src', 'index.ts'), 'export {}\n')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  ctx.provide('sessions', {
    get: (id: SessionId) => (id === SESSION ? { header: { cwd: root } } : undefined),
  } as never)
  await ctx.plugin(RemoteAccessService)
  await ctx.plugin(WorkbenchService)
  return { ctx, workbench: ctx.get('workbench') as WorkbenchService }
}

describe('WorkbenchService', () => {
  it('publishes the shared view methods under the workbench namespace', async () => {
    const { workbench } = await harness()
    expect(workbench.typertRemote).toMatchObject({ serviceKey: 'workbench', namespace: 'workbench' })
    expect(remoteMethods(workbench).map(entry => entry.method).sort())
      .toEqual(['close', 'open', 'select', 'state', 'toggle'])
  })

  it('starts closed with no selection and emits the committed view on every commit', async () => {
    const { ctx, workbench } = await harness()
    expect(workbench.state()).toEqual({ open: false, active: null })

    const seen: WorkbenchView[] = []
    ctx.on('workbench/changed', (view) => { seen.push(view) })

    expect(workbench.open('files')).toEqual({ open: true, active: 'files' })
    expect(workbench.close()).toEqual({ open: false, active: 'files' })
    expect(workbench.open(null)).toEqual({ open: true, active: 'files' })
    expect(workbench.select('git')).toEqual({ open: true, active: 'git' })
    expect(workbench.toggle()).toEqual({ open: false, active: 'git' })
    expect(workbench.toggle()).toEqual({ open: true, active: 'git' })

    expect(seen).toEqual([
      { open: true, active: 'files' },
      { open: false, active: 'files' },
      { open: true, active: 'files' },
      { open: true, active: 'git' },
      { open: false, active: 'git' },
      { open: true, active: 'git' },
    ])
    // The emitted payloads are detached copies: a later commit cannot rewrite
    // what a consumer already received.
    expect(seen[0]).not.toBe(seen[1])
  })

  it('fences the workspace root and one nested directory to the session working directory', async () => {
    const { ctx } = await harness()
    const top = await fenceSessionPath(ctx, SESSION, null)
    expect(top.root.displayPath).toBe(root)
    expect(top.target.displayPath).toBe(root)

    const absolute = await fenceSessionPath(ctx, SESSION, join(root!, 'src'))
    expect(absolute.root.displayPath).toBe(root)
    expect(absolute.target.displayPath).toBe(join(root!, 'src'))
  })

  it('resolves a relative path against the session workspace root', async () => {
    const { ctx } = await harness()
    const nested = await fenceSessionPath(ctx, SESSION, 'src')
    expect(nested.target.displayPath).toBe(join(root!, 'src'))
  })

  it('types a file by extension and falls back to a download type', () => {
    expect(contentTypeForPath('/w/a.png')).toBe('image/png')
    expect(contentTypeForPath('/w/a.JPG')).toBe('image/jpeg')
    expect(contentTypeForPath('/w/a.svg')).toBe('image/svg+xml')
    expect(contentTypeForPath('/w/a.mp3')).toBe('audio/mpeg')
    expect(contentTypeForPath('/w/a.m4a')).toBe('audio/mp4')
    expect(contentTypeForPath('/w/a.mp4')).toBe('video/mp4')
    expect(contentTypeForPath('/w/a.webm')).toBe('video/webm')
    expect(contentTypeForPath('/w/a.pdf')).toBe('application/pdf')
    expect(contentTypeForPath('/w/a.md')).toBe('text/plain; charset=utf-8')
    expect(contentTypeForPath('/w/archive.tar.gz')).toBe(DEFAULT_CONTENT_TYPE)
    expect(contentTypeForPath('/w/Makefile')).toBe(DEFAULT_CONTENT_TYPE)
    expect(contentTypeForPath('/w/trailing.')).toBe(DEFAULT_CONTENT_TYPE)
  })

  it('refuses a path when the session records no working directory', async () => {
    const { ctx } = await harness()
    await expect(fenceSessionPath(ctx, OTHER_SESSION, null))
      .rejects.toThrow(/records no working directory/)
  })

  it('refuses a path outside the session workspace', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'dsh-workbench-outside-'))
    try {
      const { ctx } = await harness()
      await expect(fenceSessionPath(ctx, SESSION, outside)).rejects.toBeInstanceOf(WorkbenchFenceError)
      await expect(fenceSessionPath(ctx, SESSION, outside)).rejects.toThrow(/outside the session workspace/)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})
