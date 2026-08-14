/**
 * The top scroll region: renders the trailing slice of the conversation.
 * It flex-grows to fill the space above the fixed status line and input, and
 * auto-sticks to the bottom as new items arrive.
 *
 * Adjacent tool calls render as a single collapsed group (`⇣ 3 tools`) like
 * Claude Code's grouped tool use; the group expands on demand. Every item
 * gets breathing room so the transcript does not stack flush together.
 * @module @deepseek-ai/dsh-cli-ui/scroll-region
 */

import * as React from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import type { CliViewItem, CliViewState } from './types.ts'
import { markdownToInk } from './markdown.tsx'
import { ToolCard } from './tool-cards.tsx'

/** Whether a tool item is collapsible into a group. */
function isTool(item: CliViewItem): item is Extract<CliViewItem, { kind: 'tool' }> {
  return item.kind === 'tool'
}

/** Render a non-tool conversation item. */
function renderItem(item: CliViewItem, key: React.Key) {
  switch (item.kind) {
    case 'user':
      return <Text key={key} color="cyan">{'> '}{item.text}</Text>
    case 'assistant':
      // Streamed text renders as-is (markdown is still forming); a committed
      // message gets the markdown → ink pass so bold, code, lists, and
      // headings show in the terminal like Claude Code.
      return item.streaming
        ? <Text key={key}>{item.text}</Text>
        : <Box key={key} flexDirection="column">{markdownToInk(item.text)}</Box>
    case 'tool':
      return <ToolCard key={key} item={item} />
    case 'notice':
      return <Text key={key} dimColor>{item.text}</Text>
    case 'divider':
      return <Text key={key} dimColor>{'─'.repeat(20)}</Text>
  }
}

/** Render a collapsed tool-run row, or its expanded tools. */
function renderToolRow(row: ToolRow, expanded: boolean, key: React.Key) {
  if (!expanded) {
    const names = [...new Set(row.tools.map(tool => tool.name))].join(', ')
    return (
      <Text key={key} dimColor>
        ⇣ {row.tools.length} tool{row.tools.length > 1 ? 's' : ''} · {names}
      </Text>
    )
  }
  return (
    <Box key={key} flexDirection="column">
      {row.tools.map((tool, index) => <ToolCard key={`${tool.callId}-${index}`} item={tool} />)}
    </Box>
  )
}

/** A run of adjacent tool items plus the flag that shows their names. */
type ToolRow = { tools: Extract<CliViewItem, { kind: 'tool' }>[] }

/** Split the visible items into renderable rows, folding adjacent tools into one row. */
function foldRows(items: readonly CliViewItem[]): Array<{ item?: CliViewItem; tools?: ToolRow }> {
  const rows: Array<{ item?: CliViewItem; tools?: ToolRow }> = []
  let run: ToolRow | undefined
  for (const item of items) {
    if (isTool(item)) {
      if (run === undefined) run = { tools: [] }
      run.tools.push(item)
    } else {
      if (run !== undefined) {
        rows.push({ tools: run })
        run = undefined
      }
      rows.push({ item })
    }
  }
  if (run !== undefined) rows.push({ tools: run })
  return rows
}

/**
 * The scrollable conversation region. The visible window is the trailing
 * slice sized to the terminal rows, so the newest items stay on screen.
 * @param view - the current view state.
 */
export function ScrollRegion({ view }: { view: CliViewState }) {
  const { stdout } = useStdout()
  // Fixed-height scroll window: the conversation occupies the terminal rows
  // minus the status line, stats bar, and input bar, so a long transcript
  // scrolls inside this region and the input stays pinned at the bottom.
  const rows = stdout.rows && stdout.rows > 0 ? stdout.rows : 24
  const height = Math.max(5, rows - 4)
  const folded = foldRows(view.items)
  // Track which tool rows are expanded; Ctrl+O toggles all.
  const [expandedRows, setExpandedRows] = React.useState<boolean[]>([])
  React.useEffect(() => {
    if (folded.length !== expandedRows.length) {
      setExpandedRows(Array(folded.length).fill(false))
    }
  }, [folded.length])
  useInput((input, key) => {
    // Ctrl+O expands/collapses every tool run.
    if (key.ctrl && input === 'o') {
      setExpandedRows(runs => runs.map(expanded => !expanded))
    }
  })
  const offset = Math.max(0, folded.length - height)
  const visible = folded.slice(offset)
  return (
    <Box flexDirection="column" height={height} overflowY="hidden" justifyContent="flex-end">
      {visible.length === 0
        ? <Text dimColor>No messages yet — type a prompt below.</Text>
        : visible.map((row, index) => {
          const globalIndex = offset + index
          return (
            <Box key={`row-${globalIndex}`} flexDirection="column" marginBottom={1}>
              {row.tools !== undefined
                ? renderToolRow(row.tools, expandedRows[globalIndex] ?? false, `tools-${globalIndex}`)
                : renderItem(row.item as CliViewItem, `item-${globalIndex}`)}
            </Box>
          )
        })}
    </Box>
  )
}
