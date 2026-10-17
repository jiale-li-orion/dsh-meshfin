/**
 * The preview of one workspace file, rendered from what the byte route answers.
 *
 * The element follows the served media type: an image, an audio file, a video,
 * or a PDF is handed the route URL and streams on its own, text is decoded once
 * into a preformatted block, and a refusal or an unreachable service becomes a
 * line saying which one it was. Nothing here holds a workspace path of its own;
 * the body builds the URL.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { loadPreview } from './preview.ts'
import type { PreviewFailure, PreviewState } from './preview.ts'
import type { NS, WorkbenchKey } from './locales.ts'
import css from './WorkbenchBody.module.css'

/** Props of one preview: the route URL, the name it is labelled with, its lifetime, and copy. */
export interface FilePreviewProps {
  readonly url: string
  readonly name: string
  readonly signal: AbortSignal
  readonly t: TranslateNS<typeof NS>
}

/**
 * Render one workspace file.
 * @param props - the file's route URL and name, the tab's lifetime, and copy.
 * @returns the element its served media type calls for, or the state line.
 */
export function FilePreview({ url, name, signal, t }: FilePreviewProps): ReactNode {
  const [state, setState] = useState<PreviewState>({ kind: 'loading' })
  useEffect(() => {
    const read = new AbortController()
    const abort = (): void => { read.abort() }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) read.abort()
    // A read that settles after this selection was replaced writes nothing: its
    // controller is aborted, and no later render reads the state it would set.
    void loadPreview(url, read.signal).then(
      (next) => { if (!read.signal.aborted) setState(next) },
      () => { if (!read.signal.aborted) setState({ kind: 'failure', failure: 'unreachable' }) },
    )
    return () => {
      signal.removeEventListener('abort', abort)
      read.abort()
    }
  }, [url, signal])

  if (state.kind === 'loading') return <p className={css.notice}>{t('preview.loading')}</p>
  if (state.kind === 'unsupported') return <p className={css.notice}>{t('preview.unsupported')}</p>
  if (state.kind === 'failure') return <p className={css.failure}>{t(failureKeyOf(state.failure))}</p>
  const label = t('preview.media', { name })
  if (state.kind === 'text') return <pre className={css.text}>{state.text}</pre>
  if (state.family === 'image') return <img className={css.media} src={state.url} alt={label} />
  if (state.family === 'pdf') return <object className={css.media} data={state.url} type="application/pdf" aria-label={label} />
  if (state.family === 'audio') return <audio className={css.media} src={state.url} controls aria-label={label} />
  return <video className={css.media} src={state.url} controls aria-label={label} />
}

/**
 * The dictionary key one failure is reported under.
 * @param failure - why the bytes route or the transport refused.
 * @returns the key naming that reason.
 */
function failureKeyOf(failure: PreviewFailure): WorkbenchKey {
  if (failure === 'forbidden') return 'error.forbidden'
  if (failure === 'not-found') return 'error.notFound'
  if (failure === 'unavailable') return 'error.unavailable'
  return 'error.network'
}
