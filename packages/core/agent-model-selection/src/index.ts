/**
 * Agent-scoped model selection shared by runtime entry points.
 *
 * An entry point (CLI driver, headless runner) installs one mutable
 * {@link ModelSelectionRef} into each Agent's scoped context through
 * {@link AgentModelSelectionService.install}; a same-process consumer — a
 * registry command, a UI handler — then reads or switches the live selection
 * through {@link AgentModelSelectionService.ref} instead of owning a private
 * ref. The selection lands in prompt assembly and request routing through the
 * shared {@link installModelSelection} waterfall.
 *
 * @module @deepseek-ai/dsh-agent-model-selection
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentModelSelection: AgentModelSelectionService
  }
}

/**
 * Owns one process-local {@link ModelSelectionRef} per Agent. The
 * {@link WeakMap} key means a disposed Agent's selection is collectable
 * without an explicit disposer; the `installModelSelection` listeners it
 * installs unwind with the Agent's scoped context.
 */
export class AgentModelSelectionService extends Service {
  private readonly selections = new WeakMap<Agent, ModelSelectionRef>()

  constructor(ctx: Context) {
    super(ctx, 'agentModelSelection')
  }

  /**
   * Install the per-Agent selection into an unpublished Agent scope.
   *
   * @param agentCtx - the Agent's scoped context carrying `ctx.agent`.
   * @param seed - the initial selection, or `undefined` when the entry point
   *   resolves the model lazily.
   * @returns the installed ref; an already-installed ref is returned unchanged.
   * @throws when `agentCtx` is not an Agent scope (no `ctx.agent`).
   */
  install(agentCtx: Context, seed?: ModelSelection): ModelSelectionRef {
    const agent = agentCtx.agent
    if (agent === undefined) {
      throw new Error('agent-model-selection: install requires an Agent-scoped context')
    }
    const existing = this.selections.get(agent)
    if (existing !== undefined) return existing
    const ref: ModelSelectionRef = { current: seed, assembled: undefined }
    this.selections.set(agent, ref)
    installModelSelection(agentCtx, ref)
    return ref
  }

  /**
   * Read the live selection for an exact live Agent.
   *
   * @param agent - the Agent whose selection to read.
   * @returns the installed ref, or `undefined` when the entry point did not
   *   install one (the Agent was created by a consumer that owns its own
   *   selection, e.g. the Host ApiProxy).
   */
  ref(agent: Agent): ModelSelectionRef | undefined {
    return this.selections.get(agent)
  }
}

export default AgentModelSelectionService
