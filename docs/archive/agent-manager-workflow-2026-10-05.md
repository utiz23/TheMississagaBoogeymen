# Agent & Manager Workflow

This is the canonical workflow reference for this repo. `CLAUDE.md`, `AGENTS.md`,
`docs/session-playbook.md`, and the `.claude/skills/*` workflow skills all point
here instead of restating this policy. If another doc appears to conflict with
this one, this document wins for workflow process; `AGENTS.md` still wins over
`CLAUDE.md` for commit/push authorization specifically.

## 1. Objective and Session Scope

One coherent objective per conversation. Inspection, implementation,
verification, self-review, in-scope corrections, and authorized checkpointing
normally stay together in the same conversation — there is no mandatory
four-session split and no rule that a phase change or a commit forces a reset.

Split into a fresh conversation when the objective itself changes, when the
current thread is genuinely covering more than one unrelated objective, or
when the transcript has grown long enough that decisions are hard to find
(see §8). Don't split work that belongs together just to match a phase
template.

## 2. Plan Mode

Use Plan Mode when uncertainty, unfamiliar consequential code, or a
significant design/risk decision warrants reviewing an approach before
touching files. Obvious, bounded changes (a described bug fix, a narrow
doc edit, a mechanical rename) can execute directly.

There is no fixed time threshold for this decision. Weigh it against the
actual blast radius and ambiguity of the change, not an estimate of how long
it will take. A plan, when one is warranted, should be proportional to the
decision — a short outline for a moderate design choice, more detail for a
schema/migration or cross-system change.

## 3. Authority Model: Codex and Claude

When Codex is acting as the managing/review layer for a piece of work: Codex
defines the outcome, constraints, acceptance criteria, and review scope.
Claude owns detailed technical planning and execution within that scope.

In that setup, Claude should not invoke another manager layer on top of
Codex's — the `manager` subagent and the `manager-orchestration` skill exist
for sessions where Claude Code is operating **without** an external
Codex/manager layer already in place (see `.claude/agents/manager.md`). Do not
spawn `manager` just because a task is nontrivial when Codex already assigned
it.

Recommended prompts from Codex to Claude should state the model, effort
level, and starting mode (Plan Mode vs. direct execution) immediately before
the copy-paste prompt block — never inside the plaintext prompt itself, since
that text is meant to stand alone in Claude's context.

## 4. Discovery and Delegation Default

Main-agent discovery is the default: read the files, grep the repo, and trace
the code yourself. Do not proactively delegate to `repo-explorer` or a
general-purpose subagent just because a task involves some searching.

Delegate only when independent, parallelizable work gives a concrete
reliability or time benefit — for example, two unrelated investigations that
don't share state, or a narrow specialist (`db-reviewer`, `worker-debugger`)
whose focused tool access reduces the chance of an accidental edit. A single
open-ended cleanup or refactor task does not, by itself, justify subagents.

### Specialist delegation map (when delegation is actually warranted)

| Specialist        | Use for                                                          | Default model / effort |
| ----------------- | ---------------------------------------------------------------- | ---------------------- |
| `repo-explorer`   | locating files, tracing data flow, narrow architecture questions | `Sonnet 5` / `low`     |
| `db-reviewer`     | Drizzle schema review, migration safety, aggregate/query checks  | `Sonnet 5` / `high`    |
| `worker-debugger` | ingestion failures, transform bugs, reprocess/idempotency issues | `Sonnet 5` / `high`    |

Raise `db-reviewer` or `worker-debugger` to `Opus 5` at `high` when the change
touches live-data migration, cross-package query contracts, or is otherwise
stubborn and correctness-critical.

## 5. Self-Review Before Reporting

Before reporting work as done, review your own diff for in-scope code, test,
and documentation defects, and fix what you find. An ordinary failing test or
typecheck error triggers debugging in the same conversation, not an automatic
handoff to another session or agent.

Escalate instead of silently deciding when you hit: a material design
decision outside what was scoped, an unresolved blocker, a conflicting edit
in the working tree, or an action outside what this conversation was
authorized to do (commits, pushes, production/provider operations,
user-global config changes).

