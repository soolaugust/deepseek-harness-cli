/**
 * Human-facing `/model` command over the Agent-scoped model selection.
 *
 * The command switches the live selection of the receiving Agent through
 * {@link ctx.agentModelSelection}, and persists it as the future default
 * through {@link ctx.agentDefaultModel} — the same two writes the Host
 * `session.selectModel` performs. It takes a free-text model id rather than a
 * validated directory, matching the CLI's prior `/model` surface; a
 * directory-backed picker remains client-only.
 *
 * @module @deepseek-ai/dsh-command-model
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-model-selection'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'

export const name = 'command-model'
export const inject = ['commands', 'agentModelSelection', 'agentDefaultModel']

const USAGE = '/model <model-id> — switch the session model; /model with no argument shows the current model'

/** Execute one parsed human command through the model-selection service. */
async function executeModelCommand(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const model = invocation.rawInput.trim()
  const ref = ctx.agentModelSelection.ref(invocation.agent)
  if (ref === undefined) {
    return { kind: 'error', text: 'model selection is unavailable for this session' }
  }
  if (model === '') {
    const current = ref.current
    return current === undefined
      ? { kind: 'success', text: `no model selected yet\n${USAGE}` }
      : { kind: 'success', text: `current model: ${current.provider}/${current.model}\n${USAGE}` }
  }
  const next: ModelSelection = {
    provider: ref.current?.provider ?? ctx.agentDefaultModel.currentSelection().provider,
    model,
  }
  ref.current = next
  await ctx.agentDefaultModel.saveSelection(next)
  return { kind: 'success', text: `model → ${model}` }
}

/**
 * Register `/model` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and both model-selection services.
 */
export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'model',
    description: 'Switch the session model',
    input: { hint: '<model-id>' },
    handler: invocation => executeModelCommand(ctx, invocation),
  })
}
