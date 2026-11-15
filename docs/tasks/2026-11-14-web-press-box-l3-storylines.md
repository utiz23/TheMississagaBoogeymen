# Task: L3 — Press Box: storylines, trends, takes and stances editor

- **State:** Merged 2026-11-14 18:46 (`f060cd49`; operator D25 "yes"); deploy waits for the operator's OK
- **Lane:** Web, Queries, Database (flags), Discord (writers read pins)
- **Risk:** medium (edits feed the writers)
- **Slug:** press-box-l3
- **Operator gate before merge:** yes (screenshots)
- **Needs a deploy:** migration if needed, `web`, `news`, `press`

## Goal and visible result

Design §3.4; mock-up "Storylines & trends". `/admin/press-box/storylines`:

- open storylines (the reporter-system threads) with each reporter's stance (for/against/take) and
  when it last moved; **pin** (one at a time: the writers get it as a suggested angle for the next
  recap and scrums), **unpin**, **close**, **new storyline**;
- trends from data: streaks, slumps, milestones, most quoted, most insulted reporter, quiet players;
- **takes and stances editor**: add, edit, remove (text checked on save with the same hockey-only and
  hard-line rules); the takes section of `/admin/news` moves here (`/admin/news` keeps a link).
  All actions logged (L1 change log).

## Paths

- **May edit:** `apps/web/src/app/admin/press-box/`, `apps/web/src/app/admin/news/` (takes section →
  link), `apps/web/src/components/press-box/`, `packages/db/src/queries/` (+ tests),
  `packages/db/src/schema/`, `packages/db/migrations/0085_*.sql` (0084 is the newest), `apps/discord/src/news/` and
  `apps/discord/src/press/` (read the pinned storyline only), this task file.

## Checks

As L1, plus tests: one pin at a time, a pinned storyline reaches the recap and scrum prompts as a
suggestion, closed ones never do, edited text passes the checks.

## Done when

All checks pass; screenshots match the mock-up.

## Log

- 2026-11-14 Lead: written.
- 2026-11-14 18:00 Lead2: started. Live since this task was written: L1, L2, B1/B2 (player background:
  confirmed facts reach writers; GM notes), Club Finals CF1–CF3 + CF2 (finals moments in news and press).
  Pinned storylines and takes must sit beside those inputs, not replace them.

- 2026-11-14 18:35 task agent: built. Migration 0085 (`news_storylines`), queries, `/admin/press-box/storylines`,
  takes editor moved from `/admin/news`, writers read the pinned storyline (news recap prompts, scrum question
  prompt). Checks green (Report). Screenshots taken on the live DB, read-only tunnel (login bypass was
  uncommitted and reverted; server and tunnel stopped; URL file deleted).

Resume: the Lead reviews the branch `work/press-box-l3`, shows the screenshots to the operator, then merges. Deploy
order is in the Report.

## Report

**What changed**

- Migration `packages/db/migrations/0085_press_box_storylines.sql` (hand-written, idempotent, rollback in header): table
  `news_storylines` (title, angle, `pinned`, `closed_at`, optional `thread_key`). A unique partial index allows ONE pinned
  row; a check says a pinned row is never closed. Takes (`news_reporter_takes`) and stances (`news_stances`) keep their tables.
- Reporter-system threads stay derived (not stored). Pin or close one and a row is made for its key. "New storyline" makes a
  typed one (its stances use key `storyline:<id>`).
- Page `/admin/press-box/storylines`: open storylines with each reporter's stance and last move, Pin / Unpin / Close / New
  storyline, add / edit / remove stance, trends (point streaks, slumps, milestones, most quoted, most insulted reporter,
  quiet players), "Writers get tonight" panel, takes editor (add / edit / remove). `/admin/news` keeps a link; its old
  takes editor and its unlogged `saveTakeAction` are removed.
- Every action: `requireAdmin` first, text checked, change written to `news_press_box_audit` in the SAME transaction (10 new
  kinds). The audit line never holds a typed text.
- Text check on save (`press-text-check.ts`): the desk's own crude / slur / strong-word lists (copied word for word; a test reads
  `apps/discord/src/news/crude.ts` and `fact-check.ts` and fails if they differ), no digit in title / angle / stance, no name of a
  "Leave me out" player (`namesAny`), length limits. A take may keep digits (as before).
- Writers: `getPinnedStoryline()` (pinned AND not closed). News desk: game posts (recap), game articles and the night recap
  prompt get a "PINNED STORYLINE" block after the Club Finals block. Scrum question prompt gets the angle (not the judge).
  Confirmed background, GM notes and Club Finals moments are untouched. A read failure logs and writes without it.

**Checks (numbers)**

- `@eanhl/db` build ok; dist tests `press-box-storylines` + `press-text-check` 19/19; all other db dist tests 248/248 (the 3 known
  old failures excluded); typecheck web, discord ok.
- web `test:unit` 768/768; discord all tests 968/968 (new: pinned.test, 4 cycle tests, 3 scrum tests).
- prettier: none of my files flagged (format:check lists 36 old files, same on main). eslint on new files: only repo-wide style
  noise in test files (`!`, bracket access); source files clean except one old line in news/page.tsx.
- Test coverage of the "Checks" line: one pin at a time (order unpin-then-pin in one transaction + unique index), pinned reaches
  game, night-recap and scrum prompts, closed / unpinned never read (SQL + close unpins), edited text passes the checks.
- Not run: no real database test (no Docker): the actions run against a scripted fake transaction; migration 0085 was NOT applied
  anywhere. No real model call.

**Screenshots** (`/tmp/claude-1000/-home-michal-projects-eanhl-team-website/a2a7873b-2807-4e71-85a1-f9e79d57ba31/scratchpad/shots-l3/`):
`live-desktop-1280.png`, `live-phone-390.png`, `live-takes-open-desktop-1280.png` (real live data, read-only; 0085 absent so
no Pin / Close buttons and a notice), `sample-pinned-desktop-1280.png`, `sample-pinned-phone-390.png` (SAMPLE data through the real
components, to show the pinned state; temp page deleted, never committed).

**Deploy order:** apply migration 0085 (operator OK), deploy `news` and `press` (they read the pin; a missing table = no angle),
then `web`. Web before the migration still renders (threads and takes editor work; pin / close hidden).

**Paths outside "May edit"**

- `apps/web/src/lib/news/takes-privacy.test.ts`: the old guard said takes live only under `/admin/news`; now also
  `app/admin/press-box/`, and the admin-before-read check points at the new page and take actions.

**Not done / notes**

- The database has no for / against side on a stance (text only), so the page shows reporter and text, not a side label.
- Hockey-only has no code check anywhere (it is a model rule in the writers' prompts); save-time check is the code layer only.
- Old `lib/news/takes-save.ts` and db `updateAdminTake` / `getTakeHolder` are now unused (left, outside paths).
- Rival thread titles carry the opponent name (may hold digits); other derived titles are digit-free.
