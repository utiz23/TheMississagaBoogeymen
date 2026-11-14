# Task: B1 — Player background: question bank, facts and the admin editor

- **State:** Verify (started 2026-11-14 15:02; task agent of `Lead2`) (operator 2026-11-14: "B1 and B2 ready")
- **Lane:** Database (one migration), Queries, Web (`/admin/press-box/players/[id]`), Discord (profile
  writer reads confirmed facts only)
- **Risk:** medium (facts about real teammates that the writers will treat as true)
- **Slug:** background-b1 (branch `work/background-b1`, worktree `.claude/worktrees/background-b1`)
- **Operator gate before merge:** yes (screenshots)
- **Needs a deploy:** migration, `press`, `web` (in that order, as L2)
- **Helper model:** Opus (migration, data about people)

## Why

The old worksheets in `docs/specs/player-dossiers/` (10 players, about 120 questions each in 9 parts:
identity, career history, hockey identity, …) were never filled in and nothing reads them. Operator
2026-11-14: over time the bots should fill these in by asking players (B2), "things like relationships
between teammates", and the operator keeps the power to edit and change every fact as admin. B1 builds
the store and the admin editor; it is useful alone (the operator can type facts at once). B2 makes the
bots ask.

## Goal and visible result

1. **Question bank** (database, seeded once by the migration or a seed step from the worksheets): one
   generic question list grouped by the 9 parts (use the person's name, not "he"; drop exact
   duplicates), plus the few player-specific questions from each player file attached to that player.
   Each question has a flag `about_teammate` (it asks about another player: relationships, ratings,
   criticism) and `active`. No answers are invented; the header facts in the files (jersey, nationality,
   position, role) are NOT copied as facts (they may be old; the roster has its own fields).
2. **Facts:** a fact belongs to one person (member, bench person or coach) and may name a second
   player (`subject_player_id`, for facts about a teammate). It has a part, the text, a status
   **proposed | confirmed | rejected**, a source (**admin** typed it, or **answer**: link to the scrum or
   interview answer it came from), who confirmed or edited it and when.
3. **Admin editor** on each dossier (`/admin/press-box/players/[id]`), a "Background" section:
   - facts grouped by part; questions still open per part (count, expandable list);
   - **proposed facts first**, each with Confirm / Edit / Reject, and the source answer's question and
     text shown **only** when that answer is usable or joke (unusable and off-limits: never the text);
   - Add a fact (part, text, optional teammate), Edit, Delete (soft delete: status rejected + logged);
   - facts **about this player written from other players' answers** listed separately ("what teammates
     said"), confirm-only;
   - every action `requireAdmin` first and an audit line in `news_press_box_audit` in the same
     transaction (L1 pattern).
4. **Overview** (Press Box): "N background facts waiting" with a link.
5. **Writers:** only **confirmed** facts reach any writer. In B1 that is the AI profile (L2's profile
   material gets a "Confirmed background" block). "Leave me out": no facts are shown to writers or on
   the profile; the editor still shows them to the admin. "Go easy": facts are shown; the existing
   no-criticism rule still applies to the text.

## Paths

- **May edit:** `packages/db/migrations/0082_*.sql`, `packages/db/src/schema/`,
  `packages/db/src/queries/` (new `press-background.ts` + tests; the L2 dossier/profile material reader),
  `apps/web/src/app/admin/press-box/`, `apps/web/src/components/press-box/`,
  `apps/discord/src/news/profile.ts` (+ test) and `apps/discord/src/press/box-requests-profile.ts` (+
  test) only to add confirmed facts to the profile material, this task file. Reads (no edit)
  `docs/specs/player-dossiers/`.

## Checks

db build; typecheck db, web, discord, worker; web unit; discord tests; db tests by name; prettier.
Tests: unusable/off-limits answer text never selected; only confirmed facts in the profile material;
Leave me out hides facts from writers; every action admin-only and logged; seed has no duplicate
questions and copies no header facts. Screenshots from the read-only preview (any login bypass never
committed).

## Done when (written before the work starts)

- **Done when:** checks pass; the editor works on a dossier; the profile writer sees confirmed facts
  only. Reason: the operator decides what is true about a teammate.
- **Not done if:** a proposed or rejected fact can reach any writer; or answer text marked unusable is
  shown anywhere.

## Stop conditions

Stop and write "Blocked" in the Log when: a path outside "May edit" is needed; the "done when" rule
is unclear; an operator decision is needed; a live write, deploy or anything irreversible comes next.

## Log

- 2026-11-14 14:57 Lead2: written (Proposed). Operator: bots fill these in over time, mostly in
  interviews; teammates asked for rate/criticise questions; admin veto; admin edits everything.

