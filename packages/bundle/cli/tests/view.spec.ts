/** The view store's pure event fold: streaming, tool cards, and notices. */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { createViewStore, initialViewState, reduceView } from '../src/view.ts'

/** Build a session event with a synthetic sequence number. */
function ev<Type extends SessionEvent['type']>(
  type: Type,
  data: Extract<SessionEvent, { type: Type }>['data'],
): SessionEvent {
  return { type, data, seq: 0, time: 0 } as SessionEvent
}

const userMessage = () => createUserMessage({ content: [{ type: 'text', text: 'run the tests' }], source: { kind: 'user' } })

describe('reduceView', () => {
  it('folds a user prompt into a user item', () => {
    const state = reduceView(initialViewState(), ev('user/message', userMessage()))
    expect(state.items).toEqual([{ kind: 'user', text: 'run the tests' }])
  })

  it('appends streaming text deltas into one assistant item, then commits it', () => {
    let state = reduceView(initialViewState(), ev('user/message', userMessage()))
    state = reduceView(state, ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Hel' } }))
    state = reduceView(state, ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'lo' } }))
    expect(state.items.at(-1)).toEqual({ kind: 'assistant', text: 'Hello', streaming: true })
    state = reduceView(state, ev('assistant/message', {
      turn: 1, step: 1,
      message: createAssistantMessage({ content: [{ type: 'text', text: 'Hello' }], source: { provider: 'p', model: 'm' } }),
    }))
    expect(state.items.at(-1)).toEqual({ kind: 'assistant', text: 'Hello', streaming: false })
  })

  it('tracks tool cards from call to result, and marks errors', () => {
    let state = reduceView(initialViewState(), ev('tool/call', {
      turn: 1, step: 1, callId: 'call-1' as never, name: 'bash', arguments: '{}',
    }))
    expect(state.items.at(-1)).toEqual({ kind: 'tool', name: 'bash', callId: 'call-1', state: 'running' })
    state = reduceView(state, ev('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({ callId: 'call-1' as never, content: [], isError: false }),
    }))
    expect(state.items.at(-1)).toEqual({ kind: 'tool', name: 'bash', callId: 'call-1', state: 'done' })
  })

  it('flips busy on turn start and end', () => {
    const busy = reduceView(initialViewState(), ev('turn/start', { turn: 1 }))
    expect(busy.busy).toBe(true)
    const idle = reduceView(busy, ev('turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(idle.busy).toBe(false)
  })

  it('surfaces a turn-end error as a notice', () => {
    const state = reduceView(initialViewState(), ev('turn/end', {
      turn: 1,
      reason: { kind: 'error', error: { code: 'MISSING_CREDENTIAL', message: 'no API key' } },
    }))
    expect(state.busy).toBe(false)
    expect(state.items.at(-1)).toEqual({ kind: 'notice', text: '✗ MISSING_CREDENTIAL: no API key' })
  })

  it('surfaces an aborted turn as an interruption notice', () => {
    const state = reduceView(initialViewState(), ev('turn/end', {
      turn: 1,
      reason: { kind: 'aborted', reason: { kind: 'user' } },
    }))
    expect(state.items.at(-1)).toEqual({ kind: 'notice', text: '⏹ interrupted' })
  })
})

describe('createViewStore', () => {
  it('publishes the sessionId and notifies subscribers on each fold', () => {
    const store = createViewStore()
    const seen: string[] = []
    store.subscribe(() => seen.push(store.getSnapshot().sessionId))
    store.append(ev('user/message', userMessage()), 'session-1')
    expect(store.getSnapshot().sessionId).toBe('session-1')
    expect(seen).toEqual(['session-1'])
    store.notice('done')
    expect(store.getSnapshot().items.at(-1)).toEqual({ kind: 'notice', text: 'done' })
  })

  it('clears the scroll region', () => {
    const store = createViewStore()
    store.append(ev('user/message', userMessage()), 'session-1')
    store.clear()
    expect(store.getSnapshot().items).toEqual([])
  })
})
