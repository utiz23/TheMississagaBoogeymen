# Task: T3 — in-depth interviews (one reporter, ~7 questions, Q&A article)

- **State:** Ready, starts after T2 (`2026-11-13-discord-press-panel-gm-ask.md`) is merged
- **Lane:** Discord (`apps/discord/src/press/`, `apps/discord/src/news/`), Database (one migration),
  Queries, Web (`/news` interview article)
- **Risk:** medium (live bots, a new public article type, a migration)
- **Slug:** press-interviews (branch `work/press-interviews`, worktree `.claude/worktrees/press-interviews`)
- **Operator approval:** 2026-11-13 ("start"; design in
  `2026-11-13-discord-press-panel-scrums-interviews.md` item 2)
- **Needs a deploy:** migration 0074 (after a fresh backup), `press`, `news`, `web`

## Goal and visible result

A separate, longer format: **one reporter asks one player about 7 questions** in a Discord thread; when
it ends, the reporter writes a **Q&A article** that appears on `/news` (and its teaser in the channel).

## Rules (operator 2026-11-13 + Lead)

- **Start, three ways:** `/gm interview player:<user> reporter:<optional> topic:<optional>` (GM only);
  `/interview` by a player for themselves (at most one per player per 7 days); **automatic offer**
  after a night where a player hit a milestone or played a "Historic" game (at most one offer for the
  club per 7 days; the strongest story wins).
- **Offer:** a message in the press channel from the reporter, mentioning the player, with an Accept
  button; **30 minutes** to accept; ignoring = no; no reminder. A GM-started interview is also an offer.
- **Flow:** a thread under the offer; **7 questions**; one follow-up may replace a planned question
  (total stays about 7); **30 minutes** per answer; typed answers in the thread count (T1 path, when
  `PRESS_TYPED_ANSWERS=1`) and the Answer button too; the reporter closes politely when the player stops
  answering or says it is over. Questions use the player's recent games, season and career facts, the
  GM topic, the reporter's voice and takes, all reporter-system writing rules (hockey only).
- **Article:** written only if at least 3 answers are usable or joke. A short intro, then the questions
  and answers; answers may be shortened, never changed or added to; the quote check and the review
  step apply; a joke answer stays a joke. Stored as a news item (kind `article`; a feature/kind marker
  "interview": agent's choice within the existing model) by that reporter; the teaser posts in the
  channel like other articles. Trial: everything is test (never public).
- **Never** for "Leave me out" players or guests or AI goalies; "Go easy": no criticism. 80% budget stop
  covers interviews. Father Rink may do interviews (Lead: yes, rare by rotation weight).
- **Cost** about $0.60–1.00 per interview with its article.

## Data

Hand-written idempotent migration `packages/db/migrations/0074_press_interviews.sql` (header like
0072/0073). Lead suggestion: `news_interviews` (player, discord user, reporter, trigger gm|player|auto,
status offered|active|done|declined|expired|stopped, channel, offer message, thread, counters, current
question, timestamps, article item id, is_test, topic) and `news_interview_answers` (question, answer,
usability, reporter). Agent may refine and must say why.

## Paths

- **May edit:** `apps/discord/src/press/`, `apps/discord/src/news/`, `packages/db/src/schema/`
  (new file or `news-press.ts`), `packages/db/src/queries/` (news, news-press) + tests,
  `packages/db/migrations/0074_press_interviews.sql`, `packages/db/src/news/`, `apps/web/src/` (render
  the interview article on `/news` and its page; keep the existing look), the press runbook, this task.

## Checks

db build; typecheck db, web, discord, worker; discord tests; web unit tests; db query tests by name;
prettier. Tests for each start path and its limits, the offer window, the 7-question flow, typed and
button answers, the article threshold and quote rules, refusals, trial = test.

## Done when

All checks pass; a test drives one GM-started interview from offer to stored article.

## Log

## Report
