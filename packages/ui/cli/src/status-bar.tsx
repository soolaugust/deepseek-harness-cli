/**
 * The status line and session stats: busy state, session id, and the
 * whole-session figures the web surface renders — turn/step counts, LLM and
 * tool wall time, first-token latency, throughput, cache hit rate, and
 * input/output tokens. The status line sits above the input bar (upper-left);
 * the stats summary renders on the same line's right side, above the input bar.
 * @module @deepseek-ai/dsh-cli-ui/status-bar
 */

import * as React from 'react'
import { Box, Text, useStdout } from 'ink'
import type { CliViewState } from './types.ts'

/**
 * Minimum columns reserved on the stats row for the `○ idle`/`● busy` + session
 * id head to the strip's left. The strip truncates rather than overlap that
 * head, which sits on the same line above the input bar.
 */
const STATS_HEAD_WIDTH = 12

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
 * Truncate a string to fit `max` display columns with a trailing `…`.
 * CJK and other wide glyphs count as two columns; content longer than `max`
 * returns a slice ending in `…` (the ellipsis replaces content, so the slice
 * plus the ellipsis stays within `max` on the wide glyph that overflows).
 * @param text - the text to cap.
 * @param max - the maximum display width in columns.
 * @returns text no wider than `max` columns.
 */
export function truncateToWidth(text: string, max: number): string {
  if (max <= 0 || text === '') return ''
  let cols = 0
  let i = 0
  for (const ch of text) {
    // Wide glyphs render as two terminal columns.
    const w = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u.test(ch) ? 2 : 1
    if (cols + w > max) {
      return i === text.length ? text : `${text.slice(0, i)}…`
    }
    cols += w
    i += 1
  }
  return text
}

/**
 * Build the pipe-separated whole-session stats summary shown on the input
 * bar's right side.
 * @param view - the current view state with accumulated stats.
 * @returns the joined stats summary.
 */
export function statsSummary(view: CliViewState): string {
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
  return segments.join(' | ')
}

/**
 * Render the busy state and session id as the status line above the input
 * bar, upper-left.
 * @param view - the current view state.
 */
export function StatusBar({ view }: { view: CliViewState }) {
  return (
    <Box flexShrink={0}>
      <Text color={view.busy ? 'yellow' : 'green'}>
        {view.busy ? '● busy' : '○ idle'}
      </Text>
      <Text dimColor>  {view.sessionId}</Text>
    </Box>
  )
}

/**
 * Render the whole-session stats summary on the upper-right line, above the
 * input bar. Capped to a single line that never wraps: the strip is truncated
 * with `…` only when it would run past the terminal's right edge.
 * @param view - the current view state with accumulated stats.
 */
export function SessionStats({ view }: { view: CliViewState }) {
  const { stdout } = useStdout()
  const summary = statsSummary(view)
  // Leave room for the idle/session head on the same line's left; the strip
  // itself takes the rest of the row and truncates only at the right edge.
  const max = (stdout.columns ?? 80) - STATS_HEAD_WIDTH
  return (
    <Box flexShrink={0} paddingLeft={1}>
      <Text dimColor>{truncateToWidth(summary, max)}</Text>
    </Box>
  )
}

/**
 * The permission badge rendered under the input bar, compact like Claude Code.
 * @param view - the current view state carrying the active preset.
 */
export function PermissionBadge({ view }: { view: CliViewState }) {
  const label = view.permission === 'danger-full-access'
    ? 'bypass permissions on'
    : `${view.permission} on`
  return (
    <Box flexShrink={0} paddingLeft={1}>
      <Text {...(view.permission === 'danger-full-access' ? { color: 'yellow' } : { dimColor: true })}>
        ⏵⏵ {label} <Text dimColor>(shift+tab to cycle)</Text>
      </Text>
    </Box>
  )
}
