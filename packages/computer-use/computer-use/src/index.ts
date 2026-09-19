/**
 * Exclusive named registration for the computer-use capability: a composition
 * mounts at most one provider that lets models observe and operate a desktop.
 * The seam owns the slot and nothing else — each provider owns its operations,
 * its tools, and its platform requirements, so a second provider fails loudly
 * instead of silently competing for the same desktop.
 * @module @deepseek-ai/dsh-computer-use
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { ComputerUseProviderName } from './brand.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The one computer-use provider this composition mounted, if any. */
    computerUse: ComputerUseRegistry
  }
}

/** Owns the single optional provider registration of the computer-use capability. */
export class ComputerUseRegistry extends Service {
  private registration: ComputerUseProviderName | undefined

  /**
   * @param ctx - owning Cordis context.
   */
  constructor(ctx: Context) {
    super(ctx, 'computerUse')
  }

  /** Name of the registered provider, including while its resources are closing. */
  get providerName(): ComputerUseProviderName | undefined {
    return this.registration
  }

  /**
   * Reserve the sole provider slot until the contribution is disposed.
   * A second registration fails even when it repeats the current name.
   * Providers must stop their tools and await owned work before releasing this
   * registration, so a released slot never overlaps a closing desktop session.
   * @param name - provider-owned name used in registration diagnostics.
   * @returns the effect disposer for this exact registration.
   */
  register(name: ComputerUseProviderName): () => Promise<void> {
    if (this.registration !== undefined) {
      throw new Error(`computer use provider "${this.registration}" is already registered`)
    }
    return this.ctx.effect(() => {
      this.registration = name
      return () => {
        this.registration = undefined
      }
    }, 'computerUse.register()')
  }
}

export default ComputerUseRegistry
