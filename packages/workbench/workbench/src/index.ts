/**
 * Shared workbench state. One service owns the view the browser and the agent
 * both mutate: browser gestures arrive as Remote calls, the `tool-workbench`
 * tools write the same value, and every commit emits `workbench/changed` so both
 * projections converge without polling.
 *
 * The package also re-exports the vocabulary its byte-route sibling reads —
 * `fenceSessionPath`, `contentTypeForPath`, the route paths, and the artifacts
 * this package's Remote methods generate — so one definition serves the Remote
 * namespace and the routes.
 * @module @deepseek-ai/dsh-workbench
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkbenchView } from './types.ts'

export type * from './types.ts'
export { contentTypeForPath, DEFAULT_CONTENT_TYPE } from './content-type.ts'
export { fenceSessionPath, WorkbenchFenceError } from './fence.ts'
export { WORKBENCH_FILE_PATH, WORKBENCH_UPLOAD_PATH } from './protocol.ts'
export type { FencedSessionPath } from './fence.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The shared workbench state service. */
    workbench: WorkbenchService
  }
}

/**
 * The shared workbench service: one mutable view, one commit path, one event.
 * The view carries no session identity, so every Remote call touches the
 * built-in `global` resource and the package registers no resource kind.
 */
export class WorkbenchService extends TypertRemoteService {
  static inject = ['remoteAccess']

  // A plain `private` field, not `#view`: cordis proxies the service instance,
  // and JavaScript private fields are not proxy-transparent.
  private view: WorkbenchView = { open: false, active: null }

  /**
   * @param ctx - owning Cordis context.
   */
  constructor(ctx: Context) {
    super(ctx, 'workbench', { namespace: 'workbench' })
  }

  /**
   * Read the current view.
   * @returns a detached copy of the committed view.
   */
  @Remote('state')
  state(): WorkbenchView {
    return { ...this.view }
  }

  /**
   * Open the workbench, optionally selecting a panel.
   * @param panelId - panel id to select, or null to keep the current selection.
   * @returns the committed view.
   */
  @Remote('open')
  open(panelId: string | null): WorkbenchView {
    return this.commit({ open: true, active: panelId ?? this.view.active })
  }

  /**
   * Close the workbench. The selection is kept, so reopening returns to it.
   * @returns the committed view.
   */
  @Remote('close')
  close(): WorkbenchView {
    return this.commit({ open: false, active: this.view.active })
  }

  /**
   * Select a panel and open the workbench.
   * @param panelId - panel id to select.
   * @returns the committed view.
   */
  @Remote('select')
  select(panelId: string): WorkbenchView {
    return this.commit({ open: true, active: panelId })
  }

  /**
   * Toggle the workbench column: open with the current selection, or close.
   * @returns the committed view.
   */
  @Remote('toggle')
  toggle(): WorkbenchView {
    return this.commit({ open: !this.view.open, active: this.view.active })
  }

  private commit(next: WorkbenchView): WorkbenchView {
    this.view = next
    const committed = { ...next }
    this.ctx.emit('workbench/changed', committed)
    return committed
  }
}

export default WorkbenchService
