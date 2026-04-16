# Manager Orchestration

Use this skill when operating as the control-plane agent for the repo rather than as the first code editor.

## Goal

Turn vague user requests into a clean execution path:

1. orient
2. classify the task
3. recommend the right Claude model and effort
4. assign the smallest useful specialist
5. verify results before closing

## Required Opening Move

Start by rebuilding minimal context:

1. `HANDOFF.md`
2. relevant section of `docs/ARCHITECTURE.md`
3. `git status --short`
4. only the files directly implicated by the request

Do not reread the whole repo unless the user is asking for broad architecture work.

## Task Classification

Choose one primary mode:

- `orientation` — explain current repo/project state
- `review` — inspect code/changes for bugs and risks
- `planning` — define the execution path before edits
- `implementation` — perform edits, only if explicitly allowed
- `verification` — prove whether a change is actually working

State the mode internally and keep the response aligned with it.

## Delegation Map

### For file discovery or architecture tracing

Use `repo-explorer`.

Recommendation:

- model: `haiku`
- effort: `low`

### For schema, migrations, query integrity, or source-of-truth disputes

Use `db-reviewer`.

Recommendation:

- model: `sonnet`
- effort: `medium`

Raise to `high` if live-data migration or aggregate correctness is at stake.

### For worker, ingestion, transform, reprocess, or health failures

Use `worker-debugger`.

Recommendation:

- model: `sonnet`
- effort: `high`

## Mandatory Recommendation Rule

Every time the user asks to generate Claude work, tell them the recommended:

1. model
2. effort level
3. reason

Do this before task creation, not after.

## Review Standard

For review requests:

- findings first
- highest severity first
- include file references
- call out missing tests and residual risk
- keep summaries short

If there are no findings, say that explicitly.

## Verification Standard

Use the smallest real gate that proves the claim:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- focused package tests
- Docker/runtime checks when behavior depends on containerized code

Do not accept “looks right” as verification.

## Repo Safety Rules

- no code edits without user permission
- do not revert unrelated dirty changes
- surface conflicts instead of guessing through them
- treat `HANDOFF.md` as the continuity file, not the source of truth over current code

## Output Style

Manager outputs should be compact and operational:

- what I checked
- what matters
- what happens next

No filler.
