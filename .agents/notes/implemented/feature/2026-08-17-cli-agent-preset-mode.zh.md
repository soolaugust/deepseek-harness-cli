# Agent Note: CLI 中的 agent preset 模式

Status: implemented

[English](2026-08-17-cli-agent-preset-mode.md) | 中文

## 问题

Web 界面为每个会话选择 **agent preset**：`standard`、`code`、`celery` 或 `memory-os`，每个 preset 都是为该会话的 agent 挂载的一个稳定的 Cordis 组合（工具、生命周期、system prompt）。[交互式 CLI](../feature/2026-08-14-cli-interactive-terminal.md) 没有对应的能力——`@deepseek-ai/dsh-cli` 的会话总是运行宿主组合，用户无法选择哪个 agent persona 驱动终端会话。这个缺口不只是缺一个 flag：组合在 agent 创建时决定（它写入会话头与稳定挂载），而且在一个会话确立某 persona 的工具之前，丢失或记错的选项必须可恢复。

## 决策

为 CLI 增加 agent preset 模式切换，镜像 Web 侧的 `composeAgent`——由 agent preset 清单服务（`@deepseek-ai/dsh-agent-presets`）提供 preset，并在 profile 未组合任何 preset 时保持 CLI 行为不变。

**表面**。`dsh cli --mode <id>` 为新建会话选择 preset；`/mode` 列出清单中的 preset id，`/mode <id>` 切换仍为 blank 的活动会话（`mode → <id>`），或在清单拒绝或会话已开始时提示 `no such mode: <id>`。状态栏显示 `mode: <id>` 徽标。

**创建**（`composeFrom`）：当部署挂载了清单服务（`ctx.get('agentPresets')`）时，runner 解析请求的 preset（`presets.resolve`）、把解析出的 id 记入会话 `meta.agentPreset`，并包装 agent `setup` 以先运行基础模型选择 setup 再 `presets.mount(agentCtx, resolvedId)`。先 resolve 再创建镜像了 Web 的 `composeAgent`，使会话头命名真实的 preset；在 `setup` 内挂载则可在组合不可用时回滚整个创建。没有清单的 profile 不组合任何内容——`composeFrom` 原样返回基础 setup，正是 preset 存在前 `dsh cli` 的行为。

**恢复** 从**事件日志**而非会话头解析 preset：`load` 待恢复的会话，运行 `resolveSessionPreset` 读取最新的 `agent-preset/selected` 记录（否则读会话头），再组合之。这让在 blank 期间被切换的会话以其较新的 persona 恢复——与 Web 端和 model-visible ⟺ logged 规则同理。

**实时切换**（`selectAgentMode`）遵循 blank 会话门：一旦存在 `turn/start`，历史是在该 preset 的工具下产生的、无法重新链接，因此已开始的会话剧绝切换。成功时 `recompose` 把活动 agent 重链到目标 preset 的稳定组合，并仅在交换提交后才向日志追加 `agent-preset/selected`——日志表达的是 agent 当前运行所用的 preset。

## 备选方案

**默认完全对齐 Web（CLI profile 挂载清单）** ——本变更中被否决。它会翻转出厂默认（基于 turn 的 `dsh cli` 开始组合 preset），且要做得干净需要 profile 层的基础拆分，以避免 preset 所有的那几行（`agent-preset`，以及 `dsh-base` 已按 agent 提供的 skill/tool/plan 行）重复。影响面更大；已延后（见后果）。

**清单按硬编码 id 取键** ——被否决：`--mode`/`/mode` 走清单自己的 `resolve`，默认值与行为保持显式（`resolve(request)`，而非隐式的 `?? default`），符合显式默认约定。

## 后果

`dsh cli -m/--mode <id>` 与 `/mode` 以 Web 的 blank 门与日志恢复语义在 CLI 上呈现 agent preset 选择。机制是可选启用的：若 profile 没有 agent-presets 行，`--mode` 与 `/mode` 无效，`dsh cli` 完全按先前运行——因此本变更对当前交付的 profile 零风险上架。

清单挂载选项（在 cli bundle 加一个 `agent-presets` 行从而默认激活模式选择）**经实测后否决**：出厂 preset 都无法在终端宿主上稳定组合。`standard`、`code`、`celery`、`cordis`、`memory-os` 各自组合失败（其工具行等待 `tools`、`shell`、`fs`、`systemPrompt` 等宿主能力服务，而 CLI profile 不会把这些暴露给 preset 的稳定组合），自足的 `minimal` 也不稳定（`persona` 偶发等待 `systemPrompt`）。同样的 preset 在 Web 宿主（base + `web.cordis.yml`）上可靠组合，说明出厂 preset 是 Web 宿主组合；要让清单挂载默认可用，需要此处延后的 profile 层基础拆分，因此 CLI profile 暂时维持可选启用。

## 验证

- 单元：`run.spec.ts` 的 `/mode` 列出清单 id 并切换 blank 会话，对拒绝的目标提示 `no such mode`；视图 store 记录 `mode` 供状态徽标使用。
- Loader 冒烟（`smoke.e2e.ts`）：`dsh cli -m code` 在无清单的干净树上解析并运行（flag 无效），证明未挂载 preset 时该 flag 不会破坏组合。
- 清单挂载探针：向 cli bundle 添加 `agent-presets` 行（`default: standard`）并为每个出厂 preset 启动 profile——`standard`、`code`、`celery`、`cordis`、`memory-os`、`minimal`。除 `minimal` 外全部挂载失败（6–8 行工具等待宿主能力）；`minimal` 也只是间歇性挂载（`persona` 等待 `systemPrompt`）。同样的 preset 在 Web 宿主上都能挂载，确认缺口因宿主而异。
- 手动：在有清单的 profile 上 `dsh cli --mode code` 会以 `code` 创建会话；`/mode` 列出并切换 blank 会话、拒绝已开始的会话。
