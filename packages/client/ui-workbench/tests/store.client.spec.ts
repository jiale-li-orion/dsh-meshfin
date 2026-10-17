/**
 * The workbench tab store: one browser-local selection, written through its own
 * action only, with independent instances per create().
 */
import { describe, expect, it } from 'vitest'
import { createWorkbenchTabStore } from '../src/client/store.ts'

describe('createWorkbenchTabStore', () => {
  it('starts with nothing previewed', () => {
    const { store } = createWorkbenchTabStore().create()
    expect(store.getSnapshot()).toEqual({ path: null })
  })

  it('setPath writes the selected path and a null clears it', () => {
    const { store, actions } = createWorkbenchTabStore().create()
    actions.setPath('/w/notes.md')
    expect(store.getSnapshot()).toEqual({ path: '/w/notes.md' })
    actions.setPath(null)
    expect(store.getSnapshot()).toEqual({ path: null })
  })

  it('each create() is an independent instance', () => {
    const first = createWorkbenchTabStore().create()
    const second = createWorkbenchTabStore().create()
    first.actions.setPath('/w/a.png')
    expect(second.store.getSnapshot()).toEqual({ path: null })
  })
})
