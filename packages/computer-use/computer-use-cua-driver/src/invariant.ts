/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-computer-use-cua-driver`.
 * @module @deepseek-ai/dsh-computer-use-cua-driver/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-computer-use-cua-driver'

/** Cordis companion plugin name. */
export const name = 'computer-use-cua-driver-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider owns no stream or durable record, and the
 * slot it reserves is already the seam's own gated state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
