/**
 * Exclusive named registration for the browser-use capability: a composition
 * mounts at most one backend that lets models inspect and operate web pages.
 * The seam owns the slot and nothing else — each provider owns its own browser
 * processes, tools, and platform requirements, so a second backend fails loudly
 * instead of silently competing for the same browser.
 * @module @deepseek-ai/dsh-browser-use
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { BrowserUseProviderName } from './brand.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The one browser backend this composition mounted, if any. */
    browserUse: BrowserUseRegistry
  }
}

/** Owns the single optional provider registration of the browser-use capability. */
export class BrowserUseRegistry extends Service {
  private registration: BrowserUseProviderName | undefined

  /**
   * @param ctx - owning Cordis context.
   */
  constructor(ctx: Context) {
    super(ctx, 'browserUse')
  }

  /** Name of the registered provider, including while its resources are closing. */
  get providerName(): BrowserUseProviderName | undefined {
    return this.registration
  }

  /**
   * Reserve the sole provider slot until the contribution is disposed.
   * A second registration fails even when it repeats the current name.
   * Providers must stop their tools and await owned browser work before
   * releasing this registration, so a released slot never overlaps a browser
   * process that is still shutting down.
   * @param name - provider-owned name used in registration diagnostics.
   * @returns the effect disposer for this exact registration.
   */
  register(name: BrowserUseProviderName): () => Promise<void> {
    if (this.registration !== undefined) {
      throw new Error(`browser use provider "${this.registration}" is already registered`)
    }
    return this.ctx.effect(() => {
      this.registration = name
      return () => {
        this.registration = undefined
      }
    }, 'browserUse.register()')
  }
}

export default BrowserUseRegistry
