/** The input keypress fold: coalesced Enter, backspace/delete, history, submit. */

import { describe, expect, it } from 'vitest'
import { applyKeypress } from '../src/text-input.tsx'

describe('applyKeypress', () => {
  it('submits on Enter when non-empty and ignores an empty value', () => {
    // Enter also resets the cursor to the start, ready for the next input.
    expect(applyKeypress('', { return: true }, 'hi', 2)).toEqual({ submit: 'hi', offset: 0 })
    expect(applyKeypress('', { return: true }, '', 0)).toEqual({})
  })

  it('handles the coalesced-Enter chunk "o\\r" as text plus Enter', () => {
    const edit = applyKeypress('o\r', {}, '', 0)
    expect(edit).toEqual({ value: 'o', offset: 1, submit: 'o' })
  })

  it('deletes the character before the cursor on both backspace and delete', () => {
    // Backspace byte → key.backspace
    expect(applyKeypress('\b', { backspace: true }, 'ab', 2)).toEqual({ value: 'a', offset: 1 })
    // DEL byte in tmux/SSH → key.delete
    expect(applyKeypress('\x7f', { delete: true }, 'ab', 2)).toEqual({ value: 'a', offset: 1 })
    // Delete at the start is a no-op
    expect(applyKeypress('\x7f', { delete: true }, 'ab', 0)).toEqual({})
  })

  it('moves the cursor with arrow keys and clamps at the ends', () => {
    expect(applyKeypress('', { leftArrow: true }, 'ab', 2)).toEqual({ offset: 1 })
    expect(applyKeypress('', { rightArrow: true }, 'ab', 1)).toEqual({ offset: 2 })
    expect(applyKeypress('', { leftArrow: true }, 'ab', 0)).toEqual({ offset: 0 })
  })

  it('navigates history on up/down and falls through to the current value', () => {
    expect(applyKeypress('', { upArrow: true }, 'current', 7, c => c === 'current' ? 'older' : undefined))
      .toEqual({ value: 'older', offset: 5 })
    expect(applyKeypress('', { downArrow: true }, 'older', 5, undefined, () => 'current'))
      .toEqual({ value: 'current', offset: 7 })
    expect(applyKeypress('', { upArrow: true }, 'current', 7)).toEqual({})
  })

  it('inserts printable input at the cursor', () => {
    expect(applyKeypress('x', {}, 'ab', 1)).toEqual({ value: 'axb', offset: 2 })
  })

  it('ignores SGR mouse wheel events instead of inserting them', () => {
    // The scroll region consumes the wheel; the input must not insert the raw
    // escape sequence. ink strips the leading ESC, so the input is `[<…M`.
    expect(applyKeypress('[<64;10;20M', {}, 'ab', 1)).toEqual({})
    expect(applyKeypress('[<65;10;20M', {}, 'ab', 1)).toEqual({})
  })

  it('ignores chunked mouse sequence fragments too', () => {
    // A slow stdin can deliver the SGR mouse escape in pieces; each fragment
    // must not reach the input as printable text.
    expect(applyKeypress('[<', {}, 'ab', 1)).toEqual({})
    expect(applyKeypress('65;10;20M', {}, 'ab', 1)).toEqual({})
    expect(applyKeypress('10;20M', {}, 'ab', 1)).toEqual({})
  })
})
