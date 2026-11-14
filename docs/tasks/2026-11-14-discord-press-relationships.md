# Task: T9 — relationships: one scale from open war to glazing, plus reporter dispositions

- **State:** Ready (operator 2026-11-14: "yes write the cards"); starts after T8 is merged
- **Lane:** Discord (`apps/discord/src/press/`, `apps/discord/src/news/`), Database (one migration)
- **Risk:** medium (tone of posts about players; data model change of T5's feuds)
- **Slug:** press-relationships
- **Operator approval:** 2026-11-14
- **Operator gate before merge:** no; migration and deploy with the operator's OK
- **Needs a deploy:** migration (next free number), `press`, `news`

## Why

A teammate asked for bots that "glaze" the players. Operator: the natural opposite of feuds.

## Goal and visible result

- **One relationship scale per player and reporter** (replaces T5's feud-only points):
  `open war · feud · simmering · neutral · warm · fan · glazing`. Signed points; negative = feud side
  (T5 thresholds kept: −2 simmering, −5 feud, −10 open war), positive = favour side (Lead: +2 warm,
  +5 fan, +10 glazing; cap ±12). Points fade toward zero (half-life 7 days, as T5). A reporter cannot
  feud and glaze the same player at once (one signed number).
- **What moves it up:** a compliment or thanks to that reporter (judge class, like T5's insult); a
  usable answer the judge rates strong; a big night that matches the reporter's taste (per-reporter
  taste list in the reporter definitions, e.g. Vale: highlight goals; Bergstrom: shot volume).
  **Down:** insults (as T5). Off-limits messages never move it (T5 rule kept).
- **Reporter disposition** (homer ↔ critic, −2…+2 per reporter, in the reporter definitions; the Press
  Box L4 makes it editable): scales the up and down steps and the starting lean (e.g. Rico Vale +2
  glazes easily; Gord Pettibone −2 almost never). Defaults set by the Lead from each reporter's voice;
  listed in the Report.
- **Per-reporter range** (operator 2026-11-14: "some bots are more prone to conflict than others;
  Father Rink should never engage in feuds"): besides the disposition, each reporter has a floor and a
  ceiling on the scale (in the reporter definitions; L4 makes them editable). **Father Rink: floor =
  neutral, never on the feud side (hard rule, tested).** Lead defaults for the others from their voice
  (e.g. Pettibone and Mercer reach open war easily; Vale reaches glazing easily), listed in the Report.
- **Effects:** warm/fan/glazing = warmer questions, more interviews and features for that player,
  over-the-top praise in that reporter's posts, recaps and columns ("Bergstrom has been on the Stick
  Menace bandwagon all month"); feud side as T5. Facts only from the sheet: glazing is tone, never
  invented stats. Prompts state both.
- **Press levels:** "Go easy" players may be glazed (positive), never feuded (T5). "Leave me out":
  nothing stored or used.
- **GM:** `/gm` reply or Press Box (L1) shows the level; T5's admin feud line becomes "relationships".

## Data

Migration (hand-written, idempotent, rollback in header): `news_press_feuds` gains signed points (or is
renamed/extended to `news_press_relationships`: agent's choice; keep T5 data, map existing points to
the negative side). Reporter dispositions and tastes live in code (`packages/db/src/news/` reporter
definitions) until L4 adds overrides.

## Paths

- **May edit:** `apps/discord/src/press/`, `apps/discord/src/news/`, `packages/db/src/news/`,
  `packages/db/src/schema/`, `packages/db/src/queries/news*.ts` and their tests,
  `packages/db/migrations/<next>_*.sql`, `apps/web/src/app/admin/news/` (rename the feuds line only),
  the rulings file, the press runbook, this task file.

## Checks

db build; typecheck db, discord, web, worker; discord tests; changed db tests by name; web unit; prettier.
Tests: the signed scale and thresholds both ways, fading, dispositions scale steps, compliment/strong
answer/taste triggers, insults still lower, off-limits never moves it, Go easy never on the feud side,
Leave me out nothing, prompts carry the "tone not facts" rule, existing T5 points preserved.

## Done when

All checks pass and the tests pin the rules above.

## Log

- 2026-11-14 Lead: written from the operator's request and approval.
- 2026-11-14 operator: some reporters are more prone to conflict; Father Rink never feuds → per-reporter range added.

## Report
