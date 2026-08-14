# 交互式终端 CLI

[English](cli.md) | 中文

`dsh cli` 启动一个组合在 `dsh-base` 之上的 [cli profile](../architecture.md#profiles-and-bundles)，新增交互式终端 REPL，不挂载 Host 或浏览器层。两个包位于 driver/renderer 接缝上：[`@deepseek-ai/dsh-cli`](../../packages/bundle/cli/README.md) 驱动 agent，[`@deepseek-ai/dsh-cli-ui`](../../packages/ui/cli/README.md) 用 [ink](https://github.com/vadimdemedes/ink) 渲染。[交互式终端 Agent Note](../../.agents/notes/implemented/feature/2026-08-14-cli-interactive-terminal.md) 拥有该决策及其备选方案。

来源：[`packages/bundle/cli/src/index.ts`](../../packages/bundle/cli/src/index.ts)、[`packages/bundle/cli/src/run.ts`](../../packages/bundle/cli/src/run.ts)、[`packages/ui/cli/src/app.tsx`](../../packages/ui/cli/src/app.tsx)。

## 驱动

`cli-runner` 插件解析目标会话——当前工作目录的最新持久化会话、具名 id（`--resume <id>`）或全新会话（`--resume fresh`）——经 `ctx.agents` 创建或恢复，并把视图存储订阅到该 agent 的 `session/event` 事件流。REPL 主循环（`run.ts`）读一行、分流、每回合停稳后 flush：

- 普通 prompt 经 `agent.followup` 成为普通用户消息。
- 内置 slash 命令：`/exit`、`/help`、`/clear`、`/session`（列出已存会话，或以 `/session <id>` 切换）。
- 应用命令：`/model <model>` 持久化模型选择并注入模型可见通知；`/permission <ask|never>` 切换当前会话的审批策略。

驱动保持渲染器无关：它只消费 `nextLine` 源与视图存储，因此 transcript 逻辑可在脚本化 io 下跑单元测试。明文 io 用缓冲行队列读 stdin 并打印已提交的视图项；ink io 把输入栏桥接到 `nextLine`。

## 渲染层

`dsh-cli-ui` 拥有终端视图契约（`CliViewItem` / `CliViewState`）。ink 树用 `useSyncExternalStore` 投影视图存储：顶部滚动区展示会话尾部、状态栏（busy/idle、会话 id）、底部输入栏。流式 assistant 文本变更同一项；工具卡反映 running/done/error。审批回答者对每次 ask 放行一次并在视图中记录。

## 会话生命周期

每回合停稳后 flush。`/session <id>` 先恢复目标（失败时当前 agent 不受影响），再 flush 并 dispose 旧句柄、重绑事件流。`dsh cli` 默认恢复当前工作目录的最新会话，重开即可从上次会话继续。
