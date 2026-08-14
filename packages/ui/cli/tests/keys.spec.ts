/** Pure Ctrl+C / Ctrl+D classification for the terminal UI. */

import { describe, expect, it } from 'vitest'
import { isCancelKey, isExitKey } from '../src/keys.ts'

describe('key classification', () => {
  it('recognizes Ctrl+C in both its control-byte and character forms', () => {
    expect(isCancelKey('c', { ctrl: true })).toBe(true)
    expect(isCancelKey('\x03', { ctrl: true })).toBe(true)
    expect(isCancelKey('c', {})).toBe(false)
    expect(isCancelKey('x', { ctrl: true })).toBe(false)
  })

  it('recognizes Ctrl+D as exit only', () => {
    expect(isExitKey('d', { ctrl: true })).toBe(true)
    expect(isExitKey('\x04', { ctrl: true })).toBe(false)
    expect(isExitKey('d', {})).toBe(false)
  })
})
