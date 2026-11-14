# Task: B1 — Player background: question bank, facts and the admin editor

- **State:** Running (since 2026-11-14 15:02; task agent of `Lead2`) (operator 2026-11-14: "B1 and B2 ready")
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

Resume: task agent makes the branch and worktree, reads the worksheets and L2's dossier code, then builds.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
- **How it was checked (commands, numbers):**
- **Tried, no gain:**
- **Not done:**
- **Git state:** branch, last commit, rebased on `main` at <hash>, checks pass/fail
