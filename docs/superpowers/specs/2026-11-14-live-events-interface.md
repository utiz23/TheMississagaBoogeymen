# Live events — engine/OBS → website interface (draft)

Status: **draft for review** (website Lead 2026-11-14, after a first exchange with the engine Lead
`[LEAD4]`). Decisions are the operator's; the engine sends nothing to the website until he approves it
and the engine has a card for it (engine rule). One copy lives in each repo once agreed.

Written for: the operator and both Leads.

## 1. Why

Today the press waits for EA: a game appears 1–12 minutes after it ends (the worker polls every 5
minutes), then the recap, then scrums, so questions arrive in the middle of the next game. The operator
wants: faster scrums, intermission interviews, and scrums triggered by big moments (e.g. an OT giveaway
that loses the game) without the GM asking.

## 2. What exists (engine Lead, 2026-11-14)

- **Live today, not the engine:** the OBS macros on Windows see, in real time, the club countdown lobby
  (game starts in ~90 s), the scorebug (game on) and the return to the lobby after the post-game screens
  (game over, seconds after the end). Faults seen on 11-13 (stuck intermission fired the end chime; a
  DNF file ran over 3 games; a last game not recorded); engine card OBS-EC investigates.
- **The engine:** reads finished recordings only (WSL, main PC), 0.3–1× game length per pass. Live input
  is its milestone 8 (no date). It reads per game: scorebug (period, clock, score, shots, PP, empty net),
  goals (time, team, scorer, assists, strength; wide test not yet accepted: 9.4% scorers/assists
  unknown), penalties, final score, post-game screens. Not read: giveaways, takeaways, live +/-, ice time;
  who is on ice not accepted yet (M3). Output per game: `events.jsonl` (`type` shot | goal | penalty |
  end_of_game; `period`, `clock_left` in tenths, `ms`, `team`, `side`, names + `*_gamertag`,
  `infraction`, `minutes`, final scores). Identity = gamertag.

## 3. The interface (proposal)

- **Transport:** HTTPS `POST` of one small JSON event to the website,
  `https://boogeymen.app/api/internal/live-events` (through the existing Cloudflare tunnel), with a
  bearer token (`LIVE_EVENTS_TOKEN`, in the website's `.env` and the sender's local secret file, never
  in git or chat) and an HMAC of the body with a timestamp (replay window 2 minutes). Alternative if the
  operator prefers no public route: the Tailscale address of Hotel-Echo with a loopback-only port
  forward. Rate limit; the website answers `202` and never blocks the sender.
- **Event shape (v1):**

```json
{
  "v": 1,
  "id": "obs-2026-11-14T03:20:41Z-game_end",
  "type": "game_start | game_end | period_end | goal | penalty | end_of_game",
  "source": "obs | engine",
  "at": "2026-11-14T03:20:41Z",
  "game_title": "nhl27",
  "period": 3,
  "clock_left_ds": 0,
  "score": { "bgm": 5, "opp": 4 },
  "team": "bgm | opp",
  "scorer_gamertag": "Stick Menace",
  "assist_gamertags": ["silkyjoker85"],
  "strength": "ev | pp | sh",
  "confidence": 0.97
}
```

Only `v`, `id`, `type`, `source`, `at` are required; the rest per type. `id` makes resends harmless
(the website stores each id once). Gamertags, never invented names.

- **Website side:** stores events in a `live_events` table (append only, 30 days), never shows them
  directly; the worker and the press read them. An event never overrides EA data: EA stays the truth
  for stats; events only make things **faster** or add **moments**.

## 4. Plan (ordered; each step a card/task with the operator's OK)

| Step   | Who                  | What                                                                                                                                                                                                                                              | Needs                                  |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **E1** | website              | `POST /api/internal/live-events` + `live_events` table + auth; the worker reacts to `game_end` by polling EA at once and every 30 s until the game appears (instead of waiting up to 5 min)                                                       | migration, `web` + `worker` deploy     |
| **E2** | engine/OBS           | the OBS macro (or the match sorter) sends `game_start` and `game_end`                                                                                                                                                                             | engine card; OBS-EC faults fixed first |
| **E3** | website              | press: prepare at `game_end` (pick the panel, warm the context) so the recap and pings go out the moment EA has the game; a "game is in, press on the way" line                                                                                   | E1                                     |
| **E4** | engine (milestone 8) | live `period_end`, `goal`, `penalty` from the engine                                                                                                                                                                                              | engine live input                      |
| **E5** | website              | intermission interviews at `period_end` (short, one reporter, 2–3 questions, ends at puck drop); a live ticker of goals in the game channel; event-triggered scrums for big moments (OT winner/loser, hat trick, late collapse, shorthanded goal) | E4; giveaways need a new engine reader |

Expected gain from E1+E2+E3 alone: game post and scrum pings about 1–2 minutes after the end instead of
1–12 (today's EA delay stays, but no polling wait).

## 5. Open questions for the operator

1. Public HTTPS route with token + HMAC, or Tailscale-only?
2. E1–E3 now (website first; OBS sender after OBS-EC), and E4–E5 when the engine goes live?
3. Big-moment triggers: which moments count (list in E5), and how many automatic scrums a night at most?
