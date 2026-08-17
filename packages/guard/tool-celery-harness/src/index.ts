/**
 * Deterministic celery reliability-rein tools exposed to the agent. Each tool
 * spawns one celery python check over the `ctx.subprocess` seam and returns the
 * script's verbatim Chinese verdict to the model as the canonical `{ text }`
 * value. A non-zero exit is a gate not passed — the tool surfaces the full
 * stdout/stderr as a structured `HarnessError`, so the loop logs an error result
 * the model can read and a companion can route on its stable `code`.
 * @module @deepseek-ai/dsh-tool-celery-harness
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { join } from 'node:path'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { SubprocessHandle, SubprocessOutcome, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-celery-harness'

/**
 * Services this plugin consumes. Both are declared so the plugin stays pending
 * until they exist; `apply` fetches the concrete services with `ctx.get` rather
 * than the topology-sensitive property proxy.
 */
export const inject = ['tools', 'subprocess']

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (an empty `celeryToolsDir` or `pythonPath` throws
 * at plugin load, never a silent fall-back to defaults).
 */
export interface Config {
  /** Directory holding the celery python scripts (default `/home/mi/ssd/codes/celery/tools`). */
  celeryToolsDir?: string
  /** Executable used to run the scripts (default `python3`). */
  pythonPath?: string
}

export const Config: z<Config> = z.object({
  celeryToolsDir: z.string().default('/home/mi/ssd/codes/celery/tools'),
  pythonPath: z.string().default('python3'),
})

/** In-memory cap for one script's stdout; overflow keeps the tail and spills the full stream. */
const STDOUT_MAX_BYTES = 64 * 1024
/** Whole-stream spill cap for stdout; a larger stream discards its now-incomplete spill. */
const STDOUT_SPILL_MAX_BYTES = 1024 * 1024
/** In-memory cap for one script's stderr diagnostic tail. */
const STDERR_MAX_BYTES = 32 * 1024
/** SIGTERM→SIGKILL escalation grace for one spawned process tree. */
const DEFAULT_GRACE_MS = 2_000
/**
 * Shared failure code for a check aborted by a tool timeout or caller
 * cancellation. Distinct from the per-gate codes so a companion routing on
 * `error.info.code` never mistakes an abort for a gate not passed.
 */
const CELERY_CHECK_ABORTED = 'CELERY_CHECK_ABORTED'

/**
 * Structured check-failure error. Extends `HarnessError` so the registry's
 * normalization carries the stable `code` on the tool result's `error.info` and
 * the model-facing message contains the script's verbatim stdout plus any
 * stderr — never a lossy paraphrase of a deterministic verdict.
 */
class CeleryCheckError extends HarnessError {
  constructor(toolName: string, code: string, reason: string, stdoutText = '', stderrText = '') {
    const body = [
      stdoutText.trim(),
      ...(stderrText.trim().length > 0 ? ['[stderr]', stderrText.trim()] : []),
    ]
      .filter(line => line.length > 0)
      .join('\n')
    super(`celery ${toolName}: ${reason}${body.length > 0 ? `\n${body}` : ''}`, code)
  }
}

/**
 * One fully-specified celery check run. `argv` is the script's own arguments —
 * every model value an unquoted argv element, with no shell layer in between.
 */
interface CeleryCheckSpec {
  /** The resolved subprocess service. */
  readonly subprocess: SubprocessRuntime
  /** The tool-execution context; supplies the session cwd and the abort signal. */
  readonly exec: ToolRunContext
  /** Tool name for diagnostics. */
  readonly toolName: string
  /** Script file name inside `celeryToolsDir`. */
  readonly script: string
  /** Script arguments in argv order. */
  readonly argv: readonly string[]
  /** Stable machine-routable failure code for a gate not passed. */
  readonly code: string
  /** Optional explicit working directory; else the session cwd, else `process.cwd()`. */
  readonly workdir?: string
}

