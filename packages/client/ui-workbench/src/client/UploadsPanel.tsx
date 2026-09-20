/**
 * The uploads panel: the files people handed this session, grouped by the device
 * they came from. The grouping is not decoration — the route files each upload
 * under its sender, so the panel reads the same fact the model is told.
 *
 * An absent uploads directory is the ordinary empty case, not a failure: nothing
 * creates it until the first file arrives.
 */
import { useEffect, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchListing } from '@deepseek-ai/dsh-workbench/types'
import type { FilePanelInjected } from './FilePanel.tsx'
import type { NS } from './locales.ts'
import css from './UploadsPanel.module.css'
import { formatSize } from './format-size'

/** Directory uploads land in, relative to the session workspace. */
const UPLOADS_DIR = 'uploads'

/** Media type used when an entry carried none; nothing renders it. */
const UNKNOWN_MEDIA_TYPE = 'application/octet-stream'

/** Locale key for one device bucket. */
type BucketKey = 'uploads.mobileApp' | 'uploads.mobileBrowser' | 'uploads.desktopBrowser' | 'uploads.unknown'

/** Buckets the route writes, in the order the panel lists them. */
const BUCKETS: readonly { name: string; label: BucketKey }[] = [
  { name: 'mobile-app', label: 'uploads.mobileApp' },
  { name: 'mobile-browser', label: 'uploads.mobileBrowser' },
  { name: 'desktop-browser', label: 'uploads.desktopBrowser' },
  { name: 'unknown', label: 'uploads.unknown' },
]

/** One uploaded file as the panel shows it. */
interface UploadRow {
  /** Device bucket the file was filed under. */
  readonly bucket: BucketKey
  /** Entry path inside the workspace. */
  readonly path: string
  /** File name as it was uploaded. */
  readonly name: string
  /** Size in bytes when the listing reported one. */
  readonly size: number | undefined
  /** Media type from the listing. */
  readonly mediaType: string
}

/** Full composed props for the uploads panel. */
export type UploadsPanelProps =
  & PropsRuntime<'workbench.panel'>
  & InjectFace<FilePanelInjected>
  & PropsLocale<typeof NS>

/**
 * Read every upload of one session, grouped by the device that sent it.
 * @param list - the fenced listing reader.
 * @param sessionId - session whose workspace holds the uploads.
 * @returns the rows in bucket order, and the file route for their bytes.
 * @throws when the workspace cannot list the uploads directory at all.
 */
async function readUploads(
  list: FilePanelInjected['list'],
  sessionId: SessionId,
): Promise<{ rows: UploadRow[]; fileRoute: string; sessionId: SessionId }> {
  const root = await list(sessionId, UPLOADS_DIR)
  const rows: UploadRow[] = []
  const add = (bucket: BucketKey, listing: WorkbenchListing): void => {
    for (const entry of listing.entries) {
      if (entry.type !== 'file') continue
      rows.push({
        bucket,
        path: entry.path,
        name: entry.name,
        size: entry.size,
        mediaType: entry.mediaType ?? UNKNOWN_MEDIA_TYPE,
      })
    }
  }
  // A bucket that does not exist yet is the ordinary case, not a failed read:
  // reading one must not blank the files the other buckets hold.
  for (const bucket of BUCKETS) {
    try {
      add(bucket.label, await list(sessionId, `${UPLOADS_DIR}/${bucket.name}`))
    } catch {
      continue
    }
  }
  // Files sitting directly under uploads/ were received before the route filed
  // them by sender, so their source was never recorded — unknown, not invented.
  add('uploads.unknown', root)
  return { rows, fileRoute: root.fileRoute, sessionId }
}

/**
 * Render the uploads panel.
 * @param props - owner width, the listing reader and preview request, and copy.
 * @returns the grouped uploads, or the empty state.
 */
export function UploadsPanel({ useSessions, list, preview, t }: UploadsPanelProps) {
  const sessionId = useSessions(state => state.current)
  const [state, setState] = useState<
    { rows: readonly UploadRow[]; fileRoute: string; sessionId: SessionId } | undefined
  >(undefined)

  useEffect(() => {
    if (sessionId === undefined) {
      setState(undefined)
      return
    }
    // No liveness flag: React 18 dropped the unmounted-update warning, and a
    // read that settles after this panel unmounts setStates into nothing.
    void readUploads(list, sessionId)
      .then((read) => { setState(read) })
      // An absent uploads directory is how a session with no uploads looks.
      .catch(() => { setState({ rows: [], fileRoute: '', sessionId }) })
  }, [list, sessionId])

  // No session, or a read still in flight: nothing to claim yet.
  if (state === undefined) return <div className={css.panel} />
  if (state.rows.length === 0) {
    return (
      <div className={css.panel}>
        <div className={css.empty}>
          <img className={css.art} src='/uploads-empty.png' alt='' width={168} height={210} />
          <p className={css.emptyTitle}>{t('uploads.empty')}</p>
          <p className={css.emptyHint}>{t('uploads.emptyHint')}</p>
        </div>
      </div>
    )
  }
  // The route came from the read that listed these rows, so the URL names the
  // session that read them rather than whichever is current at render time.
  const fileUrl = (path: string): string =>
    `${state.fileRoute}?${new URLSearchParams({ sessionId: state.sessionId, path }).toString()}`
  return (
    <div className={css.panel}>
      <div className={css.header}>
        <div className={css.title}>{t('uploads.title')}</div>
        <div className={css.count}>{String(state.rows.length)}</div>
      </div>
      <ul className={css.list}>
        {state.rows.map(row => (
          <li key={row.path}>
            <button
              type='button'
              className={css.row}
              title={row.path}
              onClick={() => {
                preview({ name: row.name, path: row.path, url: fileUrl(row.path), mediaType: row.mediaType })
              }}
            >
              {row.mediaType.startsWith('image/')
                ? <img className={css.thumb} src={fileUrl(row.path)} alt='' loading='lazy' />
                : <span className={css.fileIcon}>▤</span>}
              <span className={css.name}>{row.name}</span>
              <span className={css.meta}>{formatSize(row.size)}</span>
              <span className={css.bucket} data-bucket={row.bucket}>{t(row.bucket)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
