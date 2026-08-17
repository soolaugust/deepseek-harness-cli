# @deepseek-ai/dsh-reliability-guard

English | [中文](README.zh.md)

A reliability guard that expresses the celery harness contract — the four failure-attribution parameters β (validator looseness), ρ (path drift), C (goal context), and p₁ (per-attempt success) — at the loop boundary. It adds three opt-in behaviors on top of one always-on observer:

- **Consecutive-failure reminder (always on).** It watches each agent's tool-call stream, counts runs of consecutive failures of the same tool, and at `repeatThreshold` (default 3) injects a notice-form reminder that walks the four attribution axes. The reminder never rewrites a call; the model keeps the decision (calibrate the validator, split into checkpoints, restate the goal, or retry differently).
- **Goal gate (opt-in).** When `enforceGoalGate` is on, a monotonic `ctx.tools.guard` denies every write-tool call until the agent's log contains a model statement marked by `goalMarker` (default `GOAL:`). Once stated, the gate stays open for that agent.
- **Prompt injection (opt-in).** When `injectPrompt` is on, the first pre-step of each agent receives an `instructions`-form context carrying the harness rules: define an L0 validator before executing, split into verifiable checkpoints, attribute failures across β/ρ/C/p₁, and state the goal before writing.

The guard never adds a model-facing tool and never rewrites a call's content. It only observes tool outcomes, denies write calls while the gate is closed, and injects context.

## Config

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

`repeatThreshold` fails loud at plugin load: a non-integer or a value below 1 throws, never a silent fall-back. `goalMarker` equally rejects a blank value.

`writeTools` entries support `*` wildcards and classify tool names as write operations for the goal gate. Empty uses the built-in set (`bash`, `pwsh`, `write`, `edit`, `apply_patch`, `patch`, `rename`, `mkdir`, `rm`, `fs_write`, `fs-write`, `fs_*`, `fs-*`). A pattern matching no currently registered tool is NOT an error — the gate is a predicate over tool names at call time, not a reference to registry entries.

## Consecutive-failure chain

The chain key is the failing tool name, tracked per live agent object. A failed call to the same tool as the previous tracked failure increments the agent's counter; a failed call to a different tool resets to 1; any successful call deletes the chain. The reminder fires exactly at `repeatThreshold`, once per run; past the threshold the chain stays silent rather than repeating the message.

- **Denied calls count.** Detection sits on `tools/post-execute`, which also runs for calls a `tools/pre-execute` listener or a guard denied — a model hammering a denied write call without stating the goal draws the attribution reminder, and its C axis points back at the gate.
- **Calls without an agent are ignored.** A direct `ctx.tools.execute()` caller has no model to remind and no live agent object to key on.
- **In-memory only.** A session resumed from persistence starts with a fresh chain.

## Goal gate

When `enforceGoalGate` is on, the guard registers a monotonic `ctx.tools.guard` evaluated after every `tools/pre-execute` listener and before the tool body. A write tool (a name matching `writeTools`) requested by an agent whose log holds no `goalMarker` statement is denied with a reason naming the gate; a non-write tool, an agent that stated the goal, and an agentless call pass unchanged. Confirmation is per-agent and sticky: once the model emits an assistant message containing `goalMarker`, the gate stays open for that agent.

## Prompt injection

When `injectPrompt` is on, the guard's pre-step listener prepends an `instructions`-form context (source `{kind: 'plugin', plugin: 'reliability-guard', form: 'instructions'}`) to the entering messages of the agent's first step. Later steps delegate without re-injecting, so the rules are stated once per agent.

## Model Experience

### Consecutive-failure reminder

#### What the model sees

At `repeatThreshold` consecutive failures of one tool, that agent receives the notice below as an injected context on the post-execute decision. No tool schema or normal-call text is added.

##### injected notice

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

#### Token effect

Zero tokens before the threshold. The reminder is retained history for that agent.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Harness prompt (injected when `injectPrompt` is on)

#### What the model sees

On the first step, the `instructions`-form context below is prepended to the entering messages.

##### injected instructions

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

#### Token effect

The injected text is retained history, added once per agent. The `goalMarker` literal is the only data-dependent token.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Failure detection is success/failure binary only** — the reminder keys on `result.isError`, so a tool that returns an error-free but useless result (a command that exits 0 while failing the task) never counts.
- **The goal gate is name-pattern based** — write classification uses `writeTools` name matching, not tool metadata, because `ToolSchema` carries no write flag; a write tool outside the configured patterns bypasses the gate.
- **Confirmation is sticky per agent** — a new user task in the same agent does not reset the gate; the injected prompt still asks the model to restate the goal, but the gate does not hard-block past the first confirmation.
- **Prompt injection is one-shot** — the harness rules are stated once per agent, not re-affirmed on every step, so a long session's recent context drifts away from them.
- **Past the threshold a chain goes silent** — the reminder fires only at the exact configured count, never beyond it.
