/**
 * The top scroll region: a virtualized window over the transcript's styled
 * line model (`scroll-layout`). It renders only the visible slice of lines, so
 * a long transcript scrolls inside the region and the input stays pinned at
 * the bottom — and it never relies on ink's fixed-height clipping, which
 * mis-wraps CJK once content overflows.
 *
 * Scrolling is keyboard-driven: PgUp/PgDn page the window. While pinned to the
 * bottom the region auto-follows new items as they arrive; scrolling back pauses
 * the follow until the user returns to the bottom. ↑/↓ stay with the text input
 * for history navigation, so they are not consumed here.
 * @module @deepseek-ai/dsh-cli-ui/scroll-region
 */

import * as React from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import type { CliViewState } from './types.ts'
import { layoutItems, foldRows, scrollStep, viewportSlice } from './scroll-layout.ts'
import type { StyledRun } from './scroll-layout.ts'

/** Rows reserved above the scroll region by the status line, stats, and input. */
const FIXED_ROWS = 4

/** The minimum usable viewport height in rows. */
const MIN_HEIGHT = 5

/** Render one styled run as an ink `<Text>`, carrying only set styles. */
function StyledText({ run }: { run: StyledRun }) {
  return (
    <Text
      {...(run.bold ? { bold: true } : {})}
      {...(run.italic ? { italic: true } : {})}
      {...(run.dim ? { dimColor: true } : {})}
      {...(run.color !== undefined ? { color: run.color } : {})}
    >
      {run.text}
    </Text>
  )
}

/**
 * The scrollable conversation region. The visible window is a slice of the
 * styled line list sized to the terminal rows, so the newest items stay on
 * screen and the input stays pinned at the bottom.
 * @param view - the current view state.
 */
export function ScrollRegion({ view }: { view: CliViewState }) {
  const { stdout } = useStdout()
  const width = stdout.columns && stdout.columns > 0 ? stdout.columns : 80
  const rows = stdout.rows && stdout.rows > 0 ? stdout.rows : 24
  const height = Math.max(MIN_HEIGHT, rows - FIXED_ROWS)

  // Track which tool rows are expanded; Ctrl+O toggles all.
  const groups = foldRows(view.items).filter(row => row.tools !== undefined).length
  const [expanded, setExpanded] = React.useState<boolean[]>([])
  React.useEffect(() => {
    setExpanded((prev) => {
      if (prev.length === groups) return prev
      return Array(groups).fill(false) as boolean[]
    })
  }, [groups])

  const lines = React.useMemo(() => layoutItems(view.items, width, expanded), [view.items, width, expanded])
  const total = lines.length
  const maxOffset = Math.max(0, total - height)

  // Offset from the bottom in lines; 0 pins to the newest content.
  const [offset, setOffset] = React.useState(0)
  // Synchronous mirror so rapid PgUp/PgDn presses fold against the latest
  // offset instead of a stale render closure.
  const offsetRef = React.useRef(offset)
  React.useEffect(() => { offsetRef.current = offset })
  React.useEffect(() => {
    // Clamp when content shrinks; when pinned, stay pinned as content grows.
    setOffset(o => Math.min(o, maxOffset))
  }, [maxOffset])

  useInput((rawInput, key) => {
    if (key.ctrl && rawInput === 'o') {
      setExpanded(runs => runs.map(expanded => !expanded))
      return
    }
    const next = scrollStep(offsetRef.current, key, height, maxOffset)
    if (next !== offsetRef.current) setOffset(next)
  })

  const [start, end] = viewportSlice(total, height, offset)
  const visible = lines.slice(start, end)

  return (
    <Box flexDirection="column" height={height}>
      {visible.length === 0
        ? <Text dimColor>No messages yet — type a prompt below.</Text>
        : visible.map((line, index) => (
          <Box key={`line-${start + index}`} height={1} flexDirection="row">
            {line.runs.length === 0
              ? <Text> </Text>
              : line.runs.map((run, runIndex) => <StyledText key={runIndex} run={run} />)}
          </Box>
        ))}
    </Box>
  )
}
