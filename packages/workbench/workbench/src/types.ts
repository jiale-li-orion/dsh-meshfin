/**
 * Shared workbench vocabulary: the view state one service owns and the event a
 * commit publishes.
 * @module @deepseek-ai/dsh-workbench/types
 */

/**
 * The shared workbench view. Both the browser and agent tools mutate this one
 * value, so a human gesture and a model tool call converge on the same state.
 */
export interface WorkbenchView {
  /** Whether the workbench column is open. */
  open: boolean
  /**
   * Selected panel id, or `null` when nothing is selected. The host stores the
   * id opaquely: panel membership belongs to the browser's slot registry, so an
   * unknown id is the client's to interpret (it falls back to the first panel).
   */
  active: string | null
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The shared workbench view changed. Emitted on every commit — a browser
     * gesture, an agent tool call, or a Remote call — so a client can apply the
     * committed value instead of deriving its own.
     * @param view - the committed view state.
     * @mode emit
     */
    'workbench/changed'(view: WorkbenchView): void
  }
}
