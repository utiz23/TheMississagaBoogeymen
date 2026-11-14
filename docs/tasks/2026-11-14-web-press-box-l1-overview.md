# Task: L1 — Press Box: shell, overview, relationships board, change log

- **State:** Verify (done 2026-11-14 03:49; was Running since 03:22; task agent of `Lead2`; Opus: migration + admin controls)
  (operator 2026-11-14: design and mock-up approved; "Proceed with both" 03:22)
- **Lane:** Web (`apps/web/src/app/admin/press-box/`), Queries, Database (one migration)
- **Risk:** medium (admin controls that change live press behaviour)
- **Slug:** press-box-l1
- **Operator gate before merge:** yes (screenshots)
- **Needs a deploy:** migration, `web` (and `press` only if a control needs a new reader)

## Goal and visible result

Design: `docs/superpowers/specs/2026-11-14-press-box-design.md` §3.1, §3.3; mock-up (approved):
https://claude.ai/artifact/CkBNzXiMwt9w7yujcFqAdJ (Overview, Feuds board). Build `/admin/press-box`
(admin only, `requireAdmin` on the page and every server action) with the tab bar (Overview,
Dossiers, Relationships, Storylines, Reporters; later tabs show "coming soon" until L2–L4):

- **Overview:** mode (shown; switching mode stays an ops step, read-only here), heat (cool / normal /
  hot with scope: writes the existing press settings), reporters on/off count (link), monthly spend vs
  cap with the 80% stop, "Run a free test scrum" (calls the same logic as `/gm testscrum`, T8), Now
  (open scrums, interviews, waiting GM asks), top 5 relationships both sides, top storylines (read
  only until L3), hot/cold players and milestones within reach (from existing stats queries), change log.
- **Relationships board** (T9's scale, the mock-up's feuds board in red and green): players ×
  reporters, a selected-cell panel with **cool down (halve toward zero), reset, set level (with a
  reason), freeze/unfreeze**.
- **Change log:** every Press Box action writes who, when, what (before/after summary).

## Data

