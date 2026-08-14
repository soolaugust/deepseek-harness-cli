/** The ink application: frame-level rendering of the view store. */

import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'
import { CliApp } from '../src/app.tsx'
import type { CliViewStoreLike } from '../src/hooks/use-cli-view.ts'
import type { CliViewState } from '../src/types.ts'

/** A fixed, non-emitting view store for frame assertions. */
function fixedStore(state: CliViewState): CliViewStoreLike {
  return { getSnapshot: () => state, subscribe: () => () => {} }
}

const ZERO_STATS: CliViewState['stats'] = {
  turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0,
  inputTokens: 0, cacheReadTokens: 0, outputTokens: 0,
}

function renderApp(state: Partial<CliViewState>) {
  return render(
    <CliApp store={fixedStore({ items: [], busy: false, sessionId: '', stats: ZERO_STATS, ...state })} onSubmit={() => {}} onCtrlC={() => {}} onExit={() => {}} />,
  )
}

describe('CliApp', () => {
  it('renders the empty state with a hint and the idle status', () => {
    const { lastFrame } = renderApp({})
    expect(lastFrame()).toContain('No messages yet')
    expect(lastFrame()).toContain('idle')
  })

  it('renders user, assistant, tool, and notice items with the session id', () => {
    const { lastFrame } = renderApp({
      items: [
        { kind: 'user', text: 'run the tests' },
        { kind: 'assistant', text: 'Running…', streaming: true },
        { kind: 'tool', name: 'bash', callId: 'c1', state: 'done' },
        { kind: 'notice', text: 'done in 3s' },
      ],
      busy: true,
      sessionId: 'session-1',
    })
    const frame = lastFrame() ?? ''
    expect(frame).toContain('run the tests')
    expect(frame).toContain('Running')
    expect(frame).toContain('bash')
    expect(frame).toContain('done in 3s')
    expect(frame).toContain('busy')
    expect(frame).toContain('session-1')
  })
})
