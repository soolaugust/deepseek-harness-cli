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
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { createInteractiveIo, installCliApproval } from '@deepseek-ai/dsh-cli-ui'
import type {} from '@deepseek-ai/dsh-user-approval'
// Empty type imports carry the session-persistence Context merge for the
// latest-session probe, and the commands/permission-presets Context merges for
// the permission-cycle services, through the global service store.
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-agent-model-selection'
// Value import carries the roster's resolve-past-header rule and the Context
// merge for the agentPresets service, so the runner can compose an agent from
// a session's recorded preset and re-link a live blank agent to another one.
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
// Empty type imports carry the loader Context merge for the settlement await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type { CliStartupValues } from './startup.ts'
import { createViewStore } from './view.ts'
import type { CliViewItem, CliViewStore } from './view.ts'
import { runRepl, type CliSessionRef } from './run.ts'

/** Stable Cordis plugin name. */
export const name = 'cli-runner'

/** Core services required before the interactive loop can start. */
export const inject = ['agentDefaultModel', 'agentModelSelection', 'agents', 'sessions']

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
    resume: z.union([z.const('latest'), z.const('fresh'), z.object({ sessionId: z.string() })]).default('fresh'),
    permission: z.union(['read-only', 'workspace-write', 'danger-full-access'] as const).default('workspace-write'),
    interactive: z.boolean().default(true),
    verbose: z.boolean().default(false),
  }).required(),
})

/** The minimum persistence surface the latest-session probe needs. */
interface PersistenceLister {
  list(signal?: AbortSignal): Promise<readonly { id: SessionId; cwd?: string; createdAt: number }[]>
  /** Load one pending session's header and event log, to resolve its recorded preset. */
  load(id: SessionId): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }>
}

