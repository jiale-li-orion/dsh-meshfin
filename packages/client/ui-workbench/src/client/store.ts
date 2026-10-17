/**
 * The workbench tab's own state: which workspace file this browser previews.
 *
 * The shared view belongs to the host, and column geometry belongs to the
 * Sidebar, so this store owns the one fact neither of them can hold: which file
 * the human in front of this browser is looking at. It never crosses the Remote
 * boundary.
 * @module @deepseek-ai/dsh-client-ui-workbench/client/store
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** One tab's preview selection: a workspace path, or null while nothing is previewed. */
export interface WorkbenchTabState {
  path: string | null
}

/**
 * Annotation twin of the actions literal below: the export needs a declared
 * return type, and drift fails assignability at the defineStore call.
 */
type WorkbenchTabActions = {
  setPath: (draft: WorkbenchTabState, path: string | null) => void
}

/** The registration's store handle, as the body's `PropsStore` share names it. */
export type WorkbenchTabHandle = ReturnType<typeof createWorkbenchTabStore>

/**
 * Create the workbench tab store handle.
 * @returns the store handle: the initial selection plus its one action.
 */
export function createWorkbenchTabStore(): EngineStoreHandle<WorkbenchTabState, WorkbenchTabActions> {
  return defineStore({
    init: (): WorkbenchTabState => ({ path: null }),
    actions: {
      setPath: (draft, path: string | null) => { draft.path = path },
    },
  })
}
