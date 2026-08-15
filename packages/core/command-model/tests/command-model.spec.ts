import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import AgentModelSelectionService from '@deepseek-ai/dsh-agent-model-selection'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as commandModel from '@deepseek-ai/dsh-command-model'

interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

/** Build a live idle agent whose scoped context carries an `agent` own property. */
function stubAgent(ctx: Context, id: string): Agent {
  const session = ctx.sessions.create(SessionId(id))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  let status: AgentStatus = 'idle'
  const agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input: unknown) { inbox.append('next-step', input as never) },
    cancel() { status = 'idle' },
    runMaintenance: (task: (signal: AbortSignal) => unknown) => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  } as unknown as Agent & { ctx: Context }
  agent.ctx = new Context().extend({ agent })
  return agent
}

/** Mount the command registry, both model services, and the producer. */
async function harness(): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentModelSelectionService)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  const plugin = await ctx.plugin(commandModel)
  const agent = stubAgent(ctx, `command-model-${Math.random()}`)
  ctx.agents.register(agent)
  ctx.agentModelSelection.install(agent.ctx, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  return { ctx, agent, plugin }
}

/** Execute `/model` through the same registry boundary as a UI adapter. */
async function run(test: Harness, suffix = ''): Promise<NonNullable<Awaited<ReturnType<CommandRuntime['execute']>>>['result']> {
  const execution = await test.ctx.commands.execute(
    test.agent,
    `/model${suffix}`,
    new AbortController().signal,
  )
  if (execution === undefined) throw new Error('model command was not registered')
  return execution.result
}

describe('@deepseek-ai/dsh-command-model registration', () => {
  it('registers one global command with Loader-safe exports and disposes it', async () => {
    const test = await harness()
    expect(commandModel.name).toBe('command-model')
    expect(commandModel.inject).toEqual(['commands', 'agentModelSelection', 'agentDefaultModel'])
    expect('default' in commandModel).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(commandModel)).toBe(commandModel)

    expect(test.ctx.commands.list(test.agent)).toContainEqual({
      name: 'model',
      description: 'Switch the session model',
      input: { hint: '<model-id>' },
    })
    expect(test.ctx.commands.find(test.agent, 'model')).toBeDefined()

    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.agent, 'model')).toBeUndefined()
  })
})

describe('/model human command', () => {
  it('shows the current model and usage without mutating it', async () => {
    const test = await harness()
    const result = await run(test)
    expect(result).toEqual({
      kind: 'success',
      text: 'current model: deepseek-official/deepseek-v4-flash\n/model <model-id> — switch the session model; /model with no argument shows the current model',
    })
    expect(test.ctx.agentModelSelection.ref(test.agent)?.current?.model).toBe('deepseek-v4-flash')
  })

  it('switches the live selection and persists the default', async () => {
    const test = await harness()
    const save = vi.spyOn(test.ctx.agentDefaultModel, 'saveSelection')
    const result = await run(test, ' deepseek-reasoner ')
    expect(result).toEqual({ kind: 'success', text: 'model → deepseek-reasoner' })
    expect(test.ctx.agentModelSelection.ref(test.agent)?.current).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-reasoner',
    })
    expect(save).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'deepseek-reasoner' })
  })

  it('reports unavailability when the entry point installed no selection', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentModelSelectionService)
    await ctx.plugin(AgentDefaultModelConfig, { provider: 'p', model: 'm' })
    await ctx.plugin(commandModel)
    const session = ctx.sessions.create(SessionId('command-model-uninstalled'))
    const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
    const agent = {
      id: session.id, options: {}, session, inbox, ctx: new Context(),
      get status() { return 'idle' as AgentStatus },
      send: () => {}, followup: () => {}, steer: () => {}, inject: () => {}, cancel: () => {},
      runMaintenance: (task: (signal: AbortSignal) => unknown) => task(new AbortController().signal),
      whenIdle: () => Promise.resolve(),
    } as Agent
    ctx.agents.register(agent)
    const execution = await ctx.commands.execute(agent, '/model deepseek-reasoner', new AbortController().signal)
    expect(execution?.result).toEqual({ kind: 'error', text: 'model selection is unavailable for this session' })
  })
})
