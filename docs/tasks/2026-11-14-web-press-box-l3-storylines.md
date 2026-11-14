# Task: L3 — Press Box: storylines, trends, takes and stances editor

- **State:** Ready (operator 2026-11-14); starts after L2 is merged
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
  `packages/db/src/schema/`, `packages/db/migrations/<next>_*.sql`, `apps/discord/src/news/` and
  `apps/discord/src/press/` (read the pinned storyline only), this task file.

## Checks

As L1, plus tests: one pin at a time, a pinned storyline reaches the recap and scrum prompts as a
suggestion, closed ones never do, edited text passes the checks.

## Done when

All checks pass; screenshots match the mock-up.

## Log

- 2026-11-14 Lead: written.

## Report
