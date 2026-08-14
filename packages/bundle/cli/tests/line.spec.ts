/** Pure REPL line classification. */

import { describe, expect, it } from 'vitest'
import { parseLine } from '../src/line.ts'

describe('parseLine', () => {
  it('classifies empty and whitespace-only lines', () => {
    expect(parseLine('')).toEqual({ kind: 'empty' })
    expect(parseLine('   ')).toEqual({ kind: 'empty' })
  })

  it('parses slash commands into a name and argument list', () => {
    expect(parseLine('/exit')).toEqual({ kind: 'slash', name: 'exit', args: [] })
    expect(parseLine('/model deepseek-v4-flash'))
      .toEqual({ kind: 'slash', name: 'model', args: ['deepseek-v4-flash'] })
    expect(parseLine('/session  session-abc  '))
      .toEqual({ kind: 'slash', name: 'session', args: ['session-abc'] })
  })

  it('keeps plain prompts intact with leading whitespace trimmed', () => {
    expect(parseLine('fix the failing test')).toEqual({ kind: 'prompt', text: 'fix the failing test' })
    expect(parseLine('  what is 2 + 2?  ')).toEqual({ kind: 'prompt', text: 'what is 2 + 2?' })
  })
})
