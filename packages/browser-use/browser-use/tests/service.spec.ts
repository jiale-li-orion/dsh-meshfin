/**
 * The browser-use slot: one provider at a time, and the published name is the
 * live registration's.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import BrowserUseRegistry from '../src/index.ts'
import { BrowserUseProviderName } from '../src/brand.ts'

/**
 * Mount the registry on a fresh context.
 * @returns the context and the registry.
 */
async function harness(): Promise<{ ctx: Context; registry: BrowserUseRegistry }> {
  const ctx = new Context()
  await ctx.plugin(BrowserUseRegistry)
  return { ctx, registry: ctx.browserUse }
}

describe('BrowserUseRegistry', () => {
  it('publishes no provider until one registers, then publishes exactly that name', async () => {
    const { registry } = await harness()
    expect(registry.providerName).toBeUndefined()

    const dispose = registry.register(BrowserUseProviderName('playwright-mcp'))
    expect(registry.providerName).toBe('playwright-mcp')

    await dispose()
    expect(registry.providerName).toBeUndefined()
  })

  it('refuses a second provider, including one repeating the current name', async () => {
    const { registry } = await harness()
    registry.register(BrowserUseProviderName('playwright-mcp'))

    expect(() => registry.register(BrowserUseProviderName('other')))
      .toThrow(/browser use provider "playwright-mcp" is already registered/)
    expect(() => registry.register(BrowserUseProviderName('playwright-mcp')))
      .toThrow(/already registered/)
    expect(registry.providerName).toBe('playwright-mcp')
  })
})
