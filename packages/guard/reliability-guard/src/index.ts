/**
 * Reliability guard plugin expressing the celery harness contract (the
 * four attribution parameters β, ρ, C, p₁) at the loop boundary. It observes
 * consecutive tool failures and injects a failure-attribution reminder,
 * optionally gates write tools behind an explicit goal statement, and
 * optionally injects the harness rules into the model prompt. It never
 * rewrites a call's content. Configuration and chain semantics live in the
 * package README.
 * @module @deepseek-ai/dsh-reliability-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AssistantMessage, MessageSource } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

export const name = 'reliability-guard'

/** Services this plugin requires before `apply` runs. */
export const inject = ['tools', 'agents']

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (a non-integer `repeatThreshold`, a value below
 * 1, or a blank `goalMarker` throws at plugin load, never a silent fall-back).
 */
export interface Config {
  /** Deny write tools until the agent states its goal (default `false`). */
  enforceGoalGate?: boolean
  /** Consecutive failures of one tool that inject the attribution reminder (default `3`). */
  repeatThreshold?: number
  /** Inject the celery harness rules into the model prompt (default `false`). */
  injectPrompt?: boolean
  /**
   * `*`-wildcard tool-name patterns classified as write operations for the
   * goal gate. Empty means the built-in default set applies.
   */
  writeTools?: string[]
  /**
   * Marker text that counts a model statement as the goal declaration. The
   * goal gate stays closed until an assistant message contains it (default
   * `GOAL:`).
   */
  goalMarker?: string
}

export const Config: z<Config> = z.object({
  enforceGoalGate: z.boolean().default(false),
  repeatThreshold: z.number().default(3),
  injectPrompt: z.boolean().default(false),
  writeTools: z.array(z.string()).default([]),
  goalMarker: z.string().default('GOAL:'),
})

/** The `{kind:'plugin'}` source stamped on every message this guard injects. */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'reliability-guard' }

/** Built-in write-tool name patterns when `writeTools` is left empty. */
const DEFAULT_WRITE_PATTERNS = [
  'bash',
  'pwsh',
  'write',
  'edit',
  'apply_patch',
  'patch',
  'rename',
  'mkdir',
  'rm',
  'fs_write',
  'fs-write',
  'fs_*',
  'fs-*',
]

/** One agent's consecutive-failure chain: the failing tool's name and its run length. */
interface FailureChain {
  tool: string
  count: number
}

/** Compile one `*`-wildcard pattern to an anchored RegExp (every other regex metacharacter is matched literally). */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

/** Whether a tool name matches any configured write pattern. */
function isWriteTool(name: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(name))
}

/**
 * The attribution reminder delivered when one tool fails `repeatThreshold`
 * times consecutively. It walks the four celery axes so the model attributes
 * the failure instead of blindly retrying.
 */
function failureReminder(toolName: string, count: number): string {
  return 'Consecutive tool failures detected:\n'
    + `- tool: ${toolName}\n`
    + `- consecutive_failures: ${count}\n`
    + 'Before retrying, attribute the failure across the reliability harness axes:\n'
    + '- β (validator): could the success criterion accept a bad result? Calibrate it before continuing.\n'
    + '- ρ (path): is the task drifting? Split it into verifiable checkpoints and pass each before the next.\n'
    + '- C (goal context): is the goal and its acceptance test visible in your context? Restate it.\n'
    + '- p₁ (per-attempt success): is this single step low-yield? Change the approach or arguments — never hammer the identical call.'
}

/** The harness rules injected into the model prompt when `injectPrompt` is on. */
function harnessPrompt(goalMarker: string): string {
  return 'Reliability harness rules (celery four parameters): you are executing a multi-step task under a reliability guard.\n'
    + '1. Define an L0 validator before executing: a runnable check that states how you prove success. Do not start executing before it exists.\n'
    + '2. Split the task into verifiable checkpoints; pass each one before starting the next.\n'
    + '3. On a tool failure, attribute it across four axes before retrying:\n'
    + '   - β: is the acceptance test too loose (a bad result passes)? Calibrate the validator.\n'
    + '   - ρ: is the task path drifting? Add checkpoints and re-verify each before the next step.\n'
    + '   - C: is the goal missing from your context? Restate it.\n'
    + '   - p₁: is this single step low-yield? Change the approach or arguments — never repeat the identical call.\n'
    + `4. Write tools are gated until you state the goal. Begin your first response with \`${goalMarker}\` followed by how you define success.`
}

/**
 * Prepend the guard's message while preserving every downstream message's
 * source and metadata.
 */
