/**
 * One host view committed into the projection: the initial read, the four
 * gestures, and what a failed call leaves behind.
 */
import { describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { WorkbenchView } from '@deepseek-ai/dsh-workbench/types'
import { SharedWorkbenchView } from '../src/client/shared-view.ts'

const SEED: WorkbenchView = { open: false, active: null }

/**
 * The generated namespace, scripted: each call answers the view it commits, so a
 * test asserts both the argument that crossed the Remote and the published value.
 * @param initial - the view `state()` answers with.
 * @returns the namespace double.
 */
function fakeRemote(initial: WorkbenchView = SEED) {
  let current = initial
  const commit = (next: WorkbenchView): RemoteResult<WorkbenchView> => {
    current = next
    return { ok: true, value: current }
  }
  return {
    state: vi.fn(async (): Promise<RemoteResult<WorkbenchView>> => ({ ok: true, value: current })),
    open: vi.fn(async (panelId: string | null): Promise<RemoteResult<WorkbenchView>> =>
      commit({ open: true, active: panelId ?? current.active })),
    close: vi.fn(async (): Promise<RemoteResult<WorkbenchView>> => commit({ open: false, active: current.active })),
    select: vi.fn(async (panelId: string): Promise<RemoteResult<WorkbenchView>> => commit({ open: true, active: panelId })),
    toggle: vi.fn(async (): Promise<RemoteResult<WorkbenchView>> => commit({ open: !current.open, active: current.active })),
  }
}

/**
 * Build one projection over a real snapshot store.
 * @param initial - the view `state()` answers with.
 * @returns the projection, the store it publishes into, and the namespace.
 */
function bench(initial: WorkbenchView = SEED) {
  const store = createSnapshotStore<WorkbenchView>(SEED)
  const remote = fakeRemote(initial)
  return { projection: new SharedWorkbenchView(store, remote), store, remote }
}

describe('SharedWorkbenchView', () => {
  it('publishes the view an initial read answers with', async () => {
    const { projection, store } = bench({ open: true, active: 'preview' })
    await projection.read()
    expect(store.getSnapshot()).toEqual({ open: true, active: 'preview' })
  })

  it('leaves the seeded view alone when the read fails', async () => {
    const { projection, store, remote } = bench()
    remote.state.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'unavailable', {}) })
    await projection.read()
    expect(store.getSnapshot()).toEqual(SEED)
  })

  it('commit gestures cross the Remote and publish what it answers', async () => {
    const { projection, store, remote } = bench({ open: false, active: null })
    await projection.open('preview')
    expect(remote.open).toHaveBeenCalledWith('preview')
    expect(store.getSnapshot()).toEqual({ open: true, active: 'preview' })

    await projection.select('preview')
    expect(remote.select).toHaveBeenCalledWith('preview')

    await projection.close()
    expect(remote.close).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toEqual({ open: false, active: 'preview' })

    await projection.toggle()
    expect(remote.toggle).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toEqual({ open: true, active: 'preview' })
  })

  it('opens with no panel id so the host keeps its committed selection', async () => {
    const { projection, remote } = bench({ open: false, active: 'preview' })
    await projection.open(null)
    expect(remote.open).toHaveBeenCalledWith(null)
  })

  it('leaves the previous view in place when a commit fails', async () => {
    const { projection, store, remote } = bench({ open: true, active: 'preview' })
    await projection.read()
    remote.select.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/cancelled', 'cancelled', {}) })
    await projection.select('other')
    expect(store.getSnapshot()).toEqual({ open: true, active: 'preview' })
  })

  it('publishes one committed view for both the push and the read', async () => {
    const { projection, store } = bench()
    projection.apply({ open: true, active: 'preview' })
    expect(store.getSnapshot()).toEqual({ open: true, active: 'preview' })
    expect(projection.view.getSnapshot()).toBe(store.getSnapshot())
  })
})