## 6. Codex Review and Correction Batching

When Codex reviews Claude's result, it should treat the report as a claim,
inspect the repository and any verification evidence directly, and decide
independently whether the checkpoint passes, needs correction, or is blocked.

Reuse prior verification evidence only when it still applies to the reviewed
state (same files, same behavior). Rerun checks when the code has changed
since that evidence was produced, evidence is missing for what changed, or a
specific concern warrants a targeted recheck. Batch substantive corrections
into one follow-up scope rather than sending them one at a time.

Preserve all mandatory hooks and safety gates (pre-push verification,
verification-DB isolation, secret handling) regardless of review outcome —
review findings are never a reason to bypass them.

## 7. Verification Scope

Verification should match what actually changed, not a fixed checklist run
every time:

- Documentation-only changes: diff review, content/link checks (do the
  references you touched or added still resolve?), and — for anything a hook
  or script depends on — a check that the referenced path/command still
  exists.
- Hook or script changes: focused behavioral checks against the changed
  logic (fixture inputs, a stubbed dependency where the real one is
  destructive or slow), not a full repo build.
- Code changes: the smallest relevant gate that proves the claim —
  `pnpm typecheck` / `pnpm lint` / `pnpm format:check` as a baseline, plus
  package-specific rebuilds and tests as described in `CLAUDE.md`.

Do not run a blanket repository-wide formatting pass (`pnpm format` over
everything) as a substitute for verifying the actual change — format only
what you touched, and only when a format check on those files fails.

## 8. Context and Compaction

Compact an ongoing conversation when context becomes long enough that
decisions are hard to find, or when repeating prior context is replacing
forward progress. Start a fresh conversation for an unrelated objective or
when confusion in the current thread is persistent rather than momentary.

When compacting, preserve: the active objective, decisions made and their
rationale, authorization boundaries already granted, the files changed so
far, current verification state (pass/fail, not full logs), and the next 1-3
concrete actions. Move anything durable into `HANDOFF.md`, the current
month's journal, or another repo file rather than carrying it forward as
chat history alone — see `.claude/skills/handoff-update/SKILL.md`.

### HANDOFF.md lifecycle

`HANDOFF.md` is a size-capped current-state index, not a log:

- 100-150 lines is the target to aim for; 200 lines and 12KB are hard
  ceilings that must not be exceeded.
- It holds: the current objective/status, the latest verified checkpoint,
  essential operational constraints (summarized directly, not reproduced),
  immediate blockers, links to the active documents that carry the detail,
  and the next 1-3 actions.
- Updates replace the relevant section in place. Never append a new dated
  session entry on top of the last one — that append pattern is what grew
  this file past 8,600 lines before the 2026-09-12 compaction.
- Durable detail lives elsewhere, each account with exactly one
  authoritative home:
  - `docs/journal/YYYY-MM.md` — a concise dated work diary (normally 5-10
    bullets per meaningful milestone: outcome, decisions, verification,
    commit references when available, and links). `HANDOFF.md` should link
    to a journal entry instead of restating it.
  - `docs/planning/` — active plans and roadmaps. Keep the existing topical
    layout; don't reorganize it wholesale just to make room for one item.
  - `docs/archive/` — historical handoff snapshots and retired/superseded
    plans or reports, each clearly marked with its status and, if
    superseded, a link to the replacement.
- Check the size as part of every ordinary `HANDOFF.md` update (`wc -l` /
  `wc -c`) — this is not a separate audit step. Crossing 150 lines doesn't
  by itself obligate a migration: try tightening the prose first — a
  concise summary of an active blocker or constraint is fine as long as its
  substance (constraints, decisions, links) survives. Relocate into the
  roadmap, the current journal, or a dated archive file, in that same
  update, when condensing alone won't keep the file inside the 200-line /
  12KB ceiling, or when the material genuinely isn't current state anymore.
  Don't leave it oversized for a later cleanup session, and don't retire
  still-open work just because it's old — age alone does not make a
  blocker or decision obsolete.
