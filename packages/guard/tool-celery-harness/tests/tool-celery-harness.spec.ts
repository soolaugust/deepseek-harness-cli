/**
 * Consumer-surface tests for the six celery reliability-rein tools over a FAKE
 * subprocess service, exercised through `ctx.tools.execute()` so nothing bypasses
 * the tool registry. The fake service makes every seam outcome scriptable —
 * success, gate-not-passed exits, signal kills, spawn failures, missing collect
 * readers — so these tests verify registration, argument validation, argv
 * construction per tool, workdir derivation, signal forwarding, the structured
 * gate-failure error (code + verbatim stdout/stderr), and the no-background-job
 * invariant. Real celery scripts are never executed.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessCollectedOutputs, SubprocessHandle, SubprocessOutcome, SubprocessOutputRead, SubprocessOutputReader, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import * as ToolCeleryHarness from '@deepseek-ai/dsh-tool-celery-harness'
import type { Config } from '@deepseek-ai/dsh-tool-celery-harness'

const testToolSignal = new AbortController().signal

/** One scripted collect-mode stream, returned by `readFrom(0)` after settlement. */
interface ScriptedStream {
  text: string
  lossy?: boolean
}

/** One scripted spawn: exit facts plus the collected streams the tools read. */
interface ScriptedRun {
  outcome: SubprocessOutcome
  stdout: ScriptedStream
  stderr: ScriptedStream
}

/** A successful run over the given stdout; overrides script the failure shapes. */
function runResult(
  stdout: string,
  overrides?: Partial<SubprocessOutcome> & { stdout?: ScriptedStream; stderr?: ScriptedStream },
): ScriptedRun {
  const { stdout: stdoutOverrides, stderr: stderrOverrides, ...outcome } = overrides ?? {}
  return {
    outcome: { exitCode: 0, signal: null, ...outcome },
    stdout: { text: stdout, ...stdoutOverrides },
    stderr: { text: '', ...stderrOverrides },
  }
}

/** A fixed-response collect-mode reader: the tools read each stream once, from 0, after settlement. */
class FakeReader implements SubprocessOutputReader {
  constructor(private readonly read: ScriptedStream) {}

  readFrom(_fromByte: number): SubprocessOutputRead {
    return {
      text: this.read.text,
      nextOffset: 0,
      lossy: this.read.lossy ?? false,
    }
  }
}

/** A scriptable subprocess handle: `done` resolves with the scripted outcome (or rejects), and `terminate()` records the call. */
class FakeHandle implements SubprocessHandle {
  readonly pid = 4242
  readonly stdin = undefined
  readonly stdout = undefined
  readonly stderr = undefined
  readonly collected: SubprocessCollectedOutputs
  readonly done: Promise<SubprocessOutcome>
  /** True once `done` settled — the tools must never leave a spawn running. */
  settled = false
  /** True when the handle's termination path ran (abort signal or explicit terminate). */
  terminated = false
  /** Scripted handle that drops one requested collect reader (the defensive branch). */
  readonly dropReaders: boolean

  constructor(spec: SubprocessSpawnSpec, script: () => ScriptedRun | { reject: Error }, dropReaders = false) {
    this.dropReaders = dropReaders
    // The abort listener attaches BEFORE the scripted run resolves, mirroring
    // a real spawn: the escalation is armed when the process starts.
    spec.signal?.addEventListener('abort', () => { this.terminated = true }, { once: true })
    const scripted = script()
    if ('reject' in scripted) {
      // A spawn failure produces no process output, so no readers exist.
      this.collected = {}
      this.done = Promise.reject(scripted.reject)
    } else {
      this.collected = {
        ...dropReaders ? {} : { stdout: new FakeReader(scripted.stdout), stderr: new FakeReader(scripted.stderr) },
      }
      this.done = Promise.resolve(scripted.outcome)
    }
    this.done.then(
      () => { this.settled = true },
      () => { this.settled = true },
    )
  }

  terminate(): void {
    this.terminated = true
  }

  waitForExit(_signal?: AbortSignal): Promise<boolean> {
    return Promise.resolve(true)
  }
}

/** A scriptable fake subprocess service: `spawn()` records every spec and returns a scripted handle. */
class FakeSubprocess extends SubprocessRuntime {
  spawns: SubprocessSpawnSpec[] = []
  override async resolveExecutable(command: string): Promise<string> { return command }
  override spawnTerminal(): Promise<never> { throw new Error('celery tools spawn pipes, never terminals') }
  handles: FakeHandle[] = []
  /** Arms the per-spawn script; a `{ reject }` return scripts a spawn-level failure. */
  handler: (spec: SubprocessSpawnSpec) => ScriptedRun | { reject: Error } = () => runResult('')
  /** When true, spawned handles drop their collect readers (the defensive branch). */
  dropReaders = false

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    const handle = new FakeHandle(spec, () => this.handler(spec), this.dropReaders)
    this.handles.push(handle)
    return handle
  }
}

