/**
 * The shared-view projection: one committed `WorkbenchView`, and every gesture
 * that commits a new one.
 *
 * The host service is the single authority. This class owns no view of its own:
 * every gesture calls the Remote and adopts the value the call answers with, and
 * the plugin feeds the same projection from the `workbench/changed` push and one
 * initial `state()` read. A human click and an agent tool call therefore converge
 * on one value. A failed call commits nothing, so the last committed view stands
 * instead of a synthetic one.
 * @module @deepseek-ai/dsh-client-ui-workbench/client/shared-view
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { WorkbenchView } from '@deepseek-ai/dsh-workbench/types'

/** The generated `workbench` Remote namespace, narrowed to the calls this package makes. */
export interface WorkbenchRemoteFace {
  /** @returns the committed view. */
  readonly state: () => Promise<RemoteResult<WorkbenchView>>
  /** @param panelId - panel to select, or null to keep the current selection. @returns the committed view. */
  readonly open: (panelId: string | null) => Promise<RemoteResult<WorkbenchView>>
  /** @returns the committed view. */
  readonly close: () => Promise<RemoteResult<WorkbenchView>>
  /** @param panelId - panel to select. @returns the committed view. */
  readonly select: (panelId: string) => Promise<RemoteResult<WorkbenchView>>
  /** @returns the committed view. */
  readonly toggle: () => Promise<RemoteResult<WorkbenchView>>
}

/** The committed host view, and the Remote calls that commit a new one. */
export class SharedWorkbenchView {
  /**
   * @param store - the snapshot the projection publishes into.
   * @param remote - the generated workbench Remote namespace.
   */
  constructor(
    private readonly store: SnapshotStore<WorkbenchView>,
    private readonly remote: WorkbenchRemoteFace,
  ) {}

  /** The committed view as render code reads it. */
  get view(): ObservableSnapshot<WorkbenchView> {
    return this.store
  }

  /**
   * Publish one committed view.
   * @param view - the view the host committed, or a Remote call answered with.
   */
  apply(view: WorkbenchView): void {
    this.store.set(view)
  }

  /**
   * Read the committed view once, for a page that loaded after the commit.
   * @returns a promise settling after a successful read was published.
   */
  async read(): Promise<void> {
    await this.commit(this.remote.state())
  }

  /**
   * Open the workbench, optionally selecting a panel.
   * @param panelId - panel to select, or null to keep the host's selection.
   * @returns a promise settling after the committed view was published.
   */
  async open(panelId: string | null): Promise<void> {
    await this.commit(this.remote.open(panelId))
  }

  /**
   * Close the workbench, keeping the selection.
   * @returns a promise settling after the committed view was published.
   */
  async close(): Promise<void> {
    await this.commit(this.remote.close())
  }

  /**
   * Select a panel and open the workbench.
   * @param panelId - panel to select.
   * @returns a promise settling after the committed view was published.
   */
  async select(panelId: string): Promise<void> {
    await this.commit(this.remote.select(panelId))
  }

  /**
   * Toggle the workbench column.
   * @returns a promise settling after the committed view was published.
   */
  async toggle(): Promise<void> {
    await this.commit(this.remote.toggle())
  }

  private async commit(call: Promise<RemoteResult<WorkbenchView>>): Promise<void> {
    const result = await call
    if (result.ok) this.store.set(result.value)
  }
}
