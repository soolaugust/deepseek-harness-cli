# @deepseek-ai/dsh-agent-model-selection

English | [中文](README.zh.md)

The process-local, per-Agent model selection shared by runtime entry points. An entry point installs one mutable `ModelSelectionRef` into each Agent's scoped context; a same-process consumer — a registry command, a UI handler — then reads or switches the live selection without owning a private ref.

This is distinct from [`@deepseek-ai/dsh-agent-default-model`](../agent-default-model/README.md), which owns the process-wide default for newly created Agents. The default is this service's seed and its persistent fallback; this service owns the per-session live selection that prompt assembly and request routing read on every step.

- `ctx.agentModelSelection.install(agentCtx, seed?)` installs the selection into an unpublished Agent scope and returns its ref (idempotent per Agent).
- `ctx.agentModelSelection.ref(agent)` reads the live selection for an exact live Agent, or `undefined` when that entry point did not install one.

A ref is keyed by the Agent in a `WeakMap`, so a disposed Agent's selection is collectable without an explicit disposer; the `installModelSelection` listeners the install adds unwind with the Agent's scoped context.

## Model Experience

### Live `/model` switch

#### What the model sees

Changing `ref.current` takes effect on the next step's prompt assembly and request routing (provider and model variables, request config). A concurrent switch does not split the two surfaces: the current step keeps the selection captured at assembly time.

#### Token effect

A switch adds no model tokens itself; it changes the provider/model of the next request.

#### KV Cache effect

Switching provider or model invalidates the request prefix for subsequent steps, exactly as a provider/model change would through any other path.

## Known Limitations and Deferred Work

- The service does not validate catalog membership. A provider route may serve an unadvertised model, and the consumer that opens a model request owns availability diagnostics (same stance as `agent-default-model`).
- The Host ApiProxy owns its own three-tier selection (`selectionFor`) with a session-log fallback; it does not use this service. Consolidating that into this service is deferred, not required by the CLI consumer that motivated the extraction.
