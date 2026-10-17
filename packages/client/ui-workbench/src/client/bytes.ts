/**
 * The workbench byte route as the browser reaches it, plus the two pure readings
 * this package takes of one response: which element renders the file, and how a
 * refusal is described.
 *
 * The host owns the route (`WORKBENCH_FILE_PATH` in
 * `packages/workbench/workbench/src/protocol.ts`). A browser bundle cannot
 * import that module as a value, because the workbench package is a Host package
 * and not a module-table row, so the path is restated here in the
 * browser-relative form the page resolves; the `/api` prefix arrives from the
 * page itself.
 * @module @deepseek-ai/dsh-client-ui-workbench/client/bytes
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Browser-relative path of the route serving one workspace file's bytes. */
export const WORKBENCH_FILE_ROUTE = 'api/workbench/file'

/**
 * Same-origin URL of one workspace file's bytes for one Session.
 * @param sessionId - Session whose workspace fences the path.
 * @param path - workspace path of the file.
 * @returns the relative URL the browser resolves against the page.
 */
export function workbenchFileUrl(sessionId: SessionId, path: string): string {
  return `${WORKBENCH_FILE_ROUTE}?${new URLSearchParams({ sessionId, path }).toString()}`
}

/**
 * Last path segment of a workspace path.
 * @param path - file path, `/`-separated.
 * @returns the segment after the last separator, or the whole path when it has none.
 */
export function fileNameOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name === '' ? path : name
}

/** What the browser can render for a served media type. */
export type ContentFamily = 'image' | 'audio' | 'video' | 'pdf' | 'text' | 'other'

/**
 * Family of one served `Content-Type`, which decides the element that renders it.
 *
 * A missing header, or a type outside these families, is `other`: the route
 * serves everything it does not recognize as `application/octet-stream`, and an
 * unknown type is one no element here can show.
 * @param contentType - the `Content-Type` header value, parameters included.
 * @returns the family this package renders for that type.
 */
export function contentFamilyOf(contentType: string | null): ContentFamily {
  const mediaType = (contentType ?? '').replace(/;.*$/u, '').trim().toLowerCase()
  if (mediaType === 'application/pdf') return 'pdf'
  if (mediaType === 'application/json') return 'text'
  if (mediaType.startsWith('text/')) return 'text'
  if (mediaType.startsWith('image/')) return 'image'
  if (mediaType.startsWith('audio/')) return 'audio'
  if (mediaType.startsWith('video/')) return 'video'
  return 'other'
}

/** Why the bytes route refused one request. */
export type BytesFailure = 'forbidden' | 'not-found' | 'unavailable'

/**
 * The refusal a response status stands for.
 *
 * The route answers 403 when the path escapes the Session's workspace and 404
 * when nothing regular is there; a 206 is a successful range answer.
 * @param status - HTTP status of the response.
 * @returns the refusal, or null when the response carries bytes.
 */
export function bytesFailureOf(status: number): BytesFailure | null {
  if (status >= 200 && status < 300) return null
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  return 'unavailable'
}
