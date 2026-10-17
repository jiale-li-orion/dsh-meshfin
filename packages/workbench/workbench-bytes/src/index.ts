/**
 * The workbench byte route. A viewer reads a workspace file's bytes through one
 * authenticated `/api` route instead of a whole-file Remote call, so a video
 * seeks and a large image streams without holding the file in memory.
 *
 * The connection service owns authentication: a route registered through
 * `ctx.connection.fetch.register` is reachable only by an admitted client, so
 * this plugin adds only the workspace fence — the same `fenceSessionPath` the
 * workbench listing uses — before a byte leaves the process.
 * @module @deepseek-ai/dsh-workbench-bytes
 */

import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  contentTypeForPath,
  fenceSessionPath,
  WORKBENCH_FILE_PATH,
  WorkbenchFenceError,
} from '@deepseek-ai/dsh-workbench'
import { parseRange } from './range.ts'

export const name = 'workbench-bytes'

/** Required services: the authenticated fetch carrier, the filesystem, and sessions. */
export const inject = ['connection', 'fs', 'sessions']

/** Answer one refusal with a plain-text status and no body. */
function refuse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** Stream `[start, end]` of a process path as a response body, or the whole file. */
function bodyOf(path: string, bounds: { start: number; end: number } | undefined): ReadableStream<Uint8Array> {
  const stream = bounds === undefined ? createReadStream(path) : createReadStream(path, bounds)
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>
}

/**
 * Serve one byte request for a file inside a session's workspace.
 *
 * Exported for the route test, which drives it with a synthetic `Request`;
 * production callers reach it through the registered route.
 * @param ctx - context carrying the services named by {@link inject}.
 * @param request - the admitted request.
 * @returns the whole file, the selected range, or a refusal.
 */
export async function serveWorkbenchFile(ctx: Context, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('sessionId')
  const requested = url.searchParams.get('path')
  if (sessionId === null || requested === null) return refuse(400, 'sessionId and path are required')
  let target
  try {
    ({ target } = await fenceSessionPath(ctx, SessionId(sessionId), requested))
  } catch (error) {
    if (error instanceof WorkbenchFenceError) return refuse(403, error.message)
    throw error
  }
  const info = await ctx.fs.stat(target)
  if (info === undefined || info.type !== 'file') return refuse(404, 'not a file')
  const processPath = ctx.fs.processPath(target)
  const contentType = contentTypeForPath(target.displayPath)
  const size = info.size
  const method = request.method.toUpperCase()
  if (size === undefined) {
    // Without a size there is no range arithmetic and no content length, so the
    // answer is a plain chunked 200.
    return new Response(method === 'HEAD' ? null : bodyOf(processPath, undefined), {
      status: 200,
      headers: { 'content-type': contentType, 'cache-control': 'no-store' },
    })
  }
  const selection = parseRange(request.headers.get('range') ?? undefined, size)
  if (selection.kind === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: {
        'content-type': contentType,
        'cache-control': 'no-store',
        'content-range': `bytes */${String(size)}`,
      },
    })
  }
  const bounds = selection.kind === 'partial' ? { start: selection.start, end: selection.end } : undefined
  const length = bounds === undefined ? size : bounds.end - bounds.start + 1
  const headers: Record<string, string> = {
    'content-type': contentType,
    'cache-control': 'no-store',
    'accept-ranges': 'bytes',
    'content-length': String(length),
    ...bounds === undefined
      ? {}
      : { 'content-range': `bytes ${String(bounds.start)}-${String(bounds.end)}/${String(size)}` },
  }
  const status = bounds === undefined ? 200 : 206
  if (method === 'HEAD') return new Response(null, { status, headers })
  return new Response(bodyOf(processPath, bounds), { status, headers })
}

/**
 * Register the workbench's byte route on the authenticated fetch carrier.
 * @param ctx - Cordis context carrying the connection, filesystem, and sessions services.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.connection.fetch.register({
      path: WORKBENCH_FILE_PATH,
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: request => serveWorkbenchFile(ctx, request),
    }),
    'workbench-bytes: file route',
  )
}
