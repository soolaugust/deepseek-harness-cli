import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as ReliabilityGuard from '@deepseek-ai/dsh-reliability-guard'
import type { Config } from '@deepseek-ai/dsh-reliability-guard'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Behavior suite for the reliability guard: consecutive-failure attribution
 * reminders, the write-tool goal gate (deny before the model states the goal,
 * allow after), and the one-shot harness prompt injection — all driven through
 * a real agent loop against a scripted mock adapter (no network).
 */

/** Boot the core spine + the guard; the caller registers adapters and extra listeners. */
async function harness(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ReliabilityGuard, config)
  ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'p', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
  ctx.tools.register(defineContentToolFixture({ name: 'write', description: 'w', parameters: {}, async execute() { return [{ type: 'text', text: 'written' }] } }))
  ctx.tools.register(defineContentToolFixture({ name: 'read', description: 'r', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
  ctx.tools.register(defineContentToolFixture({ name: 'flaky', description: 'f', parameters: {}, async execute() { throw new Error('boom') } }))
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => { const d = ctx.on('agent/status', ({ agent: s, status: st }) => { if (s === agent && st === 'idle') { d(); resolve() } }) })
}

function run(ctx: Context, script: StreamChunk[][]): Agent {
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  return agent
}

/** Every plugin-source injected message in the agent's log, flattened to text + source. */
function injectedContexts(agent: Agent): { text: string; source: unknown }[] {
  return [...agent.session.events]
    .filter((e): e is SessionEvent<'user/message'> => e.type === 'user/message' && e.data.source.kind === 'plugin')
    .map(e => ({
      text: e.data.content.map(block => block.type === 'text' ? block.text : '').join('|'),
      source: e.data.source,
    }))
}

/** Every tool/result event in the agent's log, in order. */
function toolResults(agent: Agent): SessionEvent<'tool/result'>[] {
  return [...agent.session.events].filter((e): e is SessionEvent<'tool/result'> => e.type === 'tool/result')
}

/** The `notice`-form attribution reminder's source. */
const noticeSource = (tool: string, count: number) => ({
  kind: 'plugin',
  plugin: 'reliability-guard',
  form: 'notice',
  summary: `${tool} × ${count} failures`,
})

/** The `instructions`-form harness prompt's source. */
const instructionsSource = {
  kind: 'plugin',
  plugin: 'reliability-guard',
  form: 'instructions',
}

describe('consecutive-failure reminder', () => {
  it('injects one attribution reminder at the default threshold (3)', async () => {
    const ctx = await harness()
    const agent = run(ctx, [
      toolCallResponse('c1', 'flaky', {}),
      toolCallResponse('c2', 'flaky', {}),
      toolCallResponse('c3', 'flaky', {}), // 3rd consecutive failure
      textResponse('done'),
    ])
    await waitForIdle(ctx, agent)

    const found = injectedContexts(agent)
    expect(found).toHaveLength(1)
    expect(found[0]!.text).toContain('- tool: flaky')
    expect(found[0]!.text).toContain('consecutive_failures: 3')
    expect(found[0]!.text).toContain('β (validator)')
    expect(found[0]!.text).toContain('p₁ (per-attempt success)')
    expect(found[0]!.source).toEqual(noticeSource('flaky', 3))
  })

  it('fires at a custom threshold', async () => {
    const ctx = await harness({ repeatThreshold: 2 })
    const agent = run(ctx, [
      toolCallResponse('c1', 'flaky', {}),
      toolCallResponse('c2', 'flaky', {}), // 2nd consecutive failure
      textResponse('done'),
    ])
    await waitForIdle(ctx, agent)

    const found = injectedContexts(agent)
    expect(found).toHaveLength(1)
    expect(found[0]!.source).toEqual(noticeSource('flaky', 2))
  })

  it('does not remind below the threshold', async () => {
    const ctx = await harness({ repeatThreshold: 3 })
    const agent = run(ctx, [
      toolCallResponse('c1', 'flaky', {}),
      toolCallResponse('c2', 'flaky', {}),
      textResponse('done'),
    ])
    await waitForIdle(ctx, agent)

    expect(injectedContexts(agent)).toHaveLength(0)
  })

  it('a success resets the chain', async () => {
    const ctx = await harness()
    const agent = run(ctx, [
      toolCallResponse('c1', 'flaky', {}),
      toolCallResponse('c2', 'probe', {}), // success resets the chain
      toolCallResponse('c3', 'flaky', {}),
      toolCallResponse('c4', 'flaky', {}),
      toolCallResponse('c5', 'flaky', {}), // 3rd consecutive AFTER the reset
      textResponse('done'),
    ])
    await waitForIdle(ctx, agent)

    const found = injectedContexts(agent)
    expect(found).toHaveLength(1)
    expect(found[0]!.source).toEqual(noticeSource('flaky', 3))
  })

  it('denied calls count toward the chain (goal-gate denials draw the reminder)', async () => {
    const ctx = await harness({ enforceGoalGate: true, repeatThreshold: 3 })
    const agent = run(ctx, [
      toolCallResponse('c1', 'write', {}),
      toolCallResponse('c2', 'write', {}),
      toolCallResponse('c3', 'write', {}), // 3rd consecutive denial
      textResponse('done'),
    ])
    await waitForIdle(ctx, agent)

    const results = toolResults(agent)
    expect(results).toHaveLength(3)
    expect(results.every(r => r.data.message.content[0].isError)).toBe(true)
    const found = injectedContexts(agent)
    expect(found).toHaveLength(1)
    expect(found[0]!.source).toEqual(noticeSource('write', 3))
  })
})

describe('goal gate', () => {
  it('denies a write tool before the goal, allows it after the model states the goal', async () => {
    const ctx = await harness({ enforceGoalGate: true })
    const agent = run(ctx, [
      toolCallResponse('c1', 'write', { file: 'a.txt' }, 'GOAL: fix the bug and prove it with a passing test'),
      toolCallResponse('c2', 'write', { file: 'a.txt' }),
      textResponse('done'),
    ])
    await waitForIdle(ctx, agent)

    const results = toolResults(agent)
    expect(results).toHaveLength(2)
    expect(results[0]!.data.message.content[0].isError).toBe(true)
    const denialText = results[0]!.data.message.content[0].content
      .map(block => block.type === 'text' ? block.text : '').join('')
    expect(denialText).toContain('goal gate')
    expect(results[1]!.data.message.content[0].isError).toBe(false)
  })

  it('leaves non-write tools allowed while the gate is closed', async () => {
    const ctx = await harness({ enforceGoalGate: true })
    const agent = run(ctx, [
      toolCallResponse('c1', 'read', { file: 'b.txt' }, 'GOAL: collect the data'),
      toolCallResponse('c2', 'probe', {}),
      textResponse('done'),
    ])
    await waitForIdle(ctx, agent)

    const results = toolResults(agent)
    expect(results).toHaveLength(2)
    expect(results.every(r => r.data.message.content[0].isError === false)).toBe(true)
    expect(injectedContexts(agent)).toHaveLength(0)
  })

  it('is disabled by default (write allowed with no goal statement)', async () => {
    const ctx = await harness()
    const agent = run(ctx, [
      toolCallResponse('c1', 'write', { file: 'a.txt' }),
      textResponse('done'),
    ])
    await waitForIdle(ctx, agent)

    const results = toolResults(agent)
    expect(results).toHaveLength(1)
    expect(results[0]!.data.message.content[0].isError).toBe(false)
  })

  it('honors configured write patterns', async () => {
    const ctx = await harness({ enforceGoalGate: true, writeTools: ['commit_*'] })
    const agent = run(ctx, [
      toolCallResponse('c1', 'write', { file: 'a.txt' }), // 'write' not in writeTools -> allowed
      toolCallResponse('c2', 'commit_x', {}),             // matches commit_* -> denied
      textResponse('done'),
    ])
    await waitForIdle(ctx, agent)

    const results = toolResults(agent)
    expect(results).toHaveLength(2)
    expect(results[0]!.data.message.content[0].isError).toBe(false)
    expect(results[1]!.data.message.content[0].isError).toBe(true)
  })
})

describe('prompt injection', () => {
  it('injects the harness instructions once when injectPrompt is on', async () => {
    const ctx = await harness({ injectPrompt: true })
    const agent = run(ctx, [
      toolCallResponse('c1', 'probe', {}),
      textResponse('done'),
    ])
    await waitForIdle(ctx, agent)

    const found = injectedContexts(agent)
    expect(found).toHaveLength(1)
    expect(found[0]!.text).toContain('celery four parameters')
    expect(found[0]!.text).toContain('L0 validator')
    expect(found[0]!.text).toContain('GOAL:')
    expect(found[0]!.source).toEqual(instructionsSource)
  })

  it('injects nothing when injectPrompt is off', async () => {
    const ctx = await harness()
    const agent = run(ctx, [
      textResponse('done'),
    ])
    await waitForIdle(ctx, agent)

    expect(injectedContexts(agent)).toHaveLength(0)
  })
})

describe('config validation fails loud', () => {
  async function spine(): Promise<Context> {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    return ctx
  }

  it('rejects a repeatThreshold below 1', async () => {
    const ctx = await spine()
    await expect(ctx.plugin(ReliabilityGuard, { repeatThreshold: 0 })).rejects.toThrow(/integer >= 1/)
  })

  it('rejects a fractional repeatThreshold', async () => {
    const ctx = await spine()
    await expect(ctx.plugin(ReliabilityGuard, { repeatThreshold: 2.5 })).rejects.toThrow(/integer >= 1/)
  })

  it('rejects a blank goalMarker', async () => {
    const ctx = await spine()
    await expect(ctx.plugin(ReliabilityGuard, { goalMarker: '  ' })).rejects.toThrow(/must not be blank/)
  })
})
