# Agent Note: Agent-preset mode in the CLI

Status: implemented

English | [中文](2026-08-17-cli-agent-preset-mode.zh.md)

## Problem

The Web surface selects an **agent preset** per session: `standard`, `code`, `celery`, or `memory-os`, each a standing Cordis composition (tools, lifecycle, system prompt) mounted for that session's agent. The [interactive CLI](../feature/2026-08-14-cli-interactive-terminal.md) had no equivalent — an `@deepseek-ai/dsh-cli` session always ran the host composition, so a user could not choose which agent personality drove a terminal session. The gap was not just a missing flag: composition is decided at agent creation (it feeds the session header and the standing mount), and a wrong or misremembered choice must be recoverable before a conversation commits to a persona's tools.

## Decision

Add CLI agent-preset mode switching mirroring the Web surface's `composeAgent` — a `preset` provided by the agent-preset roster (`@deepseek-ai/dsh-agent-presets`), gated so the CLI stays behavior-identical when a profile composes no presets.

**Surface.** `dsh cli --mode <id>` selects the preset for a fresh session; `/mode` lists the roster's preset ids and `/mode <id>` switches a still-blank live session (`mode → <id>`), or reports `no such mode: <id>` when the roster rejected it or the conversation already started. The status bar shows a `mode: <id>` badge.

**Creation** (`composeFrom`): when the deployment mounts the roster service (`ctx.get('agentPresets')`), the runner resolves the requested preset (`presets.resolve`), records the resolved id in the session `meta.agentPreset`, and wraps the agent `setup` to chain the base model-selection setup then `presets.mount(agentCtx, resolvedId)`. Resolve-before-create mirrors the Web's `composeAgent` so the header names the real preset, and mounting inside `setup` rolls the whole creation back if the composition is unusable. A profile with no roster composes nothing — `composeFrom` returns the base setup unchanged, which is exactly the pre-preset behavior for `dsh cli`.

**Resume** resolves the preset from the **event log**, not the header: `load` the pending session, run `resolveSessionPreset` to read the newest `agent-preset/selected` record (else the header), and compose that. This lets a session switched while blank resume under its newer persona — the same reasoning as the Web receiver and the model-visible ⟺ logged rule.

**Live switch** (`selectAgentMode`) honors the blank-session gate: once a `turn/start` exists the history was produced under that preset's tools and cannot be re-linked, so a started session refuses. On success it `recompose`s the live agent to the target's standing composition, then appends `agent-preset/selected` to the log only after the swap commits — the log states what the agent now runs.

## Alternatives considered

**Roster keyed under a hardcoded id** — rejected: `--mode`/`/mode` resolve through the roster's own `resolve`, so defaults and behavior stay explicit (`resolve(request)` rather than a hidden `?? default`), per the explicit-defaults convention.

## Consequences

The cli bundle imports the `agent-presets` roster (`default: standard`, shipped presets under `config/agent-presets/` with `system` trust, alongside the person's `$DSH_HOME/.agent-presets`), so `dsh cli` composes each session from a preset by default. `dsh cli -m/--mode <id>` and `/mode` surface agent-preset selection on the CLI with the Web's blank-gate and log-resume semantics. A profile that replaces the roster or mounts no `agent-presets` row keeps `--mode`/`/mode` inert and `dsh cli` behaviorally uncomposed.

An early build of this change rejected the roster-mount on evidence that no shipped preset composed over the terminal host: `--mode`/`/mode` and the default `standard` failed to mount (their tool rows waited for host capability services such as `tools`, `shell`, `fs`, and `systemPrompt` that the CLI profile did not surface to a preset's standing composition). That failure was **specific to the `src` (tsx) launcher smoke path** — `runLoaderSmoke` in `src` mode loads `@deepseek-ai/cordis` and the preset parcel as duplicate ESM module instances, which splits the preset isolate realms from the host realm. The same composition mounts every shipped preset reliably over the built artifact (`lib` plain-Node, the CI/production path): the `smoke.e2e.ts` preset cases pass with empty stderr and the standalone built `dsh cli --mode <preset>` boots cleanly. Shipping the roster by default is therefore safe for production; a dev using a tsx source-launch smoke of a preset-composing profile will see the spurious realm split.

## Verification

- Unit: `run.spec.ts` `/mode` lists the roster's ids and switches a blank session, and reports `no such mode` for a rejected target; the view store records `mode` for the status badge.
- Loader-smoke (`smoke.e2e.ts`, `lib` mode as CI runs it): `dsh cli` composes the default `standard`, `dsh cli --mode code` composes `code`, and a no-roster profile leaves the flag inert — all exit cleanly with empty stderr.
- tsx `src`-mode note: the same preset-composing smokes fail under `src` launch with `row(s) did not activate`; this is the known tsx module-duplication artifact, not exercised by CI.
- The deployment overlay in `apps/cli/src/profile-boot.ts` appends the shipped preset root to whichever `agent-presets` row the composition mounts, so the bundle insert and the shipped presets resolve together.
- Manual: on the built `dsh`, `cli --mode code` creates the session under `code`; `--mode bogus` fails loud with the roster's available ids; `/mode` lists and switches a blank session and refuses a started one.