const DEFAULT_CONFIG = {
  celeryToolsDir: '/celery/tools',
  pythonPath: 'python3',
} satisfies Config

async function setup(config: Config = DEFAULT_CONFIG) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(FakeSubprocess)
  const subprocess = ctx.subprocess as FakeSubprocess
  const fiber = await ctx.plugin(ToolCeleryHarness, config)
  return { ctx, subprocess, fiber }
}

/** A stand-in agent whose session header carries the given cwd (and a stable id). */
const agent = (cwd?: string): Agent =>
  ({ session: { header: { id: 'session-1', ...cwd !== undefined ? { cwd } : {} } } }) as unknown as Agent

let callCounter = 0
function call(
  ctx: Context,
  name: string,
  args: unknown,
  options: { agent?: Agent; signal?: AbortSignal } = {},
) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
    ...options.agent ? { agent: options.agent } : {},
    ...options.signal ? { signal: options.signal } : {},
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('registration', () => {
  it('registers all six celery checks with their canonical schemas', async () => {
    const { ctx, subprocess } = await setup()
    // Registration performs NO load-time probe: nothing spawns until a tool call.
    expect(subprocess.spawns).toHaveLength(0)
    expect(ctx.tools.schemas().map(s => s.name).sort()).toEqual([
      'celery_calibrate_verifier',
      'celery_decision',
      'celery_fixate',
      'celery_goal_gate',
      'celery_telemetry',
      'celery_verify_goal',
    ])
  })

  it('stays pending until both tools and subprocess exist (inject)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolCeleryHarness, DEFAULT_CONFIG) // no subprocess service
    expect(ctx.tools.schemas()).toHaveLength(0)
  })

  it('unregisters everything on fiber disposal (HMR safety)', async () => {
    const { ctx, fiber } = await setup()
    expect(ctx.tools.schemas()).toHaveLength(6)
    await fiber.dispose()
    expect(ctx.tools.schemas()).toHaveLength(0)
  })
})

describe('config validation fails loud', () => {
  it.each([
    ['celeryToolsDir', { celeryToolsDir: '' }],
    ['pythonPath', { pythonPath: '  ' }],
  ] as const)('rejects an empty %s at load', async (_name, config) => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeSubprocess)
    await expect(ctx.plugin(ToolCeleryHarness, { ...DEFAULT_CONFIG, ...config })).rejects.toThrow(/must be a non-empty/)
  })
})

