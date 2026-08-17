# @deepseek-ai/dsh-command-model

English | [中文](README.zh.md)

Human-facing `/model` control over the Agent-scoped model selection. The plugin registers one global command through [`ctx.commands`](../../interaction/commands/README.md), so every composed command adapter discovers and executes it without a model turn.

Switching takes a free-text model id, matching the CLI's prior `/model` surface. A directory-backed picker remains client-only: the host command plane has no catalog UI, and the host does not validate catalog membership.

## Command contract

| Input | Result |
|---|---|
| `/model` | Show the current `provider/model` and usage. |
| `/model <model-id>` | Switch the live selection of the receiving Agent (next step's prompt assembly and request routing) and persist it as the future default. |

A switch writes two authoritative states through the model-selection service, the same two writes the Host `session.selectModel` performs: the per-Agent live selection (`agentModelSelection.ref(agent).current`) and the persistent default (`agentDefaultModel.saveSelection`). The provider is kept from the current selection (or the default when none is selected) so a switch renames the model without losing the route.

## Composition

The producer injects `commands`, `agentModelSelection`, and `agentDefaultModel`. A custom app mounts their owners plus this plugin:

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: agent-model-selection
  name: '@deepseek-ai/dsh-agent-model-selection'
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
- id: command-model
  name: '@deepseek-ai/dsh-command-model'
```

## Model Experience

### Human `/model` control

#### What the model sees

The slash input and direct status/output text are absent from model requests. The switch (`/model`) takes effect in the next request's provider and model; it is not injected as a message.

#### Token effect

Switching a model adds no model tokens itself; it changes the provider/model of the next request.

#### KV Cache effect

Switching provider or model invalidates the request prefix for subsequent steps, exactly as a provider/model change would through any other path.

## Known Limitations and Deferred Work

- **Free-text model id, no directory** — the host command plane does not enumerate or validate models; a directory-backed picker remains client-only.
- **Only entry points that install a selection** — surfaces whose entry point does not call `agentModelSelection.install` (e.g. the Host ApiProxy, which owns its own selection) get a direct `unavailable` error.
