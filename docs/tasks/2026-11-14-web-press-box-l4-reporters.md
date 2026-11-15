# Task: L4 — Press Box: reporter editor (bio, voice, catchphrases, disposition)

- **State:** Deployed 2026-11-14 19:36 (operator: "deployt")
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
  `packages/db/migrations/0087_*.sql (0085 L3, 0086 reserved for P1)`, `apps/discord/src/news/`, `apps/discord/src/press/`,
  this task file.

## Checks

As L1, plus tests: overrides merge over defaults, reset restores, the locked rules stay in every
prompt whatever the override says, character version recorded, preview is one call.

## Done when

All checks pass; screenshots match the mock-up; one previewed line shown to the operator.

## Log

- 2026-11-14 Lead: written.
- 2026-11-14 18:50 Lead2: started. L3 is merged (not yet deployed): build on its storylines page and text checks. Migration 0087 (0086 is reserved for P1). Live since this was written: Press Box L1–L3 code, B1/B2, Club Finals.

- 2026-11-14 19:20 task agent: built on branch `work/press-box-l4` (worktree `.claude/worktrees/press-box-l4`). Done, State = Verify. Details in the Report. The operator's gate (screenshots, one previewed line) is open: screenshots and hand-written sample lines are in the scratchpad (see Report).

- 2026-11-14 19:30 Lead2: rebased on the gm-ask fix; checks on the combined code: typecheck db/discord/worker
  clean, web 0 errors outside `.next`; web 779/779; discord 1000/1000; db 24/24; prettier clean. Merged.

- 2026-11-14 19:37 Lead2: deployed during a game night (last game 19:32). The session was cut during the first
  backup; nothing had changed on Hotel-Echo; backup retaken and checked
  (`~/eanhl-backups/manual/eanhl-pre-0087-2026-11-14.dump`, 29.5 MB, 97 table-data entries); 0087 applied
  (`news_reporter_overrides`, `news_items.character_version`); rollback tags
  `eanhl-team-website-{news,press,web}:rollback-he-2026-11-14-pre-l4`; `news` + `press` (rejoined 4 of 4 open
  threads), then `web`. `/` and `/news` 200; reporters page 307 → login signed out.

Resume: operator opens /admin/press-box/reporters; first real "Preview a sample line" is the operator's click.

## Report

**What changed**

- Migration `packages/db/migrations/0087_press_box_reporters.sql` (hand-written, idempotent, rollback in the header): table `news_reporter_overrides` (reporter, bio, voice_notes, catchphrases, disposition, character_version, updated_by, updated_at; a NULL field = code default), column `news_items.character_version`, request kind `preview` on `news_press_box_requests`.
- `packages/db/src/news/character.ts` (pure): the LOCKED rules (`LOCKED_RULES`, `lockedRulesBlock`), the merge of an override over the code character (`mergeCharacter`, `characterOf`), the in-process registry and `characterVersionOf`. `dispositionOf` (relationships) reads the override first.
- `packages/db/src/queries/press-box-reporters.ts` and `reporter-overrides.ts`: save, reset and preview-request, each one transaction with its `news_press_box_audit` line (kinds `reporter_edit`, `reporter_reset`, `reporter_preview`; field names only, never text); save checks (crude and slur lists, "Leave me out" names, rule-switching text, shapes and limits); reads for the pages (counts only).
- Writers: `reporterVoice` and `buildSystemPrompt` (discord `news/prompts.ts`) use the merged character and add the locked rules LAST in every writer prompt (news desk system prompt, scrum asker and judge, interviews, wire replies, background questions). `NEWS_RULES_VERSION` 2026-11-14.3 (the prompts changed). News desk and press service read the overrides at the start of each pass (optional `refreshCharacter` on the stores; a failed read keeps the last character). Every item stores the character version of its reporter (`insertNewsItem`, best effort).
- Preview: `apps/discord/src/news/sample-line.ts` + `press/box-requests-preview.ts`: ONE model call through the desk's `ModelCall`, spend recorded, 80% budget stop, no review, no rewrite, nothing posted. The web page cannot call a model, so the button queues a request (like the AI profile) and the press service writes the line on its next pass.
- Web: `/admin/press-box/reporters` (nine cards) and `/reporters/[id]` (rail, record, editor, preview, locked rules shown read only). On/off reuses the existing switch (`setReporterEnabledAction` of /admin/news, called from a Press Box wrapper that checks the admin first).
- Safety fix on the way: the press service ran ANY unknown request kind as a test scrum (it posts to Discord). Unknown kinds now fail with a fixed line.

**Checks (run on the branch after `git rebase main`)** see the numbers in the final message of the task agent; commands: `pnpm --filter @eanhl/db build`, db tests (`pnpm --filter @eanhl/db test` and `dist/queries/__tests__/*.test.js` by name), `pnpm --filter @eanhl/discord typecheck` and `test`, `pnpm --filter web typecheck` and `test:unit`, prettier on the changed files.

**Not done / limits**

- The preview uses the SAVED character (not unsaved text in the form). Save first.
- Edited catchphrases change the voice text but the code check that counts signature words (`SIGNATURE_WORDS`, post max 1, article max 3) still counts the code words only.
- An edited bio reaches the writers only when edited (the code bio is not in the prompts today). The public reporter pages (`/news/reporters/...`, outside this task's paths) still show the code bio.
- The on/off switch writes no audit line (existing behaviour, reused as it is).
- Scrum, interview and wire-reply rows do not record a character version (only `news_items`).
- A refused save redirects with a notice: the typed text is not kept.
- The "profanity" locked line keeps the existing exception (mild words hell, damn, crap for Mercer, Pettibone and Vale, rule 26), because the code allows it.
- Nothing was written to any database, no model was called, nothing was posted.

**Deploy order** apply 0087 -> deploy `news` and `press` (discord) -> deploy `web` last. The old press service would run a `preview` request as a test scrum, so the web app must go last. Rollback: header of the migration, after the code is rolled back.

**Screenshots** (dev server on the live database, read-only tunnel; login bypass and a fixture for Mara Quill "edited v3" plus a hand-written preview line were temporary, uncommitted and reverted): `/tmp/claude-1000/-home-michal-projects-eanhl-team-website/a2a7873b-2807-4e71-85a1-f9e79d57ba31/scratchpad/shots-l4/` (`list-*`, `editor-quill-*`, `editor-mercer-*`, 1280 and 390). Sample lines (hand-written, no model): `shots-l4/sample-lines.md`.
