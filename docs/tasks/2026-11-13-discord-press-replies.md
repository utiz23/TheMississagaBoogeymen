# Task: T4 — Discord replies (answers, reporter replies, replies to wire posts)

- **State:** Ready (operator 2026-11-13: all three items; privacy paragraph approved as written); starts
  after T3 is merged
- **Lane:** Discord (`apps/discord/src/press/`, `apps/discord/src/news/`), Web (privacy text),
  Database only if item 3 needs a small table
- **Risk:** medium (reads more Discord messages; new AI calls on player text)
- **Slug:** press-replies
- **Operator gate before merge:** yes (privacy text)
- **Needs a deploy:** `press`, `news`, `web` (privacy text); a migration only if needed

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

## Report
