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

**Full Web parity by default (roster mounted in the CLI profile)** — rejected for this change. It flips the shipped default (turn-based `dsh cli` composes presets), and doing it cleanly needs a profile-layer base split so the preset-owned rows (`agent-preset`, plus the skill/tool/plan rows `dsh-base` already provides per agent) do not duplicate. Larger blast radius; deferred (see Consequences).

**Roster keyed under a hardcoded id** — rejected: `--mode`/`/mode` resolve through the roster's own `resolve`, so defaults and behavior stay explicit (`resolve(request)` rather than a hidden `?? default`), per the explicit-defaults convention.

## Consequences

`dsh cli -m/--mode <id>` and `/mode` surface agent-preset selection on the CLI with the Web's blank-gate and log-resume semantics. The mechanism is opt-in: without an agent-presets row in the profile, `--mode` and `/mode` are inert and `dsh cli` runs exactly as before — so the change ships at zero risk to the current shipped profile.

The roster-mount option (activate mode selection by default by adding an `agent-presets` row to the cli bundle) was **tested and rejected on evidence**: none of the shipped presets composes reliably over the terminal host. `standard`, `code`, `celery`, `cordis`, and `memory-os` each fail to mount (their tool rows wait for host capability services such as `tools`, `shell`, `fs`, and `systemPrompt` that the CLI profile does not surface to a preset's standing composition), and the self-contained `minimal` is flaky (`persona` intermittently waits for `systemPrompt`). The same presets mount reliably over the Web host (base + `web.cordis.yml`), so the shipped presets are Web-host compositions; making a roster-mount default viable needs the profile-layer base split deferred here, so the CLI profile stays opt-in for now.

## Verification

- Unit: `run.spec.ts` `/mode` lists the roster's ids and switches a blank session, and reports `no such mode` for a rejected target; the view store records `mode` for the status badge.
- Loader-smoke (`smoke.e2e.ts`): `dsh cli -m code` parses and runs on a clean tree with no roster (the flag is inert), proving the flag does not break composition when no presets are mounted.
- Roster-mount probe: added an `agent-presets` row (`default: standard`) to the cli bundle and booted the profile for each shipped preset — `standard`, `code`, `celery`, `cordis`, `memory-os`, `minimal`. Every preset except `minimal` fails to mount (6–8 tool rows wait for host capabilities); `minimal` mounts only intermittently (`persona` waits for `systemPrompt`). The same presets mount over the Web host, confirming the gap is host-specific.
- Manual: `dsh cli --mode code` on a preset-mounting profile creates the session under `code`; `/mode` lists and switches a blank session and refuses a started one.
