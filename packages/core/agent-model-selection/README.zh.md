# @deepseek-ai/dsh-agent-model-selection

[English](README.md) | 中文

运行时入口点共享的进程内、按 Agent 的模型选择。入口点把一份可变的 `ModelSelectionRef` 安装进每个 Agent 的作用域上下文；同进程消费者——注册表命令、UI handler——随后读取或切换该 live 选择，而无需持有私有 ref。

它与 [`@deepseek-ai/dsh-agent-default-model`](../agent-default-model/README.md) 不同：后者拥有新创建 Agent 的进程级默认值。默认值是本服务的 seed 和持久化兜底；本服务拥有会话级 live 选择，供 prompt 装配与请求路由在每一步读取。

- `ctx.agentModelSelection.install(agentCtx, seed?)` 把选择安装进未发布的 Agent 作用域并返回其 ref（按 Agent 幂等）。
- `ctx.agentModelSelection.ref(agent)` 读取某个确切 live Agent 的 live 选择，该入口点未安装时返回 `undefined`。

ref 以 Agent 为键存于 `WeakMap`，因此被释放 Agent 的选择无需显式 disposer 即可回收；install 添加的 `installModelSelection` 监听器随 Agent 作用域上下文一并 unwind。

## Model Experience

### Live `/model` 切换

#### 模型看到什么

修改 `ref.current` 在下一步的 prompt 装配与请求路由生效（provider 与 model 变量、请求配置）。并发切换不会劈裂两个表面：当前步保留装配时捕获的选择。

#### Token 影响

切换本身不增加模型 token；它改变下一次请求的 provider/model。

#### KV Cache 影响

切换 provider 或 model 会使后续步骤的请求前缀失效，与通过其他任何路径变更 provider/model 完全一致。

## Known Limitations and Deferred Work

- 本服务不校验目录成员资格。provider 路由可能服务一个未通告的模型，打开模型请求的消费者拥有可用性诊断（与 `agent-default-model` 相同立场）。
- Host ApiProxy 拥有自己的三层选择（`selectionFor`，带 session-log 兜底），不使用本服务。把它收敛进本服务属于延期项，而非驱动本抽取的 CLI 消费者所必需。
