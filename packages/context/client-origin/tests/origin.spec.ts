/**
 * Client-origin derivation: which class one open turn declares, and what the
 * model is told about it.
 */
import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { deriveClientOriginContext, renderClientOriginContext } from '../src/origin.ts'

/** One ordinary user-rpc message declaring the given class, when any. */
function prompt(device?: unknown): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: (device === undefined
      ? { kind: 'user', rpcId: 'rpc' }
      : { kind: 'user', rpcId: 'rpc', clientDevice: device }) as never,
  })
}

describe('deriveClientOriginContext', () => {
  it('resolves the class a turn declares', () => {
    expect(deriveClientOriginContext([prompt('mobile-app')]))
      .toEqual({ kind: 'resolved', device: 'mobile-app' })
  })

  it('reports disagreement rather than the last writer', () => {
    expect(deriveClientOriginContext([prompt('mobile-app'), prompt('desktop-browser')]))
      .toEqual({ kind: 'mixed', devices: ['mobile-app', 'desktop-browser'] })
  })

  it('ignores repeated declarations of one class', () => {
    expect(deriveClientOriginContext([prompt('mobile-browser'), prompt('mobile-browser')]))
      .toEqual({ kind: 'resolved', device: 'mobile-browser' })
  })

  it('reports nothing when no message declares a class', () => {
    expect(deriveClientOriginContext([prompt()])).toEqual({ kind: 'missing' })
    expect(deriveClientOriginContext([])).toEqual({ kind: 'missing' })
  })

  it('ignores a message that did not come from a client prompt', () => {
    const injected = createUserMessage({
      content: [{ type: 'text', text: 'injected' }],
      source: { kind: 'client-origin', form: 'snapshot', sections: [] },
    })
    const loopContext = createUserMessage({
      content: [{ type: 'text', text: 'runtime' }],
      source: { kind: 'runtime-context', form: 'snapshot', sections: [] },
    })
    expect(deriveClientOriginContext([injected, loopContext])).toEqual({ kind: 'missing' })
  })

  it('refuses a class outside the closed set', () => {
    // A producer that invents a bucket would otherwise reach the model unread.
    expect(() => deriveClientOriginContext([prompt('tablet')])).toThrow(TypeError)
    expect(() => deriveClientOriginContext([prompt(7)])).toThrow(TypeError)
  })
})

describe('renderClientOriginContext', () => {
  it('states the class and only what follows from that class', () => {
    const desktop = renderClientOriginContext({ kind: 'resolved', device: 'desktop-browser' })
    expect(desktop).toContain('desktop-browser')
    // Guidance written for a phone must not follow a desktop client: a reader
    // that is told about a small screen when the screen is large is misled.
    expect(desktop).not.toContain('small screen')
    expect(desktop).toContain('long answer')

    expect(renderClientOriginContext({ kind: 'resolved', device: 'mobile-app' }))
      .toContain('small screen')
    expect(renderClientOriginContext({ kind: 'resolved', device: 'mobile-browser' }))
      .toContain('browser on a phone')
  })

  it('names every class when a turn disagrees', () => {
    const text = renderClientOriginContext({ kind: 'mixed', devices: ['mobile-app', 'desktop-browser'] })
    expect(text).toContain('mobile-app')
    expect(text).toContain('desktop-browser')
  })

  it('says so when the class is unknown instead of guessing one', () => {
    expect(renderClientOriginContext({ kind: 'missing' })).toContain('unavailable')
  })
})
