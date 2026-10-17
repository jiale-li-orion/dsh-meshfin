/**
 * Host half of the archived-sessions page (@muwinds/dsh-archived-sessions).
 *
 * One read-only JSON route under /dsh-archived on the harness web server:
 *   POST /dsh-archived/inspect  { sessionId } -> {
 *     id, createdAt, cwd, parentSession, eventCount, sizeBytes,
 *     windowStart, messageCount, truncated, messages
 *   }
 *
 * The route answers only for Sessions the Workspace registry currently holds in
 * its archive set. Listing and restoring archived Sessions belong to the browser
 * half, which reads them from the Workspace Remote; this half exists because a
 * message preview needs the stored log, and `SessionPersistence` no longer
 * exposes `inspect`. The preview reads a bounded tail through a `read` handle
 * instead of loading the complete log.
 *
 * `SessionPersistence` also stopped naming a Session's artifact directory, so
 * nothing here deletes or measures a Session on disk: `stat()` is the only
 * per-Session storage fact the API still offers.
 */

/** Plugin display name for the Loader. */
export const name = 'archived-sessions'

/** The browser HTTP carrier owns the route lifetime. */
export const inject = ['webServer']

/** Absolute registration path of the route. */
export const ROUTE_PREFIX = '/dsh-archived'

/** Newest messages kept in one preview. */
export const MAX_MESSAGES = 100

/** Longest message text kept in one preview. */
const MAX_TEXT = 8000

/** Events read from the end of a log when its length is known. */
const TAIL_WINDOW = 2000

/** Events per read on the handle. */
const PAGE_SIZE = 512

/** Ceiling for the length probe, so a corrupt backend cannot spin. */
const MAX_PROBE_EVENTS = 1_000_000

/**
 * Read the message text of a content-block list.
 * @param blocks - the persisted content blocks.
 * @returns the concatenated readable text.
 */
function blocksText(blocks) {
  if (!Array.isArray(blocks)) return ''
  const parts = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'reasoning' && typeof block.text === 'string') parts.push('[思考] ' + block.text)
    else if (block.type === 'tool-call') parts.push('[调用 ' + (block.name || '?') + ']')
    else if (block.type === 'tool-result') parts.push('[工具结果]')
    else if (block.type === 'image') parts.push('[图片]')
  }
  return parts.join('\n')
}

/**
 * Read the requested Session id.
 * @param args - parsed request body.
 * @returns the id.
 * @throws when the body carries no session id.
 */
function sessionIdOf(args) {
  const id = args !== null && typeof args === 'object' ? args.sessionId : undefined
  if (typeof id !== 'string' || id.length === 0) throw new Error('sessionId is required')
  return id
}

/**
 * Read the Host archive set.
 * @param registry - the Workspace registry.
 * @returns the archived Session ids.
 * @throws when the registry is not started.
 */
export function archivedIdsOf(registry) {
  const ids = registry?.archivedSessionIds
  if (!Array.isArray(ids)) throw new Error('workspace registry archive set unavailable')
  return ids
}

/**
 * Count the events behind a handle when the backend reports no cheap count.
 *
 * A one-event probe finds an index past the end, then a binary search in
 * `(present, absent]` locates the last present index, so the work is
 * logarithmic in the log length instead of a full read.
 * @param handle - an open `read` handle.
 * @param known - the backend's cheap count, when it has one.
 * @returns the number of events in the log.
 */
async function eventCountOf(handle, known) {
  if (typeof known === 'number' && Number.isSafeInteger(known) && known >= 0) return known
  let present = 0
  let absent
  for (let probe = 1; probe <= MAX_PROBE_EVENTS; probe *= 2) {
    const { events } = await handle.read(probe, 1)
    if (events.length === 0) {
      absent = probe
      break
    }
    present = probe
  }
  if (absent === undefined) return present + 1
  while (absent - present > 1) {
    const middle = present + Math.floor((absent - present) / 2)
    const { events } = await handle.read(middle, 1)
    if (events.length === 0) absent = middle
    else present = middle
  }
  return absent
}

/**
 * Turn a tail slice of a stored log into preview messages.
 * @param events - the events to scan, in seq order.
 * @returns the messages kept, newest last.
 */
