# How We Work

Adopted 2026-10-04 (workflow review, "Option A"). Replaces the Codex-as-manager
workflow, archived unchanged at
[`docs/archive/agent-manager-workflow-2026-10-05.md`](../archive/agent-manager-workflow-2026-10-05.md).

## Roles

- **The operator** (project owner) asks for things in plain language and
  decides anything irreversible. Not a software engineer: explain plainly, say
  in one sentence what will visibly change, and always say what is not done.
- **Claude Code leads**: plans, builds, verifies, deploys when approved,
  reports, and keeps `HANDOFF.md`, the journal and the plans current.
- **Codex is an optional second opinion**, through the official Codex plugin
  (ChatGPT login; never add an API key). Claude recommends, the operator types
  the command: `/codex:adversarial-review --wait <focus>` before building risky
  work, `/codex:review --wait` on the finished diff before committing. Always
  for secrets, network exposure, deleting data and live-database migrations;
  sometimes for ingestion, teammate-visible stats, or a bug that survived two
  fix attempts; never for UI, docs or small fixes. Treat findings as claims to
  check. If Codex is unavailable, continue and record the review as owed.

## Size the process to the risk

| Change                                       | Process                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| UI, docs, small fixes                        | Build it and show it (screenshot or link).                                                  |
| Database, ingestion, real data               | Short plan → fresh backup → rehearse on a copy when data changes → review → apply → verify. |
| Secrets, network exposure, deleting anything | Plan; the operator approves each irreversible step. Never print a secret.                   |

Plans are proportional: a few sentences for UI, a numbered list for a
migration. Use Plan Mode only when the risk or ambiguity warrants it.

## Doing the work

- Do discovery yourself. Use subagents (`db-reviewer`, `worker-debugger`,
  `repo-explorer`) only for genuinely parallel or specialist work.
- Verify with the smallest checks that prove the claim (the commands are in
  `CLAUDE.md`), and self-review the diff before reporting. A failing check is
  debugged in the same conversation.
- Production is Hotel-Echo; deploy with the `docker-redeploy` skill (tag
  rollback images before building; `--no-deps`).
- Never bypass a safety gate: the pre-push verification when it applies,
  verification-database isolation, secret handling.
- In a dirty working tree, don't revert or overwrite changes you didn't make;
  stop and ask when they overlap the task.

## Reporting

End each task with: what changed (the visible effect), how it was checked,
what is not done or owed, and the git state when something was committed.
Plain language, no hype; say plainly when something failed or was skipped.

## Project memory

`HANDOFF.md` is the current-state index (target 100–150 lines; hard ceiling
200 lines / 12KB; update sections in place, never append dated entries).
Detail goes to `docs/journal/YYYY-MM.md` (dated diary), `docs/planning/`
(active plans) and `docs/archive/` (retired material, copied byte-for-byte).
See the `handoff-update` skill. On resume, read `HANDOFF.md` and only the
documents the task needs (the `resume-phase` skill); trust the repo over
`HANDOFF.md` when they disagree. When compacting, keep the objective,
decisions, granted authorizations, changed files, verification state and next
actions.

## Commits and pushes

The rules live in `CLAUDE.md` ("Commit Protocol").

## Stop and ask when

- an irreversible or outward-facing step is next and hasn't been approved:
  a production deploy, a live-data migration, a deletion, exposing a service,
  moving a secret;
- the request is ambiguous in a way that changes what gets built;
- unrelated dirty work overlaps the change.

Otherwise keep moving.
