/** The status line and session stats formatting and rendering. */

import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'
import { PermissionBadge, SessionStats, StatusBar, statsSummary, truncateToWidth } from '../src/status-bar.tsx'
import type { CliViewState } from '../src/types.ts'

function view(partial: Partial<CliViewState>): CliViewState {
  return {
    items: [], busy: false, sessionId: 'session-1',
    stats: {
      turns: 1, steps: 34, llmMs: 128_000, toolMs: 121_000,
      ttftMs: 1200, ttftSteps: 1, inputTokens: 640_000,
      cacheReadTokens: 960_000, outputTokens: 13_400,
    },
    permission: 'workspace-write',
    ...partial,
  }
}

function statusFrame(partial: Partial<CliViewState>): string {
  const { lastFrame } = render(<StatusBar view={view(partial)} />)
  return lastFrame() ?? ''
}

function statsFrame(partial: Partial<CliViewState>): string {
  const { lastFrame } = render(<SessionStats view={view(partial)} />)
  return lastFrame() ?? ''
}

describe('StatusBar', () => {
  it('shows idle and the session id above the input bar', () => {
    const out = statusFrame({})
    expect(out).toContain('○ idle')
    expect(out).toContain('session-1')
  })

  it('shows busy while the agent is running', () => {
    const out = statusFrame({ busy: true })
    expect(out).toContain('● busy')
  })
})

describe('SessionStats', () => {
  it('renders the leading figures and ellipsizes the tail at 100 columns', () => {
    const out = statsFrame({})
    expect(out).toContain('1 轮 · 34 步')
    expect(out).toContain('LLM 2m8s')
    expect(out).toContain('工具调用 2m1s')
    expect(out).toContain('首 token 平均 1.2s')
    expect(out).toContain('缓存命中 60%')
    // The testing renderer is 100 columns wide; the strip reserves room for
    // the idle/session head on the same row, so the token-group tail ellipsizes.
    expect(out).toContain('…')
  })

  it('omits unknown figures gracefully', () => {
    const out = statsFrame({
      stats: { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
    })
    expect(out).toContain('0 轮 · 0 步')
    expect(out).toContain('LLM 0ms')
  })
})

describe('statsSummary', () => {
  it('formats counts, wall time, ttft, throughput, cache, and tokens', () => {
    const summary = statsSummary(view({}))
    expect(summary).toContain('1 轮 · 34 步')
    expect(summary).toContain('LLM 2m8s')
    expect(summary).toContain('工具调用 2m1s')
    expect(summary).toContain('首 token 平均 1.2s')
    expect(summary).toContain('105 tok/s')
    expect(summary).toContain('缓存命中 60%')
    expect(summary).toContain('输入 1.6M tok · 输出 13.4K tok')
  })
})

describe('truncateToWidth', () => {
  it('returns short text unchanged', () => {
    expect(truncateToWidth('abc', 10)).toBe('abc')
  })

  it('appends an ellipsis when cut', () => {
    expect(truncateToWidth('abcdef', 4)).toBe('abcd…')
  })

  it('counts CJK wide glyphs as two columns', () => {
    // '工具a' is exactly 5 columns; the next ASCII char would overflow, so
    // the slice ends there and adds '…'.
    expect(truncateToWidth('工具ab', 5)).toBe('工具a…')
  })

  it('returns an empty string when the budget is non-positive', () => {
    expect(truncateToWidth('abc', 0)).toBe('')
  })
})

describe('PermissionBadge', () => {
  it('renders the permission badge with the cycle hint', () => {
    const data = view({})
    const { lastFrame } = render(<PermissionBadge view={data} />)
    expect(lastFrame()).toContain('⏵⏵ workspace-write on (shift+tab to cycle)')
  })

  it('labels the full-access preset as bypass permissions', () => {
    const data = view({ permission: 'danger-full-access' })
    const { lastFrame } = render(<PermissionBadge view={data} />)
    expect(lastFrame()).toContain('⏵⏵ bypass permissions on (shift+tab to cycle)')
  })
})
