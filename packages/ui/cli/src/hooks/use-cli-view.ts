/**
 * The React bridge from the REPL view store to the ink tree: subscribe in an
 * effect and force a re-render on each store emission.
 * @module @deepseek-ai/dsh-cli-ui/hooks
 */

import { useEffect, useState } from 'react'
import type { CliViewState } from '../types.ts'

/** The read surface the renderer needs from the driver's view store. */
export interface CliViewStoreLike {
  getSnapshot(): CliViewState
  subscribe(fn: () => void): () => void
}

/**
 * Project the current view state into a component, re-rendering on emission.
 * @param store - the driver-owned view store.
 * @returns the current immutable snapshot.
 */
export function useCliView(store: CliViewStoreLike): CliViewState {
  const [, force] = useState(0)
  useEffect(() => {
    return store.subscribe(() => { force(count => count + 1) })
  }, [store])
  return store.getSnapshot()
}
