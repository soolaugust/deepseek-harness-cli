/**
 * The status line and session stats bar: busy state, session id, and the
 * whole-session figures the web surface renders — turn/step counts, LLM and
 * tool wall time, first-token latency, throughput, cache hit rate, and
 * input/output tokens.
 * @module @deepseek-ai/dsh-cli-ui/status-bar
 */

import * as React from 'react'
import { Box, Text } from 'ink'
import type { CliViewState } from './types.ts'

/** Format a millisecond span compactly (`2m8s`, `1.2s`, `300ms`). */
function fmtMs(ms: number): string {
  if (ms >= 60_000) {
    const m = Math.floor(ms / 60_000)
    const s = Math.round((ms % 60_000) / 1_000)
    return `${m}m${s}s`
  }
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

/** Format a token count compactly (`1.6M`, `13.4K`, `512`). */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/**
 * Render the bottom status line and the session stats bar.
 * @param view - the current view state with accumulated stats.
 */
export function StatusBar({ view }: { view: CliViewState }) {
  const stats = view.stats
  // Average first-token latency over the steps that recorded one.
  const ttft = stats.ttftSteps > 0 ? fmtMs(stats.ttftMs / stats.ttftSteps) : '—'
  // Decode throughput is approximated from total output over total LLM time.
  const decodeMs = stats.llmMs > 0 ? stats.llmMs : 1
  const tokPerSec = stats.outputTokens > 0 ? `${Math.round(stats.outputTokens / (decodeMs / 1_000))} tok/s` : ''
  // Cache hit rate from cache-read over billed input.
  const billedInput = stats.inputTokens + stats.cacheReadTokens
  const cachePct = billedInput > 0 ? `${Math.round((stats.cacheReadTokens / billedInput) * 100)}%` : ''
  const segments = [
    `${stats.turns} 轮 · ${stats.steps} 步`,
    `LLM ${fmtMs(stats.llmMs)} · 工具调用 ${fmtMs(stats.toolMs)}`,
    `首 token 平均 ${ttft}`,
    tokPerSec,
    cachePct !== '' ? `缓存命中 ${cachePct}` : '',
    `输入 ${fmtTokens(billedInput)} tok · 输出 ${fmtTokens(stats.outputTokens)} tok`,
  ].filter(segment => segment !== '')
  return (
    <Box flexShrink={0} flexDirection="column">
      <Box>
        <Text color={view.busy ? 'yellow' : 'green'}>
          {view.busy ? '● busy' : '○ idle'}
        </Text>
        <Text dimColor>  {view.sessionId}</Text>
      </Box>
      <Text dimColor>{segments.join(' | ')}</Text>
    </Box>
  )
}
