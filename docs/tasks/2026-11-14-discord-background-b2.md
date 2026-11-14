# Task: B2 — Player background: the bots ask, propose facts; teammate answers need the admin

- **State:** Verify (task agent done 2026-11-14 16:08; started 15:36 by `Lead2`) (operator 2026-11-14 15:02: "B1 and B2 ready")
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
6. ~~**Old answers**: import of the 55 answers in camrazz.md as proposed facts~~ **DROPPED** by the operator
   2026-11-14 (see Log): no import, no seed step, no facts from any worksheet. Every player starts with no facts.
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

## Proposed privacy sentence (the exact wording is the operator's to approve)

> Answers to background questions may be kept as short notes about your hockey history and your teammates; an admin checks them before the reporters use them, and you can ask to have them removed.

It is on `/legal/privacy` as its own last section, "Background notes" (`apps/web/src/app/legal/privacy/background-section.tsx`).
No other legal text was changed. Players at "Leave me out" get no background questions.

## Stop conditions

Stop and write "Blocked" in the Log when: a path outside "May edit" is needed; the "done when" rule
is unclear; an operator decision is needed; a live write, deploy or anything irreversible comes next.

## Log

- 2026-11-14 14:57 Lead2: written (Proposed), after B1.

- 2026-11-14 15:02 Lead2: operator "B1 and B2 ready".

- 2026-11-14 15:36 Lead2: started (B1 merged at `4e4ba1fa`).

- 2026-11-14 15:37 task agent: branch `work/background-b2` and worktree made; installed; db and ea-client built.
  Read B1 and the interview/scrum code.

- 2026-11-14 15:37 Lead2 (operator ~15:38): "blank fact sheets for everyone. Start from scratch, throw those 55
  answers out." Goal item 6 (the camrazz.md import; the Lead calls it item 7) is DROPPED completely: no import
  script, no seed step, no facts from any worksheet file. The B1 question bank (questions only) stays. No import
  code was written.

- 2026-11-14 15:50 task agent: BLOCKED (partly), not stopped. The privacy page's text and its date live outside "May edit":
  the text in `apps/web/src/content/legal/privacy.tsx` (a verbatim copy of `docs/planning/privacy-policy-draft.md`) and the
  date `lastUpdated` in `apps/web/src/lib/legal/legal-docs.ts`. Nothing there was edited. The proposed sentence is added as
  its own LAST section from `apps/web/src/app/legal/privacy/` (inside "May edit"), so no other legal text changes. Needs the
  Lead: (1) the date: `privacy.lastUpdated` is already `2026-11-14`, so a merge today needs no bump, a later merge needs one
  line in `legal-docs.ts`; (2) the source draft `docs/planning/privacy-policy-draft.md` must get the same section once the
  operator approves the wording, or the e2e fidelity test `apps/web/test/legal-http.test.ts` (needs a running server, not run
  here) will fail on the extra section.

- 2026-11-14 16:08 task agent: built and tested. Migration 0084 (switch table `news_background_settings`, default OFF; ask log
  `news_background_asks`), run twice on an in-memory Postgres (same counts) together with the real SQL: one ask per panel and
  per interview, a proposed fact only from a real answered ask, at most 2 per answer, nothing for Leave me out or a Go easy
  subject, answers to a teammate question left out of the quote reads. No import of any worksheet answer (operator, see
  above). Samples written. State = Verify.

