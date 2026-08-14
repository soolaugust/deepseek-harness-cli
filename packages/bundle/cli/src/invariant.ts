/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-cli`.
 * @module @deepseek-ai/dsh-cli/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-cli'

/** Cordis companion plugin name. */
export const name = 'cli-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the runner is an interactive driver whose observable
 * contract (per-prompt streaming through the session/event feed, transcript on
 * the view store, exit by explicit command) is process-level and covered by
 * REPL transcript snapshots; it registers nothing and holds no mutable
 * relation to audit inside the tree.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
