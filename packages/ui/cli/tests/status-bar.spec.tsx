/** The status/stats bar formatting and rendering. */

import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'
import { StatusBar } from '../src/status-bar.tsx'
import type { CliViewState } from '../src/types.ts'

function frame(partial: Partial<CliViewState>): string {
  const view: CliViewState = {
    items: [], busy: false, sessionId: 'session-1',
    stats: {
      turns: 1, steps: 34, llmMs: 128_000, toolMs: 121_000,
      ttftMs: 1200, ttftSteps: 1, inputTokens: 640_000,
      cacheReadTokens: 960_000, outputTokens: 13_400,
    },
    permission: 'workspace-write',
    ...partial,
  }
  const { lastFrame } = render(<StatusBar view={view} />)
  return lastFrame() ?? ''
}

describe('StatusBar', () => {
  it('renders counts, wall time, ttft, throughput, cache, and tokens', () => {
    const out = frame({})
    expect(out).toContain('1 轮 · 34 步')
    expect(out).toContain('LLM 2m8s')
    expect(out).toContain('工具调用 2m1s')
    expect(out).toContain('首 token 平均 1.2s')
    expect(out).toContain('缓存命中 60%')
    // ink wraps the token segment; assert the pieces independently.
    expect(out).toContain('输入 1.6M')
    expect(out).toContain('输出 13.4K tok')
  })

  it('omits unknown figures gracefully', () => {
    const out = frame({
      stats: { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
    })
    expect(out).toContain('0 轮 · 0 步')
    expect(out).toContain('LLM 0ms')
  })

  it('renders the permission badge with the cycle hint', () => {
    const out = frame({ permission: 'workspace-write' })
    expect(out).toContain('⏵⏵ workspace-write on (shift+tab to cycle)')
  })

  it('labels the full-access preset as bypass permissions', () => {
    const out = frame({ permission: 'danger-full-access' })
    expect(out).toContain('⏵⏵ bypass permissions on (shift+tab to cycle)')
  })
})