describe('spawn argv construction', () => {
  it('celery_goal_gate: task_governor.py check with the three answers as argv elements', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('判定: PASS\n')
    const result = await call(ctx, 'celery_goal_gate', { goal: 'g', why: 'w', output: 'o' })
    expect(result.isError).toBe(false)
    expect(subprocess.spawns[0]?.argv).toEqual([
      'python3', '/celery/tools/task_governor.py',
      'check', '--goal', 'g', '--why', 'w', '--output', 'o',
    ])
  })

  it('celery_verify_goal: explore with integer options', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('动作: CONTINUE\n')
    await call(ctx, 'celery_verify_goal', { rounds: 3, newFindings: 0, window: 2 })
    expect(subprocess.spawns[0]?.argv).toEqual([
      'python3', '/celery/tools/task_governor.py',
      'explore', '--rounds', '3', '--new-findings', '0', '--window', '2',
    ])
  })

  it('celery_calibrate_verifier: beta_calibration.py --inject', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('β(漏放)=0.000\n')
    await call(ctx, 'celery_calibrate_verifier', { injectPath: '/inject/verifier.json' })
    expect(subprocess.spawns[0]?.argv).toEqual([
      'python3', '/celery/tools/beta_calibration.py', '--inject', '/inject/verifier.json',
    ])
  })

  it('celery_decision: decide with kind and question', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('🤖 自主判断\n')
    await call(ctx, 'celery_decision', { kind: 'explore', question: '该不该继续找候选' })
    expect(subprocess.spawns[0]?.argv).toEqual([
      'python3', '/celery/tools/decision.py', 'decide', '--kind', 'explore', '--question', '该不该继续找候选',
    ])
  })

  it('celery_fixate: fixation_filter.py four questions', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('✅ [FIXATE] 在线监控\n')
    await call(ctx, 'celery_fixate', { topic: '在线监控', q1: 'y', q2: 'y', q3: 'y', q4: 'y' })
    expect(subprocess.spawns[0]?.argv).toEqual([
      'python3', '/celery/tools/fixation_filter.py',
      '--topic', '在线监控', '--q1', 'y', '--q2', 'y', '--q3', 'y', '--q4', 'y',
    ])
  })

  it('celery_telemetry: status argv when no parameters are given', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('参数正常\n')
    await call(ctx, 'celery_telemetry', {})
    expect(subprocess.spawns[0]?.argv).toEqual(['python3', '/celery/tools/telemetry.py', 'status'])
  })

  it('celery_telemetry: record argv with only the provided parameters', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('ρ(漂移)=0.3\n')
    await call(ctx, 'celery_telemetry', { rho: 0.3 })
    expect(subprocess.spawns[0]?.argv).toEqual([
      'python3', '/celery/tools/telemetry.py', 'record', '--rho', '0.3',
    ])
    await call(ctx, 'celery_telemetry', { rho: 0.3, beta: 0, p1: 0.2 })
    expect(subprocess.spawns[1]?.argv).toEqual([
      'python3', '/celery/tools/telemetry.py', 'record', '--rho', '0.3', '--beta', '0', '--p1', '0.2',
    ])
  })

  it('uses the configured pythonPath and celeryToolsDir', async () => {
    const { ctx, subprocess } = await setup({ celeryToolsDir: '/custom/celery', pythonPath: '/opt/py/bin/python' })
    subprocess.handler = () => runResult('判定: PASS\n')
    await call(ctx, 'celery_goal_gate', { goal: 'g', why: 'w', output: 'o' })
    expect(subprocess.spawns[0]?.argv[0]).toBe('/opt/py/bin/python')
    expect(subprocess.spawns[0]?.argv[1]).toBe('/custom/celery/task_governor.py')
  })

  it('keeps hostile text as ONE inert argv element (no shell layer to escape)', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('')
    await call(ctx, 'celery_goal_gate', { goal: '$(rm -rf /)', why: 'say "hi"', output: '--flag' })
    expect(subprocess.spawns[0]?.argv).toEqual([
      'python3', '/celery/tools/task_governor.py',
      'check', '--goal', '$(rm -rf /)', '--why', 'say "hi"', '--output', '--flag',
    ])
  })
})

describe('workdir derivation and signal forwarding', () => {
  it('forwards the session cwd as the spawn cwd', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('判定: PASS\n')
    await call(ctx, 'celery_goal_gate', { goal: 'g', why: 'w', output: 'o' }, { agent: agent('/sessions/s1') })
    expect(subprocess.spawns[0]?.cwd).toBe('/sessions/s1')
  })

  it('the explicit workdir argument wins over the session cwd', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('判定: PASS\n')
    await call(ctx, 'celery_goal_gate', { goal: 'g', why: 'w', output: 'o', workdir: '/explicit' }, { agent: agent('/sessions/s1') })
    expect(subprocess.spawns[0]?.cwd).toBe('/explicit')
  })

  it('defaults the spawn cwd to process.cwd() without a session cwd', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('判定: PASS\n')
    await call(ctx, 'celery_goal_gate', { goal: 'g', why: 'w', output: 'o' })
    expect(subprocess.spawns[0]?.cwd).toBe(process.cwd())
  })

  it('forwards exec.signal into the spawn spec', async () => {
    const { ctx, subprocess } = await setup()
    const controller = new AbortController()
    subprocess.handler = () => runResult('判定: PASS\n')
    const result = await call(ctx, 'celery_goal_gate', { goal: 'g', why: 'w', output: 'o' }, { signal: controller.signal })
    expect(subprocess.spawns[0]?.signal).toBe(controller.signal)
    expect(result.isError).toBe(false)
  })

  it('sets the stdio dispositions and grace budget on every spawn', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('判定: PASS\n')
    await call(ctx, 'celery_goal_gate', { goal: 'g', why: 'w', output: 'o' })
    const spec = subprocess.spawns[0]
    expect(spec?.stdio.stdin).toBe('ignore')
    expect((spec?.stdio.stdout as { maxBytes: number; spill: { maxBytes: number } }).maxBytes).toBe(64 * 1024)
    expect((spec?.stdio.stdout as { spill: { maxBytes: number } }).spill.maxBytes).toBe(1024 * 1024)
    expect((spec?.stdio.stderr as { maxBytes: number }).maxBytes).toBe(32 * 1024)
    expect(spec?.graceMs).toBe(2_000)
  })
})

