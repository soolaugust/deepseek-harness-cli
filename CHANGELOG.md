# Changelog

## 0.1.0 (2026-08-17)

The first stable release of `dsh cli` — an interactive terminal agent with a
Claude Code-style experience. Everything below landed since the fork's
developer-preview period.

### Interactive terminal UI (`dsh cli`)

- **Full-screen alternate-screen UI** — the transcript owns the whole terminal,
  the input bar stays pinned at the bottom, and the mouse wheel scrolls the
  output (SGR mouse mode), with Shift+drag to select text. Mouse mode is
  disabled cleanly on exit so the shell's own wheel scrolling returns.
- **Keyboard navigation** — PgUp/PgDn page the transcript; ↑/↓ stay with the
  input for history navigation; `Shift+Tab` cycles the permission preset.
- **Fixed input bar** with a visible cursor, durable prompt history across
  sessions, and up/down history navigation.
- **Markdown terminal rendering** — bold, italic, code, lists, and headings
  render with terminal styles. Streaming output renders progressively, so raw
  `##`/`**` markup never flashes before the final style snaps in.
- **Collapsible tool runs** — adjacent tool calls merge into one `⇣ n tools`
  row, expandable with `Ctrl+O`.
- **Session stats bar** — turns/steps, LLM and tool wall time, first-token
  latency, throughput, cache hit rate, and input/output tokens.
- **Permission badge** — `Shift+Tab` cycles `read-only → workspace-write →
  danger-full-access`; the current preset is shown under the input bar.

### Virtualized transcript

- **Row-level, CJK-aware line layout** replaces ink's fixed-height clipping,
  which mis-wrapped wide glyphs once content overflowed. Long transcripts
  scroll smoothly and correctly in any width.
- **Fresh-by-default session choice** — `dsh cli` starts a brand-new session;
  `dsh cli --resume` (or `--resume <id>`) resumes one, matching Claude Code.

### Celery reliability harness

- **`tool-celery-harness`** — six deterministic checks (goal gate, verifier
  calibration, online telemetry, decision classification, methodology
  fixation, exploration convergence) run through the subprocess seam as
  model-facing tools.
- **`reliability-guard`** — a loop-boundary guard expressing the celery four
  parameters (β/ρ/C/p₁): consecutive-failure attribution reminders, an
  optional goal gate before write tools, and optional harness-rule prompt
  injection.
- **`celery` preset** — the standard coding agent plus the two packages,
  selectable via `~/.dsh/settings.yaml` (`agent-presets.default: celery`).

### Development

- **Hot reload** — `pnpm dsh:dev` (node --watch) restarts on source changes.
- **Stable bilingual documentation** — README, guide, and API docs maintain
  matched English/Chinese pairs with pairing-gate enforcement.
