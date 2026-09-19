/**
 * The Cua Driver provider: it reserves the slot only when a desktop it can
 * show is possible, and its refusals name the missing prerequisite.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ComputerUseRegistry from '@deepseek-ai/dsh-computer-use'
import { apply } from '../src/index.ts'

/**
 * Mount the seam plus whatever prerequisites the case needs.
 * @param options - which prerequisite services and routes to provide.
 * @returns the context and the seam.
 */
async function harness(options: {
  attachments?: boolean
  routes?: readonly { id: string; models: readonly { id: string; inputModalities?: readonly string[] }[] }[]
} = {}): Promise<{ ctx: Context; registry: ComputerUseRegistry }> {
  const ctx = new Context()
  await ctx.plugin(ComputerUseRegistry)
  if (options.attachments === true) ctx.provide('attachments', {} as never)
  if (options.routes !== undefined) {
    ctx.provide('llm', {
      listProviders: () => options.routes!.map(route => ({ id: route.id, name: route.id })),
      listModels: (provider: string) => Promise.resolve(
        options.routes!.find(route => route.id === provider)?.models ?? [],
      ),
    } as never)
  }
  return { ctx, registry: ctx.computerUse }
}

describe('computer-use-cua-driver', () => {
  it('reserves the slot when a durable store and an image route are present', async () => {
    const { ctx, registry } = await harness({
      attachments: true,
      routes: [{ id: 'deepseek-official', models: [{ id: 'vision', inputModalities: ['text', 'image'] }] }],
    })
    await apply(ctx, {})
    expect(registry.providerName).toBe('cua-driver')
  })

  it('refuses a setup with no attachment store, naming the way out', async () => {
    const { ctx } = await harness({ routes: [] })
    await expect(apply(ctx, {})).rejects.toThrow(/screenshots need a durable attachment store.*requireScreenshots: false/s)
  })

  it('refuses a setup whose routes declare no image input, and runs blind when asked', async () => {
    const noImage = await harness({
      attachments: true,
      routes: [{ id: 'deepseek-official', models: [{ id: 'text-only', inputModalities: ['text'] }] }],
    })
    await expect(apply(noImage.ctx, {})).rejects.toThrow(/no catalog entry does/)
    // A route whose entry omits modalities is negative capability, not unknown.
    const omitted = await harness({ attachments: true, routes: [{ id: 'x', models: [{ id: 'bare' }] }] })
    await expect(apply(omitted.ctx, {})).rejects.toThrow(/declares image input/)

    const blind = await harness()
    await apply(blind.ctx, { requireScreenshots: false })
    expect(blind.registry.providerName).toBe('cua-driver')
  })
})
