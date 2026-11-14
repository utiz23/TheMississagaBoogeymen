# Task: B2 — Player background: the bots ask, propose facts; teammate answers need the admin

- **State:** Running (since 2026-11-14 15:36; task agent of `Lead2`) (operator 2026-11-14 15:02: "B1 and B2 ready")
- **Lane:** Discord (`apps/discord/src/press/`, `apps/discord/src/news/`), Queries, Database (only if a
  column is needed), Web (privacy page: one sentence)
- **Risk:** medium-high (AI questions and AI-written facts about real teammates; a privacy text change)
- **Slug:** background-b2
- **Operator gate before merge:** yes (the privacy sentence, and dry-run samples of questions and
  proposed facts)
- **Needs a deploy:** `press` (and `news` if the night writers read facts), `web` (privacy), migration
  only if needed
- **Helper model:** Opus

## Goal and visible result

Over time the bots fill in each player's background from B1's question bank. All facts they make are
**proposed**; the admin confirms, edits or rejects them in B1's editor.

1. **When they ask:**
   - **Interviews:** at most one background question per interview, from the questions this person
     has not answered yet (never a question already answered or rejected).
   - **Scrums:** rare: at most one background question per person per 7 days, never in the first scrum
     after a loss of 3+ goals, and never more than one per scrum panel. Game questions come first.
   - Asked in the reporter's own voice and character (the question text is a seed, not a script).
2. **Teammate questions** (operator 2026-11-14: "they specifically requested the ability to be asked
   to rate or criticise teammates … we have to put in admin veto power"):
   - allowed, including ratings and criticism of a teammate's hockey;
   - **never** about a teammate at press level "Go easy" or "Leave me out" (that teammate is never the
     subject of a rating or criticism question);
   - answers about a teammate always become **proposed** facts with the teammate named; no writer uses
     them until the admin confirms. The admin may confirm, soften (edit) or reject: that is the veto.
   - the existing hard lines, no crude quotes and off-limits rules apply as everywhere.
3. **From answer to fact:** after a background answer, one small model request proposes 0–2 facts
   (short, hockey only, third person), each linked to the answer. A joke answer gives no fact (it may stay
   a joke quote). The cost goes into the monthly spend; the budget check runs first. Nothing is
   proposed from an unusable or off-limits answer.
4. **Writers** (news desk night prompt, scrum/interview question writers, AI profile) get **confirmed**
   facts only, as background, never quoted as the player's words. Unconfirmed answers stay what they
   are today: quotes under the existing quote rules.
5. **Privacy:** one added sentence on `/legal/privacy` (and its date), for example: "Answers to
   background questions may be kept as short notes about your hockey history and your teammates; an
   admin checks them before the reporters use them, and you can ask to have them removed." The exact
   wording is the operator's (gate before merge). Players at "Leave me out" get no background
   questions.
6. **Old answers (operator 2026-11-14, D13 b):** `docs/specs/player-dossiers/camrazz.md` already holds 55
   written answers. Import them once as **proposed** facts (source: the worksheet, with the question), for
   the admin to confirm; no other worksheet has answers.
7. **Admin switch:** background questions on/off in the Press Box (logged), default **off** until the
   operator turns it on after the deploy.

## Paths

- **May edit:** `apps/discord/src/press/` (interview and scrum question choice, the answer step),
  `apps/discord/src/news/` (fact proposal writer; the night prompt's background block),
  `packages/db/src/queries/` (background queries + tests), `packages/db/src/schema/` and
  `packages/db/migrations/0084_*.sql` only if a column is needed (0082 is B1, 0083 is CF1), `apps/web/src/app/legal/privacy/` (one
  sentence + date), `apps/web/src/app/admin/press-box/` (the on/off switch only), this task file.

## Checks

As B1 plus discord tests with zero real model calls: the 7-day scrum limit; one per interview; never a
Go easy / Leave me out teammate as subject; teammate facts always proposed; nothing from unusable,
off-limits or joke answers; writers get confirmed facts only; switch off = no background questions.
Dry-run samples (fakes or the test channel only) for the operator.

## Done when (written before the work starts)

- **Done when:** checks pass, the samples look right to the operator, and the privacy sentence is
  approved. Reason: the operator keeps the final word on what is true about a teammate.
- **Not done if:** any fact reaches a writer without confirmation; or a Go easy / Leave me out player is
  the subject of a rating or criticism question.

## Stop conditions

Stop and write "Blocked" in the Log when: a path outside "May edit" is needed; the "done when" rule
is unclear; an operator decision is needed; a live write, deploy or anything irreversible comes next.

## Log

- 2026-11-14 14:57 Lead2: written (Proposed), after B1.

- 2026-11-14 15:02 Lead2: operator "B1 and B2 ready".

- 2026-11-14 15:36 Lead2: started (B1 merged at `4e4ba1fa`).

Resume: task agent makes the branch and worktree, reads B1's tables and the interview/scrum question code.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
- **How it was checked (commands, numbers):**
- **Tried, no gain:**
- **Not done:**
- **Git state:** branch, last commit, rebased on `main` at <hash>, checks pass/fail
