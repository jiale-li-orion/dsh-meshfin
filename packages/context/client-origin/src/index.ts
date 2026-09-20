/**
 * Client-origin context: eligible steps tell the model which kind of client sent
 * the turn's prompt, so an answer can be written for the screen in hand.
 *
 * The class is read from the durable user message rather than from the transport,
 * so what the model is told is exactly what the log can replay.
 *
 * @module @deepseek-ai/dsh-client-origin
 */

import type { Context } from '@deepseek-ai/cordis'
import { collectTurnUserMessages, enterWithSnapshotMessage } from '@deepseek-ai/dsh-agent'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { deriveClientOriginContext, renderClientOriginContext } from './origin.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'client-origin'

/** The agent registry that owns pre-step processing. */
export const inject = ['agents']

/**
 * Register the pre-step injection. The class is stated once per turn, at the
 * step that opens it: it cannot change while the turn it belongs to is open, and
 * repeating it every step would spend context on a fact that has not moved.
 * @param ctx - the plugin context.
 */
export function apply(ctx: Context): void {
  ctx.on('agent/pre-step', async (
    { agent, turn, step, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted || step !== 1) return decision
    const origin = deriveClientOriginContext(
      collectTurnUserMessages(agent.session.readLog(), turn, decision.messages),
    )
    if (origin.kind === 'missing') return decision
    const text = renderClientOriginContext(origin)
    return enterWithSnapshotMessage(decision, name, text)
  }, { prepend: true })
}
