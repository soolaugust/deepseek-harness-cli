/**
 * The top scroll region: renders the trailing slice of the conversation.
 * It flex-grows to fill the space above the fixed status line and input, and
 * auto-sticks to the bottom as new items arrive.
 * @module @deepseek-ai/dsh-cli-ui/scroll-region
 */

import * as React from 'react'
import { Box, Text, useStdout } from 'ink'
import type { CliViewItem, CliViewState } from './types.ts'
import { markdownToInk } from './markdown.tsx'
import { ToolCard } from './tool-cards.tsx'

/** Render one conversation item to terminal text. */
export function renderItem(item: CliViewItem, key: number) {
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

/**
 * The scrollable conversation region. The visible window is the trailing
 * slice sized to the terminal rows, so the newest items stay on screen.
 * @param view - the current view state.
 */
export function ScrollRegion({ view }: { view: CliViewState }) {
  const { stdout } = useStdout()
  // Guard against hosts that report no window size: fall back to 24 rows.
  const rows = stdout.rows && stdout.rows > 0 ? stdout.rows : 24
  // Leave room for the status line, the input border, and the input row.
  const visible = view.items.slice(-Math.max(5, rows - 4))
  return (
    <Box flexDirection="column" flexGrow={1} overflowY="hidden">
      {visible.length === 0
        ? <Text dimColor>No messages yet — type a prompt below.</Text>
        : visible.map(renderItem)}
    </Box>
  )
}
