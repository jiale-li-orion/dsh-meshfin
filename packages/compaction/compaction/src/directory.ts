/**
 * Host directory resolving the compaction provider selected by each Agent composition.
 * @module @deepseek-ai/dsh-compaction/directory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { CompactionAgentContext, CompactionEngine } from './index.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    compactions: CompactionDirectory
  }
}

/** Global fallback plus per-Agent providers contributed by isolated presets. */
export class CompactionDirectory extends Service {
  private global: CompactionEngine | undefined
  private readonly byAgent = new WeakMap<CompactionAgentContext, CompactionEngine>()

  /**
   * Create the directory service as `ctx.compactions`.
   * @param ctx - context owning the service lifetime.
   */
  constructor(ctx: Context) {
    super(ctx, 'compactions')
  }

  /**
   * Register one provider for an isolated Agent or as the process fallback.
   * @param provider - compaction implementation contributed by one composition.
   * @param agent - owning Agent when the provider lives in an Agent preset.
   * @returns disposer removing only this exact registration.
   */
  register(provider: CompactionEngine, agent?: CompactionAgentContext): () => void {
    if (agent === undefined) {
      if (this.global !== undefined) throw new Error('compactions: global provider already registered')
      this.global = provider
      return () => { if (this.global === provider) this.global = undefined }
    }
    if (this.byAgent.has(agent)) throw new Error('compactions: Agent provider already registered')
    this.byAgent.set(agent, provider)
    return () => { if (this.byAgent.get(agent) === provider) this.byAgent.delete(agent) }
  }

  /**
   * Resolve the provider selected by one Agent's composition.
   * @param agent - target Agent.
   * @returns the Agent provider, otherwise the global fallback.
   * @throws when neither composition supplied a provider.
   */
  resolve(agent: CompactionAgentContext): CompactionEngine {
    const provider = this.byAgent.get(agent) ?? this.global
    if (provider === undefined) throw new Error('compaction is unavailable for this Agent')
    return provider
  }
}

export default CompactionDirectory
