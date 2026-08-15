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
    const frame = lastFrame() ?? ''
    expect(frame).toContain('No messages yet')
    expect(frame).toContain('idle')
    // The session stats now render inside the input bar's right side.
    expect(frame).toContain('0 轮 · 0 步')
    expect(frame).toContain('输入 0 tok')
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

  it('renders markdown, folds tool runs, and does not interleave long content', () => {
    const { lastFrame } = renderApp({
      items: [
        { kind: 'user', text: '说明冒泡排序' },
        {
          kind: 'assistant',
          streaming: false,
          text: '冒泡排序反复交换相邻的逆序元素。\n\n1. 比较相邻元素\n2. 顺序不对则交换\n3. 重复直到无交换\n\n```c\nfor (int i = 0; i < n - 1; i++) {\n    for (int j = 0; j < n - i - 1; j++) {\n        if (a[j] > a[j + 1]) swap(a[j], a[j + 1]);\n    }\n}\n```\n\n最坏情况是 O(n²)。',
        },
        { kind: 'tool', name: 'bash', callId: 'c1', state: 'done' },
        { kind: 'tool', name: 'grep', callId: 'c2', state: 'done' },
      ],
    })
    const frame = lastFrame() ?? ''
    // Folded tool run: a single row naming both tools.
    expect(frame).toContain('⇣ 2 tools')
    expect(frame).toContain('bash')
    expect(frame).toContain('grep')
    // Code fence stays intact: the list item after it is not dragged into it.
    expect(frame).toContain('for (int i = 0; i < n - 1; i++) {')
    expect(frame).toContain('最坏情况是 O(n²)。')
    // The closing brace of the code fence must appear before the trailing text.
    const codeEnd = frame.indexOf('}')
    const tail = frame.indexOf('最坏情况')
    expect(codeEnd).not.toBe(-1)
    expect(tail).toBeGreaterThan(codeEnd)
  })
})