/**
 * Run one celery check to settlement and return its verbatim stdout. A non-zero
 * exit, a signal kill, or a spawn failure throws a {@link CeleryCheckError}; a
 * caller abort surfaces the same structured failure before and after the spawn.
 * @param pythonPath - configured python executable.
 * @param celeryToolsDir - configured script directory.
 * @param spec - the check to run.
 * @returns the script's complete stdout text on exit code 0.
 */
async function runCeleryCheck(pythonPath: string, celeryToolsDir: string, spec: CeleryCheckSpec): Promise<string> {
  const { subprocess, exec, toolName, script, argv, code, workdir } = spec
  const cwd = workdir ?? exec.agent?.session.header.cwd ?? process.cwd()
  let handle: SubprocessHandle
  try {
    handle = subprocess.spawn({
      argv: [pythonPath, join(celeryToolsDir, script), ...argv],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: STDOUT_MAX_BYTES, spill: { maxBytes: STDOUT_SPILL_MAX_BYTES } },
        stderr: { maxBytes: STDERR_MAX_BYTES },
      },
      graceMs: DEFAULT_GRACE_MS,
      signal: exec.signal,
    } satisfies SubprocessSpawnSpec)
  } catch (error: unknown) {
    // Node's spawn() throws synchronously for a NUL in argv, and the local
    // impl can throw synchronously when the signal aborts between the check
    // above and this call. The abort is the reportable cause then.
    if (exec.signal.aborted) {
      throw new CeleryCheckError(toolName, CELERY_CHECK_ABORTED, 'check aborted before completion (tool timeout or caller cancellation)')
    }
    throw new CeleryCheckError(toolName, code, `could not start its celery check (python launch failed): ${String(error)}`)
  }
  let outcome: SubprocessOutcome
  try {
    outcome = await handle.done
  } catch (error: unknown) {
    throw new CeleryCheckError(toolName, code, `could not start its celery check (python launch failed): ${String(error)}`)
  }
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  if (stdout === undefined || stderr === undefined) {
    throw new CeleryCheckError(toolName, code, 'celery check produced no collected output streams')
  }
  // The signal can abort while the spawn is awaited; the static narrowing that
  // proves this re-check "always false" cannot see AbortSignal state changes.
  if (exec.signal.aborted) {
    throw new CeleryCheckError(toolName, CELERY_CHECK_ABORTED, 'check aborted before completion (tool timeout or caller cancellation)')
  }
  if (outcome.signal !== null || outcome.exitCode === null) {
    throw new CeleryCheckError(toolName, code, `check was killed by signal ${outcome.signal ?? '(unknown)'}`, stdout.text, stderr.text)
  }
  if (outcome.exitCode !== 0) {
    throw new CeleryCheckError(toolName, code, `check failed (exit ${outcome.exitCode})`, stdout.text, stderr.text)
  }
  return stdout.text
}

/** The canonical value schema: the verbatim script output. */
const CELERY_VALUE_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string', required: true } },
  additionalProperties: false,
} as const

/** The canonical value of every successful celery check. */
interface CeleryToolValue {
  text: string
}

/**
 * Shared output projection: the celery scripts emit Chinese verdict text, so the
 * model render hands that text straight through as one text block.
 */
const CELERY_OUTPUT = {
  schema: CELERY_VALUE_SCHEMA,
  render: (_args: unknown, value: CeleryToolValue): ContentBlock[] => [
    { type: 'text', text: value.text },
  ],
}

/**
 * Install the six celery checks as tools.
 * @param ctx - plugin context; carries the `tools` and `subprocess` services.
 * @param config - validated {@link Config}; `celeryToolsDir`/`pythonPath` are re-checked fail-loud here.
 */
