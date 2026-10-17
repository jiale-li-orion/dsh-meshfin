/**
 * The workbench tab's body: the committed shared view, the gestures that commit
 * a new one, and the preview of one workspace file.
 *
 * The view arrives through the inject `hooks` compartment and leaves only through
 * the projection's Remote calls, so a control press here and an agent tool call
 * land on the one host value. The previewed path is this package's own store
 * field: which file a browser looks at never crosses the Remote boundary.
 */
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchView } from '@deepseek-ai/dsh-workbench/types'
import { fileNameOf, workbenchFileUrl } from './bytes.ts'
import { FilePreview } from './FilePreview.tsx'
import type { NS } from './locales.ts'
import { PANELS, panelFor } from './panels.ts'
import type { WorkbenchTabHandle } from './store.ts'
import css from './WorkbenchBody.module.css'

/** The registration-private face the body receives: the committed view and the four commits. */
export interface WorkbenchInjected {
  readonly hooks: { readonly view: ObservableSnapshot<WorkbenchView> }
  /** Session whose workspace fences the previewed file's bytes. */
  readonly sessionId: SessionId
  /** @param panelId - panel to select, or null to keep the committed one. */
  readonly open: (panelId: string | null) => Promise<void>
  /** @returns a promise settling after the committed view was published. */
  readonly close: () => Promise<void>
  /** @param panelId - panel to select. */
  readonly select: (panelId: string) => Promise<void>
  /** @returns a promise settling after the committed view was published. */
  readonly toggle: () => Promise<void>
}

/** The body's composed props: the tab record, its store, the injected face, and copy. */
export type WorkbenchBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<WorkbenchTabHandle>
  & InjectFace<WorkbenchInjected>
  & PropsLocale<typeof NS>

/**
 * The workbench type's body.
 * @param props - composed slot props.
 * @returns the shared view with its control row and the file preview.
 */
export function WorkbenchBody({
  useTabInfo, useView, useStore, actions, sessionId, open, close, select, toggle, t,
}: WorkbenchBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const view = useView(current => current)
  const path = useStore(state => state.path)
  const [draft, setDraft] = useState('')
  const inputId = useId()
  const panel = panelFor(view.active)
  return (
    <div className={css.panel}>
      <div className={css.controls}>
        {PANELS.map(entry => (
          <button
            key={entry.id}
            type="button"
            className={css.button}
            aria-pressed={entry.id === panel.id}
            onClick={() => { void select(entry.id) }}
          >
            {t(entry.labelKey)}
          </button>
        ))}
        <button type="button" className={css.button} onClick={() => { void open(null) }}>{t('control.open')}</button>
        <button type="button" className={css.button} onClick={() => { void toggle() }}>{t('control.toggle')}</button>
        <button type="button" className={css.button} onClick={() => { void close() }}>{t('control.close')}</button>
      </div>
      <p className={css.status}>{view.open ? t('status.open', { panel: t(panel.labelKey) }) : t('status.closed')}</p>
      <form
        className={css.form}
        onSubmit={(event) => {
          event.preventDefault()
          const trimmed = draft.trim()
          actions.setPath(trimmed === '' ? null : trimmed)
        }}
      >
        <label className={css.label} htmlFor={inputId}>{t('path.label')}</label>
        <input
          id={inputId}
          className={css.input}
          value={draft}
          placeholder={t('path.placeholder')}
          onChange={(event) => { setDraft(event.target.value) }}
        />
        <button type="submit" className={css.button}>{t('path.submit')}</button>
      </form>
      <div className={css.preview}>
        {path === null
          ? <p className={css.notice}>{t('preview.empty')}</p>
          : <FilePreview url={workbenchFileUrl(sessionId, path)} name={fileNameOf(path)} signal={tab.signal} t={t} />}
      </div>
    </div>
  )
}
