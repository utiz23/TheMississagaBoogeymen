# Task: L2 — Press Box: player dossiers and AI profiles

- **State:** Ready (operator 2026-11-14); starts after L1 is merged
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
  `packages/db/migrations/<next>_*.sql`, `apps/discord/src/news/` (profile prompt + writer entry only),
  this task file.

## Checks

As L1, plus tests: Leave me out shows identity only, Go easy profile has no criticism rule in its
prompt, off-limits text never rendered, profile write is one call and recorded in spend.

## Done when

All checks pass; screenshots match the mock-up.

## Log

- 2026-11-14 Lead: written.

## Report
