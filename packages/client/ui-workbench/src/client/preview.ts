/**
 * One read of the workbench byte route, and what the bytes turned out to be.
 *
 * The family is read from the response rather than guessed from the path, so the
 * element that renders a file is the one its served media type calls for. A
 * `HEAD` answer classifies the file first: an image, a video, or a PDF is then
 * handed to its element as a URL and streams on its own, while text — the one
 * family that has to be decoded here — is fetched once. A refusal becomes the
 * failure the tab shows instead of content.
 * @module @deepseek-ai/dsh-client-ui-workbench/client/preview
 */
import { bytesFailureOf, contentFamilyOf } from './bytes.ts'
import type { BytesFailure } from './bytes.ts'

/** Why a preview shows no content: the route refused it, or it never answered. */
export type PreviewFailure = BytesFailure | 'unreachable'

/** What one preview shows: a streamed element, decoded text, or the reason there is neither. */
export type PreviewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'media'; readonly family: 'image' | 'audio' | 'video' | 'pdf'; readonly url: string }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'failure'; readonly failure: PreviewFailure }

/**
 * Classify one file through the byte route, then load what the browser cannot
 * load by itself.
 * @param url - same-origin URL of the file's bytes.
 * @param signal - aborts the read when the tab or the selection is replaced.
 * @returns the state the tab renders for this read.
 * @throws when the transport itself fails; the caller reports that as `unreachable`.
 */
export async function loadPreview(url: string, signal: AbortSignal): Promise<PreviewState> {
  const head = await fetch(url, { method: 'HEAD', signal })
  const refusal = bytesFailureOf(head.status)
  if (refusal !== null) return { kind: 'failure', failure: refusal }
  const family = contentFamilyOf(head.headers.get('content-type'))
  if (family === 'other') return { kind: 'unsupported' }
  if (family === 'text') {
    const response = await fetch(url, { signal })
    const textRefusal = bytesFailureOf(response.status)
    if (textRefusal !== null) return { kind: 'failure', failure: textRefusal }
    return { kind: 'text', text: await response.text() }
  }
  return { kind: 'media', family, url }
}
