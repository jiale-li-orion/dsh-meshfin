/**
 * The built-in file panel: a fenced listing of the current session's workspace.
 * Reads go through the host workbench service, which resolves every path with
 * the session's recorded working directory as the fence, so the panel shows
 * exactly the tree the agent operates in. Listing and error state are the
 * component's own (only it knows them); the session comes from the framework's
 * `useSessions` seat.
 */
import { useEffect, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchListing } from '@deepseek-ai/dsh-workbench/types'
import type { WorkbenchFileRef } from './contract/slots.ts'
import type { createFilePanelStore } from './file-panel-store.ts'
import { parentPath } from './listing.ts'
import type { NS } from './locales.ts'
import css from './FilePanel.module.css'
import { formatSize } from './format-size'

/** Media type used when a file entry carried none; nothing renders it. */
const UNKNOWN_MEDIA_TYPE = 'application/octet-stream'

/** Registrant-private injected share: the fenced listing reader and the preview request. */
export interface FilePanelInjected {
  /**
   * List one directory inside the session workspace.
   * @param sessionId - session whose cwd fences the listing.
   * @param path - directory to list; null lists the workspace root.
   * @returns the fenced listing.
   */
  list: (sessionId: SessionId, path: string | null) => Promise<WorkbenchListing>
  /**
   * Ask the shell to show one file in the viewer chain.
   * @param file - the selected entry, including the byte URL for its content.
   */
  preview: (file: WorkbenchFileRef) => void
}

/** Full composed props for the file panel. */
export type FilePanelProps =
  & PropsRuntime<'workbench.panel'>
  & InjectFace<FilePanelInjected>
  & PropsStore<ReturnType<typeof createFilePanelStore>>
  & PropsLocale<typeof NS>

/**
 * Render the file panel.
 * @param props - owner width, injected listing reader, and the locale seat.
 * @returns the current directory's entries, or the empty/error state.
 */
export function FilePanel({ useSessions, useStore, actions, list, preview, t }: FilePanelProps) {
  const sessionId = useSessions(state => state.current)
  const showHidden = useStore(state => state.showHidden)
  const [path, setPath] = useState<string | null>(null)
  const [listing, setListing] = useState<WorkbenchListing | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (sessionId === undefined) return
    let live = true
    setError(undefined)
    void list(sessionId, path).then(
      (next) => { if (live) setListing(next) },
      (cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : String(cause)) },
    )
    return () => { live = false }
  }, [list, path, sessionId])

  if (sessionId === undefined) return <div className={css.notice}>{t('files.empty')}</div>
  if (error !== undefined) return <div className={css.error}>{t('files.error', { message: error })}</div>
  if (listing === undefined) return <div className={css.notice} />

  const parent = parentPath(listing.path, listing.root)
  // The listing advertises the byte route, so this window never hardcodes a
  // host path: the URL is the same value the host registered.
  const fileUrl = (entryPath: string): string =>
    `${listing.fileRoute}?${new URLSearchParams({ sessionId, path: entryPath }).toString()}`
  const visible = listing.entries.filter(entry => showHidden || !entry.name.startsWith('.'))
  return (
    <div className={css.panel}>
      <div className={css.header}>
        <div className={css.path} title={listing.path}>{parent === null ? t('files.root') : listing.path}</div>
        <button
          type="button"
          className={css.hiddenToggle}
          aria-pressed={showHidden}
          data-active={showHidden || undefined}
          onClick={() => { actions.setShowHidden(!showHidden) }}
        >
          {t('files.showHidden')}
        </button>
      </div>
      <ul className={css.list}>
        {parent !== null && (
          <li>
            <button type="button" className={css.row} onClick={() => { setPath(parent) }}>
              <span className={css.icon}>↰</span>
              <span className={css.name}>{t('files.parent')}</span>
            </button>
          </li>
        )}
        {visible.map(entry => (
          <li key={entry.path}>
            <button
              type="button"
              className={css.row}
              disabled={entry.type === 'other'}
              onClick={() => {
                // `other` rows are disabled, so only files and directories
                // ever reach this handler.
                if (entry.type === 'directory') {
                  setPath(entry.path)
                  return
                }
                preview({
                  name: entry.name,
                  path: entry.path,
                  url: fileUrl(entry.path),
                  mediaType: entry.mediaType ?? UNKNOWN_MEDIA_TYPE,
                })
              }}
            >
              <span className={css.icon}>{entry.type === 'directory' ? '▸' : entry.type === 'file' ? '·' : '?'}</span>
              <span className={css.name}>{entry.name}</span>
              <span className={css.size}>{formatSize(entry.size)}</span>
            </button>
          </li>
        ))}
      </ul>
      {listing.entries.length === 0 && <div className={css.notice}>{t('files.empty')}</div>}
    </div>
  )
}