describe('output parsing', () => {
  it('passes the verbatim stdout through as the canonical value and rendered text', async () => {
    const { ctx, subprocess } = await setup()
    const verdict = '目标: 在线监控\n动机: 从离线理论变在线可观察\n产出: 监控工具\n判定: PASS\n'
    subprocess.handler = () => runResult(verdict)
    const result = await call(ctx, 'celery_goal_gate', { goal: '在线监控', why: '观察', output: '工具' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected goal gate success')
    expect(result.value).toEqual({ text: verdict })
    expect(text(result)).toBe(verdict)
  })
})

describe('gate-not-passed exit semantics', () => {
  it('a non-zero exit surfaces stdout and stderr with a stable code', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('目标: (空)\n判定: REVIEW\n  ⚠ 目标缺失\n', { exitCode: 1, stderr: { text: 'traceback line' } })
    const result = await call(ctx, 'celery_goal_gate', { goal: '', why: '', output: '' })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'CELERY_GOAL_GATE_REJECTED' } })
    expect(result.error?.message).toContain('判定: REVIEW')
    expect(result.error?.message).toContain('目标缺失')
    expect(result.error?.message).toContain('[stderr]')
    expect(result.error?.message).toContain('traceback line')
  })

  it('each gate owns its failure code', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('动作: STOP\n', { exitCode: 1 })
    const verify = await call(ctx, 'celery_verify_goal', { rounds: 3, newFindings: 0, window: 3 })
    expect(verify.error).toMatchObject({ info: { code: 'CELERY_VERIFY_GOAL_CONVERGED' } })

    subprocess.handler = () => runResult('β=0.900\n', { exitCode: 1 })
    const calibrate = await call(ctx, 'celery_calibrate_verifier', { injectPath: '/i.json' })
    expect(calibrate.error).toMatchObject({ info: { code: 'CELERY_CALIBRATE_REGRESSION' } })

    subprocess.handler = () => runResult('⚠ β=0.5 超阈值\n', { exitCode: 1 })
    const telemetry = await call(ctx, 'celery_telemetry', { rho: 0.9 })
    expect(telemetry.error).toMatchObject({ info: { code: 'CELERY_TELEMETRY_ALERT' } })
  })

  it('a signal kill and a spawn rejection both fail the check', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('', { exitCode: null, signal: 'SIGKILL' })
    const killed = await call(ctx, 'celery_fixate', { topic: 't', q1: 'y', q2: 'y', q3: 'y', q4: 'y' })
    expect(killed.isError).toBe(true)
    expect(killed.error?.message).toContain('SIGKILL')

    subprocess.handler = () => ({ reject: new Error('spawn ENOENT') })
    const failed = await call(ctx, 'celery_fixate', { topic: 't', q1: 'y', q2: 'y', q3: 'y', q4: 'y' })
    expect(failed.isError).toBe(true)
    expect(failed.error).toMatchObject({ info: { code: 'CELERY_FIXATION_ERROR' } })
    expect(failed.error?.message).toContain('could not start')
  })

  it('rejects when the subprocess implementation drops a requested collect stream', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.dropReaders = true
    const result = await call(ctx, 'celery_decision', { kind: 'explore', question: 'q' })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('no collected output streams')
  })

  it('reports a caller abort fired during the run', async () => {
    const { ctx, subprocess } = await setup()
    const controller = new AbortController()
    subprocess.handler = () => {
      controller.abort('timeout')
      return runResult('', { exitCode: null, signal: 'SIGTERM' })
    }
    const result = await call(ctx, 'celery_decision', { kind: 'explore', question: 'q' }, { signal: controller.signal })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('aborted before completion')
    expect(subprocess.handles[0]?.terminated).toBe(true)
  })
})

describe('argument validation', () => {
  it('rejects missing required arguments', async () => {
    const { ctx } = await setup()
    const result = await call(ctx, 'celery_goal_gate', { goal: 'g' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('invalid arguments')
  })

  it('rejects a decision kind outside the enum', async () => {
    const { ctx } = await setup()
    const result = await call(ctx, 'celery_decision', { kind: 'delete', question: 'q' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('invalid arguments')
  })
})

describe('the no-background-job invariant', () => {
  it('settles every spawned check handle across successful and failed runs', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('判定: PASS\n')
    await call(ctx, 'celery_goal_gate', { goal: 'g', why: 'w', output: 'o' })
    subprocess.handler = () => runResult('', { exitCode: 1, stderr: { text: 'boom' } })
    await call(ctx, 'celery_verify_goal', { rounds: 1, newFindings: 0, window: 3 })
    // One foreground spawn per call, each awaited to settlement before the
    // tool returns — the checks never leave a background handle running.
    expect(subprocess.spawns).toHaveLength(2)
    expect(subprocess.handles.every(handle => handle.settled)).toBe(true)
  })
})
