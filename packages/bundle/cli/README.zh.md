# `@deepseek-ai/dsh-cli`

[English](README.md) | 中文

dsh 交互式终端组合包。[`cordis.patch.yml`](cordis.patch.yml) 直接叠加在 [`dsh-base`](../base/README.md) 之上：提供编码 persona 和工具模式、禁用 HMR（热模块替换）、将 Code Mode 的 worker 作为核心执行能力挂载，并插入本包的 `cli-startup` 提供方和 `cli-runner` 插件。它不挂载任何 Host、HTTP server、Web runtime 或浏览器插件。

Loader 结算后，runner 解析本次调用要驱动的会话——当前工作目录的最新持久化会话、具名 id（`--resume <id>`）或全新会话（`--resume fresh`）——通过 `ctx.agents` 创建或恢复它，把视图存储订阅到该 agent 的 `session/event` 事件流，并驱动 REPL 直到用户输入 `/exit`。每个提示作为普通用户消息经 `agent.followup` 提交；每回合停稳后、下一个提示前对 Session 执行 flush。终端渲染是一个可注入的 io：本包携带明文 io（读 stdin、打印已提交的视图项，供 `--no-interactive` 使用），ink TUI io 在 [`@deepseek-ai/dsh-cli-ui`](../../ui/cli/README.md)。退出请求经启动器提供的 `ctx.appExit` 宿主钩子（[`dsh-cmdline`](../../boot/cmdline/README.md)）。

## 模型体验

无影响，因为 runner 把提示作为普通用户消息提交；提示词与工具由 base 和 cli 组合包中的相应条目提供。

#### KV Cache 影响

无；runner 不向请求前缀添加任何内容。

## 已知限制与暂缓事项

- **同时只存在一个活动 agent**：切换会话会先 dispose 当前 agent 再恢复下一个；不并发运行多个 agent。
- **`ctx.appExit` 由启动器持有**：在 `dsh` 启动器之外启动 cli profile 会在激活时明确报错，直到宿主提供该退出请求。
- **交互 io 是 ink TUI**：没有终端（管道 stdin）时使用 `--no-interactive` 获得稳定的明文输出。
