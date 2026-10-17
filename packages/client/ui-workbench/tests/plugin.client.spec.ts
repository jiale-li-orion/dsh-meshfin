/**
 * The plugin's registrations and the shared-view projection.
 *
 * The tab-type registry and the slot registry are real, because "registered"
 * means what they say a type and a seat are; the Remote, the copy settings
 * scope, and the connection are doubles, because what matters here is what was
 * handed to them and that every registration is gone after dispose, which is
 * what makes a reload safe.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { RemoteError, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchView } from '@deepseek-ai/dsh-workbench/types'
import { WORKBENCH_TAB_ID, WORKBENCH_TAB_KIND } from '../src/client/definition.ts'
import { apply, inject } from '../src/client/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'
import { WorkbenchBody } from '../src/client/WorkbenchBody.tsx'
import type { WorkbenchInjected } from '../src/client/WorkbenchBody.tsx'
import { WorkbenchTitle } from '../src/client/WorkbenchTitle.tsx'
import type { WorkbenchTitleInjected } from '../src/client/WorkbenchTitle.tsx'

/** Slot names the two stages register into. */
const BODY_SEAT = 'sidebar.right.pane.tab' as const
const TITLE_SEAT = 'sidebar.right.pane.tab.title' as const

/** A seat this package registers into. */
type Seat = typeof BODY_SEAT | typeof TITLE_SEAT

/**
 * The generated workbench namespace, scripted, plus the push channel the plugin
 * subscribes to.
 * @param initial - the view `state()` answers with.
 * @returns the namespace, the captured push handlers, and a `$on` recorder.
 */
function fakeRemote(initial: WorkbenchView = { open: false, active: null }) {
  const handlers = new Set<(view: WorkbenchView) => void>()
  let current = initial
  const commit = (next: WorkbenchView): RemoteResult<WorkbenchView> => {
    current = next
    return { ok: true, value: current }
  }
  const namespace = {
    state: vi.fn(async (): Promise<RemoteResult<WorkbenchView>> => ({ ok: true, value: current })),
    open: vi.fn(async (panelId: string | null): Promise<RemoteResult<WorkbenchView>> =>
      commit({ open: true, active: panelId ?? current.active })),
    close: vi.fn(async (): Promise<RemoteResult<WorkbenchView>> => commit({ open: false, active: current.active })),
    select: vi.fn(async (panelId: string): Promise<RemoteResult<WorkbenchView>> => commit({ open: true, active: panelId })),
    toggle: vi.fn(async (): Promise<RemoteResult<WorkbenchView>> => commit({ open: !current.open, active: current.active })),
  }
  const remote = {
    workbench: namespace,
    $on: vi.fn((_event: string, handler: (view: WorkbenchView) => void) => {
      handlers.add(handler)
      return () => { handlers.delete(handler) }
    }),
  }
  return { namespace, remote, handlers }
}

/**
 * Boot the browser half over the real slot and tab-type registries.
 * @param initial - the view the stubbed host answers `state()` with.
 * @returns the context, the plugin fiber, the registries, and the doubles.
 */
async function bench(initial: WorkbenchView = { open: false, active: null }) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      [BODY_SEAT]: { kind: 'keyed', scope: 'session' },
      [TITLE_SEAT]: { kind: 'keyed', scope: 'session' },
    },
  } as never, () => null)
  const { namespace, remote, handlers } = fakeRemote(initial)
  ctx.provide('remote', remote as never)
  ctx.provide('remote.workbench', namespace as never)
  // The locale plugin binds a settings scope, which reads the connection handle
  // and the forwarded-event port.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
  const tabs = new SidebarRightTabRegistry(ctx)
  ctx.provide('sidebarRightTabs', tabs as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  // These specs assert the shipped Chinese copy. There is no jsdom `window` in
  // this lane, so browser-language detection never runs and the locale comes
  // from the fallback: state the asserted locale explicitly.
  ctx.locale.setLocale('zh')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  onTestFinished(async () => { await fiber.dispose() })
  await fiber.await()
  return { ctx, fiber, tabs, namespace, handlers }
}

/** The bound write set the framework hands a session-scoped inject factory. */
const ACTIONS: { setPath: (path: string | null) => void } = { setPath: vi.fn() }

/**
 * Invoke one seat's inject factory the way the render machinery does.
 * @param ctx - booted context.
 * @param seat - slot name to read the single entry of.
 * @param sessionId - the Session the seat is dispatching for.
 * @returns the value the entry's factory produced.
 */
function injectedOf(ctx: Context, seat: Seat, sessionId = 'session-7'): unknown {
  const entry = ctx.slots.entries(seat)[0]
  if (entry === undefined) throw new Error(`${seat} has no entry`)
  const inject: unknown = entry.inject
  if (typeof inject !== 'function') throw new Error(`${seat} registered no inject face`)
  return (inject as (sessionId: string, actions: typeof ACTIONS) => unknown)(sessionId, ACTIONS)
}