- 2026-11-14 15:02 Lead2: operator "B1 and B2 ready"; started.

- 2026-11-14 15:03 task agent: branch work/background-b1 and worktree made; installed; db and ea-client built.
- 2026-11-14 15:07 task agent: read worksheets: 10 players (ids 1,2,3,5,6,8,10,11,12,13, match live), 1202 question lines. camrazz.md already has 55 written answers: NOT imported (answers are not part of the seed; operator may want them later). Seed = 100 generic questions + 252 player-specific rows (30 flagged about_teammate). Migration 0082 written and run twice on an in-memory Postgres (pglite): same counts, constraints refuse bad rows.

- 2026-11-14 15:19 task agent: built schema (news-press-background.ts), queries (press-background.ts), profile material + profile writer block (confirmed facts only), web actions, Background panel, Overview line. Tests: db 17 new (43 with the two older press-box files), web 8 new (727 unit pass), discord 870 pass. SQL also run on an in-memory Postgres (pglite): unusable and test-answer text never selected; writer rows exclude proposed, rejected, Leave me out.

- 2026-11-14 15:26 task agent: screenshots done (live read-only tunnel + a fixture page for the proposed/confirmed states; login bypass, fixture page, dev server and tunnel all removed again, nothing of them committed). State = Verify.

- 2026-11-14 15:30 Lead2: reviewed. Every action `requireAdmin` first (confirm/reject/remove through
  `decide`); 0082 only adds two tables (seeded bank). Paths inside "May edit" (`box-requests.test.ts`
  accepted as the profile handler's test). Rebased on `main`: typecheck db/web/discord/worker clean; web
  727/727; discord 870/870; db press-background 17, press-box-dossiers 11, press-box 15 (all pass);
  prettier clean. Screenshots seen (fixture data: live has no 0082).

Resume: operator: screenshots (D13), admin-typed facts confirmed at once, and whether to import
camrazz.md's 55 written answers as proposed facts; then merge (after CF1's or before: both edit the
schema/queries index lines).

## Report (task agent fills when state = Verify)

- **What changed (visible effect):** Migration 0082 adds the question bank (100 generic questions + 252 player-specific rows for 10 players, 30 flagged about-a-teammate; seeded from the worksheets' questions only) and the facts table (proposed | confirmed | rejected; source admin or answer; optional second player). Each dossier has a "Background" section: waiting facts first with Confirm / Edit / Reject (source answer shown only when usable or joke), confirmed facts by part, "what teammates said" (confirm or reject, edit on the owner's page), Add a fact (confirmed at once, since the admin typed it), open questions per part (answering one files the fact), rejected list. Overview shows "N background facts waiting" with links. The AI profile gets a "Confirmed background" block (confirmed only; nothing for Leave me out; Go easy shows facts, no-criticism rule stays; a profile that copies 4 words of a fact is refused). Every action runs requireAdmin first and writes news_press_box_audit in the same transaction (ids and parts, never fact text).
- **How it was checked (commands, numbers):** db build ok. db dist tests by name: press-background 17 new pass, plus press-box-dossiers and press-box (43 pass total, 0 fail). web typecheck ok; web test:unit 727 pass (8 new). discord typecheck ok; discord test 870 pass (5 new profile tests, 1 new box-requests test). worker typecheck ok. prettier --check on all changed files ok (format:check on the whole repo already warns on 8 old files I did not touch). Migration 0082 run twice on an in-memory Postgres (pglite): same row counts (100 + 252), constraints refuse an unreviewed confirmed fact, a self-named subject, a bad part, a half-set person. The fact/writer/open-question SQL also ran there: unusable and test-answer text never came back; writer rows excluded proposed, rejected, Leave-me-out owner or subject. Screenshots: dossier on live read-only (tables missing, section falls back to empty, no error), fixture page for all states, mobile 390px has no sideways scroll.
- **Tried, no gain:** none. camrazz.md already holds 55 written answers: NOT imported (answers are not part of this task; operator may want them as proposed facts later). Position-bound worksheet questions (for example "What kind of winger is {name}") are attached to the players whose worksheet had them and carry the worksheet's position; they can be switched off with `active`.
- **Not done:** no live apply, no deploy, no real model call. Screenshots could not show real facts (live has no 0082 tables), so proposed/confirmed states are from a fixture page. B2 (bots ask, propose facts) not started. Questions have no admin editor (active flag is set by SQL only).
- **Git state:** branch work/background-b1; see the final report for the commit hash and the main hash it is rebased on. Checks pass.
