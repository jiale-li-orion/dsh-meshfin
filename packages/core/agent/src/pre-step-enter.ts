/**
 * How a pre-step listener adds its own snapshot context to the step's batch.
 *
 * Such a listener hands the chain's `enter` decision forward unchanged apart
 * from one appended message: the `snapshot`-form plugin message the model reads
 * as this plugin's contribution. Attribution and form belong together — the
 * message's `sections` are what the source names — so the two are built here
 * rather than shaped by each plugin.
 *
 * @module @deepseek-ai/dsh-agent/pre-step-enter
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { PreStepDecision } from './runtime-types.ts'

/**
 * Enter the step with its proposed batch followed by one plugin snapshot
 * message.
 * @param decision - the batch decision the downstream chain produced.
 * @param plugin - the contributing plugin's name, recorded as the message's source and section name.
 * @param text - the snapshot text carried to the model.
 * @returns the enter decision holding the batch, then the appended snapshot message.
 */
export function enterWithSnapshotMessage(
  decision: Extract<PreStepDecision, { kind: 'enter' }>,
  plugin: string,
  text: string,
): PreStepDecision {
  return {
    kind: 'enter',
    messages: [
      ...decision.messages,
      createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin, form: 'snapshot', sections: [{ name: plugin, text }] },
      }),
    ],
  }
}
