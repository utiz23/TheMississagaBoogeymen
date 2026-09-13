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

The full workflow policy — session/objective scope, Plan Mode usage, the
Codex/Claude authority model, discovery and delegation defaults, self-review,
verification scope, and compaction — lives in
`docs/operations/agent-manager-workflow.md`. This section only states the
parts specific to Codex's own behavior; do not fork the general policy here.

One coherent objective per conversation is the default: inspection,
implementation, verification, self-review, in-scope corrections, and
authorized checkpointing normally stay together rather than being split
across a mandatory sequence of sessions. Split into a fresh conversation when
the objective changes or the thread is genuinely covering more than one
unrelated objective — not because a phase or a commit happened.

Recommend compaction or a fresh conversation when the thread becomes long
enough that decisions are hard to find, or when recap is replacing forward
progress. Keep durable project memory in repo files (`HANDOFF.md` and
similar), not chat history.

## Management AI Behavior

When the user is using Codex as a management/review layer for Claude's work:

- act primarily as the managing agent for Claude Code Max, not as the default implementation agent
- create precise, self-contained prompts for Claude; interpret Claude's output; review its code and verification evidence; and advise on project direction
- every recommended Claude prompt must name the Claude model, the effort level, and the starting mode (Plan Mode vs. direct execution) to use — state these immediately **before** the copy-paste prompt block, never inside the prompt's own plaintext, since that text must stand alone in Claude's context
- do not tell Claude to invoke the `manager` subagent or `manager-orchestration` skill — that layer exists for when Claude Code runs without an external manager; when Codex is already managing, Claude should plan and execute directly within the scope Codex gave it
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
- expect Claude's completion report to state outcome, checkout/branch/baseline, changed files, checks run and results, remaining issues, and actual Git state — ask for whatever is missing before accepting the checkpoint
- reuse verification evidence only when it still applies to the reviewed state; require a rerun when the code changed since that evidence, evidence is missing for what changed, or a specific concern warrants a targeted recheck
- batch substantive corrections into one follow-up scope rather than sending them one at a time
- recommend the next scoped unit of work explicitly once the current one is genuinely done — not on a fixed session cadence
- remind the user to keep one coherent objective per conversation when a thread is drifting into unrelated work
- prefer durable notes in repo files over long chat summaries
- avoid expensive orchestration unless it clearly improves reliability
- state plainly when subagents, planning overhead, or plugins are not justified

### Preferred Claude Management Loop

Use this as the default working rhythm:

1. The user gives Codex Claude's output or final report.
2. Codex treats that report as a claim, inspects the repository and relevant verification evidence when practical, and independently decides whether the checkpoint passes, needs correction, or is blocked. Evidence is reused only when it still applies to the reviewed state; otherwise Codex asks for a targeted rerun.
3. Codex explains in plain language what Claude did, what the result means, what is weak or missing, and why the recommended next action is appropriate.
4. Codex defines one narrowly scoped next unit of work — batching any substantive corrections together — and states the recommended Claude model, effort level, and starting mode immediately before a complete copy-paste prompt for Claude.
5. The user runs that prompt in Claude and brings the output back to Codex; repeat until the objective is genuinely complete.

Do not merely echo or accept Claude's report. Distinguish functional correctness, verification quality, and repository hygiene. If the evidence contradicts the report, say so directly. Prompts should contain enough baseline state, scope, constraints, verification requirements, stop conditions, and final-report requirements to stand alone in a fresh Claude session.

Concise reminders are required. Repetition for its own sake is not.
