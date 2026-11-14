# Workflow v2: tasks, lanes, one Lead

Status: **in force since 2026-11-09** (operator OK). Adapted from the engine repo's guide (`eanhl-live-engine` `docs/operations/workflow-v2.md`,
seed copy in `docs/operations/workflow-v2-seed/`). Replaces `agent-manager-workflow.md` (archived
unchanged at `docs/archive/agent-manager-workflow-2026-11-09.md`).

Written for: the operator first, then every Claude session on this project.

## 1. What changes

- One **Lead** chat coordinates. Each piece of work is a **task**: a small file with a goal, the exact
  paths it may edit, a "done when" rule and stop conditions.
- One branch and one worktree per task. Only the Lead merges to `main`.
- A **Verifier** re-checks any task that claims a number.
- The operator reads one live page, `docs/decisions.md`.
- Name: the engine calls work items "cards". Here they are **tasks**, because "cards" is the player
  card system (`docs/specs/cards/`).

## 2. Roles

| Role           | Count                   | Does                                                                                                                                                   | Does not                                                                           |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| **Operator**   | 1                       | Approves tasks, decides, approves every deploy and live-database write                                                                                 | –                                                                                  |
| **Lead**       | 1 chat                  | Writes tasks, keeps the board and `docs/decisions.md`, merges verified branches, keeps `HANDOFF.md` and the journal, prepares deploys for the operator | Decide what is the operator's; write or deploy to live without the operator's OK   |
| **Task agent** | 1 per task              | Does one task in its own branch and worktree, reports on the task                                                                                      | Merge to `main`, edit outside the task's paths, deploy, write to the live database |
| **Verifier**   | 1 per task with a claim | Re-runs the checks on the branch, reports pass or fail                                                                                                 | Fix the code, read the author's claim before it has its own result                 |
| **Codex**      | optional                | Second opinion on risky changes (the operator types the command)                                                                                       | –                                                                                  |

**Small tasks** (risk "low" in section 7, one lane, no live write): the operator may tell the Lead to do
the task itself, in the task's own worktree. All other rules stay.

## 3. Tasks

A task is one file in `docs/tasks/`, made from `docs/tasks/TEMPLATE.md`. Name:
`YYYY-MM-DD-<lane>-<slug>.md`. One goal per task. If the scope grows, write a new task.

| State    | Meaning                                              | Who moves it                  |
| -------- | ---------------------------------------------------- | ----------------------------- |
| Proposed | Written, not approved                                | Lead or any session           |
| Ready    | The operator approved it. "Done when" is written.    | Operator (tells the Lead)     |
| Running  | A task agent has it                                  | Task agent                    |
| Verify   | Done. Report written. Rebased on `main`.             | Task agent                    |
| Merged   | Checks passed, branch is in `main`                   | Lead                          |
| Deployed | Live on Hotel-Echo (only for tasks that change live) | Lead, after the operator's OK |
| Parked   | Stopped on purpose, with the reason                  | Lead or operator              |
| Dropped  | Not wanted any more                                  | Operator                      |

The board is `docs/board.md`: one line per open task. Only the Lead edits it. A task agent edits only
its own task file.

## 4. Lanes

A task names its lane and the exact paths it may edit. When two rows cover a file, the most specific
path wins.

| Lane         | Paths                                                                                                                                                                                                  | Notes                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Web          | `apps/web/`                                                                                                                                                                                            | Site, API routes, internal render pages for Discord                                |
| Discord      | `apps/discord/`                                                                                                                                                                                        | Game poster, unlock poster, news desk, press bots                                  |
| Worker       | `apps/worker/`, `packages/ea-client/`                                                                                                                                                                  | EA ingest, transforms, aggregates, card progression                                |
| Database     | `packages/db/src/schema/`, `packages/db/migrations/`, `packages/db/drizzle.config.ts`                                                                                                                  | Always an operator gate. Migrations 0046+ are hand-written SQL.                    |
| Queries      | `packages/db/` (everything not in Database)                                                                                                                                                            | Shared by web, worker and discord: a change here names its consumers               |
| Ops          | `ops/`, `scripts/`, `.githooks/`, `docker-compose.yml`, `docker-compose.test.yml`, `DEPLOY.md`                                                                                                         | Backups, deploy, hooks                                                             |
| OCR (frozen) | `tools/`                                                                                                                                                                                               | No new work here (all OCR work is in `eanhl-live-engine`). Read only.              |
| Shared       | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, `.gitignore`, `CLAUDE.md`, `AGENTS.md`, `.claude/` | Needs the Lead's OK on the task. Two open tasks may not name the same shared path. |
| Lead         | `HANDOFF.md`, `docs/board.md`, `docs/decisions.md`, `docs/journal/`, `.claude/skills/handoff-update/`                                                                                                  | Only the Lead edits these                                                          |
| No lane      | `docs/`, `README.md`, `research/`                                                                                                                                                                      | A task may edit the docs it names                                                  |

