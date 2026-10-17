/**
 * The workspace fence every workbench read passes: one session's recorded
 * working directory is the root, and nothing outside it is addressable. Both
 * the Remote listing the browser panel calls and the HTTP byte route that
 * feeds the viewer resolve through here, so a path a panel may list is exactly
 * a path a viewer may stream.
 * @module @deepseek-ai/dsh-workbench/fence
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Refusal raised when a request cannot be fenced to the session workspace. */
export class WorkbenchFenceError extends Error {
  /** Stable diagnostic code for a refused request. */
  readonly code = 'WORKBENCH_OUTSIDE_WORKSPACE'

  /**
   * @param message - why the request was refused, naming the offending path.
   */
  constructor(message: string) {
    super(message)
    this.name = 'WorkbenchFenceError'
  }
}

/** One fenced resolution: the workspace root and the requested target inside it. */
export interface FencedSessionPath {
  /** The session's recorded working directory, resolved through `fs`. */
  root: FsTarget
  /** The requested path; equal to `root` when `path` was null. */
  target: FsTarget
}

/**
 * Resolve one path inside a session's recorded working directory.
 * @param ctx - context carrying the `fs` and `sessions` services.
 * @param sessionId - session whose recorded working directory fences the path.
 * @param path - absolute or relative path; null resolves to the workspace root.
 * @returns the workspace root and the resolved target.
 * @throws WorkbenchFenceError when the session records no working directory or the path escapes it.
 */
export async function fenceSessionPath(
  ctx: Context,
  sessionId: SessionId,
  path: string | null,
): Promise<FencedSessionPath> {
  const rootPath = ctx.sessions.get(sessionId)?.header.cwd
  if (rootPath === undefined) {
    throw new WorkbenchFenceError(`session ${sessionId} records no working directory to fence the workbench to`)
  }
  const root = await ctx.fs.resolve(rootPath)
  const target = path === null ? root : await ctx.fs.resolve(path, { cwd: rootPath })
  if (!ctx.fs.contains(root, target)) {
    throw new WorkbenchFenceError(`"${target.displayPath}" is outside the session workspace "${root.displayPath}"`)
  }
  return { root, target }
}
