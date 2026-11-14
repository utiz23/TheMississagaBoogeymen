# For the operator: what needs you now

Your dashboard. The Lead updates it after every merge, decision, deploy or new task.
Last update: **2026-11-14 15:08 CST** (Lead2). All tasks: `docs/board.md`.
Tip: open with Markdown preview (Ctrl+Shift+V); it refreshes when the Lead saves.

## 1. Waiting for your answer (max 3)

| ID  | Question  | My advice | Waiting costs |
| --- | --------- | --------- | ------------- |
| -   | none open | -         | -             |

## 2. Right now

| What                                            | State                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Press bots                                      | LIVE in the game channel (typed answers, own threads, panel scrums, interviews, replies, bench, test scrums)                   |
| T9 relationships + T10 Talk fix                 | LIVE since 2026-11-14                                                                                                          |
| E1 live events                                  | LIVE since 14:12, Tailscale only (port 3100). Waits for the engine's sender (E2).                                              |
| Worker watchdog                                 | LIVE since 14:12: a stuck worker restarts itself within 15 minutes; EA requests stop after 30 s                                |
| Press Box L1                                    | LIVE since 14:01 at `/admin/press-box` (sign in first). The board is empty until relationships build up on game nights.        |
| Press Box L2 (player dossiers + AI profiles)    | LIVE since 14:55 at `/admin/press-box/players`. "Write" makes an AI profile (about $0.05).                                     |
| Player background B1                            | running (task agent); B2 starts after B1 is merged                                                                             |
| Club Finals (playoffs) CF1                      | running (task agent): rounds from EA results, game badges, a Club Finals page, Season 1 history; CF2 (Discord + news) after it |
| News Desk name + Press Box in your account menu | LIVE since 14:15                                                                                                               |
| Backup hardening                                | LIVE since 03:42 (lock proven; this week's weekly copy made); I check the 11-15 03:00 run                                      |

## 3. Your to-dos (only you can do these)

- **Anthropic workspace limit:** set it to $100 a month to match the news desk cap ($100 on
  Hotel-Echo since 11-13; scrums stop at $80). November so far: $15.17.

## 4. Can start when you say so

| Item                                        | Size  | Note                                                                           |
| ------------------------------------------- | ----- | ------------------------------------------------------------------------------ |
| Remove the merged `feat/news-desk` worktree | tiny  | Clean-up only.                                                                 |
| Contribution Wheel hydration warning        | small | Old warning in the browser console; no visible fault.                          |
| Prettier red on 8 old files                 | tiny  | `pnpm format:check` fails on old docs and 2 code files; no effect on the site. |

## 5. Watch (no action now)

- **Game post speed:** since 11-09 the post goes out about 1 minute after the worker saves the game.
  The rest of the wait is EA: on 11-12 the worker saw games 1–12 minutes after they ended (it checks
  every 5 minutes).
- **News desk:** live in the game channel. 11-12: Barlow's recap "Sunnyvale Shot Hawks push the
  Boogeymen skid to five" posted.
- **Cards:** re-check the season pace at mid-season; re-tune before NHL 28.
- **Legal footer notice** (AI news): hides itself on 2026-11-25. Nothing to do.

## 6. Done recently

- 2026-11-09: no badge posts · goalie stars fix (A + .900) · news desk live, feed in time order, cap
  $60 · game posts after one worker pass · bot test channel off · workflow v2 adopted.

## 7. Decided (newest first, your words)

- 2026-11-14 15:08 · Club Finals (playoffs): "approve all 4 items" → round/game badges (site + Discord
  post), a Club Finals page, finals games weigh more for news and scrums, Season 1 history rebuilt and
  checked against the engine's panel reads. Tasks CF1 (running) and CF2 (after CF1).
- 2026-11-14 15:02 · "B1 and B2 ready" → B1 started; B2 after B1.
- 2026-11-14 14:56 · Player background: bots fill it in over time (mostly interviews, rare in scrums);
  "they specifically requested the ability to be asked to rate or criticise teammates" → allowed, with an
  admin veto (teammate facts confirm-only); the admin edits every fact. "write B1 and B2".
- 2026-11-14 14:52 · "deploy L2" → Press Box L2 deployed 14:55 (backup, 0081, `press`, `web`).
- 2026-11-14 14:45 · Press Box L2: "D7 screenshots ok" (merged); "D8 Yes" (keep write + rule check, 2
  requests per profile); "D9 yes" (an admin may raise a "Leave me out" player's press level; logged).
- 2026-11-14 14:15 · "deploy approved" (D6) → News Desk rename + Press Box menu item live.
- 2026-11-14 14:10 · "make press room a option in the admin navbar pfp dropdown" → "Press Box" item for admins.
- 2026-11-14 14:05 · "rename Press Room … To News Desk" → public `/news` pages only (the AI writer's
  internal "PRESS ROOM" label and `/admin/news` stay).
- 2026-11-14 14:04 · "start L2" → Press Box L2 started (2 task agents with D4).
- 2026-11-14 13:58 · "D4 yes" → worker watchdog + time limits task started; "D5 yes, now is a quiet time" →
  Press Box L1 deploy.
- 2026-11-14 13:46 · "I meant D2 and D3" → deploy E1 after a Codex second opinion (running, E1 changes
  only, your OK on the arguments); merge Press Box L1 after the review ends.
- 2026-11-14 · "D1, approved" → backup hardening deployed 03:42 (rollback tag `:rollback-he-2026-11-14-pre-hardening`).
- 2026-11-14 · Live goal ticker: "agreed" → a fixed template line, no AI; AI only for big-moment
  comments, intermission interviews and the recap. EA's game post stays the final word.
- 2026-11-14 · "Proceed with both" → Press Box L1 and backup hardening started (3 task agents with E1).
- 2026-11-14 · Task agents at once: "I typically run 3 tasks at once, but you can petition me for more
  or less" → limit 3 (was 2); the Lead may ask for more or fewer.
- 2026-11-14 · EA load at the horn: "lets go with your advice" → E1 checks only the EA match lists at
  the horn and at +1, +2, +4, +8 min (worst case ~15 extra EA calls per game; was every 30 s for
  15 min, ~210). Normal 5-minute pass unchanged.
- 2026-11-14 · "agreed. deploy" → T9 + T10 deployed (0078); new Lead chat after this deploy.
- 2026-11-14 · Live events route: "this is going to run on hotel echo, otherwise I am not sure, your
  call" → Lead: Tailscale only (main PC over Tailscale, or Hotel-Echo locally). Plan: "approved". Big
  moments: "Your list sounds right, we can adjust this later."
- 2026-11-14 · Father Rink: "should never engage in feuds" (T9 range rule).
- 2026-11-14 · Glazing: "write the cards" (T9 one scale, open war ↔ glazing).
- 2026-11-14 · Press Box design and mock-up: "APPROVED." Name: "Press Box".
- 2026-11-14 · Bench voices: GM + volunteer; "Coach" + Discord name; privacy paragraph approved.
- 2026-11-14 · One thread per player; reporters reply to the player; "axe the answer button".
- 2026-11-13 · Hard lines never acknowledged; feuds; "If players want to cool off they can change
  their status."
- 2026-11-13 · Press bots: privacy text approved; open trial; all as built; 9 accounts ("robust");
  news cap $100.
