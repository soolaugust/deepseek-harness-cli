/**
 * @deepseek-ai/dsh-cli — interactive terminal driver. The bundle patch rides
 * over dsh-base; this runner creates or resumes one Agent through the core
 * registry, subscribes the view store to the agent's `session/event` feed, and
 * drives the REPL until the user exits. The terminal UI is an injectable io:
 * this package ships the plain-output io, the ink TUI io lives in
 * `@deepseek-ai/dsh-cli-ui`.
 * @module @deepseek-ai/dsh-cli
 */

import { randomUUID } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { createInteractiveIo, installCliApproval } from '@deepseek-ai/dsh-cli-ui'
import type {} from '@deepseek-ai/dsh-user-approval'
// Empty type imports carry the session-persistence Context merge for the
// latest-session probe, and the commands/permission-presets Context merges for
// the permission-cycle services, through the global service store.
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-permission-presets'
// Empty type imports carry the loader Context merge for the settlement await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type { CliStartupValues } from './startup.ts'
import { createViewStore } from './view.ts'
import type { CliViewItem, CliViewStore } from './view.ts'
import { runRepl, type CliReplDeps, type CliSessionRef } from './run.ts'

/** Stable Cordis plugin name. */
export const name = 'cli-runner'

/** Core services required before the interactive loop can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: the invocation resolved from this app's provider service. */
export interface Config {
  /** The parsed CLI invocation (flags, session choice, permission, io mode). */
  startup: CliStartupValues
}

export const Config: z<Config> = z.object({
  startup: z.object({
    model: z.string(),
    provider: z.string(),
    cwd: z.string().default(process.cwd()),
    resume: z.union([z.const('latest'), z.const('fresh'), z.object({ sessionId: z.string() })]).default('latest'),
    permission: z.union(['read-only', 'workspace-write', 'danger-full-access'] as const).default('workspace-write'),
    interactive: z.boolean().default(true),
    verbose: z.boolean().default(false),
  }).required(),
})

/** The minimum persistence surface the latest-session probe needs. */
interface PersistenceLister {
  list(signal?: AbortSignal): Promise<readonly { id: SessionId; cwd?: string; createdAt: number }[]>
}

/** The maximum number of prompt-history lines kept on disk. */
const MAX_HISTORY_LINES = 200

/**
 * Load the durable prompt history (one line per prompt).
 * @param file - the history file path.
 * @returns the prompts in oldest-first order; missing files yield an empty list.
 */
function loadHistory(file: string): string[] {
  try {
    const text = readFileSync(file, 'utf8')
    return text.split('\n').filter(line => line.trim() !== '')
  } catch {
    return []
  }
}

/** The preset cycle order, mirroring Claude Code's shift+tab carousel. */
const PRESET_CYCLE = ['read-only', 'workspace-write', 'danger-full-access'] as const

/**
 * Cycle the permission preset one step forward for the live agent.
 * @param ctx - the plugin context carrying the permission-presets and commands services.
 * @param agent - the live agent to switch; no-op before the agent exists.
 * @param view - the view store, updated so the badge reflects the new preset.
 */
function cyclePermission(ctx: Context, agent: Agent | undefined, view: CliViewStore): void {
  if (agent === undefined) return
  const presets = ctx.get('permissionPresets')
  const commands = ctx.get('commands')
  if (presets === undefined || commands === undefined) return
  const current = presets.current(agent.session.events)
  const index = PRESET_CYCLE.indexOf(current as (typeof PRESET_CYCLE)[number])
  const next = PRESET_CYCLE[(index + 1) % PRESET_CYCLE.length] ?? 'workspace-write'
  void commands.execute(agent, `/permission ${next}`, new AbortController().signal)
    .then(() => {
      view.setPermission(next)
      view.notice(`permission → ${next}`)
    })
    .catch(() => { view.notice(`permission switch to ${next} failed`) })
}