/** The minimum agent-preset roster surface the session composition needs. */
interface PresetService {
  /** Resolve one preset id (or the roster default) to its mountable identity. */
  resolve(id?: string): Promise<{ id: string }>
  /** Compose an agent from a preset, in the agent factory's setup hook. */
  mount(agentCtx: Context, id?: string): Promise<{ id: string }>
  /** Enumerate the roster's preset ids for `/mode`'s available-modes listing. */
  list(): Promise<readonly { id: string }[]>
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
 * Compose an agent from a preset, mirroring the Web surface's
 * {@link createApiRemoteAgentResolver composeAgent}: resolve the preset
 * BEFORE the session exists so its id reaches the creation header, then mount
 * it in the agent factory's `setup` so a rejected composition rolls the whole
 * creation back. A deployment with no preset roster composes nothing — every
 * session shares the host composition, which is the behavior before presets
 * existed.
 * @param presets - the agent-preset roster service, narrowed to the surface used.
 * @param baseSetup - the setup every created/resumed agent already runs
 * (installs the session-scoped model selection); the composed setup runs it
 * first, then mounts the preset.
 * @param presetId - the requested preset id, or `undefined` for the roster default.
 * @returns the id to record on the header (absent without a roster) and the
 * setup callback that installs the session selection and mounts the preset.
 * @throws when the roster supplies no usable preset under `presetId`.
 */
async function composeFrom(
  presets: PresetService | undefined,
  baseSetup: (agentCtx: Context) => void | Promise<void>,
  presetId: string | undefined,
): Promise<{
  agentPreset?: string
  setup: (agentCtx: Context) => void | Promise<void>
}> {
  if (presets === undefined) return { setup: baseSetup }
  // resolve() re-reads the roster and throws for a broken or unknown preset,
  // so a bad `--mode` fails before the session boundary snapshots meta.
  const resolvedId = (await presets.resolve(presetId)).id
  return {
    agentPreset: resolvedId,
    setup: (agentCtx: Context) => {
      const result = baseSetup(agentCtx)
      return void presets.mount(agentCtx, resolvedId).then(() => result)
    },
  }
}

/**
 * Compose the setup for resuming an existing session: its preset comes from
 * the session's recorded history. Read the log, not the header, so a session
 * that switched while blank resumes under the newer composition.
 * @param persistence - the session-persistence surface with `load`.
 * @param presets - the roster, when the deployment composes agents.
 * @param baseSetup - the canonical agent setup to chain the preset mount onto.
 * @param sessionId - the persisted session to resume.
 * @param fallbackPresetId - a preset to compose a session that recorded none,
 * such as an explicit `--mode` the user passed on a legacy session.
 * @returns the composition for the runner's `agents.resume` setup.
 */
async function composeForResume(
  persistence: Pick<PersistenceLister, 'load'>,
  presets: PresetService | undefined,
  baseSetup: (agentCtx: Context) => void | Promise<void>,
  sessionId: SessionId,
  fallbackPresetId: string | undefined,
): Promise<{
  agentPreset?: string
  setup: (agentCtx: Context) => void | Promise<void>
}> {
  const inspected = await persistence.load(sessionId)
  const recorded = resolveSessionPreset({ header: inspected.meta, events: inspected.events })
  return composeFrom(presets, baseSetup, recorded ?? fallbackPresetId)
}
/**
 * Whether the session's conversation has started: no model-loop turn has run.
 * Mirrors the Web receiver's blank gate, which a started conversation fixes
 * because swapping its preset would leave logged tool calls the new
 * composition cannot make.
 * @param agent - the live agent whose session to check.
 * @returns true when no turn has started (the agent preset can still be changed).
 */
function sessionBlank(agent: Agent): boolean {
  return !agent.session.events.some(event => event.type === 'turn/start')
}

/** The minimum agent-preset roster surface a live switch needs. */
interface LivePresetService {
  /** The preset one agent currently runs on, absent when it joined none. */
  composedPreset(agentCtx: Context): string | undefined
  /** Re-link one agent to another preset's standing composition. */
  recompose(agentCtx: Context, id: string): Promise<{ id: string }>
}

/**
 * Switch the live agent to another agent preset, honoring the blank-session
 * gate: once a conversation starts, its history was produced under that
 * preset's tools and cannot be re-linked. Mirror of the Web receiver's
 * `agentPreset.select`.
 * @param presets - the live-preset surface (recompose + composedPreset).
 * @param agent - the live agent to switch.
 * @param id - the target preset id.
 * @returns the installed preset id, or `undefined` when refused (started or
 * its composition unusable).
 */
async function selectAgentMode(
  presets: LivePresetService | undefined,
  agent: Agent,
  id: string,
): Promise<string | undefined> {
  if (presets === undefined) return undefined
  if (!sessionBlank(agent)) return undefined
  try {
    const preset = await presets.recompose(agent.ctx, id)
    // Logged only after the swap commits: the log states what the agent runs,
    // and a rejected mount leaves the previous composition.
    agent.session.append('agent-preset/selected', { agentPreset: preset.id })
    return preset.id
  } catch {
    return undefined
  }
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
  const modelSelectionMaybe = ctx.get('agentModelSelection')
  const sessionsMaybe = ctx.get('sessions')
  if (agentsMaybe === undefined || defaultModelMaybe === undefined
    || modelSelectionMaybe === undefined || sessionsMaybe === undefined) return
  const agents = agentsMaybe
  const defaultModel = defaultModelMaybe
  const modelSelection = modelSelectionMaybe
  const sessions = sessionsMaybe

  const base = defaultModel.currentSelection()
  const agentOptions = { provider: startup.provider ?? base.provider, model: startup.model ?? base.model }
  // Install the session-scoped selection into every created/resumed/switched
  // agent; the registry /model command switches it through agentModelSelection.
  const setup = (agentCtx: Context): void => { modelSelection.install(agentCtx, agentOptions) }
  // The agent-preset roster service, when the CLI composition mounts one. Its
  // presence decides whether sessions compose from a preset at all.
  const presets = ctx.get('agentPresets')

  // Resolve which session to drive: explicit id, latest for this cwd, or fresh.
  let created: AgentHandle
  if (startup.resume === 'fresh') {
    const composed = await composeFrom(presets, setup, startup.mode)
    created = await agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      // A fresh session names the requested preset, or the roster default when
      // none was given; composeFrom resolves it before the boundary snapshots meta.
      meta: { cwd: startup.cwd, ...(composed.agentPreset === undefined ? {} : { agentPreset: composed.agentPreset }) },
      agentOptions,
      setup: composed.setup,
    })
  } else {
    const sessionId = startup.resume === 'latest'
      ? await latestSessionForCwd(persistence, startup.cwd)
      : SessionId(startup.resume.sessionId)
    if (sessionId === undefined || persistence === undefined) {
      const composed = await composeFrom(presets, setup, startup.mode)
      created = await agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: { cwd: startup.cwd, ...(composed.agentPreset === undefined ? {} : { agentPreset: composed.agentPreset }) },
        agentOptions,
        setup: composed.setup,
      })
    } else {
      // Resume composes the preset the session recorded — resolved from the
      // LOG, not the header, so a session that switched while blank runs its
      // turns under the newer composition. Same reasoning as the Web surface.
      const composed = await composeForResume(persistence, presets, setup, sessionId, startup.mode)
      created = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup: composed.setup })
    }
  }
  currentHandle = created
  // Seed the permission and agent-mode badges with the session's current values.
  const presetsSeed = ctx.get('permissionPresets')
  if (presetsSeed !== undefined) view.setPermission(presetsSeed.current(created.agent.session.events))
  if (presets !== undefined) {
    const mode = presets.composedPreset(created.agent.ctx)
    if (mode !== undefined) view.setMode(mode)
  }
  let onEvent = (session: Session, event: SessionEvent): void => {
    const handle = currentHandle
    if (handle === undefined) return
    if (session.id === handle.agent.session.id) view.append(event, handle.agent.id)
  }
  let unsubEvent = ctx.on('session/event', onEvent)
  // The approval answerer grants each ask once and surfaces it in the view.
  const unsubApproval = installCliApproval(ctx, view)

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
      const composed = persistence === undefined
        ? await composeFrom(presets, setup, startup.mode)
        : await composeForResume(persistence, presets, setup, sessionId, startup.mode)
      next = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup: composed.setup })
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

  // Agent-preset mode switching, mirroring the Web surface: a roster that
  // composes agents can re-link a still-blank live agent to another preset via
  // `/mode <id>`; a started conversation refuses. Nothing is wired when the CLI
  // deployment composes no presets.
  const listAgentModes = async (): Promise<readonly string[]> => {
    if (presets === undefined) return []
    return (await presets.list()).map(preset => preset.id)
  }
  const switchAgentMode = async (target: string): Promise<string | undefined> => {
    const handle = currentHandle
    if (handle === undefined || presets === undefined) return undefined
    const installed = await selectAgentMode(presets, handle.agent, target)
    if (installed !== undefined) view.setMode(installed)
    return installed
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
    listAgentModes,
    switchAgentMode,
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
