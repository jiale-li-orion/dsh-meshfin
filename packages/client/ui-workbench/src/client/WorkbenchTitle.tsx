/**
 * The workbench type's chip title: the tab's own name and the panel the shared
 * view currently selects.
 *
 * Registered under `sidebar.right.pane.tab.title`, it reads the same committed
 * view as the body, so a commit from any client renames the chip without the tab
 * being reopened.
 */
import type { ReactNode } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchView } from '@deepseek-ai/dsh-workbench/types'
import type { NS } from './locales.ts'
import { panelFor } from './panels.ts'

/** The title's injected face: the committed view, narrowed to what a chip shows. */
export interface WorkbenchTitleInjected {
  readonly hooks: { readonly view: ObservableSnapshot<WorkbenchView> }
}

/** The title's composed props: the tab information hook, the injected view, and copy. */
export type WorkbenchTitleProps =
  & PropsRuntime<'sidebar.right.pane.tab.title'>
  & InjectFace<WorkbenchTitleInjected>
  & PropsLocale<typeof NS>

/**
 * The title as the chip and a floating panel's header show it.
 * @param props - composed slot props.
 * @returns the type's name followed by the committed panel's label.
 */
export function WorkbenchTitle({ useView, t }: WorkbenchTitleProps): ReactNode {
  const view = useView(current => current)
  return `${t('title')} · ${t(panelFor(view.active).labelKey)}`
}
