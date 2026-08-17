/**
 * The line model for the transcript scroll region.
 *
 * `ink` gives no public API to measure or scroll content, and its fixed-height
 * `overflowY: hidden` window mis-wraps CJK once content exceeds the window
 * (paragraph text interleaves with code fences). This module instead flattens
 * the conversation into a virtual list of *styled terminal lines* — each line
 * is a run of `StyledRun`s that fits the terminal width exactly, so the scroll
 * region renders only the visible slice and never asks ink to wrap or clip.
 *
 * The entry point is `layoutItems`: it folds adjacent tool calls (collapsed to
 * one `⇣ n tools` line, or expanded per tool), inserts one blank separator
 * line between distinct message blocks, and returns the flat line list the
 * scroll region slices from. Folding state arrives from the component as an
 * array indexed by tool-group position.
 * @module @deepseek-ai/dsh-cli-ui/scroll-layout
 */

import { marked, type Token, type Tokens } from 'marked'
import type { CliViewItem } from './types.ts'

/** Terminal colors used in the transcript. */
export type RunColor = 'cyan' | 'red' | 'green' | 'yellow' | 'gray'

/** A styled character run that renders as one adjacent `<Text>`. */
export interface StyledRun {
  text: string
  bold?: boolean
  italic?: boolean
  dim?: boolean
  color?: RunColor
}

/** One terminal row: styled runs that exactly fill `width` columns. */
export interface RenderLine {
  runs: StyledRun[]
}

/** A styled character used for width-aware wrapping. */
interface Char {
  ch: string
  bold: boolean
  italic: boolean
  dim: boolean
  color: RunColor | undefined
}

/**
 * The terminal-column width of one glyph: wide glyphs render as two columns.
 * @param ch - the single character to measure.
 * @returns 2 for wide glyphs, otherwise 1.
 */
export function charWidth(ch: string): number {
  return /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u.test(ch) ? 2 : 1
}

/**
 * The width of a plain string in terminal columns.
 * @param text - the string to measure.
 * @returns the summed column width of every glyph in `text`.
 */
export function textWidth(text: string): number {
  let w = 0
  for (const ch of text) w += charWidth(ch)
  return w
}

/**
 * Truncate a string to `width` terminal columns without splitting a wide
 * glyph: the slice ends on a character boundary and never exceeds `width`.
 * @param text - the text to truncate.
 * @param width - the maximum width in columns.
 * @returns a prefix of `text` no wider than `width` columns.
 */
export function truncateToColumns(text: string, width: number): string {
  let cols = 0
  let out = ''
  for (const ch of text) {
    const w = charWidth(ch)
    if (cols + w > width) break
    out += ch
    cols += w
  }
  return out
}

/**
 * Wrap a plain string to `width` terminal columns, CJK-aware. A trailing empty
 * line is never produced for input that ends exactly on a boundary.
 * @param text - the text to wrap.
 * @param width - the terminal width in columns.
 * @returns the wrapped lines.
 */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  let cols = 0
  for (const ch of text) {
    const w = charWidth(ch)
    if (cols + w > width && line !== '') {
      lines.push(line)
      line = ''
      cols = 0
    }
    line += ch
    cols += w
  }
  lines.push(line)
  return lines
}

/** Style state carried while wrapping a styled character stream. */
type StyleState = { bold: boolean; italic: boolean; dim: boolean; color: RunColor | undefined }

/** Partial style state accepted by line builders (color stays optional). */
type CharStyle = Partial<Omit<StyleState, 'color'> & { color?: RunColor }>

/** Build a styled character stream from a plain string. */
function plainChars(text: string, s: CharStyle = {}): Char[] {
  // Array.from, not spread, so surrogate pairs (emoji) stay whole code points.
  return Array.from(text).map(ch => ({
    ch,
    bold: s.bold ?? false,
    italic: s.italic ?? false,
    dim: s.dim ?? false,
    color: s.color,
  }))
}

/**
 * Wrap a styled character stream into `width`-wide lines, merging adjacent
 * characters with identical style into a single run per row.
 * @param chars - the styled characters to wrap.
 * @param width - the terminal width in columns.
 * @returns the wrapped lines, one `RenderLine` per row.
 */
