# dsh cli — interactive terminal agent

English | [中文](README.zh.md)

`dsh cli` is an **interactive terminal agent**, forked from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) with a CLI focus: a [Claude Code](https://docs.anthropic.com/en/docs/claude-code)-style coding experience in your terminal — full-screen UI, streaming output, tool cards, session history, and permission controls, with no browser needed.

Under the hood it is DeepSeek Harness's plugin architecture ([everything is a plugin](https://github.com/cordiverse/cordis)), but this repository only cares about and polishes the single `dsh cli` interaction path.

## Features

- **Claude Code-style interaction**: full-screen alternate screen, input bar pinned to the bottom, up/down arrow history navigation (including cross-session persistent history)
- **Markdown terminal rendering**: bold, italic, code, lists, and headings rendered with terminal styles
- **Tool card folding**: adjacent tool calls merge into one line, expand with `Ctrl+O`
- **Session stats bar**: turns/steps, LLM time, first-token latency, throughput, cache hit rate, input/output tokens
- **Permission badge**: `Shift+Tab` cycles `read-only → workspace-write → danger-full-access`, with `danger-full-access` shown as "bypass permissions"
- **Custom provider**: point to any OpenAI-compatible endpoint (e.g. mify), with both model routing and `web_search` configurable
- **Session resume**: reopening `dsh cli` continues the last session, switch with `/session`
- **Hot-reload development**: `pnpm dsh:dev` (node --watch) auto-restarts on source changes

## Quick start

Requires Node.js ≥ 22.

```sh
# from source
git clone https://github.com/soolaugust/deepseek-harness-cli.git
cd deepseek-harness-cli
pnpm install
pnpm run build
pnpm dsh cli
```

From npm:

```sh
npx @deepseek-ai/dsh cli
```

The first launch creates/resumes a session; type text and press Enter to send, and model output renders streaming above the input bar.

## Usage

| Action | Effect |
| --- | --- |
| Type text + `Enter` | Send to the agent |
| `↑` / `↓` | History navigation (cross-session persistent) |
| `Shift+Tab` | Cycle permission preset |
| `Ctrl+O` | Expand/collapse tool group |
| `Ctrl+C` | Cancel current turn while running; quit at the prompt |
| `/exit` `/help` `/clear` `/session` `/model` `/permission` | Slash commands |

Full instructions in the [CLI guide](docs/user/guide/cli.md).

## Configuring a custom provider

Point `~/.dsh/settings.yaml` at any OpenAI-compatible endpoint (e.g. mify, OpenRouter); both model routing and `web_search` are configurable. See [CLI guide · Using a custom model provider](docs/user/guide/cli.md#use-a-custom-model-provider).

## Development

```sh
pnpm dsh:dev          # auto-restart on source changes (hot-reload development)
pnpm run test         # unit tests
pnpm run typecheck    # type checks
```

## Inherited from DeepSeek Harness

This repository is a fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) focused on its `dsh cli` interactive terminal capability. The full multi-profile architecture, Web UI, SDK, and more remain in the [upstream repository](https://github.com/deepseek-ai/deepseek-harness).

## License

[MIT](LICENSE)
