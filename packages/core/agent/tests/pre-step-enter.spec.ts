/**
 * `enterWithSnapshotMessage` builds the enter decision a pre-step listener
 * returns: the step's own batch, followed by the listener's snapshot message.
 */

import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { enterWithSnapshotMessage } from '@deepseek-ai/dsh-agent'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'

/** A user message with distinguishable text. */
function message(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** The batch of an enter decision, failing the test on any other kind. */
function entered(decision: PreStepDecision): UserMessage[] {
  if (decision.kind !== 'enter') throw new Error(`expected an enter decision, got ${decision.kind}`)
  return decision.messages
}

describe('enterWithSnapshotMessage', () => {
  it('appends one attributed snapshot message after the step batch', () => {
    const batch = message('prompt')

    const decision = enterWithSnapshotMessage({ kind: 'enter', messages: [batch] }, 'time-context', 'clock text')

    const messages = entered(decision)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual(batch)
    expect(messages[1]?.content).toEqual([{ type: 'text', text: 'clock text' }])
    expect(messages[1]?.source).toEqual({
      kind: 'plugin',
      plugin: 'time-context',
      form: 'snapshot',
      sections: [{ name: 'time-context', text: 'clock text' }],
    })
  })

  it('keeps the batch order and hands back a fresh message array', () => {
    const batch = [message('first'), message('second')]

    const messages = entered(enterWithSnapshotMessage({ kind: 'enter', messages: batch }, 'client-origin', 'class'))

    expect(messages.slice(0, 2)).toEqual(batch)
    expect(messages).not.toBe(batch)
  })
})
