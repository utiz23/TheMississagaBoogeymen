# Task: T4 — Discord replies (answers, reporter replies, replies to wire posts)

- **State:** Verify (operator 2026-11-13: all three items; privacy paragraph approved as written; run in
  parallel with T3 in the operator's chat)
- **Lane:** Discord (`apps/discord/src/press/`, `apps/discord/src/news/`), Web (privacy text),
  Database only if item 3 needs a small table
- **Risk:** medium (reads more Discord messages; new AI calls on player text)
- **Slug:** press-replies
- **Operator gate before merge:** yes (privacy text)
- **Needs a deploy:** `press`, `news`, `web` (privacy text); a migration only if needed

## Running in parallel with T3 (read first)

T3 (`2026-11-13-discord-press-interviews.md`, branch `work/press-interviews`) changes the same press code
at the same time. Keep edits to shared files (`gateway.ts`, `interactions.ts`, `store.ts`,
`test-fakes.ts`, `config.ts`, `pass.ts`, `question.ts`) small and additive; put new logic in new files
(e.g. `apps/discord/src/press/replies*.ts`). A migration, if any, is `0075` and must not depend on 0074. Before Verify: `git rebase main` (T3 may be merged first); resolve conflicts, re-run every check,
say what you resolved. You report to the operator in this chat; the Lead merges.

## First: typed answers did not work live (operator 2026-11-13: "we still have to press answer")

T1 (deployed, `PRESS_TYPED_ANSWERS=1`, Message Content intent ON for Wade Barlow, log "typed answers
on") should take a plain message in a scrum thread as the answer. Players still had to press Answer.
Likely cause (Lead, not proven): only Barlow's client has the message intents, and the thread is
started by the asking reporter's bot; Barlow is not a member of that thread and may not receive its
messages. Fix: Barlow joins every scrum (and interview) thread when it is created or first used
(`PUT /channels/{thread.id}/thread-members/@me`), and re-joins open threads at start-up. Add one log
line per received thread message that is considered (thread id, user id, taken or why not; never the
text). Check discord.js thread behaviour in its docs (Context7) and say what you found.

## Goal and visible result

1. **Players reply to answer:** a Discord Reply to a reporter's question message (in the scrum or
   interview thread) is the answer to that exact question, for the asked player only. A plain message
   still answers the player's open question (T1). A reply to an old or someone else's question is ignored.
2. **Reporters reply to answers:** a reporter's follow-up, acknowledgement or next line about an answer
   is posted as a Discord reply (`message_reference`) to the player's answer message (the typed
   message, or the pop-up echo), so the thread shows who answers what.
3. **Reply to a wire post:** a Discord Reply to a reporter's news post in the game channel may get an
   answer from that reporter, in character, as a Discord reply.
   - Only team members (linked Discord). Never to "Leave me out" players; "Go easy": no criticism.
   - About half of the replies get an answer (seeded, so tests are stable); one answer per person per
     post; at most 8 answers a night; none after the 80% budget stop.
   - The reply text is sent to the AI as untrusted data (fenced, like scrum answers), never stored; the
     reporter's answer is stored (a news item or a small table: agent's choice, say why) and follows all
     writing rules (hockey only, no invented teammate quotes, no new facts beyond the sheet).
   - Cost about $0.06 per answer.

## Privacy paragraph (approved by the operator 2026-11-13, as written)

> **Replies to reporters in Discord.** If you reply to a reporter's post in our team's Discord channel,
> the bots may send your reply to Claude AI (Anthropic) so the reporter can answer you. We store the
> answer and the message IDs, not the text of your reply.

Goes into `apps/web/src/content/legal/privacy.tsx` and `data-collection.tsx` (section on AI news), with
`lastUpdated` set on release day.

## Paths

- **May edit:** `apps/discord/src/press/`, `apps/discord/src/news/`, `packages/db/src/queries/news*.ts`
  and their tests, `packages/db/src/schema/` and `packages/db/migrations/0075_*.sql` only if item 3
  needs it, `apps/web/src/content/legal/`, `apps/web/src/lib/legal/legal-docs.ts`, the press runbook,
  this task.

## Checks

db build; typecheck db, discord, web, worker; discord tests; changed db tests by name; web unit; prettier.
Tests: reply-to-question targets the right question and person; others ignored; reporter lines carry
`message_reference`; wire-post replies: members only, press levels, limits, seeded chance, budget stop,
fenced untrusted text, nothing of the reply text stored.

## Done when

All checks pass; on a game night a reply to a question is taken as its answer, reporter lines reply to
answers, and a reply to a wire post gets an in-character answer within the limits.

## Log

- 2026-11-13 Lead: written from the operator's choice (all three).
- 2026-11-13 operator: privacy paragraph approved as written.
- 2026-11-13 agent: Running. Branch work/press-replies from main 089bc1fe (T3 already merged).
- 2026-11-13 agent: typed answers, cause found in code (not proven live): discord.js drops a
  messageCreate when the thread is not in Barlow's channel cache (no Partials.Channel). Discord
  docs: bots get thread messages of public threads they can see without joining, but the thread
  object reaches Barlow only by THREAD_CREATE/GUILD_CREATE. Fix: read raw MESSAGE_CREATE (no
  cache needed) and Barlow joins every press thread (at creation and at start-up).
