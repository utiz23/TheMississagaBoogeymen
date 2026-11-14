# Task: T5 — hard lines (never acknowledged) and reporter feuds

- **State:** Verify (task agent, 2026-11-13; Lead repeats the checks and decides the merge)
- **Lane:** Discord (`apps/discord/src/press/`, `apps/discord/src/news/`), Database (one migration),
  Queries
- **Risk:** medium (what the bots answer to player text; story content about players)
- **Slug:** press-feuds
- **Operator approval:** 2026-11-13
- **Operator gate before merge:** no; migration and deploy with the operator's OK
- **Needs a deploy:** migration (next free number after T3/T4), `press`, `news`

## Why

The team likes the press bots and talks to them a lot, often with insults aimed at the fictional
reporters ("fuck u wade", "#FuckMaraQuill", "gord ur an asshole"); one message pulled in a real
politician. Operator: keep the banter, never acknowledge the hard lines, turn the rest into feuds.
Players who want to cool off change their press status ("Go easy" / "Leave me out") themselves.

## A. Hard lines: never acknowledged

- **Off-limits:** slurs; threats; mentions of real people outside the club (politicians, celebrities,
  public figures), politics, family and real-life private matters.
- An off-limits message gets **no reaction at all**: no reply, no acknowledgement (overrides T2's "no
  silent answers" for this class only), no echo of a pop-up answer, never quoted, never stored as a
  usable answer, no feud points. It does not count as an answer: the open question stays open (the
  player can still answer properly within the window). A reply to a wire post (T4) that is off-limits
  gets no answer.
- Detection: the answer judge gets a fourth class `offlimits` (separate from `unusable`, which is still
  acknowledged briefly); the T4 reply path uses the same classification. Fail closed: if the check
  cannot run, treat the message as off-limits (no reaction). A short code-level list of obvious slurs
  may run first (no AI call needed).
- Logged as "off-limits, not acknowledged" (never the text).

## B. Feuds

- A message that insults a reporter (and is not off-limits) adds feud points between that player and
  that reporter (scrum answers, typed thread messages, T4 replies). Points fade (Lead: half-life about 7
  days). Levels: none / simmering / feud / open war (thresholds: agent's choice, say why).
- Effects, by level: the reporter's questions and replies to that player get cooler and sharper (still
  professional, hockey only, never profanity, never about real life); at "feud" and above, the night
  recap and the weekly column may mention it as a storyline ("Erb and Pettibone are not on speaking
  terms"), stated as the reporter's view, never as a fact about the player. A feud can also make that
  reporter more likely to be on the player's scrum panel.
- "Go easy" players: no feud content anywhere (points may still be stored but are never used).
  "Leave me out": nothing at all.
- Feuds are shown to the GM (`/gm` reply or a line on `/admin/news`: agent's choice, small).

## C. No crude quotes (Lead, 2026-11-13; operator asked whether the banter becomes article material)

Public pieces (recaps, columns, interviews, wire posts) never quote or paraphrase profanity, slurs or
crude lines, also not as a joke; a clean joke may be quoted as a joke. The answer judge marks a crude
answer `unusable` (acknowledged, never quoted). Case: Samich's "I like to see my team work for me like
a bunch of slaves…" was judged `joke` on 11-13; the Lead set answer 5 to `unusable` by hand before that
night's recap (reverse: set it back to `joke`).

## Data

Hand-written idempotent migration (next number), header like 0072: e.g. `news_press_feuds` (player_id,
reporter, points numeric, last_event_at, updated_at; unique player+reporter) and the judge class.
Rollback in the header.

## Paths

- **May edit:** `apps/discord/src/press/`, `apps/discord/src/news/`, `packages/db/src/schema/`,
  `packages/db/src/queries/news*.ts` and their tests, `packages/db/src/news/`,
  `packages/db/migrations/<next>_press_feuds.sql`, `apps/web/src/app/admin/news/` (feud line only),
  the press runbook, this task file.

## Checks

db build; typecheck db, discord, web, worker; discord tests; changed db tests by name; web unit;
prettier. Tests: each off-limits kind gets no reaction and keeps the question open; fail closed;
unusable still acknowledged; feud points add, fade, map to levels; Go easy and Leave me out; feud lines
appear in recap/column material only at "feud"+; no profanity rule in the prompts.

## Done when

All checks pass; tests pin A and B; the Report lists the thresholds and the prompt changes.

## Log

- 2026-11-13 Lead: written from the operator's choice (A and B; cool-off = players' own press status).
- 2026-11-13 Task agent: work on `work/press-feuds`. A, B and C built; checks green (see Report). Judgment calls are rulings 56-64 in `docs/superpowers/plans/2026-10-26-news-desk-bots-rulings.md`. Nothing deployed, migration 0076 not applied, nothing pushed. No Docker here: the SQL was pinned by tests, never run on a database.
- 2026-11-13 Task agent: `apps/discord/src/press-main.ts` is outside "May edit", so it was NOT changed. The hard-line check is built inside `press/` from the deps' model call and store when `deps.screen` is absent (`screenMessage`), so the process needs no wiring.

## Report

### What changed

- **A. Hard lines.** New `press/hard-lines.ts`. Every player message passes `screenMessage` before any claim, echo or reaction: a short slur list in code (`news/crude.ts`, no model call), then one cheap Claude call (purpose `review`, effort low) that says off-limits (slur, threat, real person outside the club, politics, family, real-life private matter) and whether a reporter is insulted. Off-limits: no reply, no echo, no claim, nothing stored, no feud points, the question stays open; the log line is `off-limits, not acknowledged (<slur|model|check failed|judge>)`, never the text. Fail closed: a thrown error, a refusal, junk output, the extras budget spent, all give off-limits. The judge also has a fourth class `offlimits` (second line): it stops at once (no review, no second write), takes the pop-up echo down, reopens the question and stores nothing. `unusable` is still acknowledged. Wired into scrum answers (pop-up and typed, `interactions.ts`), interview answers (`interview.ts`) and wire-post replies (`wire-replies.ts`, before the 50% chance gate).
- **B. Feuds.** New `packages/db/src/news/feuds.ts` (points, fade, levels), table `news_press_feuds` (migration 0076), queries `addFeudPoints` (one atomic upsert) / `listFeuds` / `isPressThread`. Press side: `press/feuds.ts`, `feud-store.ts`, `feud-db.ts`. Effects: the reporter's questions, judgements, interview questions and wire answers get a feud line in the request (cooler and sharper, professional, hockey only); the panel draw weights a feud-level reporter x3 (`FEUD_PANEL_WEIGHT`); the night recap and the weekly column get the writing reporter's own feuds at feud level and above as a storyline (`DeskContext.feuds`, review told it is the reporter's view, at most 2); the GM sees a "Press feuds (GM only)" table on `/admin/news`. "Go easy": points may be stored, no level is ever used (checked in the prompt builders and in `feudsFor`). "Leave me out": no points at all. A message in a press thread that is not an answer counts by a code check only (reporter name + rude word) and only in a scrum or interview thread.
- **C. No crude quotes.** `news/crude.ts` (slurs, the desk's strong words, other crude words; mild words hell/damn/crap are not crude). `writeChecked` now fails any text with a crude word before the review (so questions, replies, recaps, columns, interview articles); `pressForSheet`, `scrumHistory`, `interviewHistory` and the interview article drop crude answers whatever their label; judge rule 11 marks a crude answer `unusable`.

### Thresholds and why

- Insult: mild 1 point, strong 2. Half-life 7 days (Lead). Levels: simmering from 2, feud from 5, open war from 10; total capped at 12.
- Why: one strong insult is a simmer; about three in a few days is a feud; only a sustained campaign reaches war. The cap stops a spam night from becoming a month-long war (steady state would otherwise be about 21). Feud panel weight 3 (heat weight is 3, a take is 2).

### Prompt changes (`NEWS_RULES_VERSION` 2026-11-13.3 -> 2026-11-13.4)

- News system rules: rule 6 (no crude quotes, points to 38); new rules 38 (never quote or paraphrase profanity, slurs, crude lines, also as a joke; reporters never use profanity beyond rule 26) and 39 (feuds: only the named reporter, one short line, the reporter's own view, never a fact about the player, never what was said, professional and hockey only, never profanity, none without a request line).
- Scrum asker and judge: rule 9 (never repeat a crude line, never a stronger word), rule 11 (classes: crude = unusable, `offlimits` defined, banter must be clean to be a joke), rule 13/14 (offlimits writes nothing), new rule 15 (feuds); the interview system prompt and the wire-reply rules (rules 10 and 11) carry the same text. New request lines per feud level.
- New hard-line check prompt (`hard-lines.ts`): classifies a message; says rude talk at fictional reporters is NOT off-limits.

### Migration 0076 and rollback

`packages/db/migrations/0076_press_feuds.sql`: one new table `news_press_feuds` (player_id FK, reporter check, points numeric(6,2) >= 0, last_event_at, updated_at, unique player+reporter), idempotent, hand-applied with psql like 0075; apply BEFORE deploying `press` and `news`. No change to `news_scrum_answers.usability` (an off-limits message is never stored). Rollback: `DROP TABLE IF EXISTS "news_press_feuds";` (in the header). Without the table: no points saved (one log line), levels read none, the recap is written without a storyline, the admin line says "not available yet"; hard lines and C do not need it. Not applied; the SQL was never run on a database (no Docker).

### Checks (all in the worktree, after `pnpm --filter @eanhl/db build`)

- Typecheck: db, discord, web, worker: all clean.
- `pnpm --filter @eanhl/discord test`: 766 tests, 766 pass (was 729 before this task).
- db tests by name: `news-feuds.test.js` + `feuds.test.js` + `news-press.test.js` + `news-wire-replies.test.js`: 64 of 64 pass; `dist/news/*.test.js` + `news-interviews` + `news`: 148 of 148 pass.
- web `pnpm test:unit`: 672 of 672 pass.
- Prettier: all changed files clean (`prettier --check`).
- Mutation check: with the off-limits branch disabled in `interactions.ts`, 5 of the new tests fail; restored, all pass.
- Not run: the migration on a database, `pnpm --filter web build`, any live or Docker step, a screenshot of the new admin table (no dev server).

### Tests that pin the rules

Each off-limits kind (threat, a real politician, politics, family, a private matter; a slur by code) gets no reply, no echo, nothing stored and keeps the question open, pop-up and typed; fail closed (throwing screen, no screen, budget spent); unusable still acknowledged; judge `offlimits` second line; interview and wire-reply paths (slur, off-limits, fail closed); feud points add, fade (14 days: war -> simmering), map to levels at the thresholds; Go easy stores points and never uses them (scrum, wire reply, recap); Leave me out adds nothing; feud lines in the recap and column only at feud level and above and only for the writing reporter; no-profanity and feud rules pinned in the prompts; migration and query SQL shape pinned.

### Not done / open risks

- `apps/discord/src/press-main.ts` (outside "May edit") unchanged: the process uses the default check built from the deps. If the Lead prefers an explicit wire, it is a 3-line change there.
- Cost: one extra small model call per player answer and per wire reply (also unchosen ones). Estimated well under 1 cent each; not measured.
- The slur list in code is short on purpose; the model check covers the rest. The model check is a judgment: "hockey remark about a real pro player is fine" is ruling 59; the operator may want that stricter.
- Non-answer thread messages: the code check can miss an insult without a reporter name, or count a rude word near a name.
- Crude interview answers are dropped from the Q&A article in code but that path has no dedicated test (the shared `writeChecked` and `pressForSheet` paths do).
- Privacy policy: the new table stores points only, no message text; no legal-doc change was made. The Lead should decide if the policy date needs a bump.
- Existing stored answers: any older answer with a swear word is now dropped from quote material and history (also rows labelled usable or joke). Match 5 answer 5 can go back to `joke` by hand but the code would still hide it if it has a crude word.

### Git state

Branch `work/press-feuds`, on top of `96ec0fe2` (main had not moved, so no rebase was needed). Code commit `c9290e5c`, then this task-file commit. Not pushed, not merged, not deployed.
