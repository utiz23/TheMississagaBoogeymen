# For the operator: what needs you now

Your dashboard. The Lead updates it after every merge, decision, deploy or new task.
Last update: **2026-11-14 03:52 CST** (Lead2). All tasks: `docs/board.md`.
Tip: open with Markdown preview (Ctrl+Shift+V); it refreshes when the Lead saves.

## 1. Waiting for your answer (max 3)

| ID  | Question                                                                                                                                                                                                                                                                                 | My advice                                             | Waiting costs                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| D2  | Deploy E1 (live events)? Steps: migration 0079 (one new table), two new secrets in Hotel-Echo's `.env`, rebuild `web` + `worker`, then `tailscale serve` on port 3100 (tailnet only). Rule: Codex second opinion first (secrets + a new way in); I give you the one command to type.     | Yes, after Codex, at a quiet time (not during a game) | Nothing until the engine's sender (E2) exists; no hurry |
| D3  | Press Box L1: do the screenshots look right? Files: `overview.png`, `overview-phone.png`, `board-sample-selected.png` (sent to you; the coloured board cells are SAMPLE data, live has no relationships yet). OK = I merge; the deploy (backup, 0080, `web` + `press`) is a separate OK. | Yes: it matches the approved mock-up                  | L2 cannot start until L1 is merged                      |

## 2. Right now

| What                            | State                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Press bots                      | LIVE in the game channel (typed answers, own threads, panel scrums, interviews, replies, bench, test scrums) |
| T9 relationships + T10 Talk fix | LIVE since 2026-11-14                                                                                        |
| E1 live events endpoint         | merged (all checks pass; boot-order fault fixed with `tailscale serve`); deploy is D2                        |
| Press Box L1                    | built and checked (web 701/701, discord 848/848); waits for your OK on the screenshots (D3)                  |
| Backup hardening                | LIVE since 03:42 (lock proven; this week's weekly copy made); I check the 11-15 03:00 run                    |

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