/**
 * Append one prompt to the durable history, trimming to the cap.
 * @param file - the history file path.
 * @param line - the submitted prompt.
 */
function appendHistory(file: string, line: string): void {
  try {
    const existing = loadHistory(file)
    appendFileSync(file, `${line}\n`)
    if (existing.length >= MAX_HISTORY_LINES) {
      const trimmed = [...existing, line].slice(-MAX_HISTORY_LINES)
      writeFileSync(file, `${trimmed.join('\n')}\n`)
    }
  } catch {
    // Durable history is best-effort; a read-only home must not block the session.
  }
}

/** Map a view item to one plain terminal line. */
function renderPlain(item: CliViewItem): string {
  switch (item.kind) {
    case 'user': return `> ${item.text}`
    case 'assistant': return item.text
    case 'tool': return `[90m[${item.name}] ${item.state === 'running' ? '…' : item.state === 'error' ? `✗ ${item.error ?? ''}` : '✓'}[0m`
    case 'notice': return `[90m${item.text}[0m`
    case 'divider': return ''
  }
}

/**
 * The plain-output io: reads lines from stdin and prints committed view items
 * to stdout. Streaming assistant items print once they commit, so piped/CI use
 * gets stable output without terminal control sequences.
 */
function createPlainIo(view: CliViewStore, interactive: boolean): {
  nextLine(): Promise<string | null>
  dispose(): void | Promise<void>
} {
  // Line-mode readline: each line resolves the next pending line, and EOF
  // (close) resolves null so the driver exits cleanly on a piped/closed stdin.
  const input = createInterface({ input: process.stdin, output: process.stdout, terminal: interactive })
  let printed = 0
  const render = (): void => {
    const items = view.getSnapshot().items
    // Plain mode prints every committed item as it lands; streaming assistant
    // text appears once (the view mutates one item, it does not stack frames).
    while (printed < items.length) {
      const item = items[printed]
      if (item === undefined) break
      const line = renderPlain(item)
      if (line !== '') process.stdout.write(line + '\n')
      printed++
    }
  }
  view.subscribe(render)
  render()
  // A buffered line queue: lines arriving while the driver is busy (e.g. a
  // slash command awaiting a settings write) are held, not dropped.
  const lines: string[] = []
  let lineWaiters: ((line: string | null) => void)[] = []
  let closed = false
  input.on('line', (line: string) => {
    const waiter = lineWaiters.shift()
    if (waiter !== undefined) waiter(line)
    else lines.push(line)
    if (interactive && !closed) input.prompt()
  })
  input.on('close', () => {
    closed = true
    const waiters = lineWaiters
    lineWaiters = []
    for (const waiter of waiters) waiter(null)
  })
  return {
    nextLine: () => {
      const buffered = lines.shift()
      if (buffered !== undefined) return Promise.resolve(buffered)
      if (closed) return Promise.resolve(null)
      return new Promise<string | null>((resolve) => {
        lineWaiters.push(resolve)
        if (interactive) input.prompt()
      })
    },
    // Flush pending stdout writes so a fast /exit does not drop rendered lines.
    dispose: () => {
      input.close()
      process.stdout.write('')
    },
  }
}

/** Report an unexpected direct-driver failure and request a failing exit. */
function fail(error: unknown): void {
  process.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
}

/**
 * Pick the most recent session whose header pins the given working directory.
 * @param persistence - the session persistence service (optional in tests).
 * @param cwd - the absolute working directory to match.
 * @returns the newest matching session id, or undefined when none exists.
 */
async function latestSessionForCwd(
  persistence: PersistenceLister | undefined,
  cwd: string,
): Promise<SessionId | undefined> {
  if (persistence === undefined) return undefined
  const headers = await persistence.list()
  const matches = headers.filter(header => header.cwd === cwd).sort((a, b) => b.createdAt - a.createdAt)
  return matches[0]?.id
}

