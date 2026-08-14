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
}

/**
 * Mount the ink TUI and return a line io the REPL driver can read from.
 * @param options - the view store plus the driver's cancellation/exit hooks.
 * @returns a nextLine that resolves each submitted line, plus dispose.
 */
export function createInteractiveIo(options: InteractiveIoOptions): InteractiveIo {
  let pending: ((line: string | null) => void) | null = null
  let disposed = false
  // Resolve the driver's pending line read; a null line is the EOF/exit signal
  // that lets the REPL loop wind down cleanly. The ink tree alone consumes
  // stdin: any extra 'readable' listener would compete for the same stream and
  // starve ink's keypress handling.
  const resolveNext = (line: string | null): void => {
    if (pending !== null) {
      const resolve = pending
      pending = null
      resolve(line)
    }
  }
  const instance = render(
    <CliApp
      store={options.view}
      onSubmit={resolveNext}
      onCtrlC={options.onCancel}
      onExit={() => { options.onExit(); resolveNext(null) }}
      {...(options.onHistoryUp === undefined ? {} : { onHistoryUp: options.onHistoryUp })}
      {...(options.onHistoryDown === undefined ? {} : { onHistoryDown: options.onHistoryDown })}
    />,
  )
  return {
    nextLine: () => {
      if (disposed) return Promise.resolve(null)
      if (pending !== null) return Promise.reject(new Error('cli-ui: concurrent nextLine'))
      return new Promise<string | null>((resolve) => { pending = resolve })
    },
    dispose: () => {
      disposed = true
      instance.unmount()
    },
  }
}
