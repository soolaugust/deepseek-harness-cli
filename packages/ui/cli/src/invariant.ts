/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-cli-ui`.
 * @module @deepseek-ai/dsh-cli-ui/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-cli-ui'

/** Cordis companion plugin name. */
export const name = 'cli-ui-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the renderer is a pure projection of the view store
 * (its own getSnapshot/subscribe) to terminal frames, asserted by ink-testing
 * library frame snapshots; it registers nothing and holds no mutable relation
 * to audit inside the tree.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
