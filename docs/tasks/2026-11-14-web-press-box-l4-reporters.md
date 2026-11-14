# Task: L4 — Press Box: reporter editor (bio, voice, catchphrases, disposition)

- **State:** Ready (operator 2026-11-14); starts after L3 is merged
- **Lane:** Web, Database (overrides), Discord (writers read the merged character)
- **Risk:** medium (changes the writers' input)
- **Slug:** press-box-l4
- **Operator gate before merge:** yes (screenshots and one sample line)
- **Needs a deploy:** migration, `web`, `news`, `press`

## Goal and visible result

Design §3.5; mock-up "Reporter editor". `/admin/press-box/reporters` and `/[id]`: the 9 reporters
(on/off from the existing switch), record (posts, scrum questions, relationships, quotes drawn), and an
editor for **bio, voice notes, catchphrases and disposition (T9, homer ↔ critic)**. Saved as overrides
over the definitions in code, with a character version; the writers read the merged character; every
item records the character version it was written with. "Reset to default". "Preview a sample line"
(one short AI call, ~$0.01, recorded in spend; added in the mock-up, operator approved the mock-up).
The safety rules are shown locked and are never editable (hockey only; no real people, politics,
family; no profanity; quotes only from stored usable answers; no crude quotes; press levels).

## Data

`news_reporter_overrides` (reporter, bio, voice_notes, catchphrases, disposition, character_version,
updated_by, updated_at); `news_items` (and scrum/interview rows if needed) record the character version.
Hand-written migration with rollback.

## Paths

- **May edit:** `apps/web/src/app/admin/press-box/`, `apps/web/src/components/press-box/`,
  `packages/db/src/queries/` (+ tests), `packages/db/src/schema/`, `packages/db/src/news/`,
  `packages/db/migrations/<next>_*.sql`, `apps/discord/src/news/`, `apps/discord/src/press/`,
  this task file.

## Checks

As L1, plus tests: overrides merge over defaults, reset restores, the locked rules stay in every
prompt whatever the override says, character version recorded, preview is one call.

## Done when

All checks pass; screenshots match the mock-up; one previewed line shown to the operator.

## Log

- 2026-11-14 Lead: written.

## Report
