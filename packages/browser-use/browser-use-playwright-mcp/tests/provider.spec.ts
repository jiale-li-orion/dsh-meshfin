/**
 * The Playwright MCP provider: it resolves the launch-or-attach choice, derives
 * the companion row's arguments from it, and reserves the slot only for a
 * choice that can run.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import BrowserUseRegistry from '@deepseek-ai/dsh-browser-use'
import { apply, browserServerArgs, resolveBrowserChoice } from '../src/index.ts'

/**
 * Mount the seam on a fresh context.
 * @returns the context and the seam.
 */
async function harness(): Promise<{ ctx: Context; registry: BrowserUseRegistry }> {
  const ctx = new Context()
  await ctx.plugin(BrowserUseRegistry)
  return { ctx, registry: ctx.browserUse }
}

describe('browser-use-playwright-mcp', () => {
  it('launches a headless isolated Chromium by default', () => {
    const choice = resolveBrowserChoice({ mode: 'launch' })
    expect(choice).toEqual({ mode: 'launch', headless: true })
    expect(browserServerArgs(choice)).toEqual(['--browser', 'chromium', '--isolated', '--headless'])
  })

  it('keeps an explicit windowed launch and a configured executable', () => {
    const choice = resolveBrowserChoice({ mode: 'launch', headless: false, executablePath: '/opt/chrome' })
    expect(browserServerArgs(choice)).toEqual([
      '--browser', 'chromium', '--isolated', '--executable-path', '/opt/chrome',
    ])
  })

  it('attaches to a validated debugging endpoint instead of launching', () => {
    const choice = resolveBrowserChoice({ mode: 'attach', endpoint: 'ws://127.0.0.1:9222/devtools/browser/abc' })
    expect(browserServerArgs(choice)).toEqual([
      '--browser', 'chromium', '--cdp-endpoint', 'ws://127.0.0.1:9222/devtools/browser/abc',
    ])
  })

  it('rejects an unparseable, unsupported, or whitespace-bearing endpoint', () => {
    expect(() => resolveBrowserChoice({ mode: 'attach', endpoint: '127.0.0.1:9222' }))
      .toThrow(/must be a valid HTTP\(S\) or WS\(S\) URL/)
    expect(() => resolveBrowserChoice({ mode: 'attach', endpoint: 'ftp://127.0.0.1:9222' }))
      .toThrow(/without whitespace/)
    expect(() => resolveBrowserChoice({ mode: 'attach', endpoint: 'http://127.0.0.1:9222/a b' }))
      .toThrow(/without whitespace/)
  })

  it('reserves the slot for a valid choice and leaves it free for an invalid one', async () => {
    const { ctx, registry } = await harness()
    expect(() => { apply(ctx, { mode: 'attach', endpoint: 'not a url' }) }).toThrow(/valid HTTP\(S\)/)
    expect(registry.providerName).toBeUndefined()

    apply(ctx, { mode: 'launch' })
    expect(registry.providerName).toBe('playwright-mcp')
    expect(() => { apply(ctx, { mode: 'launch' }) }).toThrow(/already registered/)
  })
})
