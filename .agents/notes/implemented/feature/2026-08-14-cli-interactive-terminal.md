# Agent Note: Interactive terminal CLI (`dsh cli`)

Status: implemented

English | [中文](2026-08-14-cli-interactive-terminal.zh.md)

## Problem

DeepSeek Harness shipped two CLI surfaces: `dsh --profile headless "task"` (a one-shot runner) and `dsh web` (a browser UI). There was no terminal-interactive entry — the [TUI removal](../simplification/2026-08-04-remove-tui-package.md) left Web as the only interactive surface and required "a named product, an explicit package boundary, a concrete interaction provider, and assembled lifecycle and transcript acceptance" to reintroduce one. Users want a Claude Code / Codex-style local REPL: a bottom input bar over a scrolling transcript, streaming tokens, tool cards, session resume, and permission control.

## Decision

Add a `cli` profile (`dsh cli`) composed over `dsh-base`, split into two packages with a driver/renderer seam:

- **`@deepseek-ai/dsh-cli`** (`packages/bundle/cli/`) — the ink-agnostic REPL driver. It resolves the target session (latest for the cwd, `--resume <id>`, or fresh), subscribes the view store to the agent's `session/event` feed, and runs the loop: read a line → route it (built-in `/exit /help /clear /session`, app commands `/model /permission`, or a plain prompt through `agent.followup`) → settle to quiescence → flush. Session switching (`/session <id>`) resumes the target first (leaving the current agent untouched on failure), then flushes and disposes the previous handle and rebinds the feed. The plain-output io reads stdin through a **buffered line queue** — a single pending slot dropped lines arriving while a slash command awaited a settings write.
- **`@deepseek-ai/dsh-cli-ui`** (`packages/ui/cli/`) — the ink renderer. It owns the terminal view contract (`CliViewItem` / `CliViewState`) so the driver depends on the renderer's contract, not the reverse. `createInteractiveIo` bridges the driver's `nextLine` to the input bar; the ink tree subscribes with `useSyncExternalStore`. The approval answerer grants each ask once and surfaces it as a view notice.

The driver is renderer-agnostic and injectable (`nextLine` + view store), so transcript logic is covered by unit tests without a terminal, and the assembled profile by keyless loader-smokes. The view bridge in `dsh-cli-ui` subscribes with `useState` + a `useEffect` subscription rather than `useSyncExternalStore`: under ink's React reconciler the external-store subscribe hook was never registered (`emit` observed zero listeners), so view mutations did not re-render the tree.

**CLI flags** (`--model`, `--provider`, `--cwd`, `--resume <latest|fresh|id>`, `--permission <read-only|workspace-write|danger-full-access>`, `--no-interactive`, `--verbose`) parse in a `cli-startup` provider and publish `ctx.cliStartup`. The cli patch binds the approval policy to `ctx.cliStartup.permission`: `danger-full-access` disables prompting, other presets ask and the answerer grants.

## Interaction seam and rationale

The approval answerer grants (`allowed-once`) and records rather than prompting y/N, because interactive approval input needs an input-routing seam between the REPL loop (idle while the agent runs) and the renderer that the current io bridge does not model. Grants are visible in the transcript; the sandbox and permission presets still bound what a tool may touch. Interactive y/N approval is deferred (see Consequences).

JSX compiles with the **classic runtime** in `packages/ui/cli` because source-launch `tsx` (esbuild) does not honor `tsconfig` `jsx`, so components import `React` explicitly and the built lib matches; client packages keep `react-jsx` under their own tsconfigs.

## Alternatives considered

**Ink vs hand-written ANSI** — ink chosen: same as Claude Code, Vercel-maintained, peer React 18 already in the workspace, declarative yoga layout; the driver/renderer seam keeps ink swappable for a plain renderer if a raw-mode conflict ever surfaces.

**One bundle with an embedded UI** — rejected: the driver must stay ink-free to run transcript tests with an injected io; a separate `packages/ui/cli` keeps the renderer's contract owner explicit.

**View types owned by the driver** — rejected: the driver importing UI types and the UI importing driver io would cycle; the renderer owns the view contract and the driver depends on it.

## Consequences

`dsh cli` gives a Claude Code-style terminal session: streaming assistant text, tool cards, status bar, session list/resume/switch, model switching, and permission toggling. `dsh --profile headless` and `dsh web` are unchanged. The reintroduction conditions from the TUI removal note are met: named product (`dsh cli`), explicit boundary (`bundle/cli` + `ui/cli`), a concrete interaction provider (driver + approval answerer), and assembled lifecycle with transcript acceptance.

The approval stance defaults to granting with an on-screen record; interactive y/N prompting is deferred until the input-routing seam exists. The plain-output mode is best-effort for CI and loses streaming fidelity by design.

## Verification

- Unit: `line.ts` parsing, `view.ts` reduceView folding, `run.ts` REPL routing (prompts, built-ins, `/session` list/switch, app command dispatch), `keys.ts` Ctrl+C classification, ink frame rendering over a fixed view store.
- Loader-smoke: boots the real `cli` profile from `apps/cli` and exits cleanly on a closed stdin; prints `dsh cli --help`.
- Manual: `dsh cli` interactive TUI renders and exits on `/exit`; `/model` and `/permission` mutate the session under a pseudo-terminal.
