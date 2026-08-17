# `@deepseek-ai/dsh-cli`

English | [中文](README.zh.md)

The dsh interactive terminal bundle. [`cordis.patch.yml`](cordis.patch.yml) rides directly over [`dsh-base`](../base/README.md): it supplies the coding persona and tool mode, disables HMR, mounts Code Mode's worker as a core execution capability, inserts the agent-preset roster (defaulting to `standard`), and inserts this package's `cli-startup` provider and `cli-runner` plugin. It mounts no Host, HTTP server, Web runtime, or browser plugin.

After the Loader settles, the runner resolves the session this invocation drives — the latest persisted session for the working directory, a named id (`--resume <id>`), or a fresh one (`--resume fresh`) — creates or resumes it through `ctx.agents`, subscribes the view store to the agent's `session/event` feed, and drives the REPL until the user types `/exit`. Each prompt becomes an ordinary user message via `agent.followup`; each turn settles to quiescence and the Session flushes before the next prompt. The terminal renderer is an injectable io: the plain-output io ships here (reads stdin, prints committed view items, used by `--no-interactive`), and the ink TUI io lives in [`@deepseek-ai/dsh-cli-ui`](../../ui/cli/README.md). Exit requests go through the launcher-provided `ctx.appExit` host hook ([`dsh-cmdline`](../../boot/cmdline/README.md)).

## Agent presets

The cli bundle mounts an [`agent-presets`](../../preset/agent-presets/README.md) roster with shipped presets under `config/agent-presets/` and a default of `standard`, so every session composes from a preset: the preset decides the tool schemas and prompt sections the model sees. `dsh cli --mode <preset>` pins a fresh or resumed session to that preset (defaulting to the roster's own default when omitted); on resume the runner rebuilds the preset recorded in the session's log, never the creation header alone, so a session that switched while blank runs its later turns under the newer composition. Within a session, `/mode <preset>` re-links a still-blank agent to another preset and `/mode` with no argument lists the roster — both mirror the Web surface's agent-preset switch, which refuses after the conversation has started. A profile that replaces the roster or mounts no `agent-presets` row composes no preset, so `--mode` and `/mode` then have no effect.


## Model Experience

None, as the runner submits prompts as ordinary user messages; prompts and tools belong to the base and cli bundle rows.

#### KV Cache effect

None; the runner adds nothing to the request prefix.

## Known Limitations and Deferred Work

- **One live agent at a time** — session switching disposes the current agent before resuming the next; no concurrent agents.
- **`ctx.appExit` is launcher-owned** — booting the cli profile outside the `dsh` launcher fails loud at activation until the host provides the exit request.
- **Interactive io is the ink TUI** — without a terminal (piped stdin), use `--no-interactive` for stable plain output.
