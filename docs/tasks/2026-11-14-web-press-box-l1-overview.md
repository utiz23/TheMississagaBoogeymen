# Task: L1 — Press Box: shell, overview, relationships board, change log

- **State:** Ready (operator 2026-11-14: design and mock-up approved); starts after T8 and T9 are merged
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
  `press-box.ts` + tests), `packages/db/src/schema/`, `packages/db/migrations/<next>_*.sql`,
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

## Report
