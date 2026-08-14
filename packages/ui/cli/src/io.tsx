/**
 * The ink io bridge: mounts the terminal UI and serves the driver's line io.
 * Kept in a .tsx module because it renders JSX.
 * @module @deepseek-ai/dsh-cli-ui/io
 */

import * as React from 'react'
import { render } from 'ink'
import { CliApp } from './app.tsx'
import type { CliViewStoreLike } from './hooks/use-cli-view.ts'

/** The io contract the driver consumes: read a line, then dispose. */
export interface InteractiveIo {
  nextLine(): Promise<string | null>
  dispose(): void
}

/** The interaction hooks the driver wires to the UI. */
export interface InteractiveIoOptions {
  /** The driver-owned view store the UI projects. */
  view: CliViewStoreLike
  /** Cancel the in-flight turn. */
  onCancel(this: void): void
  /** Request a clean process exit. */
  onExit(this: void): void
  /** Up-arrow history navigation. */
  onHistoryUp?(this: void, current: string): string | undefined
  /** Down-arrow history navigation. */
  onHistoryDown?(this: void, current: string): string | undefined
  /** Shift+Tab cycles the permission preset. */
  onCyclePermission?(this: void): void
}

/**
 * Mount the ink TUI and return a line io the REPL driver can read from.
 * @param options - the view store plus the driver's cancellation/exit hooks.
 * @returns a nextLine that resolves each submitted line, plus dispose.
 */
export function createInteractiveIo(options: InteractiveIoOptions): InteractiveIo {
  let pending: ((line: string | null) => void) | null = null
  // Buffered submitted lines: a prompt typed while the agent is busy waits
  // here (runRepl is blocked on whenIdle and has no nextLine outstanding),
  // instead of being dropped as "no reaction".
  const buffer: string[] = []
  let disposed = false
  // The ink tree alone consumes stdin: any extra 'readable' listener would
  // compete for the same stream and starve ink's keypress handling.
  const resolveNext = (line: string | null): void => {
    if (pending !== null) {
      const resolve = pending
      pending = null
      resolve(line)
    } else if (line !== null) {
      buffer.push(line)
    }
  }
  // Switch to the alternate screen first so the transcript owns the whole
  // terminal: the input bar stays pinned at the bottom and the mouse wheel
  // scrolls inside the ink UI instead of the terminal's own history. Only on a
  // real TTY — piped/CI output must not be polluted with screen-switch codes.
  if (process.stdout.isTTY) process.stdout.write('\x1b[?1049h')
  const instance = render(
    <CliApp
      store={options.view}
      onSubmit={resolveNext}
      onCtrlC={options.onCancel}
      onExit={() => { options.onExit(); resolveNext(null) }}
      {...(options.onHistoryUp === undefined ? {} : { onHistoryUp: options.onHistoryUp })}
      {...(options.onHistoryDown === undefined ? {} : { onHistoryDown: options.onHistoryDown })}
      {...(options.onCyclePermission === undefined ? {} : { onCyclePermission: options.onCyclePermission })}
    />,
  )
  // ink arms raw mode when the input hook mounts; re-arm explicitly so the
  // first keypress after a watch-restart is parsed as a key, not a raw escape
  // sequence (otherwise an early Up becomes the literal "^[[A").
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(true) } catch { /* non-tty stdin */ }
  }
  return {
    nextLine: () => {
      if (disposed) return Promise.resolve(null)
      if (pending !== null) return Promise.reject(new Error('cli-ui: concurrent nextLine'))
      const buffered = buffer.shift()
      if (buffered !== undefined) return Promise.resolve(buffered)
      return new Promise<string | null>((resolve) => { pending = resolve })
    },
    dispose: () => {
      disposed = true
      instance.unmount()
      // Leave the alternate screen, restoring the terminal's prior content.
      if (process.stdout.isTTY) process.stdout.write('\x1b[?1049l')
    },
  }
}
