/**
 * Markdown → ink JSX rendering for the dsh cli transcript.
 *
 * A fold of `marked`'s token stream into ink's declarative `<Text>` styles
 * (bold, italic, cyan, dim), which the terminal renders natively. Inline
 * styling composes as adjacent `<Text>` nodes in a row box; block tokens
 * (list items, fenced code, headings) become their own lines. The fold is
 * pure over the token stream, so it is unit-testable without a terminal.
 * @module @deepseek-ai/dsh-cli-ui/markdown
 */

import * as React from 'react'
import { Box, Text } from 'ink'
import { marked, type Token, type Tokens } from 'marked'

/**
 * Render a markdown string to an ink node tree.
 * @param content - raw markdown from the model.
 * @returns ink JSX that renders bold, italic, code, and lists in the terminal.
 */
export function markdownToInk(content: string): React.ReactNode {
  const tokens = marked.lexer(content)
  const lines: React.ReactNode[] = []
  for (const token of tokens) {
    const rendered = formatBlock(token)
    if (rendered !== null) lines.push(rendered)
  }
  return <Box flexDirection="column">{lines}</Box>
}

/** Format a block token; null skips it (whitespace). */
function formatBlock(token: Token): React.ReactNode {
  switch (token.type) {
    case 'space':
      return null
    case 'code': {
      const text = token.text as string
      return <Text dimColor>{text}</Text>
    }
    case 'heading': {
      return <Box flexDirection="row"><Text bold>{formatInlinePlain(token.tokens ?? [])}</Text></Box>
    }
    case 'blockquote': {
      return <Box flexDirection="row"><Text italic dimColor>▍ {formatInlinePlain(token.tokens ?? [])}</Text></Box>
    }
    case 'hr':
      return <Text dimColor>────</Text>
    case 'list': {
      const list = token as Tokens.List
      const start = typeof list.start === 'number' ? list.start : 1
      return (
        <Box flexDirection="column">
          {list.items.map((item, index) => {
            const marker = list.ordered ? `${start + index}.` : '•'
            return (
              <Box flexDirection="row" key={index}>
                <Text>{marker} </Text>
                {formatInline(item.tokens)}
              </Box>
            )
          })}
        </Box>
      )
    }
    case 'paragraph':
      return <Box flexDirection="row">{formatInline(token.tokens ?? [])}</Box>
    case 'text':
      return <Box flexDirection="row">{formatInline(token.tokens ?? [])}</Box>
    default:
      return <Text>{(token as { raw: string }).raw}</Text>
  }
}

/** Format inline child tokens as adjacent Text nodes in a row. */
function formatInline(tokens: readonly Token[]): React.ReactNode {
  const parts: React.ReactNode[] = []
  for (const token of tokens) {
    const rendered = formatInlineToken(token)
    if (rendered !== null) parts.push(rendered)
  }
  return <>{parts}</>
}

/** Extract the plain text of an inline token for styling. */
function inlineText(token: Token): string {
  switch (token.type) {
    case 'codespan': return token.text as string
    case 'image': {
      const image = token as Tokens.Image
      return image.title ?? image.href
    }
    case 'text': return (token as Tokens.Text).text
    default: return (token as { raw: string }).raw
  }
}

/** Format one inline token; null skips whitespace-only tokens. */
function formatInlineToken(token: Token): React.ReactNode {
  switch (token.type) {
    case 'space':
      return null
    case 'codespan':
      return <Text color="cyan">{inlineText(token)}</Text>
    case 'em':
      // Nested inline styles degrade to the plain text inside; common cases
      // (bold-within-em, code-within-em) keep their inner emphasis by folding
      // the whole inline child run into one styled Text.
      return <Text italic>{formatInlinePlain(token.tokens ?? [])}</Text>
    case 'strong':
      return <Text bold>{formatInlinePlain(token.tokens ?? [])}</Text>
    case 'link':
      return formatInline(token.tokens ?? [])
    case 'image':
      return <Text dimColor>{inlineText(token)}</Text>
    case 'text':
      return <Text>{inlineText(token)}</Text>
    default:
      return <Text>{(token as { raw: string }).raw}</Text>
  }
}

/** Join an inline child run as plain text (no nested styles). */
function formatInlinePlain(tokens: readonly Token[]): string {
  return tokens.map(inlineText).join('')
}
