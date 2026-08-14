/** The markdown → ink fold renders bold, code, lists, and headings. */

import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { markdownToInk } from '../src/markdown.tsx'

/** Render markdown and return the terminal text frame. */
function frame(md: string): string {
  const { lastFrame } = render(<>{markdownToInk(md)}</>)
  return lastFrame() ?? ''
}

/** Whether any `<Text>` element in the tree carries a given style prop. */
function hasTextStyle(node: React.ReactNode, prop: string): boolean {
  if (node === null || node === undefined || typeof node === 'string') return false
  if (React.isValidElement(node)) {
    const element = node as React.ReactElement
    if (element.type === Text && (element.props as Record<string, unknown>)[prop]) return true
    const children = React.Children.toArray((element.props as { children?: unknown }).children)
    if (hasTextStyle(children, prop)) return true
  }
  if (Array.isArray(node)) return node.some(child => hasTextStyle(child as React.ReactNode, prop))
  return false
}

describe('markdownToInk', () => {
  it('renders bold for strong and headings', () => {
    expect(frame('**bold**')).toContain('bold')
    expect(frame('# Title')).toContain('Title')
  })

  it('renders italic for emphasis', () => {
    expect(frame('*italic*')).toContain('italic')
  })

  it('renders inline and fenced code', () => {
    expect(frame('run `npm test`')).toContain('npm test')
    expect(frame('```\nconst x = 1\n```')).toContain('const x = 1')
  })

  it('renders unordered and ordered lists with markers', () => {
    expect(frame('- one\n- two')).toContain('• one')
    expect(frame('1. first\n2. second')).toContain('1. first')
  })

  it('leaves plain text intact', () => {
    expect(frame('plain text')).toContain('plain text')
  })

  it('applies ink Text styles to the element tree', () => {
    expect(hasTextStyle(markdownToInk('**bold**'), 'bold')).toBe(true)
    expect(hasTextStyle(markdownToInk('*italic*'), 'italic')).toBe(true)
    expect(hasTextStyle(markdownToInk('`code`'), 'color')).toBe(true)
    expect(hasTextStyle(markdownToInk('# Title'), 'bold')).toBe(true)
  })
})
