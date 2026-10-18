/**
 * Client-origin derivation: which class of client sent one open turn's prompt,
 * derived from the class recorded on that turn's durable user messages, and the
 * statement the model reads about it.
 *
 * Three coarse buckets, so a reader can tell a phone app from a desktop browser
 * and nothing finer. A turn whose messages disagree is reported as mixed rather
 * than collapsed into the last writer's value.
 * @module @deepseek-ai/dsh-client-origin/origin
 */

import { CLIENT_DEVICES } from '@deepseek-ai/dsh-llm'
import type { ClientDevice, UserMessage } from '@deepseek-ai/dsh-llm'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/** Client classes derived from the user messages of one open turn. */
export type ClientOriginContext =
  | { readonly kind: 'resolved'; readonly device: ClientDevice }
  | { readonly kind: 'mixed'; readonly devices: readonly ClientDevice[] }
  | { readonly kind: 'missing' }

/** Which known client class a value names, or `undefined` for anything else. */
function asClientDevice(value: string): ClientDevice | undefined {
  return CLIENT_DEVICES.find(device => device === value)
}

/**
 * Read and validate the client class of one ordinary user-rpc message.
 * @param message - a message of the open turn.
 * @returns the declared class, or undefined when the message declares none.
 * @throws TypeError when the declared value is outside the closed set.
 */
function clientDevice(message: UserMessage): ClientDevice | undefined {
  const source = message.source
  // Read as unknown durable JSON: the `user-rpc` source that carries the class is
  // declared by the package that writes prompts, not by this reader, so its
  // fields arrive by the `in` check alone and every value is validated here.
  if (source.kind !== 'user' || !('rpcId' in source) || !('clientDevice' in source)) return undefined
  const declared: unknown = source.clientDevice
  if (declared === undefined) return undefined
  const known = typeof declared === 'string' ? asClientDevice(declared) : undefined
  if (known === undefined) {
    throw new TypeError(
      `client device must be one of ${CLIENT_DEVICES.join(', ')}: ${JSON.stringify(declared)}`,
    )
  }
  return known
}

/**
 * Derive the client classes of one open turn.
 * @param messages - the turn's user messages, in order.
 * @returns the single class, the disagreeing set, or nothing when none declared it.
 */
export function deriveClientOriginContext(messages: readonly UserMessage[]): ClientOriginContext {
  const devices: ClientDevice[] = []
  for (const message of messages) {
    const device = clientDevice(message)
    if (device !== undefined && !devices.includes(device)) devices.push(device)
  }
  const [first, second] = devices
  if (first === undefined) return { kind: 'missing' }
  if (second === undefined) return { kind: 'resolved', device: first }
  return { kind: 'mixed', devices }
}

/**
 * What follows from one class, for the model.
 * @param device - the class that sent the request.
 * @returns the guidance that class implies, and nothing a different class implies.
 */
function guidanceFor(device: ClientDevice): string {
  switch (device) {
    case 'mobile-app':
      return 'It is the phone app: a small screen, and the paths it names are the ones it can '
        + 'reach, not the ones this machine can.'
    case 'mobile-browser':
      return 'It is a browser on a phone: a small screen, and neither this machine\'s paths nor '
        + 'its clipboard are the ones the person is holding.'
    case 'desktop-browser':
      return 'It is a browser on a computer: it can take a long answer, and the paths it names '
        + 'may be this machine\'s own.'
    /* v8 ignore next 2 -- the closed ClientDevice union is exhausted above. */
    default:
      return assertNever(device, 'ClientDevice')
  }
}

/**
 * Render the client class for the model request.
 * @param context - the derived class.
 * @returns the model-facing statement, including what to do when it is unknown.
 */
export function renderClientOriginContext(context: ClientOriginContext): string {
  switch (context.kind) {
    case 'resolved':
      return `Client that sent this request: ${context.device}. ${guidanceFor(context.device)}`
    case 'mixed':
      return `Client that sent this request: mixed ${JSON.stringify(context.devices)}. `
        + 'This turn\'s messages did not all come from the same client; say which one an instruction is for.'
    case 'missing':
      return 'Client that sent this request: unavailable. '
        + 'Do not assume which device the person is using.'
    /* v8 ignore next 2 -- the closed ClientOriginContext union is exhausted above. */
    default:
      return assertNever(context, 'ClientOriginContext')
  }
}
