# Task: T2 — panel scrums (3 reporters) and `/gm ask` (GM shapes questions)

- **State:** Ready, starts after T1 (`2026-11-13-discord-press-typed-answers.md`) is merged
- **Lane:** Discord (`apps/discord/src/press/`), Database (one hand-written migration), Queries
- **Risk:** medium (live bots; a migration on live, additive only)
- **Slug:** press-panel (branch `work/press-panel`, worktree `.claude/worktrees/press-panel`)
- **Operator approval:** 2026-11-13 ("start"; design in
  `2026-11-13-discord-press-panel-scrums-interviews.md` items 1, 3)
- **Operator gate before merge:** no; the migration and deploy are the operator's OK (Lead runs them)
- **Needs a deploy:** migration 0073 (after a fresh backup), then `press`, `news`, `web` if shared code
  changes

## Goal and visible result

1. **Panel scrum.** Each picked or GM-requested player is asked by **3 different reporters**, one
   question each, each posted by that reporter's own bot in the same thread. Follow-ups (at most 1 per
   reporter, by the same reporter, right after the answer) bring the player's total to a **target drawn
   per player: 3 (10%), 4 (25%), 5 (50%), 6 (15%)**. Follow-ups go to the answers with the most to chase;
   never after an unusable answer; if the answers do not allow the target, the round is shorter.
   Volunteers ("Talk to the press", `/scrum`): **2 reporters, no follow-up**.
2. **`/gm ask`** (GM only): `player` (user, required), `question` (text, required), `reporter` (choice of
   the 8 scrum reporters, optional; default: the panel's first), `exact` (boolean, default true),
   `game` (tonight's game number, optional, like `/gm note`). The player joins that game's scrum as a GM
   request (pinged after the usual 60 s; if the scrum is not open yet, when it opens). The chosen
   reporter asks that question as the player's **first** question: word for word when `exact`, else
   written from it as a topic in the reporter's voice. That reporter is part of the player's panel.
   Private reply to the GM: "Got it: <Reporter> will ask <Player>: <question>". Refused (private reply,
   nothing stored as active) for a "Leave me out" player; for a "Go easy" player when the question is
   critical (use the existing criticality check; fail closed) or the AI check is unavailable.

3. **Variety (operator's thread, 2026-11-13):** in one scrum, the questions to different players do
   not repeat the same angle (game 3439: every player got the "23 to 5 hits" question). Pass the
   angles already used in the scrum to the question writer and forbid repeats.
4. **No silent answers:** an unusable answer is still never echoed or quoted, but the next line
   acknowledges it briefly in the reporter's voice (no repeat of its words), so the player knows it
   arrived (game 3439: Erb's and Silky's first answers seemed to vanish).

## Rules that stay

Heat, rotation, takes and disabled-reporter rules pick the panel (no Father Rink); the 80% budget stop;
ping limits; trial vs live; quotes only from usable/joke answers; the night recap waits for open scrums
(at most 30 minutes); every quote attribution names the reporter who asked ("told Dex Mercer").

## Data

Hand-written idempotent migration `packages/db/migrations/0073_press_panel.sql` (same form and header
as 0072: how to apply, rollback). Lead suggestion, the agent may refine: `news_scrum_people` gains
`panel text[]` (reporter ids in order) and `target_total integer`; `news_scrum_answers` gains `reporter`
text; a GM ask is stored as a `news_gm_notes` row with new nullable columns `question_text`,
`question_exact boolean`, `question_reporter text` (or a small new table: agent's choice, say why).
Existing rows keep working (one-reporter scrums stay readable). Schema in
`packages/db/src/schema/news-press.ts`, queries in `packages/db/src/queries/news-press.ts`.

## Paths

- **May edit:** `apps/discord/src/press/`, `apps/discord/src/news/` (quote attribution, recap material),
  `packages/db/src/schema/news-press.ts`, `packages/db/src/queries/news-press.ts` + tests,
  `packages/db/migrations/0073_press_panel.sql`, `packages/db/src/news/` (rules version, shared types),
  `apps/web/src/` only if a shared type forces it, the press runbook, this task file.

## Checks

db build; typecheck db, web, discord, worker; discord tests; db query tests by name; prettier. Tests for:
the target distribution (seeded), 3 distinct reporters, follow-up allocation, volunteer round, `/gm ask`
exact and topic paths, refusals, the first question of a GM-asked player, the migration SQL shape
(pinned builder or a read of the file). Migration not applied anywhere by the agent.

## Done when

All checks pass; tests pin the rules above; the Report lists the schema change and the rollback.

## Log

## Report
