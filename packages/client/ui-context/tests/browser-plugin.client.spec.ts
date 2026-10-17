/** Browser plugin registration and HMR teardown over the real slot and Definition registries. */

import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ConversationEventRegistry } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { NS, zh } from '../src/client/locales.ts'

const SID = 'context-plugin' as SessionId

/** View ids the fake conversation service was asked to select. */
const requested: string[] = []

/** Boot the browser half over the declarations it contributes to. */
async function bench(): Promise<{
  ctx: Context
  events: ConversationEventRegistry
  fiber: ReturnType<Context['plugin']>
}> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.view': { kind: 'list', scope: 'session' },
      'conversation.chat.node': { kind: 'keyed', scope: 'session' },
      'conversation.context.meter.action': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  const binding = {
    sessionId: SID,
    session: { projections: { faceOf: () => createSnapshotStore<unknown>(undefined) } },
  }
  ctx.provide('sessions', {
    binding: (sessionId: SessionId) => (sessionId === SID ? binding : undefined),
    scope: (sessionId: SessionId) => (sessionId === SID
      ? {
        get: (name: string) => (name === 'conversation'
          ? { requestView: (view: string) => { requested.push(view) } }
          : undefined),
      }
      : undefined),
  } as never)
  ctx.provide('conversation', {} as never)
  // The real Definition registry: its registrations are effects owned by the
  // calling plugin's fiber, which is what the disposal assertion checks.
  const events = new ConversationEventRegistry(ctx)
  ctx.provide('uiConversation', {
    events,
    views: { entries: () => [], subscribe: () => () => {} },
  } as never)
  ctx.provide('remote', {} as never)
  ctx.provide('remote.sessionContext', {} as never)
  // The locale plugin binds a settings scope, which reads the connection handle.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  // These specs assert the shipped Chinese copy; state the locale explicitly
  // because no browser language detection runs in this lane.
  ctx.locale.setLocale('zh')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, events, fiber }
}

describe('ui-context browser plugin', () => {
  it('declares every service it reads', () => {
    expect(inject).toEqual([
      'slots', 'locale', 'sessions', 'uiConversation', 'conversation', 'remote', 'remote.sessionContext',
    ])
  })

  it('registers the Context View, its occupancy action, and the rewrite marker, and removes them on disposal', async () => {
    const { ctx, events, fiber } = await bench()
    expect(ctx.slots.entries('conversation.view').map(entry => entry.options.id)).toEqual(['context'])
    expect(ctx.slots.entries('conversation.context.meter.action').map(entry => entry.options.id)).toEqual(['context'])
    expect(ctx.slots.entries('conversation.chat.node').map(entry => entry.options.key)).toEqual(['context-rewrite'])
    expect(events.entries().map(definition => definition.kind)).toEqual(['context-rewrite'])
    expect(ctx.locale.bind(NS)('view.context')).toBe(zh['view.context'])


    await fiber.dispose()

    expect(ctx.slots.entries('conversation.view')).toEqual([])
    expect(ctx.slots.entries('conversation.context.meter.action')).toEqual([])
    expect(ctx.slots.entries('conversation.chat.node')).toEqual([])
    expect(ctx.locale.bind(NS)('view.context')).not.toBe(zh['view.context'])
  })

  it('selects the Context View through the session-scoped conversation service', async () => {
    const { ctx } = await bench()
    const entry = ctx.slots.entries('conversation.context.meter.action')[0]
    expect(entry).toBeDefined()
    const injected = entry?.inject?.(SID as never) as { openContext: () => void } | undefined
    injected?.openContext()
    expect(requested).toEqual(['context'])
  })

  it('matches only durable rewrite events for the marker Definition', async () => {
    const { events } = await bench()
    const definition = events.entries()[0]
    expect(definition?.match({
      type: 'context/rewrite',
      seq: 7,
      time: 1,
      data: {
        rewriteId: 'rewrite',
        mode: 'edit-and-continue',
        replacementSeq: 8,
        shadowedRange: { start: 4, end: 6 },
        shadowedSeqs: [4, 5, 6],
        shadowedTokenCount: 120,
      },
    } as never)).toEqual({ id: 'rewrite', role: 'start' })
    expect(definition?.match({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } } as never)).toBeNull()
  })
})
