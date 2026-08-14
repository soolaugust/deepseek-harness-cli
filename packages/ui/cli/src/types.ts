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

/** Whole-session statistics the status line renders (mirrors web stats). */
export interface CliStats {
  /** Distinct turns that carried at least one closed step. */
  readonly turns: number
  /** Closed steps. */
  readonly steps: number
  /** Summed model wall time, ms. */
  readonly llmMs: number
  /** Summed tool call→result wall time, ms. */
  readonly toolMs: number
  /** Summed first-token latency over the counted steps, ms. */
  readonly ttftMs: number
  /** Steps with a recorded first token. */
  readonly ttftSteps: number
  /** Summed provider input tokens (uncached). */
  readonly inputTokens: number
  /** Summed provider cache-read tokens. */
  readonly cacheReadTokens: number
  /** Summed provider output tokens. */
  readonly outputTokens: number
}

/** Immutable snapshot of everything the terminal shows. */
export interface CliViewState {
  /** Rendered conversation items in arrival order. */
  readonly items: readonly CliViewItem[]
  /** Whether an agent turn is in flight. */
  readonly busy: boolean
  /** The live session id this view belongs to. */
  readonly sessionId: string
  /** Whole-session statistics for the status line. */
  readonly stats: CliStats
  /** The active permission preset, e.g. `workspace-write`. */
  readonly permission: string
}
