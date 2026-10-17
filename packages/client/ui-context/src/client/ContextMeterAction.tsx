/** Link from the composer's context-occupancy panel to the complete Context view. */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ContextMeterActionInjected } from './slots.ts'
import css from './ContextMeterAction.module.css'

/** Occupancy-panel action props: its business callback plus localized copy. */
export type ContextMeterActionProps = ContextMeterActionInjected & PropsLocale<'sessionContext'>

/**
 * Render the occupancy panel's Context entry.
 * @param props - localized copy and the injected view selection.
 * @returns the action row.
 */
export function ContextMeterAction({ openContext, t }: ContextMeterActionProps) {
  return (
    <button
      type="button"
      className={css.action}
      title={t('meter.manageHint')}
      onClick={() => { openContext() }}
    >
      <span>{t('meter.manage')}</span>
      <span aria-hidden>→</span>
    </button>
  )
}
