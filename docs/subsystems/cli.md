# Interactive Terminal CLI

English | [中文](cli.zh.md)

`dsh cli` boots a [cli profile](../architecture.md#profiles-and-bundles) composed over `dsh-base`, adding an interactive terminal REPL with no Host or browser layer. Two packages sit on the driver/renderer seam: [`@deepseek-ai/dsh-cli`](../../packages/bundle/cli/README.md) drives the agent, and [`@deepseek-ai/dsh-cli-ui`](../../packages/ui/cli/README.md) renders it with [ink](https://github.com/vadimdemedes/ink). The [interactive-terminal Agent Note](../../.agents/notes/implemented/feature/2026-08-14-cli-interactive-terminal.md) owns the decision and its alternatives.

Sources: [`packages/bundle/cli/src/index.ts`](../../packages/bundle/cli/src/index.ts), [`packages/bundle/cli/src/run.ts`](../../packages/bundle/cli/src/run.ts), and [`packages/ui/cli/src/app.tsx`](../../packages/ui/cli/src/app.tsx).

## Driver

The `cli-runner` plugin resolves the target session — the latest persisted session for the working directory, a named id (`--resume <id>`), or a fresh one (`--resume fresh`) — creates or resumes it through `ctx.agents`, and subscribes the view store to the agent's `session/event` feed. The REPL loop (`run.ts`) reads a line, routes it, and settles each turn to quiescence before flushing:

- A plain prompt becomes an ordinary user message via `agent.followup`.
- Built-in slash commands: `/exit`, `/help`, `/clear`, and `/session` (list saved sessions, or switch with `/session <id>`).
- App commands: `/model <model>` persists a model selection and injects a model-visible notice; `/permission <ask|never>` switches the approval policy for the live session.

The driver is renderer-agnostic: it only consumes a `nextLine` source and the view store, so the transcript logic runs under unit tests with a scripted io. The plain-output io reads stdin through a buffered line queue and prints committed view items; the ink io bridges the input bar to `nextLine`.

## Renderer

`dsh-cli-ui` owns the terminal view contract (`CliViewItem` / `CliViewState`). The ink tree projects the view store with `useSyncExternalStore`: a scroll region over the trailing conversation, a status bar (busy/idle, session id), and a bottom input bar. Streaming assistant text mutates one item; tool cards reflect running/done/error. The approval answerer grants each ask once and surfaces it as a view notice.

## Session lifecycle

Each round-trip settles to quiescence and flushes. `/session <id>` resumes the target first (leaving the current agent untouched on failure), then flushes and disposes the previous handle and rebinds the event feed. `dsh cli` resumes the latest session for the current working directory by default, so reopening continues where the last session stopped.
