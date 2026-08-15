# Agent Note: CLI 消费共享命令注册表

Status: implemented

[English](2026-08-15-cli-consumes-command-registry.md) | 中文

## Problem

CLI REPL 驱动（`@deepseek-ai/dsh-cli`）在 `run.ts` 与 `index.ts` 里硬编码了六个斜杠命令——`/exit`、`/help`、`/clear`、`/session` 作为内置命令，`/model`、`/permission` 放在一个 `Record<string, handler>` 里——却从不读取其他所有交互式适配器都在消费的 base 层 `ctx.commands` 注册表（`@deepseek-ai/dsh-commands`）。`commands` 这一行挂在 `base/cordis.patch.yml`，所以它不是 web 专属服务；是 CLI 选择了一具手工打造的薄壳。

这个旁路带来了三个缺陷：

1. **已注册命令静默失效。** `command-compact`、`command-goal`、`command-feedback` 在 `ctx.commands` 上注册了 `/compact`、`/goal`、`/feedback`；但 CLI 驱动从不查询注册表，因此输入其中任何一个都会打印 `unknown command`，尽管对应插件已经加载。goal-command 的 README 甚至把这一点记为已知缺口（"随附应用中只有 Web 命令适配器使用此命令"）。
2. **`/permission` 语义漂移。** `permission-presets` 注册的 `/permission` 命令切换 sandbox-mode + approval-policy 预设（`read-only` / `workspace-write` / `danger-full-access`），而 CLI 硬编码的 handler 只接受 `ask | never` 并单独改写 approval policy。同名命令在两个界面上含义不同，用户往 CLI 里敲一个预设名会被拒绝。
3. **`/model` 切错了对象。** CLI handler 调用了 `agentDefaultModel.saveSelection`（持久化未来默认值）并注入一条 `[system] Model switched to …` 消息，却从未更新当前 agent 的 `ModelSelectionRef.current`，于是当前会话仍沿用原模型，"切换"只是持久化的默认值加一条伪造的模型可见提示。

## Decision

REPL 通过一个 fallback 槽位消费注册表，而不是再造一套自己的命令面：

- `run.ts` 在 `CliReplDeps` 上新增可选的 `runCommand(raw)` 依赖。`default` 分发分支按顺序解析：内置命令 → `deps.commands`（下方唯一由驱动持有的命令）→ `deps.runCommand(raw.trim())` → `unknown command`。传入 trim 后的行让注册表自己的 `parseCommand` 能解析它。
- `index.ts` 从 `ctx.get('commands')` 构造 `runCommand`：它调用 `commandsRegistry.execute(agent, raw, signal)`，把 settle 后的 `CommandExecution.result.text` 映射成一条视图提示，注册表未解析该行时返回 `undefined`。注册表命令因此像其他适配器一样记录自己的 `command/run` / `command/done` 生命周期。
- 删除硬编码的 `/permission` handler。`/permission` 现在走注册表，解析到 `permission-presets` 命令及其真实的预设语义。
- `/model` 保留在驱动内，因为它需要驱动持有的会话级 `ModelSelectionRef`，而注册表 handler 够不到。其 handler 已修复：更新共享的 `selectionRef.current`（使当前及之后 resume 的 agent 都用新模型）并通过 `saveSelection` 持久化，去掉 `[system]` 注入。

`selectionSetup` 辅助函数被替换为单个共享的 `selectionRef`，安装到每一个创建/resume/切换的 agent 上，与 CLI 的会话级模型语义一致。

## Alternatives considered

- **让 `/model` 也走注册表**（新增一个在 `ctx.commands` 上注册的 `command-model` 插件）：暂缓——目前没有 host 侧模型命令（web 的 `/model` 是 client 侧 `commandUi` popupSelect），且注册表 handler 拿不到驱动的 `ModelSelectionRef`，因此要切换*当前* agent 需要一个 host 侧、agent 作用域的模型选择服务，而两个入口点目前都不暴露它。这条 seam 属于模型选择重构，而非本次命令面修复。
- **保留全部硬编码命令、只是手工补齐缺失项**：否决——这延续了旁路，保留了 `/permission` 漂移，并丢掉注册表的 descriptor 与生命周期日志。
- **把注册表的 `list`/`find` 挂进驱动并重写分发**：否决——`execute` 已经完成解析、解析、日志与归一化；重写其中任何一部分都是重复注册表行为。

## Consequences

- CLI 用户现在能运行 `/compact`、`/goal`、`/feedback`、`/permission`，这些命令走与 web 适配器相同的 `command/run` / `command/done` 日志路径。
- `/permission` 在所有地方含义统一：通过 `permission-presets` 做预设切换。
- `/model` 真正切换会话模型，并停止往会话日志写入伪造的 `[system]` 消息；模型可见历史现在只反映真实用户输入。
- 在 host 侧模型选择服务出现之前，`/model` 仍是驱动持有命令；通往该重构的路径写在了代码注释里，而非被隐藏。
