/**
 * Package-owned invariant companion for the Agent-scoped model selection.
 *
 * The service owns no independent event relationship: a selection is a
 * process-local mutable ref installed into an Agent scope, and the
 * `installModelSelection` waterfall (whose disposal is proven by the
 * core/agent tests) owns the only prompt/request coupling. The empty installer
 * keeps that absence explicit in composed invariant sets.
 *
 * @module @deepseek-ai/dsh-agent-model-selection/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-agent-model-selection'

/** Cordis companion plugin name. */
export const name = 'agent-model-selection-invariant'
/** Services required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: the selection ref owns no event or state projection. */
const install: InvariantInstaller = () => {}

/**
 * Register the intentionally empty invariant contribution.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
