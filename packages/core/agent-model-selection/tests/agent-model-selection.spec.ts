/** Agent-scoped model selection: install, idempotence, and lookup. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentModelSelectionService from '../src/index.ts'

/** A context that carries an Agent own property, mirroring ReactLoopAgent.ctx. */
function agentScope(agent: Agent): Context {
  return new Context().extend({ agent })
}

async function boot(): Promise<{ ctx: Context; service: AgentModelSelectionService }> {
  const ctx = new Context()
  await ctx.plugin(AgentModelSelectionService)
  return { ctx, service: ctx.agentModelSelection }
}

describe('AgentModelSelectionService', () => {
  it('installs one ref per Agent and returns it unchanged on repeat install', async () => {
    const { ctx, service } = await boot()
    const agent = {} as Agent
    const scope = agentScope(agent)
    const seed = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

    const first = service.install(scope, seed)
    expect(first.current).toEqual(seed)
    expect(service.install(scope, { provider: 'ignored', model: 'ignored' })).toBe(first)
    expect(first.current).toEqual(seed)
    await ctx.fiber.dispose()
  })

  it('resolves the ref for an installed Agent and undefined otherwise', async () => {
    const { ctx, service } = await boot()
    const installed = {} as Agent
    const other = {} as Agent

    service.install(agentScope(installed), { provider: 'p', model: 'm' })
    expect(service.ref(installed)?.current).toEqual({ provider: 'p', model: 'm' })
    expect(service.ref(other)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('rejects a non-Agent scope', async () => {
    const { ctx, service } = await boot()
    expect(() => service.install(new Context(), { provider: 'p', model: 'm' }))
      .toThrow('install requires an Agent-scoped context')
    await ctx.fiber.dispose()
  })
})
