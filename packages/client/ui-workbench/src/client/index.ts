/**
 * Browser half: register `workbench` as one right-Sidebar tab type.
 *
 * The type reaches the Sidebar through its public path only: the definition into
 * `ctx.sidebarRightTabs`, the body into the keyed `sidebar.right.pane.tab` seat,
 * and the chip title into `sidebar.right.pane.tab.title`, both under the
 * definition's `id`. Nothing here reaches into the Sidebar's store, its panes, or
 * its sequence.
 *
 * The host workbench service is the single authority for the shared view. One
 * projection reads it once on load and follows its `workbench/changed` push, and
 * every gesture in the tab body commits through the Remote, so a human press and
 * an agent tool call converge on one value. Which file this browser previews is
 * the tab store's own field and never crosses the Remote boundary.
 * @module @deepseek-ai/dsh-client-ui-workbench/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-workbench/remote'
import type { WorkbenchView } from '@deepseek-ai/dsh-workbench/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WORKBENCH_TAB_ID, workbenchDefinition } from './definition.ts'
import { en, NS, zh } from './locales.ts'
import { SharedWorkbenchView } from './shared-view.ts'
import { createWorkbenchTabStore } from './store.ts'
import { WorkbenchBody } from './WorkbenchBody.tsx'
import type { WorkbenchInjected } from './WorkbenchBody.tsx'
import { WorkbenchTitle } from './WorkbenchTitle.tsx'
import type { WorkbenchTitleInjected } from './WorkbenchTitle.tsx'

/**
 * Required browser services: the slot registry, copy, the tab-type registry, and
 * the generated workbench Remote namespace.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workbench']

/**
 * Client plugin body: dictionaries, the shared-view projection, the tab type, and
 * its body and title seats.
 * @param ctx - client root context carrying the registries, copy, and the Remote.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workbench: dictionaries')
  const shared = new SharedWorkbenchView(
    createSnapshotStore<WorkbenchView>({ open: false, active: null }),
    ctx.remote.workbench,
  )
  // The one shared-view projection: the host push, plus one initial read so a
  // reload resumes the view another client (or the agent) committed.
  ctx.effect(() => {
    const off = ctx.remote.$on('workbench/changed', (view) => { shared.apply(view) })
    void shared.read()
    return off
  }, 'ui-workbench: shared view projection')

  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(workbenchDefinition(t)), 'ui-workbench: workbench type')
  const store = createWorkbenchTabStore()
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: WORKBENCH_TAB_ID,
    locale: NS,
    store,
    inject: (sessionId: SessionId): WorkbenchInjected => ({
      hooks: { view: shared.view },
      sessionId,
      open: async (panelId) => { await shared.open(panelId) },
      close: async () => { await shared.close() },
      select: async (panelId) => { await shared.select(panelId) },
      toggle: async () => { await shared.toggle() },
    }),
  }, WorkbenchBody)), 'ui-workbench: workbench body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: WORKBENCH_TAB_ID,
    locale: NS,
    inject: (): WorkbenchTitleInjected => ({ hooks: { view: shared.view } }),
  }, WorkbenchTitle)), 'ui-workbench: workbench title')
}
