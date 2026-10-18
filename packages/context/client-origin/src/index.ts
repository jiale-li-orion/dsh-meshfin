/**
 * Opt-in client-origin context. The step that opens a turn adds one durable,
 * source-attributed statement naming which class of client sent that turn's
 * prompt, so an answer can be written for the screen actually in hand.
 *
 * The class is read from the durable user messages of the turn rather than from
 * the transport, so what the model is told is exactly what the session log can
 * replay. Nothing is injected on a step whose messages declare no class: a
 * deployment whose clients report nothing adds no message rather than a guess.
 *
 * @module @deepseek-ai/dsh-client-origin
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Which client class the open turn's prompt declared; readers preserve the content without this producer.
     * @persistenceAttribution
     */
    'client-origin': { kind: 'client-origin' } & ContextFormed
  }
}

import { deriveClientOriginContext, renderClientOriginContext } from './origin.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'client-origin'

/** The agent registry that owns pre-step processing. */
export const inject = ['agents']

/**
 * Register a prepended pre-step listener for the lifetime of `ctx`.
 *
 * The class is stated once per turn, at the step that opens it: it cannot change
 * while the turn it belongs to is open, and repeating it every step would spend
 * context on a fact that has not moved.
 * @param ctx - plugin context; the listener is disposed with it.
 */
export function apply(ctx: Context): void {
  ctx.on('agent/pre-step', async (
    { messages, step, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted || step !== 1) return decision
    const origin = deriveClientOriginContext(messages)
    if (origin.kind === 'missing') return decision
    const text = renderClientOriginContext(origin)
    return {
      ...decision,
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: name, form: 'snapshot', sections: [{ name, text }] },
        }),
      ],
    }
  }, { prepend: true })
}