- 2026-11-13 Lead (message): T3 merged (f3f4bda0); rebased on main 089bc1fe before any change;
  interview threads included in the join fix.
- 2026-11-13 agent: thread join (thread-join.ts): Barlow joins each thread a reporter starts
  (restDiscordOps) and every active thread under the press channel at start-up (startClients).
- 2026-11-13 agent: Barlow's messages from the raw MESSAGE_CREATE (replies-raw.ts); one log line per
  considered thread message (replies.ts), never the text.
- 2026-11-13 agent: item 1 (reply = answer to that exact question) and item 2 (reporter follow-up,
  acknowledgement and closing reply to the answer) for scrums and interviews.
- 2026-11-13 agent: item 3 (wire-replies.ts), table news_wire_replies, migration 0075 (not
  applied), queries in news-press.ts, flag PRESS_WIRE_REPLIES (default off).
- 2026-11-13 agent: privacy paragraph in privacy.tsx and data-collection.tsx; runbook section.
- 2026-11-13 agent: checks green (Report); State = Verify.

## Report

Branch `work/press-replies`, rebased on main 089bc1fe (T3 merged; no conflicts: T3 was in main before
my first change). Not merged, not pushed, not deployed, migration not applied.

**Typed answers did not work live: what I found.** Discord docs (Context7, threads.mdx): an app gets
the messages of public threads it can see without joining. A thread reaches the app by THREAD_CREATE,
GUILD_CREATE or a join. discord.js 14.27 source (`MessageCreateAction`): a message whose channel is not
in the client's cache is dropped without a word unless `Partials.Channel` is on. Barlow had no
Channel partial. So the likely cause is: the thread that the asking reporter started was not in
Barlow's cache, and the typed message was dropped. Not proven live (no logs read, no ssh). Fix, both
sides:

- Barlow reads the raw gateway MESSAGE_CREATE (`replies-raw.ts`, `attachMessages`): no cache needed.
- Barlow joins every thread a reporter starts (`withBarlowJoin` in `restDiscordOps`) and, at
  start-up, every active thread under the press channel (`joinOpenThreads`, log line
  `[press] thread join: Barlow is in N of M open threads`). Scrum and interview threads both.
- One log line per considered thread message: `[press] thread message: thread <id> user <id>:
person <n>: taken` / `not taken (<why>)`. Never the text.

**1. Reply to a question.** In scrum and interview threads a Discord Reply counts only when its target
is the asking player's current question message: it has that player's Answer button
(`press:answer:<person>` / `press:ianswer:<interview>`) and its text is the current question line. No
new column: the button and the posted text identify the question. A reply to an earlier question, to
someone else's question, to any other message, or to a deleted message is ignored (logged). A plain
message still answers (T1).

**2. Reporter lines reply to answers.** The follow-up, the acknowledgement of an unusable answer and
the closing line carry `message_reference` to the typed message, or to the bots' echo of a pop-up
answer. Never to a refused answer (names a forbidden person). The next planned question is a new
question and does not reply (my reading of "follow-up, acknowledgement or next line about an
answer").

**3. Replies to wire posts** (`wire-replies.ts`). Rules as in the task. Stored in a small new table
`news_wire_replies` (migration 0075, no dependency on 0073/0074). Why a table, not a news item: an
answer is not a news piece (it must not show on `/news` or feed the desk), and "one per person per
post" needs a unique key that is claimed before the AI call (safe after a crash). The reply text is
fenced untrusted data in the prompt, never stored, never logged, and not shown to the review.
Answer check: at most 280 characters, numbers only from the sheet and the post, only the member
named, no 4 words in a row from the reply. One write plus one rewrite (cost bound); a failure means
no answer.

**My choices for the operator to confirm:**

- `PRESS_WIRE_REPLIES=1` turns item 3 on (default off, needs `PRESS_TYPED_ANSWERS=1`). Turning it on
  is a High step at deploy.
- No answer to a correction, to a post older than 24 hours (as the fan reactions), or to a post
  without a night (weekly pieces). The answer pings nobody. Trial answers are test rows.
- The seeded half is per post and person: replying again never re-rolls.

**Privacy text:** added word for word to `privacy.tsx` and `data-collection.tsx` (screenshots taken
from a dev server in the worktree, pages render in the existing style). `lastUpdated` of both is
already 2026-11-13; set it to the release day if later (runbook step 3).

**Checks** (2026-11-13, in the worktree):

- `pnpm --filter @eanhl/db build`: pass.
- typecheck db, web, discord, worker: pass (each filter matched its package).
- discord tests: 724/724 pass (40 new: thread-join 7, replies-raw 6, replies 12, wire-replies 15,
  config 1 more).
- db query tests by name (news-wire-replies, news-press, news-interviews, news): 120/120 pass;
  `pnpm --filter @eanhl/db test`: 233/233 pass.
- web `test:unit`: 672/672 pass.
- prettier: all changed files pass. `pnpm format:check` is red on 37 files that are unchanged from
  main (not this task).
- Not run: anything with Docker (verification database), the migration on a database, a live game
  night.

**Done when:** the code part is done and tested with fakes. "On a game night …" needs the deploy
(migration 0075, `press`, `news`, `web`, and `PRESS_WIRE_REPLIES=1` for item 3): the operator's OK.
Then watch the `press` log for `thread join`, `thread message … taken` and `wire reply` lines.
