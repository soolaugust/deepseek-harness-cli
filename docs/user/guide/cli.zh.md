# 使用交互式终端 CLI

[English](cli.md) | 中文

`dsh cli` 像 shell 里的编码 agent 一样启动一个交互式终端会话：底部输入栏 + 滚动 transcript + 流式模型输出 + 工具卡。它默认恢复当前工作目录的最新会话，重开即可从上次会话继续。

## 启动

```sh
dsh cli
```

改为启动一个全新会话：

```sh
dsh cli --resume fresh
```

按 id 恢复指定会话：

```sh
dsh cli --resume session-xxxx
```

## 发送消息与使用 slash 命令

输入消息并按 **Enter** 发送给 agent。流式输出显示在输入栏上方。内置 slash 命令：

| 命令 | 作用 |
| --- | --- |
| `/exit` | 结束会话并退出 |
| `/help` | 显示帮助 |
| `/clear` | 清空 transcript |
| `/session` | 列出已存会话 |
| `/session <id>` | 切换到已存会话 |
| `/model <model>` | 切换本会话的模型 |
| `/permission <ask\|never>` | 切换审批提问姿态 |

agent 运行中按 **Ctrl+C** 取消当前回合；在提示符下按则退出。

## 使用自定义模型提供方

`dsh cli` 可运行任意 OpenAI 兼容端点。通过 `$DSH_HOME/settings.yaml`（Web UI 写入的同一文件）把内置 DeepSeek 适配器指向公司网关或自建服务器即可，无需改代码或额外插件。

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

三个要点：

- **`baseURL`** 是网关根地址；自动追加 `/chat/completions`。适配器说 OpenAI chat-completions 协议，因此网关必须暴露该端点。
- **模型 id 必须携带网关前缀。** 若网关映射 `vendor/model`，则 `models[].id` 与 `agent-default-model.model` 都必须是完整的 `vendor/model`，否则请求发送裸模型名会被网关拒绝。
- **key 在每次请求时从 `apiKeyEnv` 命名的环境变量解析**；key 缺失时以 `MISSING_CREDENTIAL` 失败，绝不静默。

改动在下一个请求即生效，无需重启。要切回，编辑 `settings.yaml` 或为单个会话传 `--model` / `--provider`。

## 配置网页搜索

`web_search` 工具是内置的，说 Anthropic 兼容 Messages API 并使用 `web_search_20250305` 服务端工具。把它指向同一网关的 Anthropic 端点（与 chat-completions base 分开），这样 LLM 路由用自定义 provider 时搜索也能工作。

```yaml
# $DSH_HOME/settings.yaml
web-search-deepseek:
  baseURL: https://gateway.example/anthropic/v1
  apiKeyEnv: GATEWAY_API_KEY
  model: vendor/model
```

key 缺失时以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败并指名 `apiKeyEnv` 引用——与模型路由相同的解析路径，因此没有独立搜索 key 的 LLM provider 需要其网关暴露 Anthropic 端点。

## 参数

| 参数 | 含义 |
| --- | --- |
| `--model <model>` | 覆盖本会话的模型 |
| `--provider <provider>` | 覆盖 provider |
| `--cwd <path>` | 会话工作目录 |
| `--resume <latest\|fresh\|id>` | 驱动哪个会话 |
| `--permission <read-only\|workspace-write\|danger-full-access>` | 权限 preset |
| `--no-interactive` | CI 明文输出模式 |

## 继续

- [Web UI](./index.md)
- [配置模型](./providers.md)
- [使用 Python SDK](./python-sdk.md)
