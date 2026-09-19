/**
 * Playwright MCP browser provider: reserves the composition's browser-use slot
 * for Playwright's browser tools and refuses a launch or attachment choice that
 * cannot work.
 *
 * The server is external. In this baseline the tools arrive through the
 * row-based MCP client, so a companion row (`@deepseek-ai/dsh-mcp-client`
 * starting `@playwright/mcp` with the arguments {@link browserServerArgs}
 * derives) owns the child process, its environment, and its tool descriptions.
 * This provider owns the capability contract instead: the single-provider slot,
 * the launch-versus-attach decision, and the arguments the companion row must
 * pass so a deployment cannot drift from the validated choice.
 * @module @deepseek-ai/dsh-browser-use-playwright-mcp
 */

import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { BrowserUseProviderName } from '@deepseek-ai/dsh-browser-use/brand'
import type {} from '@deepseek-ai/dsh-browser-use'

/** Provider registration identity used in diagnostics. */
export const PROVIDER_NAME = 'playwright-mcp'

/** Cordis plugin name. */
export const name = 'browser-use-playwright-mcp'

/** The browser-use slot this provider reserves; nothing else is required. */
export const inject = ['browserUse']

/** Browser engines this provider starts; the companion server accepts one. */
const BROWSER = 'chromium'

/** Launch a browser this provider owns for the whole composition. */
export interface LaunchConfig {
  /** Selects a newly launched isolated browser. */
  mode: 'launch'
  /** Whether the browser runs without a visible window; defaults to true. */
  headless?: boolean
  /** Browser executable; omission uses the server's own installation discovery. */
  executablePath?: string
  /** Per-call timeout override in milliseconds; omission uses the MCP client default. */
  toolCallTimeoutMs?: number
}

/** Attach to a browser this provider does not own. */
export interface AttachConfig {
  /** Selects an existing debugging endpoint. */
  mode: 'attach'
  /** HTTP(S) debugging URL or WS(S) browser debugging endpoint. */
  endpoint: string
  /** Per-call timeout override in milliseconds; omission uses the MCP client default. */
  toolCallTimeoutMs?: number
}

/** Browser launch or attachment choice. */
export type Config = LaunchConfig | AttachConfig

/** Launch choice with the headless default applied. */
export interface LaunchChoice {
  /** Selects a newly launched isolated browser. */
  mode: 'launch'
  /** Whether the browser runs without a visible window. */
  headless: boolean
  /** Browser executable; omission uses the server's own installation discovery. */
  executablePath?: string
  /** Per-call timeout override in milliseconds; omission uses the MCP client default. */
  toolCallTimeoutMs?: number
}

/** Attachment choice after endpoint validation. */
export interface AttachChoice {
  /** Selects an existing debugging endpoint. */
  mode: 'attach'
  /** Validated HTTP(S) debugging URL or WS(S) browser debugging endpoint. */
  endpoint: string
  /** Per-call timeout override in milliseconds; omission uses the MCP client default. */
  toolCallTimeoutMs?: number
}

/** Resolved browser choice handed to {@link browserServerArgs}. */
export type BrowserChoice = LaunchChoice | AttachChoice

export const Config = z.union([
  z.object({
    mode: z.const('launch').required(),
    headless: z.boolean().default(true),
    executablePath: z.string().pattern(/\S/u),
    toolCallTimeoutMs: z.number().min(1),
  }),
  z.object({
    mode: z.const('attach').required(),
    endpoint: z.string().required().pattern(/^(https?|wss?):\/\/[^\s/]+/u),
    toolCallTimeoutMs: z.number().min(1),
  }),
]) as unknown as z<Config>

/** Debugging endpoint schemes the browser server accepts. */
const ENDPOINT_PROTOCOLS = ['http:', 'https:', 'ws:', 'wss:']

/**
 * Reject an unusable browser choice before the provider reserves browser use,
 * and apply the headless default explicitly so a programmatic caller that
 * bypassed the config schema resolves the same choice a deployment does.
 * @param config - browser launch or attachment choice.
 * @returns the resolved choice with defaults applied and the endpoint validated.
 * @throws Error when an attachment endpoint is not an HTTP(S) or WS(S) URL.
 */
export function resolveBrowserChoice(config: Config): BrowserChoice {
  if (config.mode !== 'attach') {
    return {
      ...config,
      headless: config.headless ?? true,
    }
  }
  let endpoint: URL
  try {
    endpoint = new URL(config.endpoint)
  } catch (error) {
    throw new Error('browser endpoint must be a valid HTTP(S) or WS(S) URL', { cause: error })
  }
  if (!ENDPOINT_PROTOCOLS.includes(endpoint.protocol) || /\s/u.test(config.endpoint)) {
    throw new Error('browser endpoint must be a valid HTTP(S) or WS(S) URL without whitespace')
  }
  return config
}

/**
 * Command-line arguments the companion `@deepseek-ai/dsh-mcp-client` row passes
 * to `@playwright/mcp`, so the validated choice and the running server agree.
 * @param choice - resolved browser choice.
 * @returns the arguments after the server entry point, in the server's order.
 */
export function browserServerArgs(choice: BrowserChoice): string[] {
  const args = ['--browser', BROWSER]
  if (choice.mode === 'attach') {
    args.push('--cdp-endpoint', choice.endpoint)
    return args
  }
  args.push('--isolated')
  if (choice.headless) args.push('--headless')
  if (choice.executablePath !== undefined) args.push('--executable-path', choice.executablePath)
  return args
}

/**
 * Reserve the browser-use slot after the browser choice resolves.
 * @param ctx - owning Cordis context.
 * @param config - browser launch or attachment choice.
 */
export function apply(ctx: Context, config: Config): void {
  resolveBrowserChoice(config)
  ctx.browserUse.register(BrowserUseProviderName(PROVIDER_NAME))
}
