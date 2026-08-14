/**
 * Pure REPL line parsing: distinguishes an empty line, a slash command, and a
 * plain user prompt. Slash commands never enter model history — the driver
 * routes them to its built-in set or to {@link ctx.commands}.
 * @module @deepseek-ai/dsh-cli/line
 */

/** A parsed REPL input line. */
export type CliLine =
  | { kind: 'empty' }
  | { kind: 'slash'; name: string; args: string[] }
  | { kind: 'prompt'; text: string }

/**
 * Split a raw line into its REPL kind.
 * @param raw - the unedited line as read from the input.
 * @returns the parsed line; surrounding whitespace is trimmed.
 */
export function parseLine(raw: string): CliLine {
  const line = raw.trim()
  if (line === '') return { kind: 'empty' }
  if (line.startsWith('/')) {
    const tokens = line.slice(1).split(/\s+/)
    return { kind: 'slash', name: tokens[0] ?? '', args: tokens.slice(1) }
  }
  return { kind: 'prompt', text: line }
}
