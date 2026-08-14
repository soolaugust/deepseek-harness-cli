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
  /** Clear the scroll region. */
  clear(): void
}

/**
 * The initial empty view state.
 * @returns an empty, not-busy view with no session id.
 */
export function initialViewState(): CliViewState {
  return { items: [], busy: false, sessionId: '' }
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
  const listeners = new Set<() => void>()
  const emit = (): void => { for (const fn of listeners) fn() }
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    append: (event, sessionId) => {
      state = { ...reduceView(state, event), sessionId }
      emit()
    },
    notice: (text) => {
      state = { ...state, items: [...state.items, { kind: 'notice', text }] }
      emit()
    },
    clear: () => {
      state = { ...state, items: [] }
      emit()
    },
  }
}
