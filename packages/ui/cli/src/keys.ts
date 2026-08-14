/**
 * Pure keypress classification for the terminal UI. ink delivers Ctrl+C as the
 * control byte \x03 or the character 'c'; this keeps the decision testable
 * without an ink stdin.
 * @module @deepseek-ai/dsh-cli-ui/keys
 */

/** The key descriptor useInput passes. */
export interface CliKey {
  ctrl?: boolean
}

/**
 * Whether the keypress cancels the in-flight turn (Ctrl+C).
 * @param input - the keypress input.
 * @param key - the parsed key descriptor.
 * @returns true for Ctrl+C.
 */
export function isCancelKey(input: string, key: CliKey): boolean {
  return Boolean(key.ctrl) && (input === 'c' || input === '\x03')
}

/**
 * Whether the keypress requests a clean exit (Ctrl+D, or Ctrl+C at the prompt).
 * @param input - the keypress input.
 * @param key - the parsed key descriptor.
 * @returns true for Ctrl+D.
 */
export function isExitKey(input: string, key: CliKey): boolean {
  return Boolean(key.ctrl) && input === 'd'
}
