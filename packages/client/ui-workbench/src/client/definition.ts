/**
 * Stage one of this package's registration: what the `workbench` tab type IS.
 *
 * A page type: it recognizes no resource address, because the shared view is one
 * process-global panel selection rather than a file, and it is opened by kind.
 * `builtin` is the ordinary band for a type shipped with the product. The chip
 * text captured at open time is the panel-agnostic name; the live title
 * registration adds the selected panel.
 * @module @deepseek-ai/dsh-client-ui-workbench/client/definition
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { NS } from './locales.ts'

/** The tab kind this package owns. */
export const WORKBENCH_TAB_KIND = 'workbench'

/** This implementation's identity in the tab system: the key its body and title register under. */
export const WORKBENCH_TAB_ID = '@deepseek-ai/dsh-client-ui-workbench'

/**
 * The workbench type's registry definition.
 * @param t - namespace-bound translate, read fresh on every title call.
 * @returns the definition to register.
 */
export function workbenchDefinition(t: TranslateNS<typeof NS>): SidebarRightTabDefinition {
  return {
    id: WORKBENCH_TAB_ID,
    kind: WORKBENCH_TAB_KIND,
    priority: 'builtin',
    title: () => t('title'),
  }
}