Migration: `news_press_box_audit` (actor, at, kind, target, summary); relationship rows gain `frozen`,
`override_level`, `override_reason` (or fit T9's shape). Hand-written, idempotent, rollback in header.

## Paths

- **May edit:** `apps/web/src/app/admin/press-box/`, `apps/web/src/components/press-box/`,
  `apps/web/src/app/admin/` (a link to the Press Box only), `packages/db/src/queries/` (new
  `press-box.ts` + tests), `packages/db/src/schema/`, `packages/db/migrations/0080_*.sql` (0079 is E1's),
  `apps/discord/src/press/` only to export the test-scrum entry point, this task file.

## Checks

db build; typecheck db, web, discord; web unit + the db tests by name; prettier; screenshots of the
Overview and the board from the dev server on the live database through the read-only tunnel
(`?default_transaction_read_only=on`; actions disabled in that preview). Lint is red repo-wide: check
new files only.

## Done when

All checks pass; screenshots match the mock-up's layout; every action is admin-only and logged (tests).

## Log

- 2026-11-14 Lead: written.
- 2026-11-14 03:22 Lead2: started. Migration number **0080** (E1, running beside this task, has 0079 and
  adds `packages/db/src/schema/live-events.ts` + an export in the schema index): if both edit the same
  schema index line, whoever merges second rebases. Only the live database's mode stays read-only in the
  preview. Running beside E1 and backup hardening.
- 2026-11-14 03:31 Task agent: branch `work/press-box-l1`, worktree `.claude/worktrees/press-box-l1`. Read design and mock-up.
  Built migration 0080 (audit, frozen/override columns, press requests, press mode), schema, `queries/press-box.ts`
  (rules + audit in one transaction), freeze/override read by `listRelationships`, press-side reader
  `box-requests.ts` (the web page cannot post to Discord, so the test-scrum button queues a request that the
  press pass runs; needs a `press` deploy). db tests 20/20, discord box tests 5/5.
- 2026-11-14 03:49 Task agent: web pages built, screenshots taken, rebased on main (9ab1a87a), all checks green (see Report). State = Verify.

Resume: Lead reviews and runs the checks again; the operator looks at the screenshots. Deploy order: back up, apply 0080, then `web` and `press` together.

## Report

### What changed

- **Migration `0080_press_box.sql`** (hand-written, idempotent, rollback in the header): table `news_press_box_audit`
  (who, when, kind, target, summary); `news_press_relationships` gains `frozen`, `override_level`, `override_reason`;
  table `news_press_box_requests` (page to press service); `news_press_settings` gains `press_mode`, `press_seen_at`.
  Schema files and `queries/press-box.ts` (rules + audit written in one transaction).
- **Pages** `/admin/press-box` (layout with `requireAdmin` + tab bar), Overview, Relationships board (players x 9
  reporters, selected pair, cool down / reset / freeze-unfreeze / set level with reason / clear pin), "coming soon"
  for Dossiers, Storylines, Reporters. Link added on the `/admin` hub. Every server action calls `requireAdmin` first.
- **Freeze** now stops new points (`addRelationshipPointsSql` skips frozen rows) and stops fading. A **pinned level**
  is what `listRelationships` (so the press and the news writers) returns; Go easy never gets a feud-side pin; Father
  Rink's range is respected (only levels in each reporter's range are offered and accepted).
- **Test scrum button**: the web app has no bot tokens, so the button queues a request (and an audit line). The press
  service runs it on its next pass with the same code as `/gm testscrum` (`apps/discord/src/press/box-requests.ts`,
  step 8 of `runPressPass`). Needs a **`press` deploy**. The same step writes the press mode and a "seen" time each pass,
  so the page can show the mode (read only) and whether press runs.

### Decisions the Lead should know

- Choices beyond the task text: (1) the request table and the `press_mode` columns (the web cannot know `PRESS_MODE`);
  (2) "Top relationships" = the 5 strongest of both sides mixed; (3) no thread links in "Now" (the web does not know the
  guild id); (4) "Reporters" count links to `/admin/news` (the switches live there until L4); (5) cool down and reset are
  refused on a frozen pair; reset zeroes points only (a pinned level stays until cleared).
- Edits outside the "May edit" list: `apps/discord/src/press/` got a new reader (`box-requests*.ts`) plus one step in
  `pass.ts`, a line in `store.ts`, two fields in `test-fakes.ts` (the path is allowed; the scope goes past "export the
  entry point"). Also `queries/news-relationships.ts` (freeze, pin) and its test. All inside the allowed directories.
- Deploying the code before applying 0080 breaks `getPressSettings` (it reads the new columns). Apply the migration first.

### Checks (on the rebased branch, 2026-11-14 03:49)

- `@eanhl/db` build; typecheck db, web, discord, worker: clean.
- db tests by name (press-box, news-relationships, news-press, news/\*): 162/162. New press-box test file: 15 tests (rules,
  Rink, Go easy, Leave me out, freeze/fade, audit kinds, SQL shapes, migration text).
- web `test:unit`: 686/686 (new: `box-actions.test.ts` 8, `form.test.ts` 6; admin-first structure check on every action).
- discord: 848/848 (new `box-requests.test.ts` 5: zero model calls, test channel only, failure path, no store).
- worker `test`: safety suite 73/73; the integration suite needs Docker: **not run**.
- prettier: clean on every changed file. Lint not used (red repo-wide).
- Migration SQL **never run on a database** (no Docker, live is read-only): pinned by text tests only.

### Screenshots (dev server on the live DB, read-only tunnel; tunnel, server and URL file removed)

Live has no 0080 yet, so the audit list is empty and the press mode shows "not seen yet". Live has 0 relationship rows,
so the board with coloured cells uses SAMPLE cells injected by an uncommitted temporary patch (not in the branch). Auth
was bypassed by a temporary uncommitted patch for the same reason (login does not work in the read-only preview).

- Overview: `/tmp/claude-1000/-home-michal-projects-eanhl-team-website/a2a7873b-2807-4e71-85a1-f9e79d57ba31/scratchpad/shots/overview.png` (real live data; Silky "2 goals from 50")
- Phone width: `.../scratchpad/shots/overview-phone.png`
- Board, empty live state: `.../scratchpad/shots/board-empty-select.png`
- Board with SAMPLE cells and a selected pair: `.../scratchpad/shots/board-sample-selected.png`

### Not done

- Actions were never clicked on a real database (preview is read-only, no local DB): the transaction code is
  covered by pure-rule tests and SQL-shape tests only. The Lead or the operator should click each action once after
  0080 is applied.
- "Start an interview" and "Add a GM note" buttons of the mock-up (L2). Trend arrows on board cells (no history stored).
- Dossiers, Storylines, Reporters are placeholders (L2-L4).
