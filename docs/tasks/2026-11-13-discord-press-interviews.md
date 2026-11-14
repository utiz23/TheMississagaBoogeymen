# Task: T3 — in-depth interviews (one reporter, ~7 questions, Q&A article)

- **State:** Merged (Lead review 2026-11-13); deploy waits for the operator's OK
- **Lane:** Discord (`apps/discord/src/press/`, `apps/discord/src/news/`), Database (one migration),
  Queries, Web (`/news` interview article)
- **Risk:** medium (live bots, a new public article type, a migration)
- **Slug:** press-interviews (branch `work/press-interviews`, worktree `.claude/worktrees/press-interviews`)
- **Operator approval:** 2026-11-13 ("start"; design in
  `2026-11-13-discord-press-panel-scrums-interviews.md` item 2)
- **Needs a deploy:** migration 0074 (after a fresh backup), `press`, `news`, `web`

## Running in parallel with T2 (read first)

T2 (`2026-11-13-discord-press-panel-gm-ask.md`, branch `work/press-panel`) changes the same press code
at the same time. To keep the merge clean:

- Put the interview logic in **new files** (e.g. `apps/discord/src/press/interview*.ts`,
  `packages/db/src/queries/news-interviews.ts`, `packages/db/src/schema/news-interviews.ts`). Keep edits
  to shared files (`gateway.ts` command list and routing, `store.ts`, `test-fakes.ts`, `config.ts`,
  `schema/index.ts`) **small and additive**: add, do not reorder or rewrite.
- Migration **0074** must not depend on 0073 (T2's): only new tables and columns of its own.
- Do not change scrum behaviour, the answer judge or the question writer (T2 owns them); reuse them.
- Typed answers: reuse T1's path (`onTypedAnswer` pattern) for interview threads, in your own module.
- Before Verify: `git rebase main` (T2 may be merged first). Conflicts with T2 are expected to be small;
  resolve them, re-run every check, and say what you resolved.
- You report to the operator in this chat; the Lead merges.

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

- 2026-11-13 agent: branch `work/press-interviews` and worktree made from `main` (a72bf0be); State Running.
- 2026-11-13 agent: read the press, news and web code; design: new files only, one-line hooks in shared files.
- 2026-11-13 agent: schema `news-interviews.ts`, migration 0074, queries `news-interviews.ts` + pinned tests.
- 2026-11-13 agent: press modules `interview*.ts` (rules, store, writer, flow, pass, gateway glue) + tests.
- 2026-11-13 agent: web: "Interview" kicker and Q/A layout on the article page; runbook section.
- 2026-11-13 agent: commit 004584af; `git rebase main` (T2 merged): conflicts in `gateway.ts` (imports: kept
  T2's gm.ts imports and added the interview import) and the runbook (kept T2's section, then mine).
- 2026-11-13 agent: aligned with T2's judge: kept-verdict fixed lines, unusable answers acknowledged, echo
  before the judgement, failure logs redacted (`safeWhy`), follow-up mode `chased`, `ASK_MAX_WRITES` (4).
- 2026-11-13 agent: all checks re-run on the rebased branch (Report); State Verify.

## Report

**Result.** Interviews work end to end in tests. The "done when" test (`interview.test.ts`, first test)
drives one GM-started interview: offer with Accept, thread, 6 planned questions + 1 follow-up (7 items),
answers, closing line, then the pass stores the Q&A article (a news item by that reporter).

**What was built.**

- Start: `/gm interview player reporter topic` (GM only), `/interview` (player, once in 7 days, starts at
  once, no Accept), automatic offer after a night recap with a milestone or a "Historic" game (once in
  7 days for the club; strongest story: a new club record in a Historic game, then a milestone, then the
  best player of a Historic game).
- Offer: posted by the timer pass, 30 minutes to accept, ignoring = expired (button removed, no reminder).
- Flow: 7 items, one follow-up may replace a planned question (only on an answer the judge marks
  `chase: strong`), 30 minutes per answer, button or typed answers, a short "I'm done" / "that's it"
  ends it politely, no answer in 30 minutes ends it politely.
- Article: only with 3+ usable or joke answers. Answers only cut; each cut marked "…" (code check
  `isCutOf`), no strong word, no forbidden name; intro quotes nobody; numbers from the sheet; then the
  review with the answers as trusted material (jokes marked). Stored as kind `article`, slug
  `interview-<id>-…`, `night` and `match_id` null. Live: `send_after` = now, so the news service's due
  pass posts the teaser like other bot items. Trial: `is_test`, posted only by the trial mirror.
- Refusals: "Leave me out", guests, AI goalies (not on the night sheet or not linked), no game in 30
  days, a switched-off reporter, an open interview; "Go easy" = no takes, no criticism (prompt + review);
  80% budget stop on every step. Father Rink is in the rotation with weight 0.2.

**Data (migration 0074, not applied anywhere).** `news_interviews` and `news_interview_answers`, new
tables only; no dependency on 0073. Changes to the Lead's suggestion, and why: no `declined` status (the
offer has no decline button; ignoring = `expired`); added `offered_at` (the claim before the offer is
sent: no double post), `article_status` (waiting/writing/written/skipped/failed: the article is claimed
once), `accepted_at`, `ended_at`, `asking_followup`; answers have `position` and `is_followup`. Two
partial unique indexes: one open interview per player; one automatic offer per night and mode.
Rollback: drop the two tables (SQL in the file header). Articles stay as news items.