export function wrapChars(chars: Char[], width: number): RenderLine[] {
  const lines: RenderLine[] = []
  let runs: StyledRun[] = []
  let cols = 0
  const flush = () => {
    if (runs.length > 0) {
      lines.push({ runs })
      runs = []
      cols = 0
    }
  }
  const emit = (ch: string, s: StyleState) => {
    const w = charWidth(ch)
    if (cols + w > width && runs.length > 0) {
      flush()
    }
    const last = runs[runs.length - 1]
    const same = last !== undefined &&
      last.bold === s.bold && last.italic === s.italic &&
      last.dim === s.dim && last.color === s.color
    if (same) {
      last.text += ch
    } else {
      runs.push({
        text: ch,
        bold: s.bold,
        italic: s.italic,
        dim: s.dim,
        ...(s.color !== undefined ? { color: s.color } : {}),
      })
    }
    cols += w
  }
  for (const c of chars) {
    emit(c.ch, { bold: c.bold, italic: c.italic, dim: c.dim, color: c.color })
  }
  flush()
  return lines
}

/** A pending styled line builder fed inline tokens, then wrapped. */
class LineBuilder {
  private chars: Char[] = []
  private width: number

  constructor(width: number) {
    this.width = width
  }

  add(text: string, s: CharStyle = {}): this {
    this.chars.push(...plainChars(text, s))
    return this
  }

  addInline(tokens: readonly Token[], inherited: CharStyle = {}): this {
    for (const token of tokens) {
      this.addInlineToken(token, inherited)
    }
    return this
  }

  private addInlineToken(token: Token, inherited: CharStyle) {
    switch (token.type) {
      case 'space':
        break
      case 'codespan':
        this.add(token.text as string, { ...inherited, color: 'cyan' })
        return
      case 'em':
        this.addInline(token.tokens ?? [], { ...inherited, italic: true })
        return
      case 'strong':
        this.addInline(token.tokens ?? [], { ...inherited, bold: true })
        return
      case 'link':
        this.addInline(token.tokens ?? [], inherited)
        return
      case 'image':
        this.add((token as Tokens.Image).title ?? (token as Tokens.Image).href, { ...inherited, dim: true })
        return
      case 'text': {
        // A marked Text token may wrap nested inline tokens (a list item's
        // tokens arrive as one outer `text` whose `tokens` hold the strong /
        // codespan / em children). Recurse into them so `- **bold**` and
        // `` `code` `` render styled, not as raw markup.
        const inner = (token as Tokens.Text).tokens
        if (inner !== undefined && inner.length > 0) {
          this.addInline(inner, inherited)
        } else {
          this.add((token as Tokens.Text).text, inherited)
        }
        return
      }
      default:
        this.add((token as { raw: string }).raw, inherited)
    }
  }

  /** Wrap the accumulated styled chars into `width`-wide lines. */
  toLines(): RenderLine[] {
    return wrapChars(this.chars, this.width)
  }
}

/** A conversation item that is not a tool call. */
export type NonToolItem = Exclude<CliViewItem, { kind: 'tool' }>

/**
 * A row in the conversation: either one non-tool item, or a run of adjacent
 * tool calls (folded or expanded).
 */
export interface LayoutRow {
  /** The folded tool run, when this row groups tool calls. */
  tools?: Extract<CliViewItem, { kind: 'tool' }>[]
  /** The single non-tool item, when this row is not a tool group. */
  item?: NonToolItem
}

/**
 * Fold adjacent tool calls into groups, mirroring the previous
 * `ScrollRegion.foldRows` behavior. Non-tool items become singleton rows.
 * @param items - the conversation items in arrival order.
 * @returns the folded rows.
 */
export function foldRows(items: readonly CliViewItem[]): LayoutRow[] {
  const rows: LayoutRow[] = []
  let run: Extract<CliViewItem, { kind: 'tool' }>[] = []
  const flush = () => {
    if (run.length > 0) {
      rows.push({ tools: run })
      run = []
    }
  }
  for (const item of items) {
    if (item.kind === 'tool') {
      run.push(item)
    } else {
      flush()
      rows.push({ item })
    }
  }
  flush()
  return rows
}