- Startup/resume reads `HANDOFF.md` plus only the linked documents the
  current task actually needs. Don't routinely open the journal or the
  archive — they're for when a task specifically needs that history.

## 9. Completion Report Format

When reporting a conversation's work as complete, state:

1. Outcome — what was actually accomplished, plainly.
2. Checkout / branch / baseline — what commit or branch the work started
   from and where it landed.
3. Changed files — the concrete list, not "various files."
4. Checks run and their results.
5. Remaining issues or limitations, if any.
6. Actual Git state at the end (`git status --short`, `git log -1`) — not an
   assumption about what should be true.

## Fast Resume Sequence

When a session starts or context is thin:

1. Read `HANDOFF.md` and only the linked documents your task actually
   needs. Do not routinely open `docs/journal/` or `docs/archive/` — read
   them only when the task specifically requires that history.
2. Read the relevant section of `docs/ARCHITECTURE.md`.
3. Check `git status --short`.
4. Inspect only the files implicated by the current task.
5. Summarize: current state, what is already done, what is risky or
   unresolved, and the next concrete actions.

If `HANDOFF.md` and the repo disagree, trust the repo and call out the
mismatch.

## Task Routing (for the `manager` subagent, when it is the right tool per §3)

### Use read-only manager mode when:

- the user wants orientation
- the user wants a review
- the user wants a plan
- the task is blocked on understanding current repo state

### Use implementation mode when:

- the user explicitly approves edits
- the change scope is concrete enough to execute
- the likely blast radius is understood

### Use review mode when:

- the user asks for a review
- a risky change landed in DB, ingestion, or aggregation logic
- the repo has dirty changes and correctness matters more than speed

Review output should lead with findings, ordered by severity, with file
references.

## Claude Recommendation Policy

Before generating any Claude/sub-agent task, state:

1. recommended model
2. recommended effort level
3. recommended starting mode (Plan Mode vs. direct execution)
4. why that combination is appropriate

Use this baseline unless the task clearly justifies something heavier:

| Task shape                                         | Model      | Effort   |
| -------------------------------------------------- | ---------- | -------- |
| mechanical edit, repo lookup, or narrow tracing    | `Sonnet 5` | `low`    |
| routine implementation, review, UI, tests, or docs | `Sonnet 5` | `medium` |
| difficult debugging, DB/query, or ingestion work   | `Sonnet 5` | `high`   |
| risky architecture, migration, or security review  | `Opus 5`   | `high`   |
| hardest ambiguous or long-horizon work             | `Fable 5`  | `high`   |

Use `xhigh` only for demanding agentic work expected to run longer than 30
minutes or require extensive exploration. Use `max` only for genuinely
frontier tasks after `xhigh` has proved insufficient. Do not overspend model
or effort on trivial work, and do not choose a heavier model merely because a
task is important.

## Dirty Worktree Rules

This repo is often dirty.

- never revert user changes without explicit instruction
- do not let a specialist bulldoze unrelated diffs
- if a task overlaps existing dirty files, inspect carefully before changing
  anything
- if overlap creates ambiguity, stop and surface the conflict instead of
  guessing

## Communication Standard

Updates should be short and operational: what's being checked, what was
found, what happens next. Avoid filler, hype, and fake certainty.

## Commit Discipline

- do not commit automatically unless the user asked for it or explicitly
  wants a checkpoint/backup
- inspect `git status --short` before every commit decision
- distinguish focused commits from full-repo snapshot commits
- do not mix unrelated dirty files into a focused commit
- if the user wants a recoverable backup, push after commit; local-only is
  not enough

See `AGENTS.md` for the full commit/push/branching rules, which take
precedence over anything here if they ever disagree.

## Stop Conditions

Stop and ask before proceeding when:

- the requested change conflicts with existing dirty edits
- a schema/data migration risk is high and intent is unclear
- a deployment or destructive action is required
- the user asked for analysis only

Otherwise, keep moving.
