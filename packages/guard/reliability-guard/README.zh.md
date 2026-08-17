# @deepseek-ai/dsh-reliability-guard

[English](README.md) | 中文

这是一个可靠性缰绳 guard，把 celery 缰绳契约——四个失败归因参数 β（校验器宽松度）、ρ（路径漂移）、C（目标上下文）、p₁（单次成功率）——表达在循环边界。它在一个始终开启的观察器之上叠加三个可选行为：

- **连续失败提醒（始终开启）。** 它监视每个 agent（智能体）的工具调用流，统计同一工具连续失败的次数；达到 `repeatThreshold`（默认 3）时，注入一条 `notice` 形式的提醒，逐项梳理四个归因轴。该提醒从不改写调用；模型保留最终决定权（标定校验器、拆分检查点、重述目标或换一种方式重试）。
- **目标门（可选开启）。** 当 `enforceGoalGate` 开启时，一个单调的 `ctx.tools.guard` 会拒绝所有写操作工具的调用，直到该 agent 的日志中出现由 `goalMarker`（默认 `GOAL:`）标记的模型目标声明。声明后，该 agent 的门保持开启。
- **提示注入（可选开启）。** 当 `injectPrompt` 开启时，每个 agent 的第一步 pre-step 会收到一条 `instructions` 形式的上下文，内容为缰绳规则：执行前先定义 L0 校验器、拆分为可验证检查点、沿 β/ρ/C/p₁ 归因失败、写操作前先声明目标。

guard 从不添加面向模型的工具，也从不改写调用的内容。它只观察工具结果、在门关闭时拒绝写工具调用，并注入上下文。

## 配置

```yaml
- id: reliability-guard
  name: '@deepseek-ai/dsh-reliability-guard'
  config:
    enforceGoalGate: false      # deny write tools until the goal is stated
    repeatThreshold: 3          # consecutive failures that trigger the reminder
    injectPrompt: false         # inject the harness rules into the model prompt
    writeTools: []              # write-tool name patterns; empty ⇒ built-in default set
    goalMarker: 'GOAL:'         # text that marks a model goal statement
```

插件加载时，`repeatThreshold` 会对错误配置快速失败：非整数或小于 1 的值都会抛出错误，绝不静默回退到默认值；`goalMarker` 同样拒绝空值。

`writeTools` 条目支持 `*` 通配符，将工具名分类为写操作，供目标门使用。空值使用内置集合（`bash`、`pwsh`、`write`、`edit`、`apply_patch`、`patch`、`rename`、`mkdir`、`rm`、`fs_write`、`fs-write`、`fs_*`、`fs-*`）。与当前任何已注册工具都不匹配的模式并非错误——门是在调用时对工具名执行谓词判断，而不是引用注册表条目。

## 连续失败链

链键是失败的「工具名」，按活跃 agent 对象分别跟踪。同一工具连续失败时，该 agent 的计数器递增；换成另一工具失败时重置为 1；任何成功调用都会删除这条链。提醒在精确达到 `repeatThreshold` 时触发，每条链只触发一次；超过阈值后链保持静默，不再重复该消息。

- **被拒绝的调用也计数。** 检测位于 `tools/post-execute`；即便调用被 `tools/pre-execute` 监听器或 guard 拒绝，该事件也会运行。模型在未声明目标的情况下反复调用被拒绝的写工具，会收到归因提醒，其 C 轴正指向这道门。
- **忽略没有 agent 的调用。** 直接调用 `ctx.tools.execute()` 的调用方没有需要提醒的模型，也没有可作为键的活跃 agent 对象。
- **仅驻留内存。** 从持久化恢复的会话会从一条全新的链开始。

## 目标门

当 `enforceGoalGate` 开启时，guard 注册一个单调的 `ctx.tools.guard`，它在每个 `tools/pre-execute` 监听器之后、工具主体之前被求值。由日志中尚无 `goalMarker` 声明的 agent 请求的写工具（名称匹配 `writeTools`）会被拒绝，拒绝原因指明这道门；非写工具、已声明目标的 agent 以及无 agent 的调用则原样放行。确认按 agent 独立且具有粘性：一旦模型产生包含 `goalMarker` 的 assistant 消息，该 agent 的门即保持开启。

## 提示注入

当 `injectPrompt` 开启时，guard 的 pre-step 监听器会把一条 `instructions` 形式的上下文（来源为 `{kind: 'plugin', plugin: 'reliability-guard', form: 'instructions'}`）前置到该 agent 第一步进入步骤的消息之前。后续步骤直接委派、不再注入，因此规则每个 agent 只陈述一次。

## 模型体验

### 连续失败提醒

#### 模型看到的内容

当同一工具连续失败达到 `repeatThreshold` 时，对应 agent 会收到下面这条 `notice` 形式的提醒，作为 post-execute 决策上的注入上下文。系统不会添加工具 schema 或正常调用文本。

##### 注入的提醒文本

```markdown
Consecutive tool failures detected:
- tool: <toolName>
- consecutive_failures: <count>
Before retrying, attribute the failure across the reliability harness axes:
- β (validator): could the success criterion accept a bad result? Calibrate it before continuing.
- ρ (path): is the task drifting? Split it into verifiable checkpoints and pass each before the next.
- C (goal context): is the goal and its acceptance test visible in your context? Restate it.
- p₁ (per-attempt success): is this single step low-yield? Change the approach or arguments — never hammer the identical call.
```

#### Token 影响

达到阈值前为零 token。提醒会作为该 agent 的历史记录保留。

#### KV Cache 影响

仅追加；新出现的内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### 缰绳提示（`injectPrompt` 开启时注入）

#### 模型看到的内容

第一步时，下面这条 `instructions` 形式的上下文会被前置到进入步骤的消息之前。

##### 注入的规则

```markdown
Reliability harness rules (celery four parameters): you are executing a multi-step task under a reliability guard.
1. Define an L0 validator before executing: a runnable check that states how you prove success. Do not start executing before it exists.
2. Split the task into verifiable checkpoints; pass each one before starting the next.
3. On a tool failure, attribute it across four axes before retrying:
   - β: is the acceptance test too loose (a bad result passes)? Calibrate the validator.
   - ρ: is the task path drifting? Add checkpoints and re-verify each before the next step.
   - C: is the goal missing from your context? Restate it.
   - p₁: is this single step low-yield? Change the approach or arguments — never repeat the identical call.
4. Write tools are gated until you state the goal. Begin your first response with `GOAL:` followed by how you define success.
```

#### Token 影响

注入的文本作为历史记录保留，每个 agent 只添加一次。`goalMarker` 字面量是唯一的随数据变化的内容。

#### KV Cache 影响

仅追加；新出现的内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **失败检测只看成功/失败二元结果**：提醒以 `result.isError` 为键，因此返回无错误但无用的结果（例如命令退出码为 0 但任务失败）的工具不会被计数。
- **目标门基于名称模式**：写操作分类使用 `writeTools` 名称匹配，而非工具元数据，因为 `ToolSchema` 不携带写操作标记；配置集合之外的写工具会绕过这道门。
- **确认对每个 agent 具有粘性**：同一 agent 收到新任务不会重置门；注入的提示仍要求模型重述目标，但门在首次确认后不再硬性拦截。
- **提示注入一次性生效**：缰绳规则每个 agent 只陈述一次，不会在每步重复强化，因此长会话的最新上下文会逐渐远离这些规则。
- **超过阈值后链不再提醒**：提醒只在精确达到所配置的次数时触发，超过后不会继续发送。
