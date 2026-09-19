/**
 * The computer-use slot: one provider at a time, and the published name is the
 * live registration's.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ComputerUseRegistry from '../src/index.ts'
import { ComputerUseProviderName } from '../src/brand.ts'

/**
 * Mount the registry on a fresh context.
 * @returns the context and the registry.
 */
async function harness(): Promise<{ ctx: Context; registry: ComputerUseRegistry }> {
  const ctx = new Context()
  await ctx.plugin(ComputerUseRegistry)
  return { ctx, registry: ctx.computerUse }
}

describe('ComputerUseRegistry', () => {
  it('publishes no provider until one registers, then publishes exactly that name', async () => {
    const { registry } = await harness()
    expect(registry.providerName).toBeUndefined()

    const dispose = registry.register(ComputerUseProviderName('cua-driver'))
    expect(registry.providerName).toBe('cua-driver')

    await dispose()
    expect(registry.providerName).toBeUndefined()
  })

  it('refuses a second provider, including one repeating the current name', async () => {
    const { registry } = await harness()
    registry.register(ComputerUseProviderName('cua-driver'))

    expect(() => registry.register(ComputerUseProviderName('other')))
      .toThrow(/computer use provider "cua-driver" is already registered/)
    expect(() => registry.register(ComputerUseProviderName('cua-driver')))
      .toThrow(/already registered/)
    expect(registry.providerName).toBe('cua-driver')
  })
})
