/** Chat marker for one same-Session context rewrite. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ConversationMatch,
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ContextRewriteNode.module.css'

/** Transcript payload of one durable rewrite marker. */
export interface ContextRewriteChatData {
  /** Whether the dependent suffix was superseded or retained. */
  readonly mode: 'edit-and-continue' | 'patch'
  /** Surface nodes the rewrite removed, in surface order. */
  readonly shadowedItemCount: number
  /** Route-priced total of the removed nodes at rewrite time. */
  readonly shadowedTokenCount: number
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Same-Session context rewrite marker. */
    'context-rewrite': ContextRewriteChatData
  }
}

interface ContextRewriteState {
  readonly match: ConversationMatch
}

/** Fold the durable `context/rewrite` event into the marker's payload. */
function rewriteData(context: ConversationNodeContext<ContextRewriteState>): ContextRewriteChatData | undefined {
  const event = context.state?.match.event
  if (event?.type !== 'context/rewrite') return undefined
  return {
    mode: event.data.mode,
    shadowedItemCount: event.data.shadowedSeqs.length,
    shadowedTokenCount: event.data.shadowedTokenCount,
  }
}

/** Marker Definition: one row per committed rewrite, anchored at the replacement. */
export const contextRewriteDefinition: ConversationNodeDefinition<ContextRewriteState> = {
  kind: 'context-rewrite',
  target: 'chat',
  match: event => event.type === 'context/rewrite'
    ? { id: event.data.rewriteId, role: 'start' }
    : null,
  start: (_context, match) => ({ match }),
  update: context => context.state,
  buildViewNode: (context) => {
    const data = rewriteData(context)
    const start = context.start ?? context.matches[0]
    if (data === undefined || start === undefined) return null
    return {
      key: context.key, kind: 'context-rewrite', id: context.id, target: 'chat',
      anchorSeq: start.event.seq, location: start.location,
      visibility: 'visible', data,
    } satisfies ChatNode<'context-rewrite'>
  },
}

interface ContextRewriteInjected {
  openContext: () => void
}

/** Props of the durable rewrite marker row; exported so a test can build one without a cast. */
export type ContextRewriteNodeProps =
  PropsRuntime<'conversation.chat.node', 'context-rewrite'>
  & InjectFace<ContextRewriteInjected>
  & PropsLocale<'sessionContext'>

/** The three inputs the marker actually reads; the rest of the slot contract is unused here. */
export type ContextRewriteMarkerProps = Pick<ContextRewriteNodeProps, 'node' | 'openContext' | 't'>

/**
 * Render the durable rewrite marker from just the payload, the view selection, and copy.
 * @param props - marker payload, the injected view selection, and copy.
 * @returns the marker row.
 */
export function ContextRewriteMarker({ node, openContext, t }: ContextRewriteMarkerProps) {
  const data = node.data
  return (
    <div className={css.root}>
      <div>
        <strong>{t('rewrite.markerTitle')}</strong>
        <span>
          {data.mode === 'patch'
            ? t('rewrite.markerPatch')
            : t('rewrite.markerEdit', {
              count: data.shadowedItemCount,
              tokens: data.shadowedTokenCount,
            })}
        </span>
      </div>
      <Button size="sm" variant="toolbar" onClick={openContext}>{t('rewrite.openContext')}</Button>
    </div>
  )
}

/**
 * Register the rewrite business Definition and its keyed Chat renderer.
 * @param ctx - client root context carrying the Conversation and slot registries.
 * @param openContext - select the Context view for one Session.
 */
/**
 * Slot-shaped entry: the chat node contract, narrowed to the marker's three inputs.
 * @param props - the full chat node props the slot passes.
 * @returns the marker row.
 */
export function ContextRewriteNode(props: ContextRewriteNodeProps) {
  return <ContextRewriteMarker node={props.node} openContext={props.openContext} t={props.t} />
}

export function registerContextRewriteNode(ctx: Context, openContext: (sessionId: SessionId) => void): void {
  ctx.uiConversation.events.register(contextRewriteDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'context-rewrite',
    locale: 'sessionContext',
    inject: (sessionId: SessionId): ContextRewriteInjected => ({ openContext: () => { openContext(sessionId) } }),
  }, ContextRewriteNode))
}
