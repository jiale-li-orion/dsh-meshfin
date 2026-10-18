/**
 * Pre-step wiring through the real agent event dispatch: the class is stated
 * once per turn, at the step that opens it, and a turn that declares nothing is
 * left exactly as the chain decided.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as clientOrigin from '../src/index.ts'

const SIGNAL = new AbortController().signal

/** One ordinary user-rpc message declaring the given class, when any. */
function prompt(device?: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: (device === undefined
      ? { kind: 'user', rpcId: 'rpc' }
      : { kind: 'user', rpcId: 'rpc', clientDevice: device }) as never,
  })
}

/** An agent over a real Session, with the inbox the pre-step chain never reads here. */
function sessionAgent(session: Session, id = 'agent'): Agent {
  return {
    id: SessionId(id),
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('client-origin must append directly to the open step') },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** Run the mounted waterfall over one proposed step, exactly as the loop would. */
async function decide(
  messages: UserMessage[],
  step: number,
  signal: AbortSignal = SIGNAL,
): Promise<PreStepDecision> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(clientOrigin)
  const session = Session.create(SessionId('client-origin'))
  const agent = sessionAgent(session)
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages, turn: 1, step, signal },
    () => Promise.resolve<PreStepDecision>({ kind: 'enter', messages }),
  )
}

/** The injected statement's text, when one was injected. */
function injectedText(decision: PreStepDecision): string | undefined {
  if (decision.kind === 'reject') return undefined
  const [added] = decision.messages.filter(message => message.source.kind === 'client-origin')
  return added?.content[0]?.type === 'text' ? added.content[0].text : undefined
}

describe('client-origin pre-step', () => {
  it('declares its name and the registry it needs', () => {
    expect(clientOrigin.name).toBe('client-origin')
    expect(clientOrigin.inject).toEqual(['agents'])
  })

  it('states the class once, at the step that opens the turn', async () => {
    const decision = await decide([prompt('mobile-app')], 1)
    expect(decision.kind).toBe('enter')
    expect(injectedText(decision)).toContain('mobile-app')
  })

  it('leaves later steps alone: the class cannot change inside its turn', async () => {
    const decision = await decide([prompt('mobile-app')], 2)
    expect(injectedText(decision)).toBeUndefined()
    expect(decision.kind === 'enter' && decision.messages).toHaveLength(1)
  })

  it('records the statement as its own snapshot source', async () => {
    const decision = await decide([prompt('desktop-browser')], 1)
    expect(decision.kind).toBe('enter')
    const added = decision.kind === 'enter'
      ? decision.messages.find(message => message.source.kind === 'client-origin')
      : undefined
    expect(added?.source).toMatchObject({
      kind: 'client-origin',
      form: 'snapshot',
      sections: [{ name: 'client-origin' }],
    })
  })

  it('keeps the messages the chain already decided to send', async () => {
    const kept = prompt('mobile-app')
    const decision = await decide([kept], 1)
    expect(decision.kind === 'enter' && decision.messages[0]).toBe(kept)
    expect(decision.kind === 'enter' && decision.messages).toHaveLength(2)
  })

  it('leaves a turn that declares nothing exactly as the chain decided', async () => {
    const undecorated = prompt()
    const decision = await decide([undecorated], 1)
    expect(decision.kind === 'enter' && decision.messages).toEqual([undecorated])
  })

  it('never injects into an aborted step', async () => {
    const aborted = new AbortController()
    aborted.abort()
    const decision = await decide([prompt('mobile-app')], 1, aborted.signal)
    expect(injectedText(decision)).toBeUndefined()
  })
})
