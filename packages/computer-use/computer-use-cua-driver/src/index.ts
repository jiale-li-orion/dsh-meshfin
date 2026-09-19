/**
 * Cua Driver provider: reserves the composition's computer-use slot for a
 * desktop the model can see and operate, and refuses to activate a setup that
 * cannot show it anything.
 *
 * The driver itself is external. In this baseline the tools arrive through the
 * row-based MCP client — a companion row
 * (`@deepseek-ai/dsh-mcp-client` with `command: cua-driver, args: [mcp]`) owns
 * the process, its permissions, and its tool descriptions — so this provider
 * owns the capability contract instead: the single-provider slot, the
 * screenshot prerequisites, and the diagnostics that name what is missing.
 * @module @deepseek-ai/dsh-computer-use-cua-driver
 */

import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { ComputerUseProviderName } from '@deepseek-ai/dsh-computer-use/brand'
import type {} from '@deepseek-ai/dsh-computer-use'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-llm'

/** Provider registration identity used in diagnostics. */
export const PROVIDER_NAME = 'cua-driver'

/** Cordis plugin name. */
export const name = 'computer-use-cua-driver'

/** The computer-use slot this provider reserves; nothing else is required. */
export const inject = ['computerUse']

/** Provider configuration. */
export interface Config {
  /**
   * Whether a model route must accept images before the provider activates
   * (default true). A desktop agent that cannot receive screenshots is blind,
   * so the default refuses the mount instead of starting a useless session.
   */
  requireScreenshots?: boolean
}

export const Config: z<Config> = z.object({
  requireScreenshots: z.boolean().default(true),
})

/**
 * Whether any registered model route declares image input.
 * Modalities are declarations, not probes: an entry naming `image` is what the
 * request path itself gates on.
 * @param ctx - context carrying the model route registry.
 * @returns true when at least one catalog entry accepts images.
 */
async function hasImageRoute(ctx: Context): Promise<boolean> {
  const llm = ctx.get('llm')
  if (llm === undefined) return false
  for (const route of llm.listProviders()) {
    const models = await llm.listModels(route.id)
    if (models.some(model => model.inputModalities?.includes('image') === true)) return true
  }
  return false
}

/**
 * Reserve the computer-use slot after checking the screenshot prerequisites.
 * @param ctx - owning Cordis context.
 * @param config - resolved provider configuration.
 * @throws Error when screenshots are required and either prerequisite is absent.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  if (config.requireScreenshots !== false) {
    if (ctx.get('attachments') === undefined) {
      throw new Error(
        'computer-use-cua-driver: screenshots need a durable attachment store, but no "attachments" service is mounted; '
        + 'mount an attachment backend, or set requireScreenshots: false to run without a visible desktop',
      )
    }
    if (!await hasImageRoute(ctx)) {
      throw new Error(
        'computer-use-cua-driver: screenshots need a model route that declares image input, but no catalog entry does; '
        + 'declare "image" in the route\'s inputModalities, or set requireScreenshots: false to run without a visible desktop',
      )
    }
  }
  ctx.computerUse.register(ComputerUseProviderName(PROVIDER_NAME))
}
