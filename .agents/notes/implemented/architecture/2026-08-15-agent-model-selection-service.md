# Agent Note: Agent-scoped model-selection service and registry /model

Status: implemented

English | [中文](2026-08-15-agent-model-selection-service.zh.md)

## Problem

The CLI `/model` command stayed hard-coded in the driver after the CLI was wired to the command registry (the [command-registry note](2026-08-15-cli-consumes-command-registry.md)), because switching the live model required the driver's private `ModelSelectionRef`. A registry handler could not reach that ref, so the last driver-owned command could not follow `/permission` into the registry. The same seam was noted there as deferred.

The deeper issue is that per-Agent model selection was not a service at all: three runtime entry points each re-derived it from a private closure over `installModelSelection` — the CLI driver (`selectionRef`), the headless runner (a one-shot `selection`), and the Host ApiProxy (`selections` WeakMap + `selectionFor` with a three-tier getter). A same-process consumer that wanted to switch the live selection had no shared place to do it.

## Decision

A new service `@deepseek-ai/dsh-agent-model-selection` owns one `ModelSelectionRef` per Agent in a `WeakMap`. `install(agentCtx, seed?)` installs the selection into an unpublished Agent scope (idempotent per Agent) and returns the ref; `ref(agent)` reads the live selection for an exact live Agent, or `undefined` when that entry point did not install one. The `WeakMap` key means a disposed Agent's selection is collectable without a disposer; the `installModelSelection` listeners the install adds unwind with the Agent scope.

A new command plugin `@deepseek-ai/dsh-command-model` registers `/model` on `ctx.commands`. Its handler reads `agentModelSelection.ref(invocation.agent)` and writes the two authoritative states the Host `session.selectModel` also writes: the live selection (`ref.current`) and the persistent default (`agentDefaultModel.saveSelection`), keeping the provider from the current selection. It takes a free-text model id, matching the CLI's prior surface; a directory-backed picker remains client-only. When the entry point installed no selection (e.g. the Host ApiProxy, which owns its own), the command returns a direct `unavailable` error.

The CLI driver drops its hard-coded `/model` handler and its private `selectionRef`: its `setup` now calls `modelSelection.install(agentCtx, agentOptions)`, and `/model` routes through the registry fallback built in the earlier change. Both new rows mount in the base bundle (`agent-model-selection` beside `agent-default-model`, `command-model` beside `command-compact`), so the CLI inherits them and the web surface is unaffected (its `/model` is a client-side `commandUi` popup, not `ctx.commands`).

## Alternatives considered

- **Fold per-Agent selection into `agent-default-model`**: rejected — that service owns the process-wide default for newly created Agents; per-Agent live selection is a distinct axis that prompt assembly reads per step, and the default is its seed and fallback, not its identity.
- **Migrate the Host ApiProxy's `selectionFor` into this service now**: deferred — `selectionFor`'s getter folds a session-log `requestHeader()` fallback between the process-local pick and the default, and its image-admission reads depend on that three-tier resolution. Consolidating it is a separate change; nothing in the CLI consumer requires it.
- **A registry command that switches only the default (`agentDefaultModel.saveSelection`)**: rejected — that would recreate the original `/model` bug of not switching the live agent; the command must reach the per-Agent ref.
- **Keep `/model` in the driver**: rejected — that is the bypass this change removes; a shared service is the seam a registry handler needs.

## Consequences

- The CLI has no driver-owned slash commands left: `/exit` `/help` `/clear` `/session` are terminal built-ins, and `/model` `/permission` `/compact` `/goal` `/feedback` all resolve through the registry with the same `command/run`/`command/done` lifecycle as the web adapter.
- `installModelSelection`'s three private re-derivations now have one service; the CLI and headless entry points install through it (headless migration is a mechanical follow-up, not done here).
- The Host ApiProxy still owns its own selection; the service and that private `selectionFor` coexist until a future consolidation, documented in the package README's deferred work.
- `/model` now takes a free-text id everywhere on the command plane; a directory-backed picker remains the client UI's separate surface.
