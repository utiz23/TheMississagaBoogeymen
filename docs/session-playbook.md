# Session Playbook

Use short, single-purpose sessions. Default pattern:

1. Session 1: inspect and define scope
2. Session 2: implement
3. Session 3: verify and polish
4. Session 4: review or handoff if needed

## Rules

- One task per session.
- Prefer one main agent.
- Use subagents only when there are at least two clearly independent workstreams and the reliability benefit is concrete.
- Do not use heavyweight planning unless the task will likely take more than 45 minutes or spans multiple systems.
- Do not use TDD-heavy workflows unless the bug is subtle, regression-prone, or otherwise high risk.
- Keep durable state in repo files, not chat history.
- If the thread is getting bloated, long, or phase-mixed, compact or start a fresh session.

## Session 1 Prompt

```text
Session 1: inspect and define scope.

Inspect the relevant area of this repo, explain what is currently happening, identify constraints and risks, and define the exact change needed.

Do not implement yet unless the scope is trivial.
Avoid subagents unless there are at least two clearly independent workstreams.
Keep this lean and recommend the exact next Session 2 objective at the end.
```

## Session 2 Prompt

```text
Session 2: implement.

Implement the agreed change in the smallest clean way. Stay within the scoped files unless you find a real dependency that requires expansion.

Avoid broad refactors, avoid subagents unless there are at least two clearly independent workstreams, and keep the session focused on shipping the change.
At the end, summarize what changed and state the exact Session 3 verification step.
```

## Session 3 Prompt

```text
Session 3: verify and polish.

Run the smallest relevant checks for the completed change, fix any issues found, and tighten rough edges without expanding scope.

Report verification results clearly, note any residual risk, and recommend whether Session 4 is needed.
```

## Session 4 Prompt

```text
Session 4: review or handoff if needed.

Review the completed work, explain what changed in plain language, call out risks or missing verification, and update HANDOFF.md if project state changed.

Keep the summary concise, prefer durable notes over chat-heavy recap, and recommend the next task only if there is a clear follow-up.
```

## Management / Review Prompt

```text
Act as the management/review layer for this repo.

Explain what Claude appears to have done, identify weak assumptions, missing verification, and workflow drift, then recommend the next session explicitly.

Prioritize reliability over speed, keep reminders concise, and call out when the thread should be split into a fresh session.
```

## Anti-Bloat Prompt

```text
This thread is getting long.

Summarize only:
- current objective
- files that matter
- latest verification result
- unresolved blockers or assumptions
- next 1-3 concrete actions

Do not preserve long transcript history that no longer matters.
```

## Fresh Session Trigger Prompt

```text
This thread is now too mixed or too long for reliable work.

State which session we are ending, summarize the active state briefly, note the exact next session objective, and move any durable state into HANDOFF.md or another repo file if needed.

Do not continue implementation in this thread after that summary.
```
