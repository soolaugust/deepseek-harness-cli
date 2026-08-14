/**
 * The status line: session id, busy state, and the current model provider.
 * @module @deepseek-ai/dsh-cli-ui/status-bar
 */

import * as React from 'react'
import { Box, Text } from 'ink'
import type { CliViewState } from './types.ts'

/** Render the bottom status line above the input bar. */
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