/**
 * Run the interactive loop on one owned session and request process exit.
 * @param ctx - plugin context carrying the Agent, default model, Session, and launcher IO services.
 * @param startup - the parsed invocation.
 * @param exit - the launcher-provided bounded exit request.
 * @param persistence - the session persistence service, when composed.
 */
async function run(
  ctx: Context,
  startup: CliStartupValues,
  exit: (code: number) => void,
  persistence: PersistenceLister | undefined,
): Promise<void> {
  // Mount the renderer BEFORE awaiting the Loader tree. The interactive io's
  // raw-mode terminal setup must happen as early as possible; a late render
  // (after the full base tree settles) leaves the PTY in canonical mode in some
  // spawns, so ink's keypress parser sees whole lines instead of keypresses.
  const view = createViewStore()
  let currentHandle: AgentHandle | undefined
  // Submitted prompt history for up/down navigation. Loaded from the durable
  // CLI history file so a new session (or a new dialog in the same cwd) can
  // arrow up to prompts from previous sessions.
  const historyFile = join(resolveDshHome(), 'cli-history.txt')
  const promptHistory: string[] = loadHistory(historyFile)
  let historyIndex = promptHistory.length
  /** The in-progress draft stashed when navigating up from the prompt. */
  let draft = ''
  const io = startup.interactive
    ? createInteractiveIo({
      view,
      onCancel: () => { currentHandle?.agent.cancel({ kind: 'user' }) },
      onExit: () => {},
      onHistoryUp: (current) => {
        if (historyIndex === promptHistory.length) {
          // First up-arrow from the prompt: stash the in-progress draft in a
          // separate slot so down-arrow can return to it without polluting
          // the durable history array.
          draft = current
        }
        if (historyIndex > 0) {
          historyIndex -= 1
          return promptHistory[historyIndex]
        }
        return undefined
      },
      onHistoryDown: () => {
        if (historyIndex < promptHistory.length) {
          historyIndex += 1
          // The prompt position holds the stashed draft, not a history entry.
          if (historyIndex === promptHistory.length) return draft
          return promptHistory[historyIndex]
        }
        return undefined
      },
      onCyclePermission: () => { cyclePermission(ctx, currentHandle?.agent, view) },
    })
    : createPlainIo(view, false)

  await ctx.get('loader')?.await()
  // Read the core services and narrow them to non-optional so closures below
  // (slash-command handlers, session switching) can reference them without a
  // non-null assertion.
  const agentsMaybe = ctx.get('agents')
  const defaultModelMaybe = ctx.get('agentDefaultModel')
  const sessionsMaybe = ctx.get('sessions')
  if (agentsMaybe === undefined || defaultModelMaybe === undefined || sessionsMaybe === undefined) return
  const agents = agentsMaybe
  const defaultModel = defaultModelMaybe
  const sessions = sessionsMaybe

  const base = defaultModel.currentSelection()
  const agentOptions = { provider: startup.provider ?? base.provider, model: startup.model ?? base.model }
  // Session-scoped model selection: /model updates `current` to switch this and
  // any later-resumed agent; saveSelection persists it as the future default.
  const selectionRef: ModelSelectionRef = { current: agentOptions, assembled: undefined }
  const setup = (agentCtx: Context): void => { installModelSelection(agentCtx, selectionRef) }

  // Resolve which session to drive: explicit id, latest for this cwd, or fresh.
  let created: AgentHandle
  if (startup.resume === 'fresh') {
    created = await agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: startup.cwd },
      agentOptions,
      setup,
    })
  } else {
    const sessionId = startup.resume === 'latest'
      ? await latestSessionForCwd(persistence, startup.cwd)
      : SessionId(startup.resume.sessionId)
    created = sessionId === undefined
      ? await agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: { cwd: startup.cwd },
        agentOptions,
        setup,
      })
      : await agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
  }
  currentHandle = created
  // Seed the permission badge with the session's current preset.
  const presetsSeed = ctx.get('permissionPresets')
  if (presetsSeed !== undefined) view.setPermission(presetsSeed.current(created.agent.session.events))
  let onEvent = (session: Session, event: SessionEvent): void => {
    const handle = currentHandle
    if (handle === undefined) return
    if (session.id === handle.agent.session.id) view.append(event, handle.agent.id)
  }
  let unsubEvent = ctx.on('session/event', onEvent)
  // The approval answerer grants each ask once and surfaces it in the view.
  const unsubApproval = installCliApproval(ctx, view)

  // App slash commands the driver owns directly. /model stays here rather than
  // in the command registry because it switches this session's live
  // model-selection ref, which only the driver holds; every registry command
  // (/permission, /compact, /goal, /feedback) routes through runCommand below.
  const commands: Record<string, (args: string[], deps: CliReplDeps) => void | Promise<void>> = {
    model: async (args) => {
      const model = args[0]
      const handle = currentHandle
      if (model === undefined || handle === undefined) {
        if (model === undefined) view.notice('/model <model> — e.g. deepseek-v4-flash')
        return
      }
      const next = { provider: handle.agent.options.provider ?? base.provider, model }
      selectionRef.current = next
      await defaultModel.saveSelection(next)
      view.notice(`model → ${model}`)
    },
  }

  // Switch the live agent to another saved session. Resume is attempted first
  // (leaving the current agent untouched on failure); only a successful resume
  // flushes and disposes the previous agent, then rebinds the event feed.
  async function switchSession(target: string): Promise<Agent | null> {
    const sessionId = SessionId(target)
    const handle = currentHandle
    if (handle === undefined) return null
    if (sessionId === handle.agent.session.id) return handle.agent
    let next: AgentHandle
    try {
      next = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
    } catch (error) {
      view.notice(`cannot resume ${target}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
    await sessions.flush(handle.agent.session)
    await handle.dispose()
    unsubEvent()
    currentHandle = next
    onEvent = (session: Session, event: SessionEvent): void => {
      if (session.id === next.agent.session.id) view.append(event, next.agent.id)
    }
    unsubEvent = ctx.on('session/event', onEvent)
    return next.agent
  }

  async function listSessions(): Promise<readonly CliSessionRef[]> {
    if (persistence === undefined) return []
    const headers = await persistence.list()
    return headers.map(header => ({
      id: header.id,
      ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
      createdAt: header.createdAt,
    }))
  }

  // Route a slash command through the command registry (`ctx.commands`);
  // undefined when the registry is not composed or does not resolve the line.
  const commandsRegistry = ctx.get('commands')
  const runCommand = async (raw: string): Promise<{ text: string } | undefined> => {
    const handle = currentHandle
    if (commandsRegistry === undefined || handle === undefined) return undefined
    const execution = await commandsRegistry.execute(handle.agent, raw, new AbortController().signal)
    if (execution === undefined) return undefined
    return { text: execution.result.text ?? '' }
  }

  const handle = currentHandle
  const code = await runRepl({
    agent: handle.agent,
    view,
    nextLine: () => io.nextLine(),
    sessions,
    listSessions,
    switchSession,
    commands,
    runCommand,
    recordPrompt: (text) => {
      if (text.trim() !== '' && promptHistory.at(-1) !== text) {
        promptHistory.push(text)
        appendHistory(historyFile, text)
      }
      historyIndex = promptHistory.length
      draft = ''
    },
  })
  io.dispose()
  unsubEvent()
  unsubApproval()
  await handle.dispose()
  exit(code)
}

/**
 * Mount the interactive direct driver.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated startup config.
 */
export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('cli-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  // The session-persistence Context merge carries the service's type through
  // the global service store; run() accepts the narrowed list surface.
  const persistence = ctx.get('sessionPersistence')
  void run(ctx, config.startup, exit, persistence).catch((error: unknown) => {
    fail(error)
    exit(1)
  })
}
