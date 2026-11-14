# Board

**Lead chat now:** `Lead2` (session ref `647652`; started 2026-11-14 03:16 CST as the new Lead; task chats and the engine Lead send to "Lead2"; a new Lead updates this line first). Earlier: `Lead` (ref `08efa5`; 2026-11-13 to 2026-11-14 03:16, stood down; its E1 task agent finishes inside it and reports to Lead2).

Only the Lead edits this file. One line per open task. Guide: `docs/operations/workflow-v2.md`.
Template: `docs/tasks/TEMPLATE.md`. Operator's live page: `docs/decisions.md`.
Limits: 3 task agents at once (operator 2026-11-14); 3 open operator decisions. Updated 2026-11-14 15:30 CST by Lead2. Fully done tasks leave the board; their files stay in `docs/tasks/`.

## Open tasks

| Task                                                                                                      | Lane                    | Risk        | State                                                           | Next                                                |
| --------------------------------------------------------------------------------------------------------- | ----------------------- | ----------- | --------------------------------------------------------------- | --------------------------------------------------- |
| [News live, in time order](tasks/2026-11-09-discord-news-live.md)                                         | Queries/Web/Ops         | high        | Deployed 11-09                                                  | watch the first game night in the channel           |
| [Game posts after one pass](tasks/2026-11-09-worker-post-after-one-pass.md)                               | Worker                  | medium      | Deployed 11-09                                                  | check the timing on the next game night             |
| [T2 panel scrums + `/gm ask`](tasks/2026-11-13-discord-press-panel-gm-ask.md)                             | Discord + DB            | medium      | Deployed 11-13 (0073 on live)                                   | watch the next game night                           |
| [T4 Discord replies](tasks/2026-11-13-discord-press-replies.md)                                           | Discord + Web           | medium      | Deployed 11-14 (0075; wire replies need `PRESS_WIRE_REPLIES=1`) | done (`PRESS_WIRE_REPLIES=1` on live)               |
| [T6 player threads, no Answer button](tasks/2026-11-14-discord-press-player-threads.md)                   | Discord                 | medium      | Deployed 11-14                                                  | watch the first live scrum                          |
| [T7 bench voices (watched in the call)](tasks/2026-11-14-discord-press-bench-voices.md)                   | Discord + DB + Web      | medium      | Deployed 11-14 (0077)                                           | test with T8                                        |
| [T8 `/gm testscrum` (no AI)](tasks/2026-11-14-discord-press-test-scrum.md)                                | Discord                 | low         | Deployed 11-14                                                  | first real run: operator's `/gm testscrum`          |
| [T9 relationships: open war ↔ glazing](tasks/2026-11-14-discord-press-relationships.md)                   | Discord + DB            | medium      | Deployed 11-14 (0078)                                           | watch the first game night                          |
| [E1 live events endpoint + fast EA poll](tasks/2026-11-14-web-live-events-e1.md)                          | Web + Worker + DB + Ops | high        | Deployed 11-14 14:12 (0079; tailscale serve 3100)               | engine E2 sender; watch the first game night        |
| [D4 worker watchdog + time limits](tasks/2026-11-14-worker-loop-watchdog.md)                              | Worker                  | medium      | Deployed 11-14 14:12                                            | done                                                |
| [L1 Press Box: overview + relationships board + log](tasks/2026-11-14-web-press-box-l1-overview.md)       | Web + DB                | medium      | Deployed 11-14 14:01 (0080)                                     | operator looks at `/admin/press-box`                |
| [Backup hardening: missed weekly/monthly, one run at a time](tasks/2026-11-14-ops-backup-hardening.md)    | Ops                     | medium      | Deployed 11-14 03:42                                            | check the 11-15 03:00 run                           |
| [L2 Press Box: dossiers + AI profiles](tasks/2026-11-14-web-press-box-l2-dossiers.md)                     | Web + DB                | medium      | Deployed 11-14 14:55 (0081)                                     | operator tries a dossier and one profile            |
| [Rename public Press Room → News Desk](tasks/2026-11-14-web-news-desk-rename.md)                          | Web                     | low         | Deployed 11-14 14:15                                            | done                                                |
| [L3 Press Box: storylines + takes editor](tasks/2026-11-14-web-press-box-l3-storylines.md)                | Web + DB                | medium      | Ready (L2 merged: can start)                                    |                                                     |
| [L4 Press Box: reporter editor](tasks/2026-11-14-web-press-box-l4-reporters.md)                           | Web + DB                | medium      | Ready (after L3)                                                |                                                     |
| [B1 Player background: bank, facts, admin editor](tasks/2026-11-14-web-background-b1.md)                  | Web + DB + Queries      | medium      | Verify (Lead checks pass)                                       | D13 operator screenshots; then merge                |
| [B2 Player background: bots ask, propose facts, teammate veto](tasks/2026-11-14-discord-background-b2.md) | Discord + Web           | medium-high | Ready (after B1)                                                | privacy sentence + samples are a gate               |
| [CF1 Club Finals: rounds, badges, page](tasks/2026-11-14-web-club-finals-cf1.md)                          | Worker + DB + Web       | medium      | Verify (Verifier running)                                       | Verifier, then operator screenshots + history (D14) |
| [CF2 Club Finals in Discord + news weighting](tasks/2026-11-14-discord-club-finals-cf2.md)                | Discord                 | medium      | Ready (after CF1)                                               | operator OKs samples                                |
| [CF3 Club Finals look on the site](tasks/2026-11-14-web-club-finals-cf3.md)                               | Web                     | low-medium  | Ready (after CF1)                                               | operator screenshots before merge                   |
| [CF4 Club Finals stats](tasks/2026-11-14-web-club-finals-cf4.md)                                          | Worker + DB + Web       | medium      | Proposed                                                        | operator decides (after CF3)                        |

## Branches and worktrees from before v2

| Branch                                                        | Worktree                           | State                                                                      |
| ------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| `feat/news-desk`                                              | `.claude/worktrees/news-desk`      | at `b2b86469`, all in `main`: can be removed (operator OK)                 |
| `feat/news-desk-bots`                                         | `.claude/worktrees/news-desk-bots` | 30 commits not in `main` (release 1 bots); waits for privacy text approval |
| `docs/news-desk-bots-design`                                  | –                                  | design, approved 10-26                                                     |
| `park/codex-claude-bridge`, `park/roster-stats-design-inputs` | –                                  | parked, local only                                                         |
