# Task: T5 — hard lines (never acknowledged) and reporter feuds

- **State:** Ready (operator 2026-11-13: "A and B"); starts after T3 and T4 are merged
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

## Report
