# Agent Note: 交互式终端 CLI（`dsh cli`）

Status: implemented

[English](2026-08-14-cli-interactive-terminal.md) | 中文

## 问题

DeepSeek Harness 此前有两种 CLI 形态：`dsh --profile headless "task"`（一次性 runner）和 `dsh web`（浏览器 UI）。缺少终端交互入口——[TUI 移除](../simplification/2026-08-04-remove-tui-package.md)让 Web 成为唯一的交互界面，并要求以"具名产品、显式包边界、具体交互 provider、组装生命周期与 transcript 验收"为前提才可重新引入。用户需要 Claude Code / Codex 风格的本地 REPL：底部输入栏 + 滚动 transcript + 流式 token + 工具卡 + 会话恢复 + 权限控制。

## 决策

新增 `cli` profile（`dsh cli`），组合在 `dsh-base` 之上，拆成两个包、中间是 driver/renderer 接缝：

- **`@deepseek-ai/dsh-cli`**（`packages/bundle/cli/`）——ink 无关的 REPL 驱动。解析目标会话（当前 cwd 的最新会话、`--resume <id>` 或全新），把视图存储订阅到该 agent 的 `session/event` 事件流，并运行主循环：读一行 → 分流（内置 `/exit /help /clear /session`、应用命令 `/model /permission`、或经 `agent.followup` 的普通 prompt）→ 停稳 → flush。会话切换（`/session <id>`）先恢复目标（失败时当前 agent 不受影响），再 flush 并 dispose 旧句柄、重绑事件流。明文 io 用**缓冲行队列**读 stdin——单个 pending 槽会在某条 slash 命令 await 设置写入期间丢掉到达的行。
- **`@deepseek-ai/dsh-cli-ui`**（`packages/ui/cli/`）——ink 渲染层。拥有终端视图契约（`CliViewItem` / `CliViewState`），因此驱动依赖渲染层的契约而非反之。`createInteractiveIo` 把驱动的 `nextLine` 桥到输入栏；ink 树用 `useSyncExternalStore` 订阅。审批回答者对每次 ask 放行一次并在视图中记录。

驱动保持渲染器无关且可注入（`nextLine` + 视图存储），因此 transcript 逻辑无需终端即可被单测覆盖，组装后的 profile 由 keyless loader-smoke 覆盖。`dsh-cli-ui` 的视图桥用 `useState` + `useEffect` 订阅而非 `useSyncExternalStore`：在 ink 的 React reconciler 下外部 store 的 subscribe hook 从未被注册（观察到 `emit` 时 listeners 为 0），视图变更不会触发重渲染。

**CLI 参数**（`--model`、`--provider`、`--cwd`、`--resume <latest|fresh|id>`、`--permission <read-only|workspace-write|danger-full-access>`、`--no-interactive`、`--verbose`）由 `cli-startup` provider 解析并发布 `ctx.cliStartup`。cli patch 把审批策略绑定到 `ctx.cliStartup.permission`：`danger-full-access` 关闭提问，其余 preset 提问且由回答者放行。

## 交互接缝与理由

审批回答者放行（`allowed-once`）并记录而非 y/N 交互式提问，因为交互式审批输入需要 REPL 主循环（agent 运行时空闲）与渲染层之间的一条输入路由接缝，而当前 io 桥没有建模它。放行在 transcript 中可见；sandbox 与权限 preset 仍限制工具可触及的范围。交互式 y/N 审批暂缓（见后果）。

JSX 在 `packages/ui/cli` 中用 **classic runtime** 编译，因为源码启动的 `tsx`（esbuild）不读取 `tsconfig` 的 `jsx`，组件因此显式 `import React`，built lib 与之匹配；client 包在自己 tsconfig 下保持 `react-jsx`。

## 备选方案

**ink vs 手写 ANSI**——选 ink：与 Claude Code 同款、Vercel 维护、workspace 已有 React 18 peer、声明式 yoga 布局；driver/renderer 接缝保证若将来出现 raw mode 冲突可换普通渲染器而驱动不变。

**单 bundle 内嵌 UI**——拒绝：驱动必须保持无 ink 才能用注入 io 跑 transcript 测试；独立 `packages/ui/cli` 让渲染契约的拥有者明确。

**视图类型由驱动拥有**——拒绝：驱动 import UI 类型、UI import 驱动 io 会成环；渲染器拥有视图契约，驱动依赖它。

## 后果

`dsh cli` 提供 Claude Code 风格的终端会话：流式 assistant 文本、工具卡、状态栏、会话列表/恢复/切换、模型切换与权限开关。`dsh --profile headless` 与 `dsh web` 不变。TUI 移除 note 的重引入条件均满足：具名产品（`dsh cli`）、显式边界（`bundle/cli` + `ui/cli`）、具体交互 provider（驱动 + 审批回答者）、组装生命周期与 transcript 验收。

审批姿态默认放行并屏幕记录；交互式 y/N 提问在输入路由接缝存在前暂缓。明文输出模式对 CI 尽力而为，按设计放弃流式保真。

## 验证

- 单元：`line.ts` 行解析、`view.ts` reduceView 归约、`run.ts` REPL 路由（prompt、内置命令、`/session` 列表/切换、应用命令分派）、`keys.ts` Ctrl+C 分类、固定视图存储上的 ink 帧渲染。
- Loader-smoke：从 `apps/cli` 真实启动 `cli` profile，stdin 关闭时干净退出；打印 `dsh cli --help`。
- 手动：`dsh cli` 交互 TUI 渲染并在 `/exit` 退出；伪终端下 `/model` 与 `/permission` 修改会话。