Path check: there is no checker script yet. The Lead runs `git diff --name-only main...work/<slug>` and
compares each path with the task's "May edit" line by hand.

## 5. Git rules

One branch and one worktree per task, from the main checkout:

```
git worktree add -b work/<slug> .claude/worktrees/<slug> main
cd .claude/worktrees/<slug>
pnpm install --offline
pnpm --filter @eanhl/db build && pnpm --filter @eanhl/ea-client build
```

- Work and commit on `work/<slug>` only. Commit messages follow `CLAUDE.md`.
- Before state Verify: `git rebase main` in the worktree, then the checks (section 6).
- Only the Lead merges, with `git merge --ff-only work/<slug>`, then pushes `main` (Commit Protocol). If
  the merge fails, the Lead may rebase the branch itself when there is no conflict and the checks pass
  again. Any conflict: the task goes back to Running.
- Never push a `work/*` branch unless the task says so. No `.patch` files: the branch is the result.
- After the merge the Lead removes the worktree and deletes the branch. Never remove a worktree with
  commits that are not in `main` or on a named branch.
- Do not run `pnpm --filter web build` while a dev server uses the same checkout (it breaks
  `apps/web/.next`).

## 6. Checks

The task agent runs these; the Lead repeats them before the merge. Run only the lines for the lanes the
diff touches, plus prettier always.

```
pnpm format:check                                   # always
pnpm --filter @eanhl/db build                       # before any consumer check, if packages/db changed
pnpm --filter <package> typecheck                   # each package the diff touches, and each consumer of a db change
pnpm --filter <package> test                        # web: test:unit at least; db: see note
```

- `pnpm lint` is red repo-wide (old config drift). Do not use it as a gate. Check new code alone.
- `@eanhl/db` tests: the script does not run `dist/queries/__tests__/*`. Run those files by name.
- The worker's integration tests and the pre-push OCR suite need the verification database (Docker).
  The main PC has no Docker since 2026-10-21. Say "not run" when a task needs them.
- A UI change also needs a picture: a screenshot from the dev server (live database, read-only tunnel).

## 7. Risk and live gates

| Change                                                                                        | Process                                                                                       |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Low: UI, docs, small fixes, Discord message text                                              | Task → build → show it (screenshot or dry-run output)                                         |
| Medium: scores and stats teammates see, ingestion, query changes                              | Task with a "done when" rule → side-by-side on real games → Verifier when a number is claimed |
| High: migrations, live-database writes, secrets, exposure, deleting data, turning a poster on | Plan on the task → fresh backup → operator approves each step → apply → check on live         |

- Deploys to Hotel-Echo use the `docker-redeploy` skill (rollback tag first). A deploy is always the
  operator's OK, never part of a task agent's work. The Lead prepares the exact steps.
- Turning a Discord poster or the news desk on, off or to a new channel is High.
- Codex second opinion: always for secrets, exposure, deleting data and live migrations; never for UI,
  docs or small fixes.

## 8. Evidence rules

- A task that changes a number teammates see shows old and new side by side on recent real games
  before the operator picks.
- The "done when" rule is written on the task before the work starts. It needs a reason from the game,
  not only a number that fits.
- Any task that claims a number gets a Verifier. The Verifier gets its own result first.
- "Tried, no gain" results stay in the task's Report.

## 9. Limits and rhythm

- At most 2 task agents at once (the operator has a few hours a week). At most 3 open operator
  decisions; if 3 wait, the Lead starts no task that makes a fourth.
- `docs/decisions.md` is the operator's live page. The Lead updates it after every merge, decision or
  new Ready task.
- `HANDOFF.md` stays an index (Handoff Protocol in `CLAUDE.md`). The journal gets a dated entry at each
  stopping point.
- **Same commit:** after every merge, start, deploy or decision, the task's State, its board row and
  `docs/decisions.md` change in the **same** commit. A stale state is a bug. (Adopted 2026-11-14 from
  the engine Lead's report.)
- **Read the clock** (`TZ=America/Edmonton date`) in the same step that writes a time; never a time
  from memory.
- **Task Log `Resume:` lines:** after each step the task Log ends with `Resume: <the next step>`, so any
  chat (or a helper after a crash or a usage limit) continues from the file.
- **Helper model:** task agents run on Sonnet by default; Opus only when the task needs it (security,
  migrations, hard design), said on the task.
- **New Lead chat:** every week, and sooner when the context was compacted, is very long, or the Lead
  forgets an agreement. Never in the middle of a merge or a deploy. The old Lead writes the handover
  (HANDOFF, journal, a P1 paste line); the new Lead updates the board's Lead line first and tells the
  old Lead to stand down (no merges, starts or edits; its helpers report and stop).
- Kickoff prompts: `docs/operations/kickoff-prompts.md`.

## 10. What stays

The operator decides. Process is sized to risk. Plain language (STE). Say what is not done. One focused
commit per verified step. Never commit broken work. Push verified `main` commits (Commit Protocol). No
force-push and no new GitHub branch without the operator's OK. Production is Hotel-Echo; the main PC is
a stopped fallback.
