/**
 * A self-managed terminal text input over `useInput`, modeled on the Claude
 * Code input: cursor offset tracking, up/down history navigation, and the
 * "coalesced Enter" handling — a slow link can deliver `"o\r"` as one chunk,
 * so a value ending in `\r` (with no embedded `\r`) submits instead of
 * inserting the carriage return as text.
 *
 * The keypress-to-edit logic lives in the pure {@link applyKeypress} so it is
 * unit-testable without an ink stdin (ink's testing library does not drive
 * `useInput`).
 * @module @deepseek-ai/dsh-cli-ui/text-input
 */

import * as React from 'react'
import { Box, Text, useInput } from 'ink'

/** The key descriptor ink passes to `useInput`. */
export interface CliInputKey {
  return?: boolean
  escape?: boolean
  ctrl?: boolean
  leftArrow?: boolean
  rightArrow?: boolean
  upArrow?: boolean
  downArrow?: boolean
  backspace?: boolean
  delete?: boolean
}

/** One keystroke's effect on the input. */
export interface KeypressEdit {
  /** The next value, when the value changes. */
  value?: string
  /** The next cursor offset. */
  offset?: number
  /** Submit this line, when Enter (or coalesced Enter) is pressed. */
  submit?: string
}

/**
 * Fold one raw keypress onto the current value and cursor.
 * @param rawInput - the raw input string ink delivered.
 * @param key - the parsed key descriptor.
 * @param value - the current input value.
 * @param offset - the current cursor offset.
 * @param onHistoryUp - up-arrow history callback; returns the older value.
 * @param onHistoryDown - down-arrow history callback; returns the newer value.
 * @returns the next value/offset and an optional submit.
 */
export function applyKeypress(
  rawInput: string,
  key: CliInputKey,
  value: string,
  offset: number,
  onHistoryUp?: (current: string) => string | undefined,
  onHistoryDown?: (current: string) => string | undefined,
): KeypressEdit {
  // Coalesced Enter: a single chunk like "o\r" on a slow link is a value plus
  // Enter. Strip the trailing \r, apply the text, then submit.
  if (rawInput.length > 1 && rawInput.endsWith('\r') && !rawInput.slice(0, -1).includes('\r')) {
    const text = rawInput.slice(0, -1)
    const next = value.slice(0, offset) + text + value.slice(offset)
    return { value: next, offset: offset + text.length, submit: next }
  }
  if (key.return) {
    return value.trim() !== '' ? { submit: value, offset: 0 } : {}
  }
  if (key.escape || (key.ctrl && rawInput === 'c')) return {}
  if (key.leftArrow) return { offset: Math.max(0, offset - 1) }
  if (key.rightArrow) return { offset: Math.min(value.length, offset + 1) }
  if (key.upArrow) {
    if (onHistoryUp) {
      const older = onHistoryUp(value)
      if (older !== undefined) return { value: older, offset: older.length }
    }
    return {}
  }
  if (key.downArrow) {
    if (onHistoryDown) {
      const newer = onHistoryDown(value)
      if (newer !== undefined) return { value: newer, offset: newer.length }
    }
    return {}
  }
  // Backspace and Delete both arrive as key.delete in tmux/SSH (the DEL byte
  // \x7f), so treat them identically as a backward delete at the cursor.
  if (key.backspace || key.delete) {
    if (offset > 0) {
      return { value: value.slice(0, offset - 1) + value.slice(offset), offset: offset - 1 }
    }
    return {}
  }
  if (rawInput.length > 0 && !key.ctrl) {
    // Normal printable input, including multi-char paste and SSH-coalesced
    // characters that are not Enter.
    const text = rawInput.replace(/\r/g, '')
    if (text === '') return {}
    return { value: value.slice(0, offset) + text + value.slice(offset), offset: offset + text.length }
  }
  return {}
}

/** The input props the REPL io supplies. */
export interface CliTextInputProps {
  /** The current value (controlled by the parent). */
  value: string
  /** Called on every edit. */
  onChange(this: void, value: string): void
  /** Called when the user presses Enter on a non-empty line. */
  onSubmit(this: void, value: string): void
  /** Called on up-arrow history navigation; returns the older value or undefined. */
  onHistoryUp?(this: void, current: string): string | undefined
  /** Called on down-arrow history navigation; returns the newer value or undefined. */
  onHistoryDown?(this: void, current: string): string | undefined
  /** Whether the input is focused (a modal or busy state may blur it). */
  focus?: boolean
}

/**
 * Render a self-managed terminal input with a visible cursor.
 * @param props - value/onChange plus history and submit callbacks.
 */
export function CliTextInput({ value, onChange, onSubmit, onHistoryUp, onHistoryDown, focus = true }: CliTextInputProps) {
  const [offset, setOffset] = React.useState(value.length)
  // Keep the cursor at the end when the value changes externally.
  React.useEffect(() => { setOffset(value.length) }, [value])
  // Synchronous mirrors of value/offset so rapid consecutive keystrokes fold
  // against the latest state instead of a stale render closure.
  const valueRef = React.useRef(value)
  const offsetRef = React.useRef(value.length)
  React.useEffect(() => { valueRef.current = value })
  React.useEffect(() => { offsetRef.current = offset })

  useInput((rawInput, key) => {
    const edit = applyKeypress(rawInput, key, valueRef.current, offsetRef.current, onHistoryUp, onHistoryDown)
    if (edit.value !== undefined) { valueRef.current = edit.value; onChange(edit.value) }
    if (edit.offset !== undefined) { offsetRef.current = edit.offset; setOffset(edit.offset) }
    if (edit.submit !== undefined) onSubmit(edit.submit)
  }, { isActive: focus })

  // Render the value with an inverted cursor block.
  const before = value.slice(0, offset)
  const at = value[offset] ?? ' '
  const after = value.slice(offset + 1)
  return (
    <Box>
      <Text>{before}</Text>
      <Text inverse>{at}</Text>
      <Text>{after}</Text>
    </Box>
  )
}