export function apply(ctx: Context, config: Config): void {
  const celeryToolsDir = (config.celeryToolsDir as string).trim()
  const pythonPath = (config.pythonPath as string).trim()
  if (celeryToolsDir.length === 0) {
    throw new Error('tool-celery-harness: `celeryToolsDir` must be a non-empty path')
  }
  if (pythonPath.length === 0) {
    throw new Error('tool-celery-harness: `pythonPath` must be a non-empty executable name')
  }

  // The inject array guarantees both services exist when apply runs; `ctx.get`
  // reads the global service store instead of the topology-sensitive proxy.
  const tools = ctx.get('tools')
  const subprocess = ctx.get('subprocess')
  if (tools === undefined || subprocess === undefined) {
    throw new Error('tool-celery-harness: `tools` and `subprocess` services are unavailable')
  }

  /** Run one celery check against the resolved services and config. */
  const run = (
    exec: ToolRunContext,
    toolName: string,
    script: string,
    code: string,
    argv: readonly string[],
    workdir?: string,
  ): Promise<string> =>
    runCeleryCheck(pythonPath, celeryToolsDir, {
      subprocess, exec, toolName, script, argv, code,
      ...(workdir !== undefined ? { workdir } : {}),
    })

  tools.register(defineTool({
    name: 'celery_goal_gate',
    description: 'Deterministic goal-layer gate: run the celery goal three-questions check '
      + '(is the goal/why/output complete, is the output deliverable, is the task merely a '
      + 'carrier). Exit 0 = PASS, exit 1 = REVIEW — a gate not passed returns the full Chinese '
      + 'verdict and issue list as a tool error. Answer before calling: what real output the '
      + 'user wants (goal), why this task exists (why), and what the deliverable is (output).',
    parameters: {
      goal: { type: 'string', required: true, description: 'The real output the user wants, not the task name.' },
      why: { type: 'string', required: true, description: 'Why this task exists; the task may be a carrier for testing the methodology.' },
      output: { type: 'string', required: true, description: 'The deliverable: patch / document / capability / conclusion.' },
      workdir: { type: 'string', description: 'Working directory for the check; defaults to the session cwd.' },
    },
    output: CELERY_OUTPUT,
    execute(args, exec) {
      return run(exec, 'celery_goal_gate', 'task_governor.py', 'CELERY_GOAL_GATE_REJECTED', [
        'check',
        '--goal', args.goal,
        '--why', args.why,
        '--output', args.output,
      ], args.workdir).then(text => ({ text }))
    },
  }))

  tools.register(defineTool({
    name: 'celery_verify_goal',
    description: 'Deterministic exploration-convergence check: decide whether continued exploration '
      + 'is still productive or has converged (no new findings across the window rounds) and should '
      + 'stop. Exit 0 = CONTINUE, exit 1 = CONVERGED — convergence returns the full Chinese status '
      + 'as a tool error. Supply the rounds already run, the new findings count, and the convergence window.',
    parameters: {
      rounds: { type: 'number', required: true, description: 'How many exploration rounds have run.' },
      newFindings: { type: 'number', required: true, description: 'Number of new advanceable candidates found this round.' },
      window: { type: 'number', required: true, description: 'Consecutive empty rounds that count as converged.' },
      workdir: { type: 'string', description: 'Working directory for the check; defaults to the session cwd.' },
    },
    output: CELERY_OUTPUT,
    execute(args, exec) {
      return run(exec, 'celery_verify_goal', 'task_governor.py', 'CELERY_VERIFY_GOAL_CONVERGED', [
        'explore',
        '--rounds', String(args.rounds),
        '--new-findings', String(args.newFindings),
        '--window', String(args.window),
      ], args.workdir).then(text => ({ text }))
    },
  }))

  tools.register(defineTool({
    name: 'celery_calibrate_verifier',
    description: 'Deterministic verifier calibration: run the celery β/α control-injection suite '
      + 'against the given injection-set JSON and report misjudge rates with Wilson confidence '
      + 'intervals. Exit 0 = within thresholds, exit 1 = regression — a regression returns the full '
      + 'Chinese α/β report as a tool error. Use after changing the judge or its prompt.',
    parameters: {
      injectPath: { type: 'string', required: true, description: 'Path to the injection-set JSON with correct/wrong arrays.' },
      workdir: { type: 'string', description: 'Working directory for the check; defaults to the session cwd.' },
    },
    output: CELERY_OUTPUT,
    execute(args, exec) {
      return run(exec, 'celery_calibrate_verifier', 'beta_calibration.py', 'CELERY_CALIBRATE_REGRESSION', [
        '--inject', args.injectPath,
      ], args.workdir).then(text => ({ text }))
    },
  }))

  tools.register(defineTool({
    name: 'celery_telemetry',
    description: 'Deterministic online-parameter monitor for the celery diagnostics ρ (goal drift), '
      + 'β (verifier leak-through), and p₁ (single-step failure rate). With no parameters it reports '
      + 'the current rolling parameters and alerts; with any of rho/beta/p1 it records a round and '
      + 'reports the updated state. Exit 0 = nominal, exit 1 = alert — an alert returns the full '
      + 'Chinese parameter line and threshold advice as a tool error.',
    parameters: {
      rho: { type: 'number', description: 'Goal-drift estimate in [0,1]; present means record a round.' },
      beta: { type: 'number', description: 'Verifier leak-through estimate in [0,1]; present means record a round.' },
      p1: { type: 'number', description: 'Single-step failure-rate estimate in [0,1]; present means record a round.' },
      workdir: { type: 'string', description: 'Working directory for the check; defaults to the session cwd.' },
    },
    output: CELERY_OUTPUT,
    execute(args, exec) {
      const recordArgs = [
        ...(args.rho !== undefined ? ['--rho', String(args.rho)] : []),
        ...(args.beta !== undefined ? ['--beta', String(args.beta)] : []),
        ...(args.p1 !== undefined ? ['--p1', String(args.p1)] : []),
      ]
      const argv = recordArgs.length > 0 ? ['record', ...recordArgs] : ['status']
      return run(exec, 'celery_telemetry', 'telemetry.py', 'CELERY_TELEMETRY_ALERT', argv, args.workdir).then(text => ({ text }))
    },
  }))

  tools.register(defineTool({
    name: 'celery_decision',
    description: 'Deterministic decision classifier from the celery decision-principle library: '
      + 'low-risk exploration decisions (explore/direction/stop-continue) are answered autonomously '
      + 'with principle advice; high-risk decisions (send/delete/publish/external) require user '
      + 'confirmation. Returns the Chinese verdict with the applicable principles.',
    parameters: {
      kind: {
        type: 'string',
        required: true,
        enum: ['explore', 'send'],
        description: 'Decision type: explore (low-risk, autonomous) or send (high-risk, needs confirmation).',
      },
      question: { type: 'string', required: true, description: 'The decision question in natural language.' },
      workdir: { type: 'string', description: 'Working directory for the check; defaults to the session cwd.' },
    },
    output: CELERY_OUTPUT,
    execute(args, exec) {
      return run(exec, 'celery_decision', 'decision.py', 'CELERY_DECISION_ERROR', [
        'decide',
        '--kind', args.kind,
        '--question', args.question,
      ], args.workdir).then(text => ({ text }))
    },
  }))

  tools.register(defineTool({
    name: 'celery_fixate',
    description: 'Deterministic methodology-fixation filter: ask the four questions before fixing a '
      + 'lesson — does it change future actions, is it already covered by code/rules, will it be used '
      + 'again, and is it non-duplicate — and decide FIXATE or SKIP with the Chinese reason. Use '
      + 'before writing any lesson to memory or documentation.',
    parameters: {
      topic: { type: 'string', required: true, description: 'The methodology topic being considered for fixation.' },
      q1: { type: 'string', required: true, description: 'Q1: does this change future actions? y/n.' },
      q2: { type: 'string', required: true, description: 'Q2: is it already covered by code/rules? y/n.' },
      q3: { type: 'string', required: true, description: 'Q3: will it be used again (not a one-off)? y/n.' },
      q4: { type: 'string', required: true, description: 'Q4: is it non-duplicate of existing memory/docs? y/n.' },
      workdir: { type: 'string', description: 'Working directory for the check; defaults to the session cwd.' },
    },
    output: CELERY_OUTPUT,
    execute(args, exec) {
      return run(exec, 'celery_fixate', 'fixation_filter.py', 'CELERY_FIXATION_ERROR', [
        '--topic', args.topic,
        '--q1', args.q1,
        '--q2', args.q2,
        '--q3', args.q3,
        '--q4', args.q4,
      ], args.workdir).then(text => ({ text }))
    },
  }))
}
