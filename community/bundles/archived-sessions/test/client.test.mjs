/**
 * Client half: the bundle registers its page into the shipped settings nav slot
 * and exposes row data through the reserved `hooks` compartment.
 *
 * The browser module table only registers a factory
 * (`window.__ModuleLoader__.load({ id, factory })`); materialization happens when
 * the shell imports the module. This test drives the same two steps with a stub
 * module table and a stub React, then renders one element tree from the page.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

/** Stub React: every hook returns its initial value, elements stay plain data. */
const reactStub = {
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
}

/** A source pair shaped like `ctx.workspaces.list` / `ctx.sessions.list`. */
function fakeServices({ archived = [], catalog = {} } = {}) {
  const listeners = new Set()
  const workspaces = {
    archiveSet: archived,
    list: {
      getSnapshot: () => ({ archivedSessionIds: workspaces.archiveSet, items: [] }),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    unarchived: [],
    async unarchiveSession(id) {
      workspaces.unarchived.push(id)
      workspaces.archiveSet = workspaces.archiveSet.filter((entry) => entry !== id)
      for (const listener of listeners) listener()
    },
  }
  const sessions = {
    list: {
      getSnapshot: () => ({ ids: Object.keys(catalog), byId: catalog, phase: 'ready', projectionsBySession: {} }),
      subscribe: () => () => {},
    },
  }
  return { workspaces, sessions, notify: () => { for (const listener of listeners) listener() } }
}

/** Distinct module identity per load; the module system caches by URL. */
let loads = 0

/** Load the bundle through a stub module table and materialize its exports. */
async function loadClient() {
  let registration
  loads += 1
  globalThis.window = {
    __ModuleLoader__: {
      load(candidate) { registration = candidate },
    },
  }
  const url = pathToFileURL(new URL('../lib/client.js', import.meta.url).pathname).href
  await import(`${url}?load=${String(loads)}`)
  delete globalThis.window
  assert.ok(registration, 'the bundle registered no module factory')
  assert.equal(registration.id, '@muwinds/dsh-archived-sessions')
  return registration.factory((name) => {
    assert.equal(name, 'react')
    return reactStub
  })
}

test('registers the page into the settings nav slot', async () => {
  const exports = await loadClient()
  assert.deepEqual(exports.inject, ['slots', 'workspaces', 'sessions'])

  const services = fakeServices()
  const injections = []
  const registrations = []
  const effects = []
  const ctx = {
    ...services,
    effect(callback, label) {
      effects.push({ callback, label })
    },
    slots: {
      inject(name, register) {
        injections.push(name)
        registrations.push(register())
      },
      register(options, component) {
        return { options, component, dispose() {} }
      },
    },
  }

  exports.apply(ctx)

  assert.deepEqual(injections, ['settings.section'])
  assert.equal(effects.length, 1)
  assert.match(effects[0].label, /ui-archived-sessions/)
  const [registration] = registrations
  assert.equal(registration.options.name, 'settings.section')
  assert.equal(registration.options.id, 'archived-sessions')
  assert.equal(registration.options.order, 30)
  assert.equal(registration.options.label(), '归档会话')
  assert.equal(typeof registration.component, 'function')
  const dispose = effects[0].callback()
  dispose()
})

test('serves rows from the workspace archive set and the session catalog', async () => {
  const exports = await loadClient()
  const services = fakeServices({
    archived: ['b', 'a'],
    catalog: {
      a: { id: 'a', title: 'First', cwd: '/work/a', updatedAt: 10, running: false },
      b: { id: 'b', displayTitle: 'Second', updatedAt: 20, running: true },
    },
  })
  let injected
  const ctx = {
    ...services,
    effect() {},
    slots: {
      inject(_name, register) {
        register()
      },
      register(options) {
        injected = options.inject
        return {}
      },
    },
  }
  exports.apply(ctx)
  const face = injected()
  assert.equal(typeof face.unarchive, 'function')
  assert.ok(face.hooks && face.hooks.rows, 'the page needs a rows source')

  const source = face.hooks.rows
  const first = source.getSnapshot()
  assert.deepEqual(first.rows.map((row) => row.id), ['b', 'a'])
  assert.equal(first.rows[0].title, 'Second')
  assert.equal(first.rows[0].running, true)
  assert.equal(first.rows[1].title, 'First')
  assert.equal(first.rows[1].cwd, '/work/a')
  // Identity stability: the renderer's hook binding compares snapshots by reference.
  assert.equal(source.getSnapshot(), first)

  let notified = 0
  const off = source.subscribe(() => { notified += 1 })
  await face.unarchive('b')
  assert.deepEqual(services.workspaces.unarchived, ['b'])
  assert.equal(notified, 1)
  const second = source.getSnapshot()
  assert.notEqual(second, first)
  assert.deepEqual(second.rows.map((row) => row.id), ['a'])
  off()
})

test('renders the page element tree without a live session list entry', async () => {
  const exports = await loadClient()
  const services = fakeServices({ archived: ['ghost'] })
  let component
  const ctx = {
    ...services,
    effect() {},
    slots: {
      inject(_name, register) {
        register()
      },
      register(_options, registered) {
        component = registered
        return {}
      },
    },
  }
  exports.apply(ctx)
  const element = component({
    useRows: () => ({ ids: ['ghost'], rows: [{ id: 'ghost', title: null, cwd: null, updatedAt: 0, running: false }] }),
    unarchive: async () => {},
  })
  assert.equal(element.type, 'div')
  assert.equal(element.props.className, 'dsw-arch-page')
})
