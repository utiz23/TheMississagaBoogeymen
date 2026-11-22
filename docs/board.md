# Board

**Lead chat now:** `eanhl-team-website-bc` (Lead3; session ref `74682f`; started 2026-11-20 21:03 CST as the new Lead; task chats and the engine Lead send to "eanhl-team-website-bc"; a new Lead updates this line first). Earlier: `Lead2` (2026-11-14 03:16 to 2026-11-20 21:03, stood down); `Lead` (ref `08efa5`; 2026-11-13 to 2026-11-14 03:16).

Only the Lead edits this file. One line per open task. Guide: `docs/operations/workflow-v2.md`.
Template: `docs/tasks/TEMPLATE.md`. Operator's live page: `docs/decisions.md`.
Limits: 3 task agents at once (operator 2026-11-14); 3 open operator decisions. Updated 2026-11-21 21:21 CST by Lead3 (Game Score page deployed). Fully done tasks leave the board; their files stay in `docs/tasks/`.

## Open tasks

| Task                                                                                                      | Lane                    | Risk        | State                                                           | Next                                           |
| --------------------------------------------------------------------------------------------------------- | ----------------------- | ----------- | --------------------------------------------------------------- | ---------------------------------------------- |
| [News live, in time order](tasks/2026-11-09-discord-news-live.md)                                         | Queries/Web/Ops         | high        | Deployed 11-09                                                  | watch the first game night in the channel      |
| [Game posts after one pass](tasks/2026-11-09-worker-post-after-one-pass.md)                               | Worker                  | medium      | Deployed 11-09                                                  | check the timing on the next game night        |
| [T2 panel scrums + `/gm ask`](tasks/2026-11-13-discord-press-panel-gm-ask.md)                             | Discord + DB            | medium      | Deployed 11-13 (0073 on live)                                   | watch the next game night                      |
| [T4 Discord replies](tasks/2026-11-13-discord-press-replies.md)                                           | Discord + Web           | medium      | Deployed 11-14 (0075; wire replies need `PRESS_WIRE_REPLIES=1`) | done (`PRESS_WIRE_REPLIES=1` on live)          |
| [T6 player threads, no Answer button](tasks/2026-11-14-discord-press-player-threads.md)                   | Discord                 | medium      | Deployed 11-14                                                  | watch the first live scrum                     |
| [T7 bench voices (watched in the call)](tasks/2026-11-14-discord-press-bench-voices.md)                   | Discord + DB + Web      | medium      | Deployed 11-14 (0077)                                           | test with T8                                   |
| [T8 `/gm testscrum` (no AI)](tasks/2026-11-14-discord-press-test-scrum.md)                                | Discord                 | low         | Deployed 11-14                                                  | first real run: operator's `/gm testscrum`     |
| [T9 relationships: open war ↔ glazing](tasks/2026-11-14-discord-press-relationships.md)                   | Discord + DB            | medium      | Deployed 11-14 (0078)                                           | watch the first game night                     |
| [E1 live events endpoint + fast EA poll](tasks/2026-11-14-web-live-events-e1.md)                          | Web + Worker + DB + Ops | high        | Deployed 11-14 14:12 (0079; tailscale serve 3100)               | engine E2 sender; watch the first game night   |
| [D4 worker watchdog + time limits](tasks/2026-11-14-worker-loop-watchdog.md)                              | Worker                  | medium      | Deployed 11-14 14:12                                            | done                                           |
| [L1 Press Box: overview + relationships board + log](tasks/2026-11-14-web-press-box-l1-overview.md)       | Web + DB                | medium      | Deployed 11-14 14:01 (0080)                                     | operator looks at `/admin/press-box`           |
| [Backup hardening: missed weekly/monthly, one run at a time](tasks/2026-11-14-ops-backup-hardening.md)    | Ops                     | medium      | Deployed 11-14 03:42                                            | check the 11-15 03:00 run                      |
| [L2 Press Box: dossiers + AI profiles](tasks/2026-11-14-web-press-box-l2-dossiers.md)                     | Web + DB                | medium      | Deployed 11-14 14:55 (0081)                                     | operator tries a dossier and one profile       |
| [Rename public Press Room → News Desk](tasks/2026-11-14-web-news-desk-rename.md)                          | Web                     | low         | Deployed 11-14 14:15                                            | done                                           |
| [L3 Press Box: storylines + takes editor](tasks/2026-11-14-web-press-box-l3-storylines.md)                | Web + DB                | medium      | Deployed 11-14 18:54 (0085)                                     | operator tries a pin                           |
| [L4 Press Box: reporter editor](tasks/2026-11-14-web-press-box-l4-reporters.md)                           | Web + DB                | medium      | Deployed 11-14 19:36 (0087)                                     | operator tries the editor                      |
| [B1 Player background: bank, facts, admin editor](tasks/2026-11-14-web-background-b1.md)                  | Web + DB + Queries      | medium      | Deployed 11-14 15:41 (0082)                                     | done                                           |
| [B2 Player background: bots ask, propose facts, teammate veto](tasks/2026-11-14-discord-background-b2.md) | Discord + Web           | medium-high | Deployed 11-14 17:12 (0084); switch OFF                         | operator turns it on when wanted               |
| [CF1 Club Finals: rounds, badges, page](tasks/2026-11-14-web-club-finals-cf1.md)                          | Worker + DB + Web       | medium      | Deployed 11-14 15:54 (0083)                                     | done                                           |
| [CF2 Club Finals in Discord + news weighting](tasks/2026-11-14-discord-club-finals-cf2.md)                | Discord                 | medium      | Deployed 11-14 17:59                                            | watch the next 6v6 finals game                 |
| [CF3 Club Finals look on the site](tasks/2026-11-14-web-club-finals-cf3.md)                               | Web                     | low-medium  | Deployed 11-14 16:47                                            | done                                           |
| [CF3b finals card: tags in the top row, same height](tasks/2026-11-14-web-club-finals-card-tags.md)       | Web                     | low         | Deployed 11-14 17:54                                            | done                                           |
| [CF4 Club Finals stats](tasks/2026-11-14-web-club-finals-cf4.md)                                          | Worker + DB + Web       | medium      | Proposed                                                        | operator decides (after CF3)                   |
| [P1 NHL 27 goals + shots by period (engine import)](tasks/2026-11-14-worker-period-import-p1.md)          | Worker + Web            | medium-high | Deployed 11-14 19:48; 22 games imported 19:53                   | next import when the engine exports more games |
| [/gm ask: a private brief by default, never posted](tasks/2026-11-14-discord-gm-ask-brief.md)             | Discord                 | medium      | Deployed 11-14 19:27                                            | done                                           |
| [Temporary Game Score explainer page](tasks/2026-11-21-web-game-score-page.md)                            | Web                     | low         | Running (Lead3 does it)                                         | screenshot to the operator, then deploy `web`  |

## Branches and worktrees from before v2

| Branch                                                        | Worktree                           | State                                                                      |
| ------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| `feat/news-desk`                                              | `.claude/worktrees/news-desk`      | at `b2b86469`, all in `main`: can be removed (operator OK)                 |
| `feat/news-desk-bots`                                         | `.claude/worktrees/news-desk-bots` | 30 commits not in `main` (release 1 bots); waits for privacy text approval |
| `docs/news-desk-bots-design`                                  | –                                  | design, approved 10-26                                                     |
| `park/codex-claude-bridge`, `park/roster-stats-design-inputs` | –                                  | parked, local only                                                         |
