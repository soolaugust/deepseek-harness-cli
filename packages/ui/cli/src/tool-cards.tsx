/**
 * Terminal rendering of tool cards: a running call, a completed result, or an
 * error, one bordered line per tool invocation.
 * @module @deepseek-ai/dsh-cli-ui/tool-cards
 */

import * as React from 'react'
import { Box, Text } from 'ink'
import type { CliViewItem } from './types.ts'

/** Render one tool card line from its view item. */
export function ToolCard({ item }: { item: Extract<CliViewItem, { kind: 'tool' }> }) {
  const color = item.state === 'error' ? 'red' : item.state === 'done' ? 'green' : 'yellow'
  const marker = item.state === 'running' ? '…' : item.state === 'error' ? '✗' : '✓'
  return (
    <Box>
      <Text color={color}>{marker} </Text>
      <Text>{item.name}</Text>
      {item.error !== undefined && <Text color="red"> {item.error}</Text>}
    </Box>
  )
}
