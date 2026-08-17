# @deepseek-ai/dsh-tool-celery-harness

[English](README.md) | 中文

确定性的 celery 可靠性缰绳工具集。每个工具通过 `ctx.subprocess` seam 启动一个 celery python 检查,并把脚本的原样中文判定作为规范化的 `{ text }` 值返回给模型。非零退出码意味着"闸门未通过"——工具会把完整的 stdout/stderr 包装成结构化的 `HarnessError`(`error.info.code` 对每个闸门是稳定的,绝不丢失原样的改写),于是 agent 循环会记录一个模型可读、companion 可按 code 路由的错误结果。celery 脚本位于 `/home/mi/ssd/codes/celery/tools`;本包只做确定性的启动调用,从不重新实现它们。

## 插件(命名空间:`tool-celery-harness`)

这是一个函数/命名空间插件(`name` / `inject` / `apply`),不是服务。它注册六个工具,并消费 `ctx.tools`(注册)与 `ctx.subprocess`(spawn);两者都声明在 `inject` 中,使插件在服务就绪前保持 pending,`apply` 通过 `ctx.get` 读取具体服务,而非拓扑敏感的属性代理。

```yaml
- id: tool-celery-harness
  name: '@deepseek-ai/dsh-tool-celery-harness'
  config:
    celeryToolsDir: /home/mi/ssd/codes/celery/tools   # default
    pythonPath: python3                               # default
```

两个配置项都会在加载时快速失败:空的 `celeryToolsDir` 或 `pythonPath` 会抛出错误,绝不静默回退到默认值。

## 工具

每个工具运行 `<pythonPath> <celeryToolsDir>/<script> <argv>`,`cwd` = `workdir` 参数,否则为 agent 的会话 cwd,否则为 `process.cwd()`;并把 `exec.signal` 透传给 spawn,使工具超时或调用方取消时能终止整个进程树。

| 工具 | 脚本 | 参数 |
|---|---|---|
| `celery_goal_gate` | `task_governor.py check` | goal, why, output |
| `celery_verify_goal` | `task_governor.py explore` | rounds, newFindings, window |
| `celery_calibrate_verifier` | `beta_calibration.py --inject` | injectPath |
| `celery_telemetry` | `telemetry.py status` / `record` | (无) / rho, beta, p1 |
| `celery_decision` | `decision.py decide` | kind, question |
| `celery_fixate` | `fixation_filter.py` | topic, q1..q4 |

`celery_telemetry` 在未提供 rho/beta/p1 时运行 `status`,否则运行 `record`(只带给定的参数)。每个模型值都是不加引号的 argv 元素——中间没有 shell 层,因此恶意文本也只会作为一个惰性参数存在。

## 退出语义

退出码 0 表示检查通过:脚本的完整 stdout 成为规范化的 `{ text }` 值,模型渲染原样透传。任何非零退出、被信号杀死或 spawn 失败都会抛出 `HarnessError`,其 `code` 对每个闸门是稳定的(`CELERY_GOAL_GATE_REJECTED`、`CELERY_VERIFY_GOAL_CONVERGED`、`CELERY_CALIBRATE_REGRESSION`、`CELERY_TELEMETRY_ALERT`、`CELERY_DECISION_ERROR`、`CELERY_FIXATION_ERROR`),message 携带完整 stdout 以及任何 stderr——闸门未通过是一个模型必须完整阅读的事实,而不是被概括转述的摘要。

## 模型体验

### 确定性检查判定

#### 模型看到的内容

每次成功的检查返回一个文本块,内容是 celery 脚本的原样中文输出;闸门未通过时返回 `Error: celery <tool>: check failed (exit <n>)`,后面跟着同样的原样输出和任何 stderr。不会增加额外的提示词或 schema。

##### 目标层闸门样例

```markdown
目标: 把"在线参数监控"做成工具化能力
动机: celery 的 β/ρ/p₁ 需要从离线理论变在线可观察
产出: 一个可被 agent 调用的确定性监控工具
判定: PASS
```

#### Token 影响

每次调用保留一个文本块,大小由脚本自身输出决定(stdout 内存上限 64 KiB 并带 1 MiB spill;stderr 保留 32 KiB 尾部)。闸门未通过时,以同样大小的错误结果代替独立的成功值。

#### KV Cache 影响

仅追加;新出现的内容位于可复用请求前缀之后,不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **仅中文判定**——celery 脚本输出中文;本包不翻译,纯英文工作流需按原样阅读。
- **退出码含义是"闸门未通过",不是"崩溃"**——REVIEW/STOP/告警等判定以 `isError` 工具结果呈现;只想看到通过结果的 companion 需要容忍错误分支。
- **调用时必须存在真实的 `celeryToolsDir`**——脚本不随包分发;缺少 `/home/mi/ssd/codes/celery/tools` 的部署每次调用都会得到 spawn 失败。
- **不做输出结构化**——规范化值就是原始文本;把判定解析成字段留待有消费方需要时再做。
