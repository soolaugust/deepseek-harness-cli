/**
 * The terminal view contract: the discriminated conversation items and the
 * immutable snapshot the ink renderer projects. Owned here so the driver
 * (`@deepseek-ai/dsh-cli`) depends on the renderer's contract, not the reverse.
 * @module @deepseek-ai/dsh-cli-ui/types
 */

/** One rendered conversation item in the terminal scroll region. */
export type CliViewItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; streaming: boolean }
  | { kind: 'tool'; name: string; callId: string; state: 'running' | 'done' | 'error'; error?: string }
  | { kind: 'notice'; text: string }
  | { kind: 'divider' }

/** Immutable snapshot of everything the terminal shows. */
export interface CliViewState {
  /** Rendered conversation items in arrival order. */
  readonly items: readonly CliViewItem[]
  /** Whether an agent turn is in flight. */
  readonly busy: boolean
  /** The live session id this view belongs to. */
  readonly sessionId: string
}