**Interview marker (agent's choice).** The slug prefix `interview-` (helpers in
`packages/db/src/news/interview.ts`); the body holds the intro, then `Q: ` / `A: ` paragraphs. No change
to `news_items` and no extra query on the web side.

**Shared files (small, additive).** `gateway.ts`: 1 import + 3 one-line hooks (router, typed-answer
default handler, command registration). `pass.ts`: 1 import + 1 step. `store.ts`: 1 import + 1 spread.
`fact-check.ts`: `STRONG_WORDS` exported. `schema/index.ts`, `queries/index.ts`, `news/index.ts`: one
export line each. `PressStore`, `test-fakes.ts`, `asker.ts`, `interactions.ts`, `config.ts`, `question.ts`
are not changed: the interview store rides on the press store object and is found by a guard
(`interviewStoreOf`); a store without it means "interviews off". The scrum judge (`judgeAnswer`) is
reused unchanged. The question writer is the interview's own (`interview-asker.ts`): it reuses
`SCRUM_RULES` 3–10 word for word and replaces rules 1–2 (the scrum rule 2 says "this game"); its code
check copies the scrum `lineProblems` (not exported; not changed to avoid touching T2's file).

**Checks (rebased on main af562f8b).**

- `pnpm --filter @eanhl/db build`: pass. Typecheck db, web, discord, worker: pass.
- `pnpm --filter @eanhl/discord test`: 683 pass, 0 fail (33 new interview tests).
- `pnpm --filter @eanhl/web test:unit`: 672 pass, 0 fail. `pnpm --filter @eanhl/db test`: 233 pass.
- db query tests by name: `news-interviews` 10, `news-press` 48, `news` 57: all pass.
- Prettier on every branch file: pass. `pnpm format:check` (whole repo): fails on 37 old files that
  this branch does not touch; the same files fail on `main`.
- Not run: the verification database and a dev-server screenshot of the article page (no Docker on this
  PC; no interview article exists yet). The migration was not applied anywhere.

**Open points for the Lead / operator.**

- Typed answers in interview threads depend on T4's fix (Barlow joins every scrum and interview thread).
  Until then the Answer button works; typed answers may not arrive.
- Deploy order: backup, migration 0074, then `press` (+ `web` for the Interview layout; `news` needs no
  code change but delivers the live teaser). Runbook section "Interviews (task T3, 2026-11-13)".
- Cost was not measured (no live run). Per interview: up to 7 questions and 7 judgements (write +
  review each) and one article (up to 3 writes + reviews).
- 2026-11-13 Lead review: rebased on main (docs only since); every changed path inside "May edit";
  migration 0074 read (new tables only, one transaction, rollback in header, independent of 0073).
  Re-ran: typecheck db/discord/web/worker clean; discord 683/683; news + news-press + interview db
  tests 115/115; web unit 672/672; prettier clean. Deploy order: backup → 0074 → `press`, `news`, `web`.
  Typed answers in interview threads need T4's thread-join fix.
