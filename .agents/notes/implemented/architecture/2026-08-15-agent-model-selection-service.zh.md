# Agent Note: Agent 作用域模型选择服务与注册表 /model

Status: implemented

[English](2026-08-15-agent-model-selection-service.md) | 中文

## Problem

CLI 接入命令注册表之后，`/model` 命令仍硬编码在驱动里（见[命令注册表 note](2026-08-15-cli-consumes-command-registry.md)），因为切换 live 模型需要驱动的私有 `ModelSelectionRef`。注册表 handler 够不到那个 ref，所以最后一个驱动持有命令无法像 `/permission` 那样进入注册表。该 seam 在那里被记为延期项。

更深层的问题是，按 Agent 的模型选择根本不是服务：三个运行时入口点各自用 `installModelSelection` 上的私有闭包重复推导——CLI 驱动（`selectionRef`）、headless 运行器（一次性 `selection`）、Host ApiProxy（`selections` WeakMap + 带三层 getter 的 `selectionFor`）。一个想切换 live 选择的同进程消费者没有共享的地方可做这件事。

## Decision

新服务 `@deepseek-ai/dsh-agent-model-selection` 在 `WeakMap` 里按 Agent 持有一个 `ModelSelectionRef`。`install(agentCtx, seed?)` 把选择装进未发布的 Agent 作用域（按 Agent 幂等）并返回 ref；`ref(agent)` 读取某个确切 live Agent 的 live 选择，该入口点未安装时返回 `undefined`。`WeakMap` 键意味着被释放 Agent 的选择无需 disposer 即可回收；install 添加的 `installModelSelection` 监听器随 Agent 作用域 unwind。

新命令插件 `@deepseek-ai/dsh-command-model` 在 `ctx.commands` 上注册 `/model`。其 handler 读取 `agentModelSelection.ref(invocation.agent)` 并写入 Host `session.selectModel` 也写入的两个权威状态：live 选择（`ref.current`）与持久化默认值（`agentDefaultModel.saveSelection`），provider 保留当前选择。它接受自由文本 model id，与 CLI 此前的表面对齐；目录支撑的选择器仍仅限 client 侧。当入口点未安装选择（例如自行持有选择的 Host ApiProxy）时，命令返回直接 `unavailable` 错误。

CLI 驱动删掉硬编码 `/model` handler 及其私有 `selectionRef`：其 `setup` 现在调用 `modelSelection.install(agentCtx, agentOptions)`，`/model` 走此前变更建好的注册表 fallback。两个新行都挂进 base bundle（`agent-model-selection` 在 `agent-default-model` 旁，`command-model` 在 `command-compact` 旁），因此 CLI 继承它们，而 web 表面不受影响（其 `/model` 是 client 侧 `commandUi` popup，不是 `ctx.commands`）。

## Alternatives considered

- **把按 Agent 选择并入 `agent-default-model`**：否决——该服务拥有新创建 Agent 的进程级默认值；按 Agent 的 live 选择是另一条轴，prompt 装配每步读取它，默认值是它的 seed 与兜底，而非其身份。
- **现在把 Host ApiProxy 的 `selectionFor` 迁入本服务**：延期——`selectionFor` 的 getter 在进程内 pick 与默认值之间折叠了 session-log `requestHeader()` 兜底，其图片准入读取依赖这个三层解析。收敛它是另一项变更；CLI 消费者不要求它。
- **注册表命令只切换默认值（`agentDefaultModel.saveSelection`）**：否决——那会重演原始 `/model` 不切换 live agent 的 bug；命令必须触达按 Agent 的 ref。
- **把 `/model` 留在驱动**：否决——这正是本变更要消除的旁路；共享服务才是注册表 handler 需要的 seam。

## Consequences

- CLI 不再有驱动持有的斜杠命令：`/exit` `/help` `/clear` `/session` 是终端内置，`/model` `/permission` `/compact` `/goal` `/feedback` 全部通过注册表解析，拥有与 web 适配器相同的 `command/run`/`command/done` 生命周期。
- `installModelSelection` 的三处私有重复推导现在有了一个服务；CLI 与 headless 入口点通过它安装（headless 迁移是机械的后续项，未在此完成）。
- Host ApiProxy 仍持有自己的选择；该服务与那个私有 `selectionFor` 共存，直到未来的收敛，记录在包 README 的 deferred work 里。
- `/model` 现在在命令平面上处处接受自由文本 id；目录支撑的选择器仍是 client UI 的独立表面。
