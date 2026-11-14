# Task: T9 — relationships: one scale from open war to glazing, plus reporter dispositions

- **State:** Merged (Lead review 2026-11-14); deploy waits for the operator's OK
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
- 2026-11-14 Task agent: work on `work/press-relationships` (rebased on main, `6fe80d6b`). Built the signed scale, dispositions, ranges, taste, praise, strong-answer rating, effects, admin line. Checks green (see Report). Judgment calls are rulings 85-92 in `docs/superpowers/plans/2026-10-26-news-desk-bots-rulings.md`. Nothing deployed, migration 0078 not applied, nothing pushed. No Docker: the SQL was pinned by tests, never run on a database. Paths: all inside "May edit" plus the rulings file and the press runbook.

- 2026-11-14 Lead review: rebased on main (T10 inside); rulings renumbered 85-92 (T10 took 84); paths inside "May edit" plus the rulings file, the runbook and a one-line re-export in `queries/index.ts` (accepted). Re-ran: typecheck db/discord/web/worker clean; discord 843/843; news db tests 132/132; web unit 672/672; prettier clean. Deploy: build images first, then backup → 0078 → `press`, `news`, `web` at once (old code reads the old table name).

## Report

### What changed

- **One signed scale.** New `packages/db/src/news/relationships.ts` replaces `feuds.ts`. Table `news_press_feuds` becomes `news_press_relationships` (migration 0078, signed points, cap +-12). Queries `addRelationshipPoints` (one atomic upsert, fades toward zero, caps both ways), `listRelationships`, `isPressThread`. Press side: `press/relationships.ts`, `relationship-store.ts`, `relationship-db.ts` (renamed from the feud files).
- **What moves it.** Down: insults (T5 values: mild -1, strong -2). Up: thanks or a compliment (new `praise` field in the hard-line check: nice +1, glowing +2; an insult wins; no extra call), a usable answer the judge rates strong (new judge field `quality`, +1 for the asking reporter, scrum and interview), a big night in the reporter's taste (+1, once per night recap, after the item is stored, never in a dry run). A typed non-answer message in a press thread counts by code (reporter name plus a kind word = nice). Off-limits never moves it; "Leave me out" stores nothing; a person with no player row stores nothing (T7); a test scrum changes nothing (T8).
- **Disposition and range per reporter** (in `reporters.ts`, code). Disposition scales the steps (up x(1+0.25d), down x(1-0.25d)) and gives a lean of 0.5d points that never fades (max 1, below the first threshold). Range clamps the level on read; a step the range cannot allow is not stored. **Father Rink: floor = neutral, hard rule at write and at read** (tested; an old T5 row for him reads neutral).
- **Effects.** Level lines for warm, fan, glazing in questions, judgements, interview questions and wire replies (tone only). Panel: feud or war x3, fan or glazing x2. Interview rotation: fan or glazing x2. Night recap and weekly column: storyline at feud, open war, fan, glazing (writing reporter only, at most 2, as the reporter's view). "Go easy": feud side reads neutral everywhere, favour side used.
- **Admin.** `/admin/news` line is now "Press relationships (GM only)" with signed points and level.
- **Rules/runbook.** Rulings 85-92; runbook section "Relationships".

### Thresholds (T5 kept on the negative side)

Open war <= -10, feud <= -5, simmering <= -2, neutral, warm >= +2, fan >= +5, glazing >= +10; cap +-12; half-life 7 days. Why: one scale, mirrored; one thank-you is only a lean for a homer, about three strong praises (or two glowing) make a fan, a long streak makes glazing.

### Defaults per reporter (disposition d, floor to ceiling, taste = one game line)

| Reporter       | d   | Range                  | Taste (big night)     |
| -------------- | --- | ---------------------- | --------------------- |
| Wade Barlow    | 0   | feud to fan            | hits 6+, assists 3+   |
| Talia Voss     | +1  | simmering to glazing   | assists 3+, points 4+ |
| Dex Mercer     | -1  | open war to fan        | goals 3+              |
| June Halberd   | 0   | feud to fan            | assists 3+, shots 8+  |
| Rico Vale      | +2  | feud to glazing        | goals 3+, points 4+   |
| Mara Quill     | -1  | feud to warm           | shots 8+, points 4+   |
| Father Rink    | +1  | **neutral** to glazing | saves 30+, goals 3+   |
| Gord Pettibone | -2  | open war to warm       | points 5+             |
| Lyle Bergstrom | +1  | feud to glazing        | shots 8+, hits 6+     |

Worked examples: one nice thank-you is +1.5 for Vale (with lean +1: warm at once) and +0.5 for Pettibone (with lean -1: still neutral). A strong insult is -2.5 for Quill and Mercer-types (critics), -3 for Pettibone.

### Prompt changes (`NEWS_RULES_VERSION` 2026-11-14.1 -> 2026-11-14.2)

- Relationship rule 16 replaces feud rule 15 in the scrum asker/judge, interview and wire-reply prompts: both sides, tone not facts ("every number still comes from the sheet, never inflate"), professional, no profanity, never name the level. New judge rule 15 (`quality`). New hard-line check rule 5 (`praise`), old 5-6 become 6-7.
- System rule 39 (news writers) now covers feud and favour: one short line, reporter's view, praise is tone only, never an invented or bigger number, no relationship without a listed one. Block title "Relationships".

### Migration 0078 and rollback

`packages/db/migrations/0078_press_relationships.sql`: renames `news_press_feuds` to `news_press_relationships` (table, constraints, pkey, sequence), turns every stored T5 point negative once (only on the run that renames), replaces the points check with `between -12 and 12`; creates the table fresh if 0076 was never applied; idempotent; hand-applied with psql. Apply BEFORE deploying `press`, `news`, `web` (the old code reads the old name). Rollback SQL in the header (favour-side rows deleted, rest flipped back, table renamed back). Not applied; never run on a database (no Docker).

### Checks (worktree, after `pnpm --filter @eanhl/db build`)

- Typecheck db, discord, web, worker: all clean.
- `pnpm --filter @eanhl/discord test`: 836 of 836 (was 766 at T5; T6-T8 included).
- db: `pnpm --filter @eanhl/db test` 246 of 246; `news-relationships`, `news-press`, `news-wire-replies`, `news-interviews` query tests by name: 74 of 74.
- web `pnpm test:unit`: 672 of 672.
- Prettier: all changed files clean.
- Mutation check: Father Rink's floor set to feud: 2 tests fail (db and discord); restored.
- Not run: the migration on a database, `pnpm --filter web build`, any live or Docker step, a screenshot of the admin table (no dev server).

### Tests that pin the rules

Signed scale and thresholds both ways; fading both ways; cap; dispositions scale the steps and the lean; homer glazes easily, critic almost never; range clamps (Pettibone cannot glaze, Vale cannot reach war); Father Rink never below neutral (no write, read neutral, still glazable); one number (praise then insults cancels); insult, compliment (nice, glowing), strong answer (ok, joke, unusable, missing field), taste (hit, quiet, dry run, once, write failure) triggers; off-limits, Leave me out, no player row, test scrum, bench: nothing; Go easy never the feud side, favour used; prompts carry "tone not facts"; migration SQL shape (rename, flip after dropping the old check, fresh create, rollback in header); panel and interviewer weights.

### Not done / open risks

- Weekly feature subject is not chosen by favour ("more features for that player"): only the storyline and tone are built. `/gm` reply does not show the level (admin page does). Say if you want either.
- Taste thresholds and dispositions are my defaults from the voices; they are code until L4. The Lead should look at the table.
- A "Go easy" player can be glazed; a night recap can then say "X is a fan of Y": tone, but check the first posts.
- Cost: no new calls (praise rides the hard-line check, `quality` the judge). One extra judge field.
- Deploy order matters (0078 first); old images break after 0078 (they read the old table name; the failure is logged, no points saved).
- The 0076 file and the T5 task text keep the "feud" wording (history).
- Taste hits count once per night recap but a recap job that fails after the item insert and is retried cannot double count (the item exists); a recap deleted and rewritten would count again.

### Git state

Branch `work/press-relationships`, on top of `6fe80d6b`. Code commit `14165c28`, then this task-file commit. Not pushed, not merged, not deployed.
