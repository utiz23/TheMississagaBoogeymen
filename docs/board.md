# Board

**Lead chat now:** `Lead` (session tag `08efa5`; task chats send to "Lead"). Task chats: T3 done (`eanhl-team-website-f2`), T4 done (`eanhl-team-website-0d`); T5 = the Lead's own task agent (since 2026-11-13 evening).

Only the Lead edits this file. One line per open task. Guide: `docs/operations/workflow-v2.md`.
Template: `docs/tasks/TEMPLATE.md`. Operator's live page: `docs/decisions.md`.
Limits: 2 task agents at once; 3 open operator decisions. Updated 2026-11-13 by the Lead.

## Open tasks

| Task                                                                                    | Lane               | Risk   | State                                                | Next                                                |
| --------------------------------------------------------------------------------------- | ------------------ | ------ | ---------------------------------------------------- | --------------------------------------------------- |
| [No badge announcements](tasks/2026-11-09-discord-no-badge-posts.md)                    | Discord            | low    | Deployed 11-09                                       | done                                                |
| [Goalie game score for 3 stars](tasks/2026-11-09-web-three-stars-score.md)              | Web                | medium | Deployed 11-09                                       | done                                                |
| [News live, in time order](tasks/2026-11-09-discord-news-live.md)                       | Queries/Web/Ops    | high   | Deployed 11-09                                       | watch the first game night in the channel           |
| [Game posts after one pass](tasks/2026-11-09-worker-post-after-one-pass.md)             | Worker             | medium | Deployed 11-09                                       | check the timing on the next game night             |
| [Press bots release 1](tasks/2026-11-13-discord-press-bots-release-1.md)                | Discord + DB + Web | high   | Deployed 11-13; LIVE in the game channel since 11-13 | done                                                |
| [T1 typed answers](tasks/2026-11-13-discord-press-typed-answers.md)                     | Discord            | medium | Deployed 11-13                                       | done                                                |
| [T2 panel scrums + `/gm ask`](tasks/2026-11-13-discord-press-panel-gm-ask.md)           | Discord + DB       | medium | Deployed 11-13 (0073 on live)                        | watch the next game night                           |
| [T3 interviews](tasks/2026-11-13-discord-press-interviews.md)                           | Discord + DB + Web | medium | Merged `f3f4bda0` (not deployed)                     | operator OK: backup → 0074 → `press`, `news`, `web` |
| [T4 Discord replies](tasks/2026-11-13-discord-press-replies.md)                         | Discord + Web      | medium | Merged `7afe9396` (not deployed)                     | operator OK: deploy with T3                         |
| [T5 hard lines + feuds](tasks/2026-11-13-discord-press-hard-lines-feuds.md)             | Discord + DB       | medium | Merged (not deployed)                                | operator OK: deploy with T3 + T4                    |
| [T6 player threads, no Answer button](tasks/2026-11-14-discord-press-player-threads.md) | Discord            | medium | Running (Lead's task agent)                          | Lead reviews; deploy `press` with operator OK       |

## Branches and worktrees from before v2

| Branch                                                        | Worktree                           | State                                                                      |
| ------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| `feat/news-desk`                                              | `.claude/worktrees/news-desk`      | at `b2b86469`, all in `main`: can be removed (operator OK)                 |
| `feat/news-desk-bots`                                         | `.claude/worktrees/news-desk-bots` | 30 commits not in `main` (release 1 bots); waits for privacy text approval |
| `docs/news-desk-bots-design`                                  | –                                  | design, approved 10-26                                                     |
| `park/codex-claude-bridge`, `park/roster-stats-design-inputs` | –                                  | parked, local only                                                         |
