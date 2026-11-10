# Board

**Lead chat now:** this chat (started 2026-11-09, VS Code; a new Lead updates this line first).

Only the Lead edits this file. One line per open task. Guide: `docs/operations/workflow-v2.md`.
Template: `docs/tasks/TEMPLATE.md`. Operator's live page: `docs/decisions.md`.
Limits: 2 task agents at once; 3 open operator decisions. Updated 2026-11-09 by the Lead.

## Open tasks

| Task                                                                       | Lane            | Risk   | State          | Next                                      |
| -------------------------------------------------------------------------- | --------------- | ------ | -------------- | ----------------------------------------- |
| [No badge announcements](tasks/2026-11-09-discord-no-badge-posts.md)       | Discord         | low    | Deployed 11-09 | done                                      |
| [Goalie game score for 3 stars](tasks/2026-11-09-web-three-stars-score.md) | Web             | medium | Deployed 11-09 | done                                      |
| [News live, in time order](tasks/2026-11-09-discord-news-live.md)          | Queries/Web/Ops | high   | Deployed 11-09 | watch the first game night in the channel |

## Branches and worktrees from before v2

| Branch                                                        | Worktree                           | State                                                                      |
| ------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| `feat/news-desk`                                              | `.claude/worktrees/news-desk`      | at `b2b86469`, all in `main`: can be removed (operator OK)                 |
| `feat/news-desk-bots`                                         | `.claude/worktrees/news-desk-bots` | 30 commits not in `main` (release 1 bots); waits for privacy text approval |
| `docs/news-desk-bots-design`                                  | –                                  | design, approved 10-26                                                     |
| `park/codex-claude-bridge`, `park/roster-stats-design-inputs` | –                                  | parked, local only                                                         |
