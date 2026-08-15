# @deepseek-ai/dsh-command-model

[English](README.md) | 中文

面向用户的 `/model` 控制，作用于按 Agent 的模型选择。该插件通过 [`ctx.commands`](../../interaction/commands/README.md) 注册一个全局命令，因此每个已组合的命令适配器都能发现并执行它，无需模型轮次。

切换接受自由文本 model id，与 CLI 此前的 `/model` 表面对齐。目录支撑的选择器仍仅限 client 侧：host 命令平面没有目录 UI，且 host 不校验目录成员资格。

## Command contract

| 输入 | 结果 |
|---|---|
| `/model` | 显示当前 `provider/model` 与用法。 |
| `/model <model-id>` | 切换接收 Agent 的 live 选择（下一步的 prompt 装配与请求路由）并持久化为未来默认值。 |

一次切换通过模型选择服务写入两个权威状态，与 Host `session.selectModel` 执行的两次写入相同：按 Agent 的 live 选择（`agentModelSelection.ref(agent).current`）与持久化默认值（`agentDefaultModel.saveSelection`）。provider 保留当前选择（无选择时取默认值），因此切换在重命名模型的同时不丢失路由。

## Composition

生产者注入 `commands`、`agentModelSelection`、`agentDefaultModel`。自定义 app 挂载它们的所有者再加本插件：

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: agent-model-selection
  name: '@deepseek-ai/dsh-agent-model-selection'
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
- id: command-model
  name: '@deepseek-ai/dsh-command-model'
```

## Model Experience

### Human `/model` control

#### 模型看到什么

斜杠输入与直接的 status/output 文本不进入模型请求。切换在下一次请求的 provider 与 model 生效；它不作为消息注入。

#### Token 影响

切换模型本身不增加模型 token；它改变下一次请求的 provider/model。

#### KV Cache 影响

切换 provider 或 model 会使后续步骤的请求前缀失效，与通过其他任何路径变更 provider/model 完全一致。

## Known Limitations and Deferred Work

- **自由文本 model id，无目录** — host 命令平面不枚举也不校验模型；目录支撑的选择器仍仅限 client 侧。
- **仅限安装过选择的入口点** — 未调用 `agentModelSelection.install` 的入口点（例如自行持有选择的 Host ApiProxy）会得到直接的 `unavailable` 错误。
