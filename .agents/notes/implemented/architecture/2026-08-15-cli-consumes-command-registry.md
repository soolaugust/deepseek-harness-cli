# Agent Note: CLI consumes the shared command registry

Status: implemented

English | [中文](2026-08-15-cli-consumes-command-registry.zh.md)

## Problem

The CLI REPL driver (`@deepseek-ai/dsh-cli`) hard-coded six slash commands in `run.ts` and `index.ts` — `/exit`, `/help`, `/clear`, `/session` as built-ins, and `/model`, `/permission` in a `Record<string, handler>` — and never read the base-layer `ctx.commands` registry (`@deepseek-ai/dsh-commands`) that every other interactive adapter consumes. The `commands` row mounts in `base/cordis.patch.yml`, so it is not a web-only service; the CLI chose a hand-rolled thin shell instead.

Three defects followed from that bypass:

1. **Registered commands silently fail.** `command-compact`, `command-goal`, and `command-feedback` register `/compact`, `/goal`, and `/feedback` on `ctx.commands`; the CLI's driver never consulted the registry, so typing any of them printed `unknown command` despite the plugin being loaded. The goal-command README even records this as a known gap ("Web command adapter only in the shipped apps").
2. **`/permission` semantic drift.** `permission-presets` registers a `/permission` command that switches the sandbox-mode + approval-policy preset (`read-only` / `workspace-write` / `danger-full-access`), while the CLI's hard-coded handler accepted only `ask | never` and wrote the approval policy alone. The same command name meant two different things on the two surfaces, and a preset name typed into the CLI was rejected.
3. **`/model` switched the wrong thing.** The CLI handler called `agentDefaultModel.saveSelection` (persisting the future default) and injected a `[system] Model switched to …` message, but never updated the live agent's `ModelSelectionRef.current`, so the current session kept its original model and the "switch" was only a persisted default plus a fake model-visible notice.

## Decision

The REPL consumes the registry through a fallback slot instead of inventing its own command surface:

- `run.ts` gains an optional `runCommand(raw)` dependency on `CliReplDeps`. The `default` dispatch branch resolves in order: built-ins → `deps.commands` (the one driver-owned command below) → `deps.runCommand(raw.trim())` → `unknown command`. Passing the trimmed line lets the registry's own `parseCommand` resolve it.
- `index.ts` constructs `runCommand` from `ctx.get('commands')`: it calls `commandsRegistry.execute(agent, raw, signal)` and maps the settled `CommandExecution.result.text` onto a view notice, returning `undefined` when the registry does not resolve the line. Registry commands therefore log their `command/run` / `command/done` lifecycle like every other adapter.
- The hard-coded `/permission` handler is deleted. `/permission` now routes through the registry, resolving to the `permission-presets` command with its real preset semantics.
- `/model` stays in the driver because it needs the driver's session-scoped `ModelSelectionRef`, which a registry handler cannot reach. Its handler is fixed: it updates a shared `selectionRef.current` (so this and any later-resumed agent use the new model) and persists through `saveSelection`, dropping the `[system]` inject.

The `selectionSetup` helper is replaced by a single shared `selectionRef` installed into every created/resumed/switched agent, matching the CLI's session-level model semantics.

## Alternatives considered

- **Route `/model` through the registry too** (a new `command-model` plugin registering on `ctx.commands`): rejected for now — there is no host-side model command today (the web `/model` is a client-side `commandUi` popupSelect), and a registry handler has no handle to the driver's `ModelSelectionRef`, so switching the *live* agent would need a host-side, agent-scoped model-selection service that neither entry point currently exposes. That seam belongs to a model-selection refactor, not this command-surface fix.
- **Keep every command hard-coded and just add the missing ones by hand**: rejected — that extends the bypass, keeps the `/permission` drift, and loses the registry's descriptors and lifecycle logging.
- **Mount the registry's `list`/`find` into the driver and reimplement dispatch**: rejected — `execute` already parses, resolves, logs, and normalizes; reimplementing any of that duplicates registry behavior.

## Consequences

- CLI users can now run `/compact`, `/goal`, `/feedback`, and `/permission`, and those commands follow the same `command/run` / `command/done` log path as the web adapter.
- `/permission` means one thing everywhere: preset switching via `permission-presets`.
- `/model` actually switches the session's model and stops writing a fake `[system]` message into the session log; the model-visible history now reflects only real user input.
- `/model` remains a driver-owned command until a host-side model-selection service exists; the path to that refactor is named in the code comment, not hidden.
