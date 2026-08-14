/**
 * The REPL main loop: read a line, route it (built-in slash commands vs a
 * plain user prompt through `agent.followup`), and settle each turn to
 * quiescence before the next prompt. Pure over injected dependencies so the
 * transcript can be driven by a scripted `io` and asserted without a terminal.
 * @module @deepseek-ai/dsh-cli/run
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { parseLine } from './line.ts'
import type { CliViewStore } from './view.ts'

/** Built-in slash commands handled by the driver before any app command. */
export const BUILTIN_SLASH = ['exit', 'help', 'clear', 'session'] as const

const HELP_TEXT = `dsh cli — interactive terminal session
  Type a message to send it to the agent, or use a slash command:
    /exit       end this session and exit
    /help       show this help
    /clear      clear the scroll region
    /session    list saved sessions
    /session <id>   switch to a saved session
  Ctrl+C while the agent runs cancels the current turn; at the prompt it exits.
`

/** One saved session surfaced by the /session command. */
export interface CliSessionRef {
  readonly id: string
  readonly cwd?: string
  readonly createdAt: number
}

/** The injected effects a REPL needs; the terminal UI supplies its own io. */
export interface CliReplDeps {
  /** The live agent the loop drives; switching replaces it. */
  agent: Agent
  /** The view store the renderer subscribes to. */
  view: CliViewStore
  /** Resolves with the next input line, or null on EOF / exit. */
  nextLine(): Promise<string | null>
  /** Durable session checkpoint after each idle interval. */
  sessions: { flush(session: Session): Promise<unknown> }
  /** Extra slash commands keyed by name, beyond the built-ins. */
  commands?: Readonly<Record<string, (args: string[], deps: CliReplDeps) => void | Promise<void>>>
  /** List saved sessions for `/session`; absent hides the command's list. */
  listSessions?(): Promise<readonly CliSessionRef[]>
  /**
   * Switch the live agent to another saved session. Returns the new agent on
   * success or null when the target does not exist / cannot resume.
   */
  switchSession?(target: string): Promise<Agent | null>
}

/**
 * Drive the REPL until `/exit`, EOF, or a null line.
 * @param deps - the injected agent, view, input, flush, and commands.
 * @returns the process exit code the caller should honor.
 */
export async function runRepl(deps: CliReplDeps): Promise<number> {
  let agent = deps.agent
  for (;;) {
    await agent.whenIdle()
    await deps.sessions.flush(agent.session)
    const raw = await deps.nextLine()
    if (raw === null) return 0
    const line = parseLine(raw)
    if (line.kind === 'empty') continue
    if (line.kind === 'prompt') {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: line.text }],
        source: { kind: 'user' },
      }))
      await agent.whenIdle()
      await deps.sessions.flush(agent.session)
      continue
    }
    switch (line.name) {
      case 'exit':
        return 0
      case 'help':
        deps.view.notice(HELP_TEXT)
        continue
      case 'clear':
        deps.view.clear()
        continue
      case 'session': {
        if (line.args.length === 0) {
          const list = await deps.listSessions?.() ?? []
          deps.view.notice(list.length === 0
            ? 'no saved sessions'
            : list.map(session => `${session.id}${session.cwd !== undefined ? ` (${session.cwd})` : ''}`).join('\n'))
          continue
        }
        const target = line.args[0]
        if (target === undefined) {
          deps.view.notice('/session needs a session id')
          continue
        }
        if (deps.switchSession === undefined) {
          deps.view.notice('/session is unavailable in this deployment')
          continue
        }
        const next = await deps.switchSession(target)
        if (next !== null) {
          agent = next
          deps.view.notice(`switched to ${next.id}`)
        } else {
          deps.view.notice(`no such session: ${target}`)
        }
        continue
      }
      default: {
        const handler = deps.commands?.[line.name]
        if (handler !== undefined) {
          await handler(line.args, deps)
          continue
        }
        deps.view.notice(`unknown command: /${line.name} (try /help)`)
      }
    }
  }
}