Resume: Lead rebases/merges after the operator approves the privacy sentence and the samples; deploy order: backup, 0084, `press` (and `news`), then `web`; the switch stays OFF until the operator turns it on in the Press Box.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
  - **Switch** (Press Box overview): "Background questions" On/Off, admin only, logged (audit kind `background_switch`), default OFF.
    With the switch off the bots ask nothing and propose nothing.
  - **Interviews:** at most one background question per interview, from the 5th item on (after the night and the season),
    only to a member, from the questions the person has not been asked yet (an earlier ask of any kind, or a fact of any
    status, closes the question). The reporter rewrites the bank text in their own voice (seed, not script); if the
    writer fails, the ordinary question is asked.
  - **Scrums:** rare: only as the LAST question of the person's panel (game questions first), at most one per person per 7 days,
    at most one per panel, never when the scrum's game was lost by 3+ goals (my reading of "first scrum after a loss of 3+":
    the scrum about that game; one line to change if the operator means the next game), never in a test scrum.
  - **Teammate questions:** a question flagged `about_teammate` is put about ONE teammate chosen by the code from members at
    press level "full" only. "Go easy" and "Leave me out" teammates are never the subject. The question may ask for a rating
    or one fair criticism of that teammate's hockey. A "Leave me out" person gets no background question. A "Go easy" person
    is never asked a question for the bad side (word filter on the seed).
  - **Answer -> facts:** after a USABLE answer, one small request proposes 0-2 facts (checked by code: third person, no quote,
    no crude word, only numbers the answer used, names only the answerer and the one teammate, a teammate fact must name the
    teammate). Stored as `proposed` only (the insert has no other status), linked to the answer and the bank question. Joke,
    unusable, off-limits (never stored), crude and test answers: no request, no fact. Budget is checked first; cost goes into the
    monthly spend.
  - **Teammate answers are never a quote:** an answer to a question about a teammate is left out of the night recap quotes, the
    interview Q&A article, the writers' earlier-answers history and the dossier quotes. Only a fact the admin confirms is used.
  - **Writers:** the ordinary scrum and interview question writers and the night recap prompt get CONFIRMED own facts only
    (a "Confirmed background" block, also marked trusted for the review; night recap: players on the sheet, 2 per player,
    10 in all, no line with a digit). Nothing for Leave me out. (The AI profile was done in B1.)
  - **Privacy page:** one proposed sentence in its own last section (see the sentence in the final report; the operator
    approves the wording).
  - **Dropped by the operator:** the camrazz.md import (no import, no seed, no facts from any worksheet).
- **How it was checked (commands, numbers):** db build ok; db dist tests by name: press-background-asks 8 new pass, news-press 54,
  press-background 17, press-box-dossiers 11, press-box 15, news-interviews 11 (all pass, 0 fail). Discord typecheck ok;
  discord test 904 pass, 0 fail (34 new: 26 in background.test.ts, 8 in background-rules.test.ts; all fakes, zero real model
  calls). Web typecheck ok; web test:unit 733 pass (6 new). Worker typecheck ok. Prettier --check ok on every changed file
  (`pnpm format:check` still lists only old docs/research files and 3 old source files). SQL and migration 0084 run twice on an
  in-memory Postgres (pglite, with 0082): counts identical, switch row OFF, no fact created, constraints refuse a self subject
  and a scrum ask with no scrum person. Samples: `/tmp/claude-1000/-home-michal-projects-eanhl-team-website/a2a7873b-2807-4e71-85a1-f9e79d57ba31/scratchpad/samples-b2/samples.md`.
- **Tried, no gain:** a switch column on `news_press_settings` (older code that selects every column of that table would fail
  before the migration): replaced by its own one-row table. Pure rules first lived in the db package (the discord tests cannot
  import `@eanhl/db/queries`, it needs a database at import time): moved to `apps/discord/src/press/background-rules.ts`.
- **Not done:** no live apply, no deploy, no real model call, nothing posted. Bench people and the coach get no background
  question (members only). Questions in the bank that are written as analyst prompts ("Is there a room nickname ... that
  should be captured here?") may fail the writer's check; then the ordinary question is asked (no harm). The privacy date and the
  source draft need the Lead (see Log). Not run: the e2e legal test (needs a server). Teammate FACTS made from other
  players' answers show in B1's "what teammates said" list as before. The scrum/interview history hides a teammate answer from
  the next question's writer ("no usable answer").
- **Git state:** branch `work/background-b2`; commit and the `main` hash it is rebased on are in the final report. Checks pass.
