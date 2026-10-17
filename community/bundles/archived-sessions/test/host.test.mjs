/**
 * Host-half behaviour: the archive-set guard, the bounded tail read, and the
 * lifecycle-owned route. These use plain fakes; `host-integration.test.mjs`
 * mounts the same handlers against the real JSONL backend and web server.
 */
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply, inspectArchivedSession, MAX_MESSAGES, ROUTE_PREFIX } from '../lib/index.js'

function registry(ids) {
  return { archivedSessionIds: [...ids] }
}

/** A stored log the fake persistence serves: `count` user messages, one per event. */
function storedLog(count, { seqBase = 0, text = 'message' } = {}) {
  const events = []
  for (let index = 0; index < count; index += 1) {
    const seq = seqBase + index
    events.push({
      type: 'user/message',
      seq,
      time: seq,
      data: { content: [{ type: 'text', text: `${text}-${seq}` }] },
    })
  }
  return events
}

function fakePersistence({ events, eventCount, header = { createdAt: 7, cwd: '/work' }, onRead, onOpen } = {}) {
  const reads = []
  return {
    reads,
    async stat() {
      return {
        header,
        ...eventCount === undefined ? {} : { eventCount },
        sizeBytes: 2048,
      }
    },
    async open(id, access) {
      onOpen?.(id, access)
      return {
        id,
        access,
        async read(offset = 0, length = events.length - offset) {
          reads.push({ offset, length })
          onRead?.({ offset, length })
          return { eventState: 'owned', events: events.slice(offset, offset + length) }
        },
        async close() {},
      }
    },
  }
}

test('registers the route as a lifecycle-owned effect', () => {
  let effect
  let disposed = false
  const ctx = {
    get: () => undefined,
    effect(callback, label) {
      effect = { callback, label }
    },
    webServer: {
      register(route) {
        assert.equal(route.kind, 'prefix')
        assert.equal(route.path, ROUTE_PREFIX)
        return () => { disposed = true }
      },
    },
  }
  apply(ctx)
  assert.match(effect.label, /dsh-archived/)
  effect.callback()()
  assert.equal(disposed, true)
})

test('refuses a session the archive set does not hold', async () => {
  await assert.rejects(inspectArchivedSession({
    workspaceRegistry: registry([]),
    sessionPersistence: fakePersistence({ events: storedLog(1), eventCount: 1 }),
  }, { sessionId: 'other' }), /is not archived/)
})

test('reports a session with no stored log', async () => {
  await assert.rejects(inspectArchivedSession({
    workspaceRegistry: registry(['gone']),
    sessionPersistence: {
      async stat() { return undefined },
      async open() { throw new Error('must not open') },
    },
  }, { sessionId: 'gone' }), /has no stored log/)
})

test('refuses without a persistence read capability', async () => {
  await assert.rejects(inspectArchivedSession({
    workspaceRegistry: registry(['a']),
  }, { sessionId: 'a' }), /session persistence read capability unavailable/)
})

test('keeps the newest messages and reports truncation', async () => {
  const events = storedLog(140)
  const persistence = fakePersistence({ events, eventCount: 140 })
  const result = await inspectArchivedSession({
    workspaceRegistry: registry(['archived']),
    sessionPersistence: persistence,
  }, { sessionId: 'archived' })

  assert.equal(result.eventCount, 140)
  assert.equal(result.messageCount, MAX_MESSAGES)
  assert.equal(result.truncated, true)
  assert.equal(result.messages[0].text, 'message-40')
  assert.equal(result.messages.at(-1).text, 'message-139')
  assert.equal(result.sizeBytes, 2048)
  assert.equal(result.createdAt, 7)
  assert.equal(result.cwd, '/work')
  assert.equal(result.windowStart, 0)
})

test('reads only a bounded tail once the log is longer than the window', async () => {
  const events = storedLog(5000)
  const persistence = fakePersistence({ events, eventCount: 5000 })
  const result = await inspectArchivedSession({
    workspaceRegistry: registry(['long']),
    sessionPersistence: persistence,
  }, { sessionId: 'long' })

  assert.equal(result.eventCount, 5000)
  assert.ok(result.windowStart >= 3000, `windowStart ${String(result.windowStart)} should skip the head`)
  for (const read of persistence.reads) {
    assert.ok(read.offset >= result.windowStart, `read below the window: ${JSON.stringify(read)}`)
  }
  assert.equal(result.messages.at(-1).text, 'message-4999')
})

test('locates the log length when the backend reports no count', async () => {
  const events = storedLog(140)
  const persistence = fakePersistence({ events })
  const result = await inspectArchivedSession({
    workspaceRegistry: registry(['probe']),
    sessionPersistence: persistence,
  }, { sessionId: 'probe' })

  assert.equal(result.eventCount, 140)
  assert.equal(result.messageCount, MAX_MESSAGES)
  assert.equal(result.messages.at(-1).text, 'message-139')
  // Logarithmic probing, not a full scan: far fewer reads than events.
  assert.ok(persistence.reads.length < 60, `probe issued ${String(persistence.reads.length)} reads`)
})

test('flushes a live session before opening the read handle', async () => {
  const order = []
  const events = storedLog(2)
  await inspectArchivedSession({
    workspaceRegistry: registry(['live']),
    sessionPersistence: fakePersistence({ events, eventCount: 2, onOpen: () => order.push('open') }),
    sessions: {
      get: () => ({ id: 'live' }),
      async flush() { order.push('flush') },
    },
  }, { sessionId: 'live' })
  assert.deepEqual(order, ['flush', 'open'])
})

test('answers the route: method, path, body, and payload', async () => {
  const events = storedLog(2)
  let handler
  const ctx = {
    get(name) {
      if (name === 'workspaceRegistry') return registry(['archived'])
      if (name === 'sessionPersistence') return fakePersistence({ events, eventCount: 2 })
      return undefined
    },
    effect(callback) { callback() },
    webServer: { register(route) { handler = route.handler; return () => {} } },
  }
  apply(ctx)

  const call = async (method, url, body) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(body)])
    req.method = method
    req.url = url
    let status
    let payload
    const res = {
      writeHead(code) { status = code },
      end(text) { payload = JSON.parse(text) },
    }
    await handler(req, res)
    return { status, payload }
  }

  assert.deepEqual(await call('GET', ROUTE_PREFIX + '/inspect'), { status: 405, payload: { error: 'method not allowed' } })
  assert.deepEqual(await call('POST', '/elsewhere'), { status: 404, payload: { error: 'not found' } })
  assert.deepEqual(await call('POST', ROUTE_PREFIX + '/inspect', '{'), { status: 400, payload: { error: 'invalid JSON body' } })
  const ok = await call('POST', ROUTE_PREFIX + '/inspect', JSON.stringify({ sessionId: 'archived' }))
  assert.equal(ok.status, 200)
  assert.equal(ok.payload.messageCount, 2)
  assert.equal(ok.payload.messages[1].text, 'message-1')
  const refused = await call('POST', ROUTE_PREFIX + '/inspect', JSON.stringify({ sessionId: 'nope' }))
  assert.equal(refused.status, 500)
  assert.match(refused.payload.error, /is not archived/)
})
