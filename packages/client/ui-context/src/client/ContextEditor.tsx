/** Same-Session Context rewrite dialog with an explicit causal-risk branch. */

import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContextRewriteMode } from '@deepseek-ai/dsh-session-context/types'
import type { SessionContextKey } from './locales.ts'
import css from './ContextEditor.module.css'

type Translate = (key: SessionContextKey, params?: Record<string, string | number>) => string

/** Controlled editor props. */
export interface ContextEditorProps {
  open: boolean
  text: string
  mode: ContextRewriteMode
  patchConfirmed: boolean
  allowEmpty: boolean
  busy: boolean
  error: string | null
  t: Translate
  onText: (text: string) => void
  onMode: (mode: ContextRewriteMode) => void
  onPatchConfirmed: (confirmed: boolean) => void
  onClose: () => void
  onSubmit: () => void
}

/** Render the rewrite editor and its explicit patch acknowledgement. */
export function ContextEditor({
  open,
  text,
  mode,
  patchConfirmed,
  allowEmpty,
  busy,
  error,
  t,
  onText,
  onMode,
  onPatchConfirmed,
  onClose,
  onSubmit,
}: ContextEditorProps) {
  const patch = mode === 'patch'
  const disabled = busy || (text.length === 0 && !allowEmpty)
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t('editor.cancel')}
      title={t('editor.title')}
      description={t('editor.warning')}
      className={css.dialog ?? ''}
      footer={(
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('editor.cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => { onSubmit() }}
            disabled={disabled || (patch && !patchConfirmed)}
          >
            {patch ? t('editor.patchConfirm') : t('editor.saveAndContinue')}
          </Button>
        </>
      )}
    >
      <textarea
        className={css.editor}
        value={text}
        placeholder={t('editor.placeholder')}
        disabled={busy}
        autoFocus
        onChange={(event) => { onText(event.currentTarget.value) }}
      />
      <div className={css.modeRow}>
        <button
          type="button"
          className={!patch ? css.activeMode : css.mode}
          disabled={busy}
          onClick={() => { onMode('edit-and-continue') }}
        >
          {t('selection.edit')}
        </button>
        <button
          type="button"
          className={patch ? css.activeMode : css.mode}
          disabled={busy}
          onClick={() => { onMode('patch') }}
        >
          {t('editor.patch')}
        </button>
      </div>
      {patch && (
        <label className={css.patchWarning}>
          <input
            type="checkbox"
            checked={patchConfirmed}
            disabled={busy}
            onChange={(event) => { onPatchConfirmed(event.currentTarget.checked) }}
          />
          <span>{t('editor.patchWarning')}</span>
        </label>
      )}
      {error !== null && <p className={css.error} role="alert">{error}</p>}
      {busy && <p className={css.busy}>{t('operation.rewriting')}</p>}
    </Modal>
  )
}
