/**
 * @deepseek-ai/dsh-cli-ui — the dsh interactive terminal renderer. An ink
 * application over the REPL view store: scroll region, input bar, tool cards,
 * status bar, and the terminal-side approval / user-question providers.
 *
 * The renderer is a pure projection of the view store to terminal frames; the
 * REPL driver in `@deepseek-ai/dsh-cli` stays renderer-agnostic.
 * @module @deepseek-ai/dsh-cli-ui
 */

export type { CliViewItem, CliViewState } from './types.ts'
export { createInteractiveIo } from './io.tsx'
export type { InteractiveIo, InteractiveIoOptions } from './io.tsx'
export { installCliApproval } from './providers/approval.ts'
