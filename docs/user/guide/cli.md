# Use the interactive terminal CLI

English | [中文](cli.zh.md)

`dsh cli` starts an interactive terminal session like a coding agent in your shell: a bottom input bar over a scrolling transcript, streaming model output, and tool cards. It resumes the latest session for the current working directory by default, so reopening continues where you left off.

## Start

```sh
dsh cli
```

Start a brand-new session instead:

```sh
dsh cli --resume fresh
```

Resume a specific session by id:

```sh
dsh cli --resume session-xxxx
```

## Send messages and use slash commands

Type a message and press **Enter** to send it to the agent. Stream output appears above the input bar. Built-in slash commands:

| Command | Effect |
| --- | --- |
| `/exit` | End the session and exit |
| `/help` | Show help |
| `/clear` | Clear the transcript |
| `/session` | List saved sessions |
| `/session <id>` | Switch to a saved session |
| `/model <model>` | Switch the model for this session |
| `/permission <ask\|never>` | Toggle the approval prompting stance |

**Ctrl+C** cancels the in-flight turn while the agent runs, and exits at the prompt.

## Use a custom model provider

`dsh cli` runs any OpenAI-compatible endpoint. Point the built-in DeepSeek adapter at a company gateway or self-hosted server through `$DSH_HOME/settings.yaml` (the same file the Web UI writes). No code changes or extra plugins are needed.

```yaml
# $DSH_HOME/settings.yaml
llm-deepseek:
  baseURL: https://gateway.example/v1
  apiKeyEnv: GATEWAY_API_KEY
  thinking: disabled
  models:
    - id: vendor/model
      name: vendor/model
      contextWindow: 128000
agent-default-model:
  provider: deepseek-official
  model: vendor/model
```

Three points to get right:

- **`baseURL`** is the gateway root; `/chat/completions` is appended automatically. The adapter speaks the OpenAI chat-completions protocol, so the gateway must expose that endpoint.
- **The model id must carry any gateway prefix.** A gateway that maps `vendor/model` needs the `models[].id` and `agent-default-model.model` to both be the full `vendor/model`, or the request sends the bare name and the gateway rejects it.
- **The key resolves from the environment** named by `apiKeyEnv` at each request; a missing key fails with `MISSING_CREDENTIAL`, never silently.

Changes take effect on the next request without restarting. To switch back, edit `settings.yaml` or pass `--model` / `--provider` for one session.

## Configure web search

The `web_search` tool is a built-in that speaks the Anthropic-compatible Messages API with the `web_search_20250305` server tool. Point it at the same gateway's Anthropic endpoint (separate from the chat-completions base) so searches work when the LLM route is a custom provider.

```yaml
# $DSH_HOME/settings.yaml
web-search-deepseek:
  baseURL: https://gateway.example/anthropic/v1
  apiKeyEnv: GATEWAY_API_KEY
  model: vendor/model
```

A missing key fails with `WEB_PROVIDER_CREDENTIAL_MISSING`, naming the `apiKeyEnv` reference — the same resolution path as the model route, so an LLM provider without a separate search key needs its gateway to expose the Anthropic endpoint.

## Flags

| Flag | Meaning |
| --- | --- |
| `--model <model>` | Override the model for this session |
| `--provider <provider>` | Override the provider |
| `--cwd <path>` | Working directory for the session |
| `--resume <latest\|fresh\|id>` | Which session to drive |
| `--permission <read-only\|workspace-write\|danger-full-access>` | Permission preset |
| `--no-interactive` | Plain output mode for CI |

## Continue

- [Web UI](./index.md)
- [Configure models](./providers.md)
- [Use the Python SDK](./python-sdk.md)
