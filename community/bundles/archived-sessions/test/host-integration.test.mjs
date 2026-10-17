/**
 * Integration: the Host half as a real Cordis plugin beside the real web server
 * and the real `SessionPersistence` service contract, answered over HTTP.
 *
 * The storage backend is in-test: the shipped JSONL backend needs the native
 * `@deepseek-ai/node-addon-system-*` addon, which this checkout does not build.
 * Everything the bundle itself depends on is real — the service class and its
 * method contracts, the plugin lifecycle, and the HTTP carrier.
 *
 * The archive set is supplied by the test through `ctx.provide`: mounting a whole
 * Workspace registry needs a storage domain and a profile, while the Host half
 * reads only `archivedSessionIds` from it.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import SessionPersistence, {
  SessionAlreadyExistsError,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
} from '@deepseek-ai/dsh-session-persistence'
import { apply, inject, name } from '../lib/index.js'

const SESSION = 'archived-integration'

/** One stored log: `count` user messages, contiguous from seq 0. */
function storedEvents(count) {
  const events = []
  for (let index = 0; index < count; index += 1) {
    events.push({
      type: 'user/message',
      seq: SessionSeq(index),
      time: index,
      surfaceOp: 'append',
      data: createUserMessage({
        content: [{ type: 'text', text: `question-${String(index)}` }],
        source: { kind: 'user' },
      }),
    })
  }
  return events
}

/** Durable in-test backend that also counts and measures its Sessions like the JSONL one. */
class MemoryPersistence extends SessionPersistence {
  constructor(ctx, sessions, options = {}) {
    super(ctx)
    this.sessions = sessions
    this.reportEventCount = options.reportEventCount ?? true
  }

  async create(header) {
    if (this.sessions.has(header.id)) throw new SessionAlreadyExistsError(header.id)
    const stored = { header, events: [] }
    this.sessions.set(header.id, stored)
    return this.handle(stored)
  }

  async flush() {}

  async open(id) {
    const stored = this.sessions.get(id)
    if (stored === undefined) throw new SessionPersistenceNotFoundError(id)
    return this.handle(stored)
  }

  async stat(id) {
    const stored = this.sessions.get(id)
    if (stored === undefined) return undefined
    return {
      header: stored.header,
      revision: SessionPersistenceRevision(`memory:${id}:${String(stored.events.length)}`),
      ...this.reportEventCount ? { eventCount: stored.events.length, sizeBytes: 4096 } : {},
    }
  }

  async list() {
    return [...this.sessions.values()].map(stored => ({ header: stored.header }))
  }

  handle(stored) {
    return {
      id: stored.header.id,
      header: stored.header,
      inheritedEventCount: 0,
      access: 'read',
      async read(offset = 0, length = stored.events.length - offset) {
        return { eventState: 'owned', events: stored.events.slice(offset, offset + length) }
      },
      async append(events) { stored.events.push(...events) },
      async flush() {},
      async close() {},
    }
  }
}

async function bootHost(t, options) {
  const sessions = new Map()
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  // The service constructor registers `sessionPersistence` on its own fiber.
  await ctx.plugin({
    name: 'memory-session-persistence',
    apply: (child) => { void new MemoryPersistence(child, sessions, options) },
  })
  const { header, events } = options.log
  const handle = await ctx.sessionPersistence.create(header)
  await handle.append(events)
  await handle.close()
  // The bundle row, composed exactly as the profile Loader composes it.
  await ctx.plugin({ name, inject, apply })
  ctx.provide('workspaceRegistry', { archivedSessionIds: options.archived })
  return { ctx, port: ctx.webServer.port }
}

function header() {
  return {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(SESSION),
    createdAt: 1_700_000_000_000,
    cwd: '/work',
    isSeeded: false,
  }
}

function inspect(port, sessionId) {
  return fetch(`http://127.0.0.1:${String(port)}/dsh-archived/inspect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })
}

test('serves the preview over HTTP from a real persistence service', async (t) => {
  const { port } = await bootHost(t, { log: { header: header(), events: storedEvents(2) }, archived: [SessionId(SESSION)] })
  const answer = await inspect(port, SESSION)
  assert.equal(answer.status, 200)
  const payload = await answer.json()
  assert.equal(payload.id, SESSION)
  assert.equal(payload.createdAt, 1_700_000_000_000)
  assert.equal(payload.cwd, '/work')
  assert.equal(payload.eventCount, 2)
  assert.equal(payload.sizeBytes, 4096)
  assert.equal(payload.messageCount, 2)
  assert.equal(payload.messages[0].text, 'question-0')
  assert.equal(payload.messages[1].text, 'question-1')
})

test('reads a bounded tail of a long stored log', async (t) => {
  const { port } = await bootHost(t, {
    log: { header: header(), events: storedEvents(3000) },
    archived: [SessionId(SESSION)],
  })
  const payload = await (await inspect(port, SESSION)).json()
  assert.equal(payload.eventCount, 3000)
  assert.equal(payload.windowStart, 1000)
  assert.equal(payload.messageCount, 100)
  assert.equal(payload.truncated, true)
  assert.equal(payload.messages.at(-1).text, 'question-2999')
})

test('locates the log length when the backend reports no count', async (t) => {
  const { port } = await bootHost(t, {
    reportEventCount: false,
    log: { header: header(), events: storedEvents(150) },
    archived: [SessionId(SESSION)],
  })
  const payload = await (await inspect(port, SESSION)).json()
  assert.equal(payload.eventCount, 150)
  assert.equal(payload.sizeBytes, null)
  assert.equal(payload.messages.at(-1).text, 'question-149')
})

test('refuses a Session the archive set does not hold', async (t) => {
  const { port } = await bootHost(t, { log: { header: header(), events: storedEvents(2) }, archived: [] })
  const answer = await inspect(port, SESSION)
  assert.equal(answer.status, 500)
  assert.match((await answer.json()).error, /is not archived/)
})

test('answers an unknown route with 404', async (t) => {
  const { port } = await bootHost(t, { log: { header: header(), events: storedEvents(1) }, archived: [] })
  const answer = await fetch(`http://127.0.0.1:${String(port)}/dsh-archived/other`, { method: 'POST', body: '{}' })
  assert.equal(answer.status, 404)
})
