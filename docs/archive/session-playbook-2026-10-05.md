# Session Playbook

The full workflow policy lives in
[`docs/operations/agent-manager-workflow.md`](operations/agent-manager-workflow.md).
This page only holds copy-paste prompt templates that build on that policy —
it does not restate it.

## Default pattern

One coherent objective per conversation: inspection, implementation,
verification, self-review, in-scope corrections, and authorized
checkpointing normally stay together. Split into a fresh conversation when
the objective itself changes, not because a phase or a commit happened.

- Prefer one main agent; do discovery yourself by default.
- Delegate to a subagent only when independent, parallelizable work gives a
  concrete reliability or time benefit.
- Use Plan Mode when the risk or ambiguity of the change warrants reviewing
  an approach first — there's no fixed time threshold.
- Use TDD-heavy workflows when the bug is subtle, regression-prone, or
  otherwise high risk — not by default.
- Keep durable state in repo files, not chat history.
- If the thread is getting bloated, long, or is drifting onto an unrelated
  objective, compact or start a fresh conversation (see
  `agent-manager-workflow.md` §8).

## Single-Objective Task Prompt

Use this as the default way to hand Claude a task that doesn't need a
separate planning pass first.

```text
Objective: <one sentence>.

Inspect what's needed, implement it, verify it with the smallest relevant
checks, self-review your diff for defects before reporting, and fix in-scope
issues you find rather than handing them off. Escalate instead of deciding
silently if you hit a material design decision outside this scope, an
unresolved blocker, or a conflicting edit in the working tree.

Report: outcome, checkout/branch/baseline, changed files, checks run and
results, remaining issues, and actual Git state.
```

## Plan-First Task Prompt

Use this when the change carries enough uncertainty, unfamiliar consequential
code, or design risk that reviewing an approach first is worth the pause.

```text
Objective: <one sentence>.

Use Plan Mode: inspect the relevant area, identify constraints and risks, and
propose an approach sized to the actual decision before making changes.

Once the plan is approved, implement, verify with the smallest relevant
checks, self-review your diff, and fix in-scope issues before reporting.

Report: outcome, checkout/branch/baseline, changed files, checks run and
results, remaining issues, and actual Git state.
```

## Management / Review Prompt

```text
Act as the management/review layer for this repo.

Treat Claude's report as a claim: inspect the repository and relevant
verification evidence, and independently decide whether the checkpoint
passes, needs correction, or is blocked. Explain what Claude appears to have
done, identify weak assumptions or missing verification, and recommend the
next scoped unit of work — state the recommended Claude model, effort level,
and starting mode immediately before any copy-paste prompt.
```

## Anti-Bloat Prompt

```text
This thread is getting long.

Summarize only:
- the active objective and decisions made toward it, with rationale
- authorization boundaries already granted
- files that matter
- latest verification result
- unresolved blockers or assumptions
- next 1-3 concrete actions

Do not preserve long transcript history that no longer matters.
```

## Fresh Conversation Trigger Prompt

```text
This thread is now covering an unrelated objective, or is too long/confused
for reliable work.

Summarize the active state briefly (objective, decisions, changed files,
verification state, next action), move any durable state into HANDOFF.md or
another repo file if needed, and stop here rather than continuing
implementation in this thread.
```
