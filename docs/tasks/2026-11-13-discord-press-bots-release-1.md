# Task: Press bots release 1 (post-game scrums)

- **State:** Proposed (operator 2026-11-13: "lets work on the post game scrums")
- **Lane:** Discord (with Queries, Database: migration 0072, Web: privacy text, nickname list; Ops:
  compose service `press`)
- **Risk:** high (new database tables on live, 9 bots post in the team channel, player answers stored
  and sent to the AI service)
- **Slug:** press-bots (branch `work/press-bots`, worktree `.claude/worktrees/press-bots`; made from
  `feat/news-desk-bots`, which stays as it is)
- **Operator approval:** pending
- **Operator gate before merge:** yes (privacy text, trial channel, scope)
- **Needs a deploy:** yes: migration 0072 (after a fresh backup), then `web`, `news`, `press`
  (runbook `docs/operations/runbooks/news-desk-bots-setup.md`)

## Goal and visible result

After a game, the recap wire post in the game channel has a "Talk to the press" button. On a big game
one player is pinged; they accept and answer 1–2 reporter questions in a thread (pop-up text box, works
on a phone). Their answers can be quoted in the night recap. Also in release 1: `/scrum`, GM notes
(`/gm`), fan-reaction follow-ups, and every news post sent by the reporter's own bot instead of the
webhook. Design: `docs/superpowers/specs/2026-10-25-news-desk-bots-design.md` (approved 2026-10-26).

## State found (Lead, 2026-11-13)

- Built 2026-10-26 by subagents (30 commits; 50 rulings and deferred minor findings in
  `docs/superpowers/plans/2026-10-26-news-desk-bots-rulings.md`). Never deployed.
- 26 `main` commits came after its base. Test merge: 4 files conflicted (5 small hunks), now resolved
  on `work/press-bots`: rules version (both sides changed the rules from `.3` → new `2026-11-13.1`), the
  `news-main.ts` header and a lost `sendWebhook` import (the test-channel copy), two test files (both
  sides' tests kept).
- The runbook's cost table is stale: it says the desk costs $8–10 a month with a $20 cap. Real:
  $1–5 per game night (November $15.17 by 11-13), cap $60. Its 80% rule stops scrums at $48.
- **Clash with an operator rule:** the design runs a trial in the bot test channel (only the GM is
  there, every ping goes to the GM). The operator turned the news desk's test-channel copies off on
  2026-11-09. The press trial uses its own channel setting (`PRESS_TEST_CHANNEL_ID`), not that webhook.

## Paths

- **May edit:** every path the branch already changes (`git diff --name-only main...work/press-bots`),
  `docs/operations/runbooks/news-desk-bots-setup.md`, this task file.
- **Must not touch:** anything else without a new line in the Log.

## Plan

1. Merge `main` into the branch (done, resolved), then every check: typecheck db, web, discord,
   worker; discord, web unit and db tests; prettier. Then a review of the merged diff (Codex second
   opinion: secrets, a live migration, stored player text: required by the workflow).
2. Fix the runbook: real costs; the live channel = the game channel; the deferred wording items.
3. Operator: approve the privacy text (or change it); decide the trial channel and the scope.
4. Operator: create the 9 Discord bot applications (runbook, about 30 minutes); tokens go straight
   into Hotel-Echo's `.env`, never in chat.
5. Release (runbook checklist): fresh backup → migration 0072 → `web`, `news`, `press` → trial night →
   read the trial → `PRESS_MODE=live`.

## Done when

- **Done when:** a live game night has a scrum in the game channel thread, the answer is stored as
  usable, and the night recap quotes it within its rules; no teammate on "Leave me out" is pinged.

## Log

- 2026-11-13 Lead: worktree made, `main` merged into it, conflicts resolved (above). Checks on the
  merge: typecheck db, web, discord, worker pass; discord tests 566/566; web unit 672/672; db tests
  365 pass, 3 fail only for want of a database (`DATABASE_URL`; OCR/run-quality query files, not in
  this change); prettier pass. Not run: worker integration and migration 0072 on a test database (no
  Docker on the main PC).