function prependContext(ours: UserMessage, theirs: UserMessage[] | undefined): UserMessage[] {
  return [ours, ...theirs ?? []]
}

/** Join the text blocks of a model message; non-text blocks contribute nothing. */
function textOf(message: AssistantMessage): string {
  let text = ''
  for (const block of message.content) {
    if (block.type === 'text') text += block.text
  }
  return text
}

/** Whether any assistant message in the agent's log contains the goal marker. */
function goalStated(agent: Agent, marker: string): boolean {
  for (const event of agent.session.events) {
    if (event.type === 'assistant/message' && textOf(event.data.message).includes(marker)) return true
  }
  return false
}

/**
 * Install the guard's listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}; `repeatThreshold` and `goalMarker` are re-checked fail-loud here.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery's .default() guarantees the fields are set after validation.
  const enforceGoalGate = config.enforceGoalGate as boolean
  const injectPrompt = config.injectPrompt as boolean
  const repeatThreshold = config.repeatThreshold as number
  const goalMarker = config.goalMarker as string
  if (!Number.isInteger(repeatThreshold) || repeatThreshold < 1) {
    throw new Error(`reliability-guard: invalid repeatThreshold ${repeatThreshold} — must be an integer >= 1`)
  }
  if (goalMarker.trim() === '') {
    throw new Error('reliability-guard: goalMarker must not be blank')
  }
  const configuredWrites = config.writeTools as string[]
  const writePatterns = (configuredWrites.length > 0 ? configuredWrites : DEFAULT_WRITE_PATTERNS)
    .map(wildcardToRegExp)

  /** Agents whose goal declaration the guard has already seen. */
  const confirmed = new WeakSet<Agent>()
  /** Agents that already received the injected harness prompt. */
  const prompted = new WeakSet<Agent>()
  /** Consecutive-failure chains keyed by live agent object. */
  const failureChains = new WeakMap<Agent, FailureChain>()

  /**
   * Advance the calling agent's consecutive-failure chain and return the
   * attribution reminder to deliver, if this run reaches the threshold. A
   * success (or a direct execute without an agent) resets the chain; counting
   * sits on post-execute so denied calls count too.
   */
  function observe(exec: ToolExecution, result: Readonly<ToolExecutionResult>): UserMessage | undefined {
    if (!exec.agent) return undefined
    if (!result.isError) {
      failureChains.delete(exec.agent)
      return undefined
    }
    const chain = failureChains.get(exec.agent)
    const count = chain !== undefined && chain.tool === exec.name ? chain.count + 1 : 1
    failureChains.set(exec.agent, { tool: exec.name, count })
    if (count !== repeatThreshold) return undefined
    return createUserMessage({
      content: [{ type: 'text', text: failureReminder(exec.name, count) }],
      source: { ...PLUGIN_SOURCE, form: 'notice', summary: `${exec.name} × ${count} failures` },
    })
  }

  // Observe-and-enrich, never veto: count first, DELEGATE so a later listener
  // can still block or replace, then fold the reminder onto whatever came back
  // (additionalContexts rides both decision variants).
  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const reminder = observe(exec, result)
    const downstream = await next()
    if (!reminder) return downstream
    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts: prependContext(reminder, downstream.additionalContexts) }
    }
    return {
      ...downstream,
      additionalContexts: prependContext(reminder, downstream.additionalContexts),
    }
  })

  // Monotonic goal gate: while the agent has not stated its goal, deny every
  // write-tool call with a reason naming the gate. Once stated, the gate stays
  // open for that agent.
  if (enforceGoalGate) {
    ctx.tools.guard((exec): string | undefined => {
      if (!exec.agent || confirmed.has(exec.agent)) return undefined
      if (!isWriteTool(exec.name, writePatterns)) return undefined
      return `${exec.name} is a write tool; the goal gate blocks writes until the agent states its success criterion (a ${goalMarker} line). State the goal and its L0 validator before mutating state.`
    })
  }

  // Pre-step: fold the goal-gate confirmation scan and the one-shot harness
  // prompt injection into the entering messages. Always delegates via next().
  ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    if (enforceGoalGate && !confirmed.has(agent) && goalStated(agent, goalMarker)) {
      confirmed.add(agent)
    }
    if (!injectPrompt || prompted.has(agent)) return next()
    prompted.add(agent)
    const downstream = await next()
    if (downstream.kind === 'reject') return downstream
    const instructions = createUserMessage({
      content: [{ type: 'text', text: harnessPrompt(goalMarker) }],
      source: { ...PLUGIN_SOURCE, form: 'instructions' },
    })
    return { kind: 'enter', messages: [instructions, ...downstream.messages] }
  })
}
