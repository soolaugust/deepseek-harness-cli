# @deepseek-ai/dsh-tool-celery-harness

English | [中文](README.zh.md)

Deterministic celery reliability-rein tools. Each tool spawns one celery python check over the `ctx.subprocess` seam and returns the script's verbatim Chinese verdict to the model as the canonical `{ text }` value. A non-zero exit is a gate not passed — the tool surfaces the full stdout/stderr as a structured `HarnessError` (`error.info.code` is stable per gate, never a lossy paraphrase), so the loop logs an error result the model can read and a companion can route on. The celery scripts come from `/home/mi/ssd/codes/celery/tools`; this package only launches them deterministically, it never re-implements them.

## Plugin (namespace: `tool-celery-harness`)

A function/namespace plugin (`name` / `inject` / `apply`), not a service. It registers six tools and consumes `ctx.tools` (registration) and `ctx.subprocess` (spawn); both are declared in `inject` so the plugin stays pending until they exist, and `apply` reads them with `ctx.get` rather than the topology-sensitive property proxy.

```yaml
- id: tool-celery-harness
  name: '@deepseek-ai/dsh-tool-celery-harness'
  config:
    celeryToolsDir: /home/mi/ssd/codes/celery/tools   # default
    pythonPath: python3                               # default
```

Both config values fail loud at load: an empty `celeryToolsDir` or `pythonPath` throws, never a silent fall-back to defaults.

## Tools

Every tool runs `<pythonPath> <celeryToolsDir>/<script> <argv>` with `cwd` = the `workdir` argument, else the agent's session cwd, else `process.cwd()`, and forwards `exec.signal` so a tool timeout or caller cancellation terminates the whole process tree.

| Tool | Script | Arguments |
|---|---|---|
| `celery_goal_gate` | `task_governor.py check` | goal, why, output |
| `celery_verify_goal` | `task_governor.py explore` | rounds, newFindings, window |
| `celery_calibrate_verifier` | `beta_calibration.py --inject` | injectPath |
| `celery_telemetry` | `telemetry.py status` / `record` | (none) / rho, beta, p1 |
| `celery_decision` | `decision.py decide` | kind, question |
| `celery_fixate` | `fixation_filter.py` | topic, q1..q4 |

`celery_telemetry` runs `status` when none of rho/beta/p1 are given and `record` (with only the given flags) otherwise. Every model value is an unquoted argv element — there is no shell layer, so hostile text stays one inert argument.

## Exit semantics

Exit 0 is a passed check: the script's complete stdout becomes the canonical `{ text }` value and the model render hands it through verbatim. Any non-zero exit, signal kill, or spawn failure throws a `HarnessError` whose `code` is stable per gate (`CELERY_GOAL_GATE_REJECTED`, `CELERY_VERIFY_GOAL_CONVERGED`, `CELERY_CALIBRATE_REGRESSION`, `CELERY_TELEMETRY_ALERT`, `CELERY_DECISION_ERROR`, `CELERY_FIXATION_ERROR`) and whose message carries the full stdout plus any stderr — a gate not passed is a fact the model must read in full, not a paraphrased summary.

## Model Experience

### Deterministic check verdict

#### What the model sees

Each successful check returns one text block with the celery script's verbatim Chinese output; a gate not passed returns `Error: celery <tool>: check failed (exit <n>)` followed by that same verbatim output and any stderr. No prompt or additional schema is added.

##### Sample goal-gate verdict

```markdown
目标: 把"在线参数监控"做成工具化能力
动机: celery 的 β/ρ/p₁ 需要从离线理论变在线可观察
产出: 一个可被 agent 调用的确定性监控工具
判定: PASS
```

#### Token effect

One retained text block per call, sized by the script's own output (stdout is capped at 64 KiB in memory with a 1 MiB spill; stderr retains a 32 KiB tail). A gate not passed adds the same-size error result instead of a separate success value.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Chinese-only verdicts** — the celery scripts emit Chinese; the package does not translate, so an English-only workflow reads them as-is.
- **Exit code means "gate not passed", not "crash"** — a REVIEW/STOP/alert verdict surfaces as an `isError` tool result; a companion that wants only passed gates must tolerate the error branch.
- **A live `celeryToolsDir` is required at call time** — the scripts are not bundled; a deployment without `/home/mi/ssd/codes/celery/tools` gets a spawn failure per call.
- **No output structurization** — the canonical value is the raw text; parsing the verdict into fields is deferred until a consumer needs it.