/** Build the styled lines for a tool row. */
function toolRowLines(row: LayoutRow, expanded: boolean, width: number): RenderLine[] {
  const tools = row.tools ?? []
  if (!expanded) {
    const names = [...new Set(tools.map(t => t.name))].join(', ')
    return wrapChars(plainChars(`⇣ ${tools.length} tool${tools.length > 1 ? 's' : ''} · ${names}`, { dim: true }), width)
  }
  return tools.flatMap((tool) => {
    const marker = tool.state === 'running' ? '…' : tool.state === 'error' ? '✗' : '✓'
    const color = tool.state === 'error' ? 'red' : tool.state === 'done' ? 'green' : 'yellow'
    return wrapChars(plainChars(`${marker} ${tool.name}`, { color }), width)
  })
}

/** Build the styled lines for a non-tool item. */
function itemLines(item: NonToolItem, width: number): RenderLine[] {
  switch (item.kind) {
    case 'user':
      return wrapChars(plainChars(`> ${item.text}`, { color: 'cyan' }), width)
    case 'assistant': {
      // Render markdown both streaming and committed, so a `## heading` or
      // `**bold**` reads styled the moment it lands instead of showing raw
      // markup that snaps clean only after the turn finishes. Half-formed
      // tokens (an unclosed fence, a lone `#`) degrade to plain text; when the
      // partial yields nothing (e.g. a bare `## `), fall back to raw text so
      // the growing stream never blanks out.
      const lines = markdownLines(item.text, width)
      return lines.length > 0 || item.text === ''
        ? lines
        : wrapChars(plainChars(item.text), width)
    }
    case 'notice':
      return wrapChars(plainChars(item.text, { dim: true }), width)
    case 'divider':
      return wrapChars(plainChars('─'.repeat(width)), width)
  }
}

/**
 * Flatten the conversation into the styled line list the scroll region renders
 * from. One blank separator line separates distinct message blocks; a divider
 * is its own block and needs no extra gap.
 * @param items - the conversation items.
 * @param width - the terminal width in columns.
 * @param expanded - per-tool-group expansion flags, indexed by group position.
 * @returns the flat line list.
 */
export function layoutItems(items: readonly CliViewItem[], width: number, expanded: boolean[]): RenderLine[] {
  const rows = foldRows(items)
  const out: RenderLine[] = []
  const blank: RenderLine = { runs: [] }
  let previousHadLines = false
  for (const [index, row] of rows.entries()) {
    if (row.tools !== undefined) {
      const lines = toolRowLines(row, expanded[index] ?? false, width)
      if (lines.length === 0) continue
      if (previousHadLines) out.push(blank)
      out.push(...lines)
    } else if (row.item !== undefined) {
      const lines = itemLines(row.item, width)
      if (lines.length === 0) continue
      if (previousHadLines && row.item.kind !== 'divider') out.push(blank)
      out.push(...lines)
    }
    previousHadLines = true
  }
  return out
}

/**
 * The next scroll offset (from the bottom, in lines) for a paging keypress.
 * PgUp scrolls back by a page, PgDn returns toward the newest content; both
 * clamp to `[0, maxOffset]` so the window never runs past either end.
 * @param offset - the current offset from the bottom in lines.
 * @param key - the key descriptor from ink's `useInput`.
 * @param page - the viewport height used as the page size.
 * @param maxOffset - the largest usable offset (total lines − viewport height).
 * @returns the next offset, unchanged when the key is not a paging key.
 */
export function scrollStep(
  offset: number,
  key: { pageUp?: boolean; pageDown?: boolean },
  page: number,
  maxOffset: number,
): number {
  if (key.pageUp) return Math.min(maxOffset, offset + page)
  if (key.pageDown) return Math.max(0, offset - page)
  return offset
}

/**
 * Whether an ink `useInput` raw input is an SGR mouse wheel event, and which
 * way the wheel turned. With mouse mode enabled (`\x1b[?1000h\x1b[?1006h`) a
 * terminal sends `\x1b[<64;…M` (wheel up) / `\x1b[<65;…M` (wheel down). ink
 * strips the leading `\x1b`, so the input arrives as `[<64;…M` — match that
 * form. The scroll region consumes the wheel; the text input must not treat it
 * as printable input.
 * @param input - the raw input ink delivered (without the leading ESC).
 * @returns 1 for a wheel-up event (scroll back), -1 for wheel-down, 0 otherwise.
 */
