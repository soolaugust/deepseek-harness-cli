/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-celery-harness`.
 * @module @deepseek-ai/dsh-tool-celery-harness/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-celery-harness'

/** Cordis companion plugin name. */
export const name = 'tool-celery-harness-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every celery check is a stateless one-shot spawn whose only
 * observable is the tool result the registry already logs; the tools own no package-local
 * event history or mutable data relation an independent companion could observe.
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
