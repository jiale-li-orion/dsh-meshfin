import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, CallId, ReasoningEffortId, createMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { serializeMessages, serializeRequest } from '../src/serialize.ts'
import type { WireImageReader } from '../src/serialize.ts'

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return { provider: 'deepseek-official', model: 'deepseek-v4-flash', messages: [], ...overrides }
}

const IMAGE_REF: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png',
  bytes: 3,
  width: 1,
  height: 1,
}

/** Reader for a model that declares image input; bytes `[1,2,3]` encode to `AQID`. */
const readImage: WireImageReader = () => Promise.resolve({ ref: IMAGE_REF, data: new Uint8Array([1, 2, 3]) })

const IMAGE_PART = { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AQID' } }
const OMITTED_PART = { type: 'text' as const, text: '[image omitted: the request image budget was exceeded]' }

/** A reader whose payload is `size` arbitrary bytes, for budget arithmetic. */
function readerOfSize(size: number): WireImageReader {
  return () => Promise.resolve({ ref: IMAGE_REF, data: new Uint8Array(size).fill(7) })
}

/** One user message carrying one image. */
function imageMessage(): Message {
  return createUserMessage({ content: [{ type: 'image', attachment: IMAGE_REF }], source: { kind: 'plugin', plugin: 'test' } })
}

describe('serializeMessages', () => {
  it('maps user text to string content', async () => {
    const wire = await serializeMessages([
      createUserMessage({
        content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'user', content: 'hello world' }])
  })

  it('maps system-role messages in history', async () => {
    const wire = await serializeMessages([
      createMessage({
        role: 'system', content: [{ type: 'text', text: 'be brief' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'system', content: 'be brief' }])
  })

  it('maps plain assistant text without reasoning_content', async () => {
    const wire = await serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking…' },
          { type: 'text', text: 'answer' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    // Tool-call-free turn: reasoning is dropped (ignored by the API anyway).
    expect(wire).toEqual([{ role: 'assistant', content: 'answer' }])
  })

  it('passes reasoning_content back on tool-call turns (official passback rule)', async () => {
    const wire = await serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'I should check the weather.' },
          { type: 'tool-call', id: CallId('call-1'), name: 'get_weather', arguments: '{"city":"Paris"}' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{
      role: 'assistant',
      // "" (not null) on tool-call turns — mirrors the official samples'
      // verbatim message replay; some gateways reject null.
      content: '',
      reasoning_content: 'I should check the weather.',
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }],
    }])
  })

  it('serializes parallel tool calls in order', async () => {
    const wire = await serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'tool-call', id: CallId('a'), name: 'one', arguments: '{}' },
          { type: 'tool-call', id: CallId('b'), name: 'two', arguments: '{}' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    const assistant = wire[0] as { tool_calls: { id: string }[] }
    expect(assistant.tool_calls.map(call => call.id)).toEqual(['a', 'b'])
  })

  it('turns tool results into role:tool messages', async () => {
    const wire = await serializeMessages([
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: CallId('call-1'),
          content: [{ type: 'text', text: 'Sunny 22C' }],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'tool', tool_call_id: 'call-1', content: 'Sunny 22C' }])
  })

  it('sends a sentinel for empty tool-result content', async () => {
    const wire = await serializeMessages([
      createUserMessage({
        content: [{ type: 'tool-result', toolCallId: CallId('call-1'), content: [] }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'tool', tool_call_id: 'call-1', content: '(no output)' }])
  })

  it('splits mixed user text + tool results into separate wire messages', async () => {
    const wire = await serializeMessages([
      createUserMessage({
        content: [
          { type: 'text', text: 'context note' },
          { type: 'tool-result', toolCallId: CallId('call-1'), content: [{ type: 'text', text: 'ok' }] },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([
      { role: 'user', content: 'context note' },
      { role: 'tool', tool_call_id: 'call-1', content: 'ok' },
    ])
  })

  it('skips plugin-added block types (merge-extensible ContentBlockMap)', async () => {
    const wire = await serializeMessages([
      createUserMessage({
        content: [
          { type: 'chart', data: 'x' } as unknown as ContentBlock,
          { type: 'text', text: 'see chart' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'user', content: 'see chart' }])
  })

  it('rejects image blocks instead of silently flattening them away', async () => {
    await expect(serializeMessages([createUserMessage({
      content: [{ type: 'image', attachment: IMAGE_REF }],
      source: { kind: 'plugin', plugin: 'test' },
    })])).rejects.toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' }))
  })

  it('encodes a user image as an image_url data URL for an image-capable model', async () => {
    const wire = await serializeMessages([createUserMessage({
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image', attachment: IMAGE_REF },
      ],
      source: { kind: 'plugin', plugin: 'test' },
    })], readImage)
    expect(wire).toEqual([{
      role: 'user',
      content: [{ type: 'text', text: 'what is this?' }, IMAGE_PART],
    }])
  })

  it('emits an image-only user message as a parts array', async () => {
    const wire = await serializeMessages([createUserMessage({
      content: [{ type: 'image', attachment: IMAGE_REF }],
      source: { kind: 'plugin', plugin: 'test' },
    })], readImage)
    expect(wire).toEqual([{ role: 'user', content: [IMAGE_PART] }])
  })

  it('keeps the bare string form for text-only content beside an image reader', async () => {
    const wire = await serializeMessages([createUserMessage({
      content: [{ type: 'text', text: 'no image here' }],
      source: { kind: 'plugin', plugin: 'test' },
    })], readImage)
    expect(wire).toEqual([{ role: 'user', content: 'no image here' }])
  })

  it('rejects an image on the assistant role even with a reader', async () => {
    await expect(serializeMessages([createMessage({
      role: 'assistant',
      content: [{ type: 'image', attachment: IMAGE_REF }],
      source: { kind: 'plugin', plugin: 'test' },
    })], readImage)).rejects.toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' }))
  })

  it('carries a tool result image in a user message after its tool message', async () => {
    const wire = await serializeMessages([createUserMessage({
      content: [{
        type: 'tool-result',
        toolCallId: CallId('call-1'),
        content: [
          { type: 'text', text: '<path>/tmp/dsh.png</path>' },
          { type: 'image', attachment: IMAGE_REF },
        ],
      }],
      source: { kind: 'plugin', plugin: 'test' },
    })], readImage)
    expect(wire).toEqual([
      { role: 'tool', tool_call_id: 'call-1', content: '<path>/tmp/dsh.png</path>' },
      { role: 'user', content: [{ type: 'text', text: 'Attached image(s) from tool result:' }, IMAGE_PART] },
    ])
  })

  it('batches images from consecutive tool results into one user message', async () => {
    const wire = await serializeMessages([
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: CallId('call-1'),
          content: [{ type: 'image', attachment: IMAGE_REF }],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: CallId('call-2'),
          content: [{ type: 'text', text: 'ok' }, { type: 'image', attachment: IMAGE_REF }],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ], readImage)
    expect(wire).toEqual([
      // An image-only result needs a sentinel so its tool message is not empty.
      { role: 'tool', tool_call_id: 'call-1', content: '(see attached image)' },
      { role: 'tool', tool_call_id: 'call-2', content: 'ok' },
      {
        role: 'user',
        content: [{ type: 'text', text: 'Attached image(s) from tool result:' }, IMAGE_PART, IMAGE_PART],
      },
    ])
  })

  it('ends the tool-result run at the next message', async () => {
    const wire = await serializeMessages([
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: CallId('call-1'),
          content: [{ type: 'text', text: 'ok' }],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      createUserMessage({
        content: [{ type: 'text', text: 'and now?' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ], readImage)
    expect(wire).toEqual([
      { role: 'tool', tool_call_id: 'call-1', content: 'ok' },
      { role: 'user', content: 'and now?' },
    ])
  })

  it('carries an image nested in a nested tool result', async () => {
    const wire = await serializeMessages([createUserMessage({
      content: [{
        type: 'tool-result',
        toolCallId: CallId('outer'),
        content: [{
          type: 'tool-result',
          toolCallId: CallId('inner'),
          content: [{ type: 'text', text: 'inner text' }, { type: 'image', attachment: IMAGE_REF }],
        }],
      }],
      source: { kind: 'plugin', plugin: 'test' },
    })], readImage)
    expect(wire).toEqual([
      { role: 'tool', tool_call_id: 'outer', content: 'inner text' },
      { role: 'user', content: [{ type: 'text', text: 'Attached image(s) from tool result:' }, IMAGE_PART] },
    ])
  })

  it('refuses a tool result image when the model takes no images', async () => {
    await expect(serializeMessages([createUserMessage({
      content: [{
        type: 'tool-result',
        toolCallId: CallId('call-1'),
        content: [{ type: 'image', attachment: IMAGE_REF }],
      }],
      source: { kind: 'plugin', plugin: 'test' },
    })])).rejects.toThrow('does not support image content for this model')
  })

  it('keeps user images and tool results in one message', async () => {
    const wire = await serializeMessages([createUserMessage({
      content: [
        { type: 'image', attachment: IMAGE_REF },
        { type: 'tool-result', toolCallId: CallId('call-1'), content: [{ type: 'text', text: 'ok' }] },
      ],
      source: { kind: 'plugin', plugin: 'test' },
    })], readImage)
    expect(wire).toEqual([
      { role: 'user', content: [IMAGE_PART] },
      { role: 'tool', tool_call_id: 'call-1', content: 'ok' },
    ])
  })

  it('drops empty text blocks from both content forms', async () => {
    const stringForm = await serializeMessages([createUserMessage({
      content: [{ type: 'text', text: '' }, { type: 'text', text: 'kept' }],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(stringForm).toEqual([{ role: 'user', content: 'kept' }])

    const partsForm = await serializeMessages([createUserMessage({
      content: [{ type: 'text', text: '' }, { type: 'image', attachment: IMAGE_REF }],
      source: { kind: 'plugin', plugin: 'test' },
    })], readImage)
    expect(partsForm).toEqual([{ role: 'user', content: [IMAGE_PART] }])
  })

  it('emits an empty user message rather than dropping block-less messages', async () => {
    const wire = await serializeMessages([createUserMessage({
      content: [],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire).toEqual([{ role: 'user', content: '' }])
  })
})

describe('serializeRequest', () => {
  const history: Message[] = [createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'plugin', plugin: 'test' },
  })]

  it('always streams with usage and maps the basics', async () => {
    const wire = await serializeRequest(request({ messages: history }))
    expect(wire).toEqual({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      stream_options: { include_usage: true },
    })
  })

  it('prepends the system prompt', async () => {
    const wire = await serializeRequest(request({ messages: history, system: 'be helpful' }))
    expect(wire.messages[0]).toEqual({ role: 'system', content: 'be helpful' })
    expect(wire.messages[1]).toEqual({ role: 'user', content: 'hi' })
  })

  it('maps sampling params and stop sequences', async () => {
    const wire = await serializeRequest(request({ messages: history, temperature: 0.2, maxTokens: 100, stop: ['END'] }))
    expect(wire.temperature).toBe(0.2)
    expect(wire.max_tokens).toBe(100)
    expect(wire.stop).toEqual(['END'])
  })

  it('maps tools to the wire function shape', async () => {
    const wire = await serializeRequest(request({
      messages: history,
      tools: [
        { name: 'a', description: 'A', parameters: { type: 'object', properties: {} } },
        { name: 'b', description: 'B', parameters: { type: 'object', properties: { x: { type: 'string' } } } },
      ],
    }))
    expect(wire.tools).toEqual([
      { type: 'function', function: { name: 'a', description: 'A', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'b', description: 'B', parameters: { type: 'object', properties: { x: { type: 'string' } } } } },
    ])
  })

  it('omits an empty tools array', async () => {
    const wire = await serializeRequest(request({ messages: history, tools: [] }))
    expect(wire.tools).toBeUndefined()
  })

  it('carries user images through the whole request body', async () => {
    const wire = await serializeRequest(request({
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: IMAGE_REF }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), {}, readImage)
    expect(wire.messages).toEqual([{ role: 'user', content: [IMAGE_PART] }])
  })

  it.each(['low', 'high', 'max'] as const)('maps adapter-default thinking and request effort %s', async (effort) => {
    const wire = await serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId(effort) }),
      { thinking: 'enabled', reasoningEffort: 'high' },
    )
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBe(effort)
  })

  it('maps off to disabled thinking without a wire reasoning effort', async () => {
    const wire = await serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('off') }),
      { thinking: 'enabled', reasoningEffort: 'max' },
    )
    expect(wire.thinking).toEqual({ type: 'disabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('re-enables thinking when max overrides an off default', async () => {
    const wire = await serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('max') }),
      { reasoningEffort: 'off' },
    )
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBe('max')
  })

  it('rejects enabling thinking when the deployment is locked to disabled', async () => {
    await expect(serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('high') }),
      { thinking: 'disabled' },
    )).rejects.toThrow(expect.objectContaining({ code: 'UNSUPPORTED_REASONING_EFFORT' }))
  })

  it('disables thinking for session-title requests without changing adapter defaults', async () => {
    const wire = await serializeRequest(
      request({
        messages: history,
        purpose: 'session-title',
        reasoningEffort: ReasoningEffortId('max'),
      }),
      { thinking: 'enabled', reasoningEffort: 'max' },
    )
    expect(wire.thinking).toEqual({ type: 'disabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('omits thinking fields when unset (provider default applies)', async () => {
    const wire = await serializeRequest(request({ messages: history }))
    expect(wire.thinking).toBeUndefined()
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('preserves an explicit enabled default without inventing a wire effort', async () => {
    const wire = await serializeRequest(request({ messages: history }), { thinking: 'enabled' })
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('rejects an effort outside the DeepSeek capability', async () => {
    await expect(serializeRequest(request({
      messages: history,
      reasoningEffort: ReasoningEffortId('medium'),
    }))).rejects.toThrow(expect.objectContaining({ code: 'UNSUPPORTED_REASONING_EFFORT' }))
  })
})

describe('review fixes: assistant content shapes', () => {
  it('serializes a content-less, tool-call-less assistant message as "" content, never null', async () => {
    // Aborted/empty assistant turns: no text, no calls → "". The earlier
    // null shape was live-falsified: the API 400s a null-content assistant
    // message without tool_calls ("content or tool_calls must be set").
    const wire = await serializeMessages([createMessage({
      role: 'assistant', content: [],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire).toEqual([{ role: 'assistant', content: '' }])
  })

  it('serializes a reasoning-ONLY assistant message as "" content with the reasoning dropped', async () => {
    // The model can answer entirely in the reasoning channel (a v4-flash
    // greeting did, live). The passback rule keeps reasoning_content off
    // plain turns, and content must still be SET — a null here poisoned the
    // session log and bricked every later turn of that session.
    const wire = await serializeMessages([createMessage({
      role: 'assistant', content: [{ type: 'reasoning', text: '你好！有什么我可以帮你的吗？' }],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire).toEqual([{ role: 'assistant', content: '' }])
  })

  it('serializes tool-call turns with empty string content, not null', async () => {
    const wire = await serializeMessages([createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: CallId('c'), name: 'f', arguments: '{}' }],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire[0]).toMatchObject({ content: '' })
  })
})

describe('request image budget', () => {
  it('keeps the newest images and replaces the oldest with a notice once the bound is reached', async () => {
    const wire = await serializeMessages([imageMessage(), imageMessage()], readerOfSize(1), 40)
    // One data URL is ~35 bytes, so only the newest occurrence fits in 40.
    expect(wire).toEqual([
      { role: 'user', content: [OMITTED_PART] },
      { role: 'user', content: [expect.objectContaining({ type: 'image_url' })] },
    ])
  })

  it('replaces an image that alone exceeds the bound, and sends no image at all with a zero budget', async () => {
    const single = await serializeMessages([imageMessage()], readerOfSize(1), 10)
    expect(single).toEqual([{ role: 'user', content: [OMITTED_PART] }])

    const wire = await serializeMessages([imageMessage()], readImage)
    expect(wire).toEqual([{ role: 'user', content: [IMAGE_PART] }])
  })
})
