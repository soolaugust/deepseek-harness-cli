# `@deepseek-ai/dsh-cli-ui`

English | [中文](README.zh.md)

The dsh interactive terminal renderer. An [ink](https://github.com/vadimdemedes/ink) application over the REPL view store: a scroll region, a bottom input bar, tool cards, a status bar, and the terminal-side approval / user-question providers. It owns the terminal view contract (`CliViewItem` / `CliViewState`) so the driver in [`@deepseek-ai/dsh-cli`](../../bundle/cli/README.md) depends on the renderer's contract, not the reverse.

The renderer is a pure projection of the view store to terminal frames: the driver writes `session/event` folds into the store and the ink tree subscribes with `useSyncExternalStore`. The renderer itself holds no agent or session handles; it renders whatever the store exposes and forwards input lines to the driver.

## Model Experience

None, as the renderer never reaches the model; it renders the view store and answers approvals through the interaction seams.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **Terminal-only** — the TUI needs a terminal; use `dsh cli --no-interactive` for plain output in CI.
- **Ink requires a tty for raw mode** — non-tty stdout falls back to the driver's plain io.
