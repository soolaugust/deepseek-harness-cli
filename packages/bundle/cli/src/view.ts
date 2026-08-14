/**
 * The REPL view store: the single source of truth the terminal UI renders
 * from, fed by the driver from the `session/event` feed. A plain external
 * store (getSnapshot/subscribe) so the ink renderer subscribes with
 * `useSyncExternalStore` and the driver stays renderer-agnostic; every
 * mutation is a pure fold in {@link reduceView} and returns a fresh state.
 * @module @deepseek-ai/dsh-cli/view
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { CliViewState } from '@deepseek-ai/dsh-cli-ui'

export type { CliViewItem, CliViewState } from '@deepseek-ai/dsh-cli-ui'

/** The store interface the driver writes and the renderer subscribes to. */
export interface CliViewStore {
  getSnapshot(): CliViewState
  subscribe(fn: () => void): () => void
  /** Fold one durable session event into the view. */
  append(event: SessionEvent, sessionId: string): void
  /** Append a system notice (command output, interruption, approvals). */
  notice(text: string): void
  /** Update the active permission preset for the badge. */
  setPermission(preset: string): void
  /** Clear the scroll region. */
  clear(): void
}

/**
 * The initial empty view state.
 * @returns an empty, not-busy view with no session id.
 */
export function initialViewState(): CliViewState {
  return {
    items: [],
    busy: false,
    sessionId: '',
    stats: { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
    permission: 'workspace-write',
  }
}

/** Internal stats fold state carried on the view snapshot. */
interface StatsState {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  ttftMs: number
  ttftSteps: number
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  /** The open step's start time; null outside a step. */
  stepStart: number | null
  /** First-token time of the open step; null before the first delta. */
  firstToken: number | null
  /** Dispatch times of in-flight tool calls, by callId. */
  pendingCalls: Record<string, number>
}

const ZERO_STATS: StatsState = {
  turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0,
  inputTokens: 0, cacheReadTokens: 0, outputTokens: 0,
  stepStart: null, firstToken: null, pendingCalls: {},
}

/** Fold a step lifecycle event onto the stats accumulator. */
function foldStats(stats: StatsState, event: SessionEvent): StatsState {
  switch (event.type) {
    case 'step/start':
      return { ...stats, stepStart: event.time, firstToken: null }
    case 'assistant/chunk': {
      const chunk = event.data.chunk
      if (stats.firstToken === null && chunk.type === 'text-delta') {
        return { ...stats, firstToken: event.time }
      }
      return stats
    }
    case 'assistant/message': {
      if (stats.stepStart === null) return stats
      const llmMs = stats.llmMs + Math.max(0, event.time - stats.stepStart)
      let next: StatsState = { ...stats, llmMs, stepStart: null }
      if (stats.firstToken !== null) {
        next = { ...next, ttftMs: next.ttftMs + Math.max(0, stats.firstToken - stats.stepStart), ttftSteps: next.ttftSteps + 1 }
      }
      const usage = event.data.usage
      if (usage !== undefined) {
        next = {
          ...next,
          inputTokens: next.inputTokens + usage.inputTokens,
          cacheReadTokens: next.cacheReadTokens + (usage.cacheReadTokens ?? 0),
          outputTokens: next.outputTokens + usage.outputTokens,
        }
      }
      return next
    }
    case 'tool/call':
      return { ...stats, pendingCalls: { ...stats.pendingCalls, [event.data.callId]: event.time } }
    case 'tool/result': {
      const callId = event.data.message.source.callId
      const dispatched = Object.hasOwn(stats.pendingCalls, callId) ? stats.pendingCalls[callId] : undefined
      if (dispatched === undefined) return stats
      const pendingCalls = Object.fromEntries(Object.entries(stats.pendingCalls).filter(([id]) => id !== callId))
      return { ...stats, toolMs: stats.toolMs + Math.max(0, event.time - dispatched), pendingCalls }
    }
    case 'step/end':
      return { ...stats, steps: stats.steps + 1, stepStart: null, firstToken: null }
    case 'turn/start':
      return { ...stats, turns: stats.turns + 1 }
    default:
      return stats
  }
}

/** Project the internal stats accumulator onto the public snapshot. */
function projectStats(stats: StatsState): CliViewState['stats'] {
  return {
    turns: stats.turns,
    steps: stats.steps,
    llmMs: stats.llmMs,
    toolMs: stats.toolMs,
    ttftMs: stats.ttftMs,
    ttftSteps: stats.ttftSteps,
    inputTokens: stats.inputTokens,
    cacheReadTokens: stats.cacheReadTokens,
    outputTokens: stats.outputTokens,
  }
}

/** Extract the plain text of a user message, mirroring headless summarize. */
function userText(event: SessionEvent<'user/message'>): string {
  const message = event.data
  return message.content
    .filter(block => block.type === 'text')
    .map(block => (block as { text: string }).text)
    .join('')
}

/**
 * Pure fold of one `session/event` onto the view state.
 * @param state - the current view state.
 * @param event - one durable session event.
 * @returns the next view state; the input state is never mutated.
 */
export function reduceView(state: CliViewState, event: SessionEvent): CliViewState {
  switch (event.type) {
    case 'turn/start':
      return { ...state, items: [...state.items, { kind: 'divider' }], busy: true }
    case 'turn/end': {
      const reason = event.data.reason
      if (reason.kind === 'error') {
        const error = reason.error
        const detail = `${error.code}: ${error.message}`
        return {
          ...state,
          busy: false,
          items: [...state.items, { kind: 'notice', text: `✗ ${detail}` }],
        }
      }
      if (reason.kind === 'aborted') {
        return { ...state, busy: false, items: [...state.items, { kind: 'notice', text: '⏹ interrupted' }] }
      }
      return { ...state, busy: false }
    }
    case 'user/message':
      // Only surface direct human prompts. Injected context (AGENTS.md,
      // skill content, goal notifications) rides the same user/message event
      // with a non-'user' source kind and would clutter the transcript.
      if (event.data.source.kind !== 'user') return state
      return { ...state, items: [...state.items, { kind: 'user', text: userText(event) }] }
    case 'assistant/chunk': {
      const chunk = event.data.chunk
      if (chunk.type !== 'text-delta') return state
      const items = [...state.items]
      const last = items[items.length - 1]
      if (last !== undefined && last.kind === 'assistant' && last.streaming) {
        items[items.length - 1] = { ...last, text: last.text + chunk.text }
      } else {
        items.push({ kind: 'assistant', text: chunk.text, streaming: true })
      }
      return { ...state, items }
    }
    case 'assistant/message': {
      const text = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => (block as { text: string }).text)
        .join('')
      const items = [...state.items]
      const last = items[items.length - 1]
      if (last !== undefined && last.kind === 'assistant' && last.streaming) {
        items[items.length - 1] = { kind: 'assistant', text, streaming: false }
      } else {
        items.push({ kind: 'assistant', text, streaming: false })
      }
      return { ...state, items }
    }
    case 'tool/call':
      return {
        ...state,
        items: [...state.items, { kind: 'tool', name: event.data.name, callId: event.data.callId, state: 'running' }],
      }
    case 'tool/result': {
      const toolCallId = event.data.message.content[0].toolCallId
      const items = state.items.map((item) => {
        if (item.kind !== 'tool' || item.callId !== toolCallId) return item
        if (event.data.error !== undefined) {
          return { ...item, state: 'error' as const, error: event.data.error.code }
        }
        return { ...item, state: 'done' as const }
      })
      return { ...state, items }
    }
    default:
      return state
  }
}

/**
 * Create a live view store the driver writes to and the renderer subscribes to.
 * @returns the store; each append/notice/clear emits to subscribers.
 */
export function createViewStore(): CliViewStore {
  let state: CliViewState = initialViewState()
  // Stats accumulate across events (open step, first token, pending tool
  // calls) outside the immutable snapshot; each append folds and projects.
  let stats: StatsState = { ...ZERO_STATS }
  const listeners = new Set<() => void>()
  const emit = (): void => { for (const fn of listeners) fn() }
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    append: (event, sessionId) => {
      stats = foldStats(stats, event)
      state = { ...reduceView(state, event), sessionId, stats: projectStats(stats) }
      emit()
    },
    notice: (text) => {
      state = { ...state, items: [...state.items, { kind: 'notice', text }] }
      emit()
    },
    setPermission: (preset) => {
      state = { ...state, permission: preset }
      emit()
    },
    clear: () => {
      state = { ...state, items: [] }
      emit()
    },
  }
}
