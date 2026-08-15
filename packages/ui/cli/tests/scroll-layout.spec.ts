/** The transcript line model: width-aware wrapping, tool folding, spacing. */

import { describe, expect, it } from 'vitest'
import { charWidth, layoutItems, markdownLines, scrollStep, textWidth, truncateToColumns, viewportSlice, wrapText } from '../src/scroll-layout.ts'
import type { CliViewItem } from '../src/types.ts'

/** Collapse a rendered line to its plain text for assertions. */
function plain(lines: ReturnType<typeof layoutItems>): string[] {
  return lines.map(line => line.runs.map(run => run.text).join(''))
}

describe('charWidth / textWidth', () => {
  it('counts ASCII as one column and CJK as two', () => {
    expect(charWidth('a')).toBe(1)
    expect(charWidth('中')).toBe(2)
    expect(textWidth('ab中')).toBe(4)
  })
})

describe('truncateToColumns', () => {
  it('never exceeds the width and does not split a wide glyph', () => {
    expect(truncateToColumns('中a中b中c', 4)).toBe('中a')
    expect(textWidth(truncateToColumns('中a中b中c', 4))).toBeLessThanOrEqual(4)
  })
  it('returns the whole string when it fits', () => {
    expect(truncateToColumns('abc', 10)).toBe('abc')
  })
})

describe('wrapText', () => {
  it('wraps ASCII to width', () => {
    expect(wrapText('abcdef', 4)).toEqual(['abcd', 'ef'])
  })
  it('respects CJK wide glyphs', () => {
    // 'ab中文' is 6 columns; 4-column wrap splits after 'ab中' (4 cols).
    expect(wrapText('ab中文', 4)).toEqual(['ab中', '文'])
  })
  it('never drops a char even when it exactly fills a row', () => {
    expect(wrapText('中文', 2)).toEqual(['中', '文'])
  })
  it('does not emit a trailing empty line on an exact boundary', () => {
    expect(wrapText('abcd', 4)).toEqual(['abcd'])
  })
})

describe('markdownLines', () => {
  it('renders headings bold and paragraphs wrapped with a blank separator', () => {
    const lines = plain(markdownLines('## 标题\n\n一段较长的正文内容需要换行', 8))
    expect(lines[0]).toContain('标题')
    expect(lines[1]).toBe('') // blank line separates the heading block.
    // Paragraph wraps to the terminal width.
    expect(lines[2]).toBe('一段较长')
    expect(lines.some(l => l.includes('的正文内'))).toBe(true)
  })

  it('keeps code blocks unwrapped and dim, clipped at width', () => {
    const lines = plain(markdownLines('```c\nif (write_fault) {\n    page = alloc_page();\n}\n```', 10))
    expect(lines.some(l => l.includes('if (write_'))).toBe(true)
    // No line exceeds the width.
    for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(10)
  })

  it('truncates wide-glyph code at a column boundary without dropping the tail', () => {
    const lines = plain(markdownLines('```\n中a中b中c\n```', 4))
    // The full line is 6 columns; the 4-column clip keeps the first 3 and
    // leaves the tail for a next line only if it wraps — code does not wrap,
    // so the visible prefix must not exceed 4 columns.
    for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(4)
    expect(lines.some(l => l.includes('中a'))).toBe(true)
  })

  it('prefixes list items with markers and indents continuation', () => {
    const lines = plain(markdownLines('1. 第一项\n2. 第二项', 20))
    expect(lines.some(l => l.includes('1. 第一项'))).toBe(true)
    expect(lines.some(l => l.includes('2. 第二项'))).toBe(true)
  })
})

describe('scrollStep', () => {
  it('pages up (back) by the viewport height, clamped to the max', () => {
    expect(scrollStep(0, { pageUp: true }, 10, 50)).toBe(10)
    expect(scrollStep(45, { pageUp: true }, 10, 50)).toBe(50) // clamp at max
  })
  it('pages down (toward newest) by the viewport height, clamped to zero', () => {
    expect(scrollStep(10, { pageDown: true }, 10, 50)).toBe(0)
    expect(scrollStep(3, { pageDown: true }, 10, 50)).toBe(0) // clamp at 0
  })
  it('leaves the offset unchanged for non-paging keys', () => {
    expect(scrollStep(10, {}, 10, 50)).toBe(10)
  })
})

describe('viewportSlice', () => {
  it('shows the newest content at offset zero', () => {
    expect(viewportSlice(30, 10, 0)).toEqual([20, 30])
  })
  it('pages back by moving the window earlier in the transcript', () => {
    expect(viewportSlice(30, 10, 10)).toEqual([10, 20])
  })
  it('clamps an oversized offset to the earliest window', () => {
    expect(viewportSlice(30, 10, 100)).toEqual([0, 10])
  })
  it('handles content shorter than the viewport', () => {
    expect(viewportSlice(4, 10, 0)).toEqual([0, 4])
  })
})

describe('layoutItems', () => {
  const item = (kind: CliViewItem['kind'], over: Partial<CliViewItem> = {}): CliViewItem =>
    ({ kind, text: '', streaming: false, ...over }) as CliViewItem

  it('separates message blocks with a blank line', () => {
    const items: CliViewItem[] = [
      item('user', { text: 'hello' }),
      item('assistant', { text: 'hi', streaming: false }),
    ]
    const lines = plain(layoutItems(items, 80, []))
    expect(lines[0]).toBe('> hello')
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe('hi')
  })

  it('renders markdown on streaming assistant text, not raw markup', () => {
    const items: CliViewItem[] = [
      { kind: 'assistant', text: '## 核心思路\n\n写时复制', streaming: true },
    ]
    const lines = plain(layoutItems(items, 80, []))
    // The heading is parsed, not shown as literal `##`.
    expect(lines.some(l => l.includes('##'))).toBe(false)
    expect(lines.some(l => l.includes('核心思路'))).toBe(true)
  })

  it('falls back to raw text when a partial markdown token yields nothing', () => {
    const items: CliViewItem[] = [
      { kind: 'assistant', text: '## ', streaming: true },
    ]
    const lines = plain(layoutItems(items, 80, []))
    expect(lines.length).toBeGreaterThan(0)
  })

  it('folds adjacent tool calls into one collapsed row', () => {
    const items: CliViewItem[] = [
      { kind: 'tool', name: 'web_search', callId: 'a', state: 'done' },
      { kind: 'tool', name: 'read_file', callId: 'b', state: 'done' },
    ]
    const collapsed = plain(layoutItems(items, 80, [false]))
    expect(collapsed[0]).toContain('⇣ 2 tools')
    expect(collapsed[0]).toContain('web_search')
    expect(collapsed[0]).toContain('read_file')
    expect(collapsed.length).toBe(1)
  })

  it('expands tool rows when flagged', () => {
    const items: CliViewItem[] = [
      { kind: 'tool', name: 'bash', callId: 'a', state: 'done' },
    ]
    const expanded = plain(layoutItems(items, 80, [true]))
    expect(expanded[0]).toContain('✓ bash')
    expect(expanded.length).toBe(1)
  })

  it('does not leave a blank line before a divider', () => {
    const items: CliViewItem[] = [
      item('assistant', { text: 'text', streaming: false }),
      { kind: 'divider' },
    ]
    const lines = plain(layoutItems(items, 80, []))
    // 'text', blank?, divider — no blank between text and divider.
    const textIdx = lines.indexOf('text')
    expect(lines[textIdx + 1]).toBe('─'.repeat(80))
  })
})