function previewMessages(events) {
  const messages = []
  for (const event of events) {
    if (!event || typeof event !== 'object' || !event.data || typeof event.data !== 'object') continue
    const data = event.data
    let message
    if (event.type === 'user/message') {
      const text = blocksText(data.content)
      if (text) message = { seq: event.seq, time: event.time, role: 'user', text: text.slice(0, MAX_TEXT) }
    } else if (event.type === 'assistant/message' && data.message && typeof data.message === 'object') {
      const text = blocksText(data.message.content)
      if (text) message = { seq: event.seq, time: event.time, role: 'assistant', text: text.slice(0, MAX_TEXT) }
    } else if (event.type === 'tool/call') {
      const callName = typeof data.name === 'string' ? data.name : '?'
      const argsText = typeof data.arguments === 'string' ? data.arguments.slice(0, 300) : ''
      message = { seq: event.seq, time: event.time, role: 'tool', text: '[' + callName + '] ' + argsText }
    }
    if (message !== undefined) messages.push(message)
  }
  const truncated = messages.length > MAX_MESSAGES
  if (truncated) messages.splice(0, messages.length - MAX_MESSAGES)
  return { messages, truncated }
}

/**
 * Build the message preview of one archived Session.
 * @param deps - Host services: `workspaceRegistry`, `sessionPersistence`, and the optional live `sessions` store.
 * @param args - request body carrying `sessionId`.
 * @returns the preview payload.
 * @throws when the Session is not archived, unknown to persistence, or unreadable.
 */
export async function inspectArchivedSession(deps, args) {
  const sessionId = sessionIdOf(args)
  const archived = archivedIdsOf(deps.workspaceRegistry)
  if (!archived.includes(sessionId)) {
    throw new Error('session ' + sessionId + ' is not archived')
  }
  const persistence = deps.sessionPersistence
  if (typeof persistence?.open !== 'function' || typeof persistence?.stat !== 'function') {
    throw new Error('session persistence read capability unavailable')
  }
  // Durability barrier: a live Session's newest events must reach storage before
  // the independent read handle below is allowed to answer.
  const live = typeof deps.sessions?.get === 'function' ? deps.sessions.get(sessionId) : undefined
  if (live !== undefined && typeof deps.sessions?.flush === 'function') await deps.sessions.flush(live)
  const snapshot = await persistence.stat(sessionId)
  if (snapshot === undefined) throw new Error('session ' + sessionId + ' has no stored log')
  const handle = await persistence.open(sessionId, 'read')
  try {
    const eventCount = await eventCountOf(handle, snapshot.eventCount)
    const windowStart = Math.max(0, eventCount - TAIL_WINDOW)
    const collected = []
    let offset = windowStart
    while (offset < eventCount) {
      const length = Math.min(PAGE_SIZE, eventCount - offset)
      const { events } = await handle.read(offset, length)
      if (events.length === 0) break
      for (const event of events) collected.push(event)
      offset += events.length
    }
    const { messages, truncated } = previewMessages(collected)
    return {
      id: sessionId,
      createdAt: snapshot.header.createdAt,
      cwd: snapshot.header.cwd ?? null,
      parentSession: snapshot.header.parentSession ?? null,
      eventCount,
      sizeBytes: snapshot.sizeBytes ?? null,
      windowStart,
      messageCount: messages.length,
      truncated,
      messages,
    }
  } finally {
    await handle.close()
  }
}

/**
 * Read one buffered request body.
 * @param req - the incoming request.
 * @returns the body text.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => { chunks.push(chunk) })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

/**
 * Answer one route request with JSON.
 * @param res - the response.
 * @param status - HTTP status.
 * @param payload - JSON-serializable body.
 */
function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

/**
 * Register the route as a lifecycle-owned effect.
 * @param ctx - Host context carrying `webServer`.
 */
export function apply(ctx) {
  async function handler(req, res) {
    if ((req.method || '') !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }
    const pathname = (req.url || '').split('?')[0].replace(/\/+$/, '')
    if (pathname !== ROUTE_PREFIX + '/inspect') {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    let body = {}
    try {
      const raw = await readBody(req)
      if (raw.trim().length > 0) body = JSON.parse(raw)
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' })
      return
    }
    try {
      sendJson(res, 200, await inspectArchivedSession({
        workspaceRegistry: ctx.get('workspaceRegistry'),
        sessionPersistence: ctx.get('sessionPersistence'),
        sessions: ctx.get('sessions'),
      }, body))
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
  if (typeof ctx.webServer?.register !== 'function') {
    throw new Error('web server route registration capability unavailable')
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }), 'dsh-archived-sessions: ' + ROUTE_PREFIX + ' route')
}
