/**
 * `collectTurnUserMessages` reads one turn's own user messages out of a session
 * log: the messages entered after that turn's `turn/start`, then the batch the
 * preparing step proposes.
 */

import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { collectTurnUserMessages } from '@deepseek-ai/dsh-agent'

/** A committed user message with distinguishable text. */
function message(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** Log one user message as a surface append, the way the loop enters a prompt. */
function enter(session: Session, text: string): void {
  session.append('user/message', message(text), { surfaceOp: 'append' })
}

/** The text blocks of a collected batch, in order. */
function texts(messages: readonly UserMessage[]): string[] {
  return messages.map(entry => String(entry.content.find(block => block.type === 'text')?.text))
}

describe('collectTurnUserMessages', () => {
  it("returns the turn's entered messages followed by the proposed batch", () => {
    const session = Session.create(SessionId('turn-messages'))
    session.append('turn/start', { turn: 1 })
    enter(session, 'opening prompt')
    enter(session, 'steering follow-up')

    const collected = collectTurnUserMessages(session.readLog(), 1, [message('proposed')])

    expect(texts(collected)).toEqual(['opening prompt', 'steering follow-up', 'proposed'])
  })

  it('returns only the proposed batch when the log holds no boundary for that turn', () => {
    const session = Session.create(SessionId('turn-messages-absent'))
    session.append('turn/start', { turn: 2 })
    enter(session, 'later turn prompt')

    expect(texts(collectTurnUserMessages(session.readLog(), 1, [message('proposed')])))
      .toEqual(['proposed'])
  })

  it('scans past a later turn to find the requested one', () => {
    const session = Session.create(SessionId('turn-messages-later-turn'))
    session.append('turn/start', { turn: 1 })
    enter(session, 'opening prompt')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })

    expect(texts(collectTurnUserMessages(session.readLog(), 1, [message('proposed')])))
      .toEqual(['opening prompt', 'proposed'])
  })

  it('collects an empty entered batch for a turn with no proposed messages', () => {
    const session = Session.create(SessionId('turn-messages-empty'))
    session.append('turn/start', { turn: 1 })

    expect(collectTurnUserMessages(session.readLog(), 1, [])).toEqual([])
  })
})
