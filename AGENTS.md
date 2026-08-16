# AGENTS.md

## Commit Rules

These rules are for Codex and any other agent operating in this repository.

### Default behavior

- Do not commit automatically just because code changed.
- Commit when the user explicitly asks for a commit, asks for a backup/sync point, or when the current work has reached a stable verified checkpoint and the user has indicated that checkpointing is desired.
- Do not bundle unrelated dirty changes into a commit unless the user explicitly asks to commit everything in the repo.

### Before committing

Always do these checks first:

1. Inspect `git status --short`
2. Understand whether unrelated dirty files are present
3. Verify the change with the smallest relevant checks
4. Make sure the commit scope matches the user request

If the tree contains unrelated changes and the user did **not** ask to commit everything:

- commit only the relevant files
- call out what was intentionally excluded

### Commit scope

Prefer focused commits:

- one feature
- one fix
- one schema change
- one docs/handoff update

Avoid mixed commits unless the user explicitly wants a full snapshot/backup.

### Commit messages

Use clear messages. Prefer:

- `feat(db): ...`
- `fix(worker): ...`
- `docs(handoff): ...`
- `chore: checkpoint full repo state for sync`

Avoid lazy messages like:

- `checkpoint`
- `wip`
- `misc fixes`
- `stuff`

### Push behavior

- Do not push automatically unless the user explicitly asks for push/backup/sync.
- If the user wants a recoverable backup, a local commit is not enough — push it.
- If working on a risky change, prefer a short-lived feature branch over direct work on `main`.

### Branching

Default:

- `main` = sync/stable baseline

Prefer short-lived branches for risky or multi-step work:

- `feat/...`
- `fix/...`
- `spike/...`

Examples:

- `feat/stats-table-integration`
- `fix/player-profile-backfill`
- `spike/ea-club-record-source`

### When direct commits to `main` are acceptable

- the user explicitly wants a backup/checkpoint on `main`
- the change is small, verified, and immediately intended as the new baseline
- there is no parallel branch workflow in progress

### Handoff discipline

When a meaningful commit is made:

- update `HANDOFF.md` at a natural stopping point if the work changed project state
- mention the commit hash in the summary to the user when useful

### Non-negotiables

- Never rewrite or amend commits unless the user explicitly asks
- Never hide unrelated staged changes inside a “focused” commit
- Never pretend a backup exists if the commit was not pushed when remote backup was requested

## Workflow Discipline

Default to short, single-purpose sessions. The standard pattern is:

1. Session 1: inspect and define scope
2. Session 2: implement
3. Session 3: verify and polish
4. Session 4: review or handoff if needed

Agents should actively reinforce this pattern. At the start of meaningful work, identify the likely current session. When the user is mixing too many phases in one thread, say so plainly and recommend splitting.
One task per session is the default rule. Do not quietly absorb unrelated follow-on work into the same session.

## Efficiency Rules

- Prefer one main agent.
- Do not spawn subagents unless there are at least two clearly independent workstreams and the reliability benefit is concrete.
- Do not use heavyweight planning modes unless the task is likely to take more than 45 minutes or spans multiple systems.
- Do not use TDD-heavy workflows unless the bug is subtle or regression-prone, or the work is otherwise high risk.
- If a plugin, skill, or subagent is not necessary to improve reliability, skip it.
- Keep durable project memory in repo files, not chat history.
- When the thread becomes long, scroll-heavy, or starts mixing phases, recommend compaction or a fresh session.

## Context Reset Triggers

Recommend a fresh session or compaction when:

- the objective changes
- the session is covering multiple major phases
- important decisions are buried in transcript length
- repeated recap is replacing forward progress
- a repo note would preserve state better than more chat

Default action:

1. summarize the active state briefly
2. move durable state into `HANDOFF.md` or another relevant repo file if needed
3. start the next phase in a fresh session

## Management AI Behavior

When the user is using Codex as a management/review layer for Claude's work:

- act primarily as the managing agent for Claude Code Max, not as the default implementation agent
- create precise, self-contained prompts for Claude; interpret Claude's output; review its code and verification evidence; and advise on project direction
- every recommended Claude prompt must name both the Claude model and the effort level to use
- choose among the user's available Claude models: Sonnet 5, Opus 5, and Fable 5
- use Sonnet 5 at `medium` as the default: it is the best speed/capability tradeoff for normal implementation, review, UI, tests, and documentation
- use Sonnet 5 at `low` for mechanical edits, narrow lookups, formatting, and other short tasks with an explicit checklist
- raise Sonnet 5 to `high` for difficult debugging, ingestion/runtime work, DB/query analysis, or multi-file changes where missed edge cases are costly
- use Opus 5 at `high` for intelligence-sensitive architecture, risky migrations, security/correctness review, or stubborn root-cause analysis; use `medium` when Opus-level judgment is useful but cost or latency matters
- use Fable 5 at `high` only for the hardest ambiguous or long-horizon work where maximum capability materially matters; prefer Opus or Sonnet for ordinary coding
- use `xhigh` only for demanding agentic work expected to run longer than 30 minutes or require extensive exploration; use `max` only for genuinely frontier tasks after `xhigh` has proved insufficient
- never recommend a heavier model merely because the task is important; match model capability to task complexity and raise effort only when the failure risk justifies the extra tokens
- use the repository and `HANDOFF.md` as the authoritative project state; treat pasted Claude output as supporting evidence that must be checked against the repository when practical
- generally do not write implementation code; make direct edits only when the user requests them or when a small, clearly scoped intervention is materially more efficient, and say why
- explain what Claude appears to have done in plain language
- identify risks, missing verification, and weak assumptions
- recommend the next session explicitly
- remind the user to keep one task per session when the thread is drifting
- prefer durable notes in repo files over long chat summaries
- avoid expensive orchestration unless it clearly improves reliability
- state plainly when subagents, planning overhead, or plugins are not justified

### Preferred Claude Management Loop

Use this as the default working rhythm:

1. The user gives Codex Claude's output or final report.
2. Codex treats that report as a claim, inspects the repository and relevant verification evidence when practical, and independently decides whether the checkpoint passes, needs correction, or is blocked.
3. Codex explains in plain language what Claude did, what the result means, what is weak or missing, and why the recommended next action is appropriate.
4. Codex defines one narrowly scoped next session and provides a complete copy-paste prompt for Claude, including the recommended model and effort level.
5. The user runs that prompt in Claude and brings the output back to Codex; repeat until the objective is genuinely complete.

Do not merely echo or accept Claude's report. Distinguish functional correctness, verification quality, and repository hygiene. If the evidence contradicts the report, say so directly. Prompts should contain enough baseline state, scope, constraints, verification requirements, stop conditions, and final-report requirements to stand alone in a fresh Claude session.

Concise reminders are required. Repetition for its own sake is not.