export function parseMouseWheel(input: string): 0 | 1 | -1 {
  const m = /^\[<(\d+);\d+;\d+[Mm]$/.exec(input)
  if (m === null) return 0
  const button = Number(m[1])
  if (button === 64) return 1 // wheel up
  if (button === 65) return -1 // wheel down
  return 0
}

/**
 * The inclusive window slice for the given offset: the trailing `total − offset`
 * lines, capped to `height`. Offset 0 is the newest content (the bottom).
 * @param total - the total number of lines.
 * @param height - the viewport height in rows.
 * @param offset - the offset from the bottom in lines.
 * @returns the visible slice indices as `[start, end)`.
 */
export function viewportSlice(total: number, height: number, offset: number): [number, number] {
  const clamped = Math.max(0, Math.min(offset, Math.max(0, total - height)))
  const start = Math.max(0, total - height - clamped)
  return [start, Math.min(total, start + height)]
}

/**
 * Flatten a markdown string into styled terminal lines, one blank line
 * separating adjacent blocks.
 * @param content - the markdown source to render.
 * @param width - the terminal width in columns.
 * @returns the styled lines, one `RenderLine` per terminal row.
 */
export function markdownLines(content: string, width: number): RenderLine[] {
  const tokens = marked.lexer(content)
  const out: RenderLine[] = []
  let block: RenderLine[] = []
  const isBlank = (line: RenderLine) => line.runs.length === 0
  const lastIsBlank = () => {
    const last = out[out.length - 1]
    return last !== undefined && isBlank(last)
  }
  const appendBlock = () => {
    if (block.length === 0) return
    if (out.length > 0 && !lastIsBlank()) out.push({ runs: [] })
    out.push(...block)
    block = []
  }
  for (const token of tokens) {
    switch (token.type) {
      case 'space':
        appendBlock()
        break
      case 'code': {
        appendBlock()
        const text = token.text as string
        const codeLines: RenderLine[] = []
        for (const line of text.split('\n')) {
          // Code never wraps; clip at the terminal width like a pager,
          // truncating on a character boundary so a wide glyph never splits.
          const clipped = truncateToColumns(line, width)
          codeLines.push(...wrapChars(plainChars(clipped, { dim: true }), width))
        }
        if (codeLines.length > 0) {
          if (out.length > 0 && !lastIsBlank()) out.push({ runs: [] })
          out.push(...codeLines)
        }
        break
      }
      case 'heading':
        block.push(...new LineBuilder(width).addInline(token.tokens ?? [], { bold: true }).toLines())
        break
      case 'blockquote':
        block.push(...new LineBuilder(width).add('▍ ', { italic: true, dim: true }).addInline(token.tokens ?? [], { italic: true, dim: true }).toLines())
        break
      case 'hr':
        appendBlock()
        if (out.length > 0 && !lastIsBlank()) out.push({ runs: [] })
        out.push(...wrapChars(plainChars('─'.repeat(width)), width))
        break
      case 'list': {
        const list = token as Tokens.List
        const start = typeof list.start === 'number' ? list.start : 1
        for (const [index, item] of list.items.entries()) {
          const marker = list.ordered ? `${start + index}.` : '•'
          // Wrap the body within the remaining width after the marker.
          const markerCols = textWidth(marker) + 1
          const rest = Math.max(1, width - markerCols)
          const bodyLines = new LineBuilder(rest).addInline(item.tokens).toLines()
          const indent = ' '.repeat(markerCols)
          bodyLines.forEach((line, li) => {
            const prefix = li === 0 ? `${marker} ` : indent
            block.push(...wrapChars([
              ...plainChars(prefix),
              ...styledRunsToChars(line.runs),
            ], width))
          })
        }
        break
      }
      case 'paragraph':
      case 'text':
        block.push(...new LineBuilder(width).addInline(token.tokens ?? []).toLines())
        break
      default:
        block.push(...wrapChars(plainChars((token as { raw: string }).raw), width))
    }
  }
  appendBlock()
  return out
}

function styledRunsToChars(runs: StyledRun[]): Char[] {
  return runs.flatMap(run =>
    Array.from(run.text).map(ch => ({
      ch,
      bold: run.bold ?? false,
      italic: run.italic ?? false,
      dim: run.dim ?? false,
      color: run.color,
    })),
  )
}
