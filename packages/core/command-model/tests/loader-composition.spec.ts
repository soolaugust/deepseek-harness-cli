import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import AgentModelSelectionService from '@deepseek-ai/dsh-agent-model-selection'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as commandModel from '@deepseek-ai/dsh-command-model'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('command-model real Loader composition', () => {
  it('discovers and executes /model through the assembled command plane', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-command-model-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@deepseek-ai/dsh-agent-model-selection'",
      "- name: '@deepseek-ai/dsh-agent-default-model'",
      '  config:',
      '    provider: deepseek-official',
      '    model: deepseek-v4-flash',
      "- name: '@deepseek-ai/dsh-command-model'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['@deepseek-ai/dsh-agent-model-selection', AgentModelSelectionService],
      ['@deepseek-ai/dsh-agent-default-model', AgentDefaultModelConfig],
      ['@deepseek-ai/dsh-command-model', commandModel],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    const session = Session.create(SessionId('loader-command-model'))
    const agent = {
      session,
      status: 'idle',
      options: {},
      reserveTurnAdmission: () => () => undefined,
    } as unknown as Agent & { ctx: Context }
    agent.ctx = new Context().extend({ agent })
    context.agentModelSelection.install(agent.ctx, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })

    expect(context.commands.list(agent)).toContainEqual({
      name: 'model',
      description: 'Switch the session model',
      input: { hint: '<model-id>' },
    })
    const execution = await context.commands.execute(agent, '/model deepseek-reasoner', new AbortController().signal)
    if (execution === undefined) throw new Error('Loader composition did not resolve /model')
    expect(execution.result).toEqual({ kind: 'success', text: 'model → deepseek-reasoner' })
    expect(context.agentModelSelection.ref(agent)?.current).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-reasoner',
    })
    expect(session.events.map(event => ({ type: event.type }))).toEqual([
      { type: 'command/run' },
      { type: 'command/done' },
    ])
    expect(session.surface.nodes).toEqual([])
    expect(session.deriveMessages()).toEqual([])
  })
})
