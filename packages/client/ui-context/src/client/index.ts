/**
 * Context view plugin, browser half: the `context` Conversation View (unit list,
 * unit detail, rewrite editor, preparation review), the rewritten-unit marker in
 * the Chat transcript, and the occupancy-panel action that selects the view.
 *
 * Each Session gets one controller over the generated `sessionContext` Remote
 * namespace; the view activates its reads only while mounted, so an idle tab
 * costs no Host traffic. The marker row is a Chat business Definition over the
 * durable `context/rewrite` event, which the Host emits on every commit.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: the generated Remote namespaces and ctx.remote merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the Chat node seat and its keyed data map.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: the Conversation service, its View seat, and the composer meter seat.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the locale plugin's Context merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the renderer-owned slots service.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the Session standard useProjection seat.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { ContextMeterAction } from './ContextMeterAction.tsx'
import { ContextView } from './ContextView.tsx'
import { registerContextRewriteNode } from './context-rewrite-node.tsx'
import { SessionContextController } from './controller.ts'
import { en, NS, zh } from './locales.ts'
import { createContextViewStore } from './store.ts'
import type { ContextMeterActionInjected, ContextViewInjected } from './slots.ts'

export type { SessionContextKey } from './locales.ts'
export type { ContextMeterActionProps } from './ContextMeterAction.tsx'
export type {
  ContextMeterActionInjected, ContextRewriteSubmission, ContextViewInjected, ContextViewProps,
} from './slots.ts'

/** Required services: slots, copy, Session bindings, both conversation faces, and the Remote reads. */
export const inject = [
  'slots', 'locale', 'sessions', 'uiConversation', 'conversation', 'remote', 'remote.sessionContext',
]

/** Conversation View id this package owns. */
const CONTEXT_VIEW = 'context'

/**
 * Client plugin body: dictionaries, the per-Session controllers, the View, its
 * occupancy-panel action, and the transcript marker.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-context: dictionaries')
  const t = ctx.locale.bind(NS)
  const store = createContextViewStore()
  const controllers = new Map<SessionId, SessionContextController>()

  const openContext = (sessionId: SessionId): void => {
    const scoped = ctx.sessions.scope(sessionId)
    const conversation = scoped?.get('conversation')
    if (conversation === undefined) throw new Error(`ui-context: session "${sessionId}" has no conversation service`)
    conversation.requestView(CONTEXT_VIEW)
  }

  registerContextRewriteNode(ctx, openContext)

  const controllerFor = (sessionId: SessionId): SessionContextController => {
    const existing = controllers.get(sessionId)
    if (existing !== undefined) return existing
    const session = ctx.sessions.binding(sessionId)?.session
    if (session === undefined) throw new Error(`ui-context: session "${sessionId}" is unavailable`)
    const controller = new SessionContextController(
      ctx.remote.sessionContext,
      sessionId,
      session.projections.faceOf('contextPressure'),
    )
    controllers.set(sessionId, controller)
    return controller
  }

  ctx.effect(() => () => {
    for (const controller of controllers.values()) controller.dispose()
    controllers.clear()
  }, 'ui-context: per-session controllers')

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: CONTEXT_VIEW,
    order: 5,
    label: () => t('view.context'),
    locale: NS,
    store,
    inject: (sessionId: SessionId): ContextViewInjected => {
      const controller = controllerFor(sessionId)
      return {
        hooks: { controller },
        activate: () => controller.activate(),
        refresh: () => controller.refresh(),
        loadEarlier: () => controller.loadEarlier(),
        readUnit: unitId => controller.readUnit(unitId),
        rewrite: request => controller.rewrite(request),
        prepare: request => controller.prepare(request),
        editPreparation: request => controller.editPreparation(request),
        discardPreparation: request => controller.discardPreparation(request),
        commitPreparation: request => controller.commitPreparation(request),
        readHistory: (checkpointId, more) => controller.readHistory(checkpointId, more),
        searchHistory: (checkpointId, query, more) => controller.searchHistory(checkpointId, query, more),
      }
    },
  }, ContextView))

  ctx.slots.inject('conversation.context.meter.action', () => ctx.slots.register({
    name: 'conversation.context.meter.action',
    id: CONTEXT_VIEW,
    order: 10,
    locale: NS,
    inject: (sessionId: SessionId): ContextMeterActionInjected => ({
      openContext: () => { openContext(sessionId) },
    }),
  }, ContextMeterAction))
}
