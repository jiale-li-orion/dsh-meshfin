/**
 * The panel roster this package offers the shared view.
 *
 * The host stores `active` opaquely and leaves membership to the browser, so
 * this list is the whole meaning of a panel id here: a plain typed constant, not
 * a slot registry, because nothing outside this package contributes a panel.
 * @module @deepseek-ai/dsh-client-ui-workbench/client/panels
 */
import type { WorkbenchKey } from './locales.ts'

/** One panel this package defines for the shared view. */
export interface WorkbenchPanel {
  /** Panel id the host stores in `WorkbenchView.active`. */
  readonly id: string
  /** Dictionary key of the panel's label. */
  readonly labelKey: WorkbenchKey
}

/** Every panel this package defines, in display order. */
export const PANELS = [
  { id: 'preview', labelKey: 'panel.preview' },
] as const satisfies readonly WorkbenchPanel[]

/**
 * The panel one committed selection stands for.
 * @param active - the host's selected panel id, or null.
 * @returns the named panel, or the first panel for an id this package does not define and for no selection at all.
 */
export function panelFor(active: string | null): WorkbenchPanel {
  return PANELS.find(panel => panel.id === active) ?? PANELS[0]
}
