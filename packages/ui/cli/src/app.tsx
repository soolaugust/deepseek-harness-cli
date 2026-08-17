/**
 * The ink application root: a Claude Code-style layout — the conversation
 * scrolls in the flexible top region, a status line and the round-bordered
 * prompt input stay fixed at the bottom.
 * @module @deepseek-ai/dsh-cli-ui/app
 */

import * as React from 'react'
import { Box, Text as InkText, useInput } from 'ink'
import { useCliView, type CliViewStoreLike } from './hooks/use-cli-view.ts'
import { isCancelKey, isExitKey } from './keys.ts'
import { ScrollRegion } from './scroll-region.tsx'
import { ModeBadge, PermissionBadge, SessionStats, StatusBar } from './status-bar.tsx'
import { CliTextInput } from './text-input.tsx'

/** The props the io wires from the driver's view store and interaction hooks. */
export interface CliAppProps {
  /** The driver-owned view store. */
  store: CliViewStoreLike
  /** Submit one input line to the driver. */
  onSubmit(this: void, line: string): void
  /** Cancel the in-flight turn (Ctrl+C while busy). */
  onCtrlC(this: void): void
  /** Request a clean exit (Ctrl+C at the prompt, or Ctrl+D). */
  onExit(this: void): void
  /** Up-arrow history navigation. */
  onHistoryUp?(this: void, current: string): string | undefined
  /** Down-arrow history navigation. */
  onHistoryDown?(this: void, current: string): string | undefined
  /** Shift+Tab cycles the permission preset. */
  onCyclePermission?(this: void): void
}

/** The assembled terminal UI. */
export function CliApp({ store, onSubmit, onCtrlC, onExit, onHistoryUp, onHistoryDown, onCyclePermission }: CliAppProps) {
  const view = useCliView(store)
  const [input, setInput] = React.useState('')
  useInput((inputChar, key) => {
    // Shift+Tab cycles the permission preset.
    if (key.shift && key.tab) {
      onCyclePermission?.()
      return
    }
    // Ctrl+C / Ctrl+D are handled here; printable input belongs to the
    // text input, which also owns the prompt focus.
    if (isCancelKey(inputChar, key)) {
      if (view.busy) onCtrlC()
      else onExit()
    } else if (isExitKey(inputChar, key)) {
      onExit()
    }
  })
  return (
    <Box flexDirection="column">
      <ScrollRegion view={view} />
      <Box flexShrink={0} flexDirection="row">
        <Box flexGrow={1}>
          <StatusBar view={view} />
        </Box>
        <SessionStats view={view} />
      </Box>
      <Box
        flexShrink={0}
        flexDirection="row"
        alignItems="flex-start"
        borderStyle="round"
        borderColor={view.busy ? 'yellow' : 'gray'}
        borderLeft={false}
        borderRight={false}
        borderBottom
      >
        <InkText color={view.busy ? 'yellow' : 'green'}>{view.busy ? '…' : '❯'} </InkText>
        <Box flexGrow={1} flexShrink={1}>
          <CliTextInput
            value={input}
            onChange={setInput}
            onSubmit={(line) => { onSubmit(line); setInput('') }}
            {...(onHistoryUp === undefined ? {} : { onHistoryUp })}
            {...(onHistoryDown === undefined ? {} : { onHistoryDown })}
          />
        </Box>
      </Box>
      <ModeBadge view={view} />
      <PermissionBadge view={view} />
    </Box>
  )
}