describe('ui-workbench browser half', () => {
  it('declares the services it binds, including the generated Remote namespace', () => {
    expect(inject).toEqual(['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workbench'])
  })

  it('registers the type with its kind, and takes it back on dispose', async () => {
    const { tabs, fiber } = await bench()
    const definition = tabs.get(WORKBENCH_TAB_KIND)
    expect(definition?.id).toBe(WORKBENCH_TAB_ID)
    expect(definition?.priority).toBe('builtin')
    expect(definition?.title('anything')).toBe(zh.title)
    await fiber.dispose()
    expect(tabs.get(WORKBENCH_TAB_KIND)).toBeUndefined()
  })

  it('lands the body and the title in their seats under the type\'s id', async () => {
    const { ctx, fiber } = await bench()
    const body = ctx.slots.entries(BODY_SEAT)
    const title = ctx.slots.entries(TITLE_SEAT)
    expect(body.map(entry => [entry.options.key, entry.locale, entry.component]))
      .toEqual([[WORKBENCH_TAB_ID, NS, WorkbenchBody]])
    expect(title.map(entry => [entry.options.key, entry.locale, entry.component]))
      .toEqual([[WORKBENCH_TAB_ID, NS, WorkbenchTitle]])
    // The body carries the registration's store and its own face factory.
    expect(body[0]?.store).toBeDefined()
    expect(typeof body[0]?.inject).toBe('function')
    await fiber.dispose()
    expect(ctx.slots.entries(BODY_SEAT)).toEqual([])
    expect(ctx.slots.entries(TITLE_SEAT)).toEqual([])
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('title')).toBe(zh.title)
    ctx.locale.setLocale('en')
    expect(translate('title')).toBe(en.title)
    // Withdrawn dictionaries leave the key unresolved rather than translated.
    await fiber.dispose()
    expect(translate('title')).not.toBe(en.title)
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('reads the host view once on load and publishes it to both seats', async () => {
    const { ctx, namespace } = await bench({ open: true, active: 'preview' })
    const face = injectedOf(ctx, BODY_SEAT) as WorkbenchInjected
    await vi.waitFor(() => {
      expect(face.hooks.view.getSnapshot()).toEqual({ open: true, active: 'preview' })
    })
    expect(namespace.state).toHaveBeenCalledTimes(1)
    const title = injectedOf(ctx, TITLE_SEAT) as WorkbenchTitleInjected
    expect(title.hooks.view.getSnapshot()).toEqual({ open: true, active: 'preview' })
  })

  it('leaves the seeded view alone when the initial read fails', async () => {
    const { ctx, namespace } = await bench()
    namespace.state.mockResolvedValueOnce({
      ok: false,
      error: new RemoteError('gateway/internal', 'unavailable', {}),
    })
    const face = injectedOf(ctx, BODY_SEAT) as WorkbenchInjected
    await Promise.resolve()
    await Promise.resolve()
    expect(face.hooks.view.getSnapshot()).toEqual({ open: false, active: null })
  })

  it('projects a workbench/changed push from the host into both seats', async () => {
    const { ctx, handlers } = await bench()
    const face = injectedOf(ctx, BODY_SEAT) as WorkbenchInjected
    for (const handler of handlers) handler({ open: true, active: 'preview' })
    expect(face.hooks.view.getSnapshot()).toEqual({ open: true, active: 'preview' })
    const title = injectedOf(ctx, TITLE_SEAT) as WorkbenchTitleInjected
    expect(title.hooks.view.getSnapshot()).toEqual({ open: true, active: 'preview' })
  })

  it('commits each gesture through the Remote and hands the body its Session', async () => {
    const { ctx, namespace } = await bench()
    const face = injectedOf(ctx, BODY_SEAT, 'session-7') as WorkbenchInjected
    expect(face.sessionId).toBe(SessionId('session-7'))

    await face.select('preview')
    expect(namespace.select).toHaveBeenCalledWith('preview')
    expect(face.hooks.view.getSnapshot()).toEqual({ open: true, active: 'preview' })

    await face.open(null)
    expect(namespace.open).toHaveBeenCalledWith(null)

    await face.toggle()
    expect(namespace.toggle).toHaveBeenCalledTimes(1)

    await face.close()
    expect(namespace.close).toHaveBeenCalledTimes(1)
    expect(face.hooks.view.getSnapshot()).toEqual({ open: false, active: 'preview' })
  })

  it('unsubscribes from the host push when the plugin goes', async () => {
    const { ctx, fiber, handlers } = await bench()
    expect(handlers.size).toBe(1)
    await fiber.dispose()
    expect(handlers.size).toBe(0)
    expect(ctx.slots.entries(BODY_SEAT)).toEqual([])
  })
})
