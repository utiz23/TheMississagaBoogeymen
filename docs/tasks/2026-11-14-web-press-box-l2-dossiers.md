# Task: L2 — Press Box: player dossiers and AI profiles

- **State:** Running (since 2026-11-14 14:04; task agent of `Lead2`; Opus: AI text about players +
  migration) (operator 2026-11-14 14:04: "start L2")
- **Lane:** Web, Queries, Database (one migration), Discord (profile writer)
- **Risk:** medium (AI text about players; actions on players' press)
- **Slug:** press-box-l2
- **Operator gate before merge:** yes (screenshots)
- **Needs a deploy:** migration, `web` (and `news`/`press` if the profile writer runs there)

## Goal and visible result

Design §3.2; mock-up "Player dossier". `/admin/press-box/players` (index: members, bench people who
talked, coach; press level, relationship count, quote count, last scrum/interview, profile age) and
`/admin/press-box/players/[id]`:

- identity, nicknames, press level and who set it, role;
- form and milestones within reach (existing stats);
- "in their own words": usable and joke quotes with question and reporter; unusable and off-limits as
  counts only, never text;
- what the press thinks (takes and stances, read here; editing comes in L3), relationships per reporter;
- GM notes and asks, interviews (article links), scrums;
- **AI profile on demand**: "Write"/"Refresh" makes one model call through the news desk's writer with
  all writing rules, hard lines, no crude quotes; Go easy = no criticism; Leave me out = no profile and
  identity only; cost counted in the monthly spend; stored with its date and rules version;
- actions (logged): press level on the player's behalf, add/remove nicknames, add a GM note, start an
  interview, cool down a relationship.

## Data

`news_player_profiles` (player id or bench person, text, written_at, rules version, cost). Hand-written
migration with rollback.

## Paths

- **May edit:** `apps/web/src/app/admin/press-box/`, `apps/web/src/components/press-box/`,
  `packages/db/src/queries/` (press-box files + tests), `packages/db/src/schema/`,
  `packages/db/migrations/0081_*.sql` (0079 is E1's, 0080 is L1's), `apps/discord/src/news/` (profile
  prompt + writer entry only), `apps/discord/src/press/box-requests*.ts` and the one `pass.ts` step that
  runs them (new request kinds only),
  this task file.

## Checks

As L1, plus tests: Leave me out shows identity only, Go easy profile has no criticism rule in its
prompt, off-limits text never rendered, profile write is one call and recorded in spend.

## Done when

All checks pass; screenshots match the mock-up.

## Log

- 2026-11-14 Lead: written.
- 2026-11-14 14:04 Lead2: started after L1 was deployed (14:01). The web app has no Anthropic key and
  no bot tokens: "Write"/"Refresh" profile and "start an interview" go through L1's request queue
  (`news_press_box_requests`, read by `apps/discord/src/press/box-requests.ts` in the `press` service),
  as L1's test scrum does: add request kinds (migration 0081 widens the kind check), the press service
  does the model call / interview and records the cost in the monthly spend. Then `press` is in the
  deploy too. Running beside D4 (worker watchdog).

- 2026-11-14 14:08 task agent: worktree `.claude/worktrees/press-box-l2` (branch `work/press-box-l2`) made; install + db/ea-client build done; read design §3.2, mock-up "Player dossier", L1 code. Plan: migration 0081 (profiles table; request kinds profile + interview with target columns), db queries, press-service handlers, web pages.

- 2026-11-14 14:19 task agent: DONE migration 0081 (profiles table, request kinds profile/interview + target columns), schema, `press-box-dossiers.ts` queries (index, dossier read, actions with audit, request queue, profile store), db tests (11 new, 15 old still pass), press service: `news/profile.ts` (writer: one write + one review, no digits/quotes, Go easy rule, Leave me out refused before any call), `press/box-requests-profile.ts` (profile and interview handlers), tests (discord suite 864 pass, typecheck clean). Migration SQL not run: no database on this PC.

Resume: web pages (`/admin/press-box/players`, `/players/[id]`), dossier actions, tab link, tests, screenshots.

## Report
