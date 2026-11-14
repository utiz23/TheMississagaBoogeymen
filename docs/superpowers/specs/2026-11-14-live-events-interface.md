# Live events — engine/OBS → website interface (draft)

Status: **approved by the operator 2026-11-14** (E1–E3 now, E4–E5 when the engine is live; reviewed by the engine Lead ; website Lead 2026-11-14). Decisions are the operator's; the engine sends nothing to the website until he approves it
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
- **The engine:** reads finished recordings only (WSL, main PC); one pass alone ~0.3–1× game length,
  2–3 h per recording when the machine is loaded. Live input
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
  "id": "obs-2026-11-14T03:20:41Z-period_end",
  "type": "lobby_countdown | game_start | period_end | goal | penalty | end_of_game_screen | game_end",
  "source": "obs | engine",
  "at": "2026-11-14T03:20:41Z",
  "game_title": "nhl27",
  "period": 3,
  "clock_left_ds": 0,
  "score": { "bgm": 5, "opp": 4 },
  "team": "bgm | opp",
  "team_abbr": "BM",
  "side": "home | away",
  "scorer_name": "WAY",
  "scorer_gamertag": null,
  "assist_names": ["NARD"],
  "assist_gamertags": [null],
  "strength": "ev | pp | sh",
  "ea_match_id": null,
  "sure": true
}
```

Required: `v`, `id`, `type`, `source`, `at` (wall time; engine events get wall time once live). The
sender maps the scorebug club abbreviation to `team` (`bgm` | `opp`) and keeps `team_abbr` and
`side`. Names: `*_name` is the in-game text; `*_gamertag` only when the roster match is sure, else
`null` (never guessed). `period` 4/5/6 = OT, OT2, OT3 (EASHL has no shootout). `sure` replaces a
confidence number (the engine has none). `id` makes resends harmless.

- **The event types, in game order:** `lobby_countdown` (the club countdown lobby, optional; a countdown
  can lead to no game), `game_start` (the first scorebug, not the countdown), `period_end` (the horn:
  scorebug gone at 0:00, any period; a tie in the 3rd goes to OT, so it is not yet the game's end),
  `goal`, `penalty`, `end_of_game_screen` (the engine's read of the END OF GAME screen: final score and
  box score), `game_end` (back in the lobby after the post-game screens; 2–5 minutes after the horn
  because the operator pages through them). The match sorter may add `ea_match_id` to `game_end` once EA
  has the game.
- **Website side:** stores events in a `live_events` table (append only, 30 days), never shows them
  directly; the worker and the press read them. An event never overrides EA data: EA stays the truth
  for stats; events only make things **faster** or add **moments**.

## 4. Plan (ordered; each step a card/task with the operator's OK)

| Step   | Who                  | What                                                                                                                                                                                                                                                                                            | Needs                                                                                                |
| ------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **E1** | website              | `POST /api/internal/live-events` + `live_events` table + auth; on a `period_end` in period 3 or later the worker checks the EA match lists only, at once and at +1, +2, +4, +8 min, until the game appears (changed 2026-11-14 by the operator: was every 30 s for 15 min); `game_end` confirms | migration, `web` + `worker` deploy                                                                   |
| **E2** | engine/OBS           | the OBS match sorter (`eashl_match_sorter.py`, the operator's script on Windows; the ASS macros set a state it reads) sends `game_start`, `period_end` and `game_end` (+ `ea_match_id`); secret in a local file outside git                                                                     | OBS-EC fixed first (false ends/starts on 11-13); an engine Platform card; operator OK for his script |
| **E3** | website              | press: prepare at the horn (pick the panel, warm the context) so the recap and pings go out the moment EA has the game                                                                                                                                                                          | E1                                                                                                   |
| **E4** | engine (milestone 8) | live `period_end`, `goal`, `penalty`, `end_of_game_screen` from the engine                                                                                                                                                                                                                      | engine live input                                                                                    |
| **E5** | website              | intermission interviews at `period_end` (short, one reporter, 2–3 questions, ends at puck drop); a live ticker of goals in the game channel; event-triggered scrums for big moments (OT winner/loser, hat trick, late collapse, shorthanded goal)                                               | E4; giveaways need a new engine reader; "who is on ice" not before M3 acceptance                     |

Expected gain from E1+E2+E3: polling starts at the horn, so the game post and scrum pings go out as soon
as EA lists the game (often about 1 minute after the end) instead of waiting for the next 5-minute poll.

## 5. Operator decisions (2026-11-14)

1. **Route:** the operator left it to the Lead ("this is going to run on Hotel-Echo … your call").
   Lead's call: **Tailscale only** — nothing new on the public internet. The website listens for live
   events on Hotel-Echo's Tailscale address only (a port bound to that address, not to the public
   tunnel); every event still carries the bearer token and the HMAC.
   **Where the sender runs is open** (operator: the engine "is intended to run on Hotel-Echo when
   properly deployed, so I am not sure"; today capture and OBS are on the main PC). Both work: from the
   main PC over Tailscale, or on Hotel-Echo itself over the local Docker network. Neither uses the
   public tunnel.
2. **Order:** approved — E1–E3 now (website first; the OBS sender after OBS-EC, with an engine card and
   the operator's OK for his match sorter); E4–E5 when the engine is live.
3. **Big moments:** the list in E5 is right; adjust later.
4. **EA load at the horn** (operator, 2026-11-14 03:18, "lets go with your advice"): E1 checks only
   the EA match lists, at once and at +1, +2, +4, +8 min (worst case ~15 extra EA calls per game), not
   a full pass every 30 s. The normal 5-minute pass is unchanged.
5. **Goal ticker = template, no AI** (operator, 2026-11-14 03:27, "agreed"): E5's live goal line is a
   fixed template from the `goal` event (score, scorer, assists, time, period), posted at once, so it
   is fast, exact, free, and works when the Claude service is down or the cap is reached. AI is used
   only around it: a reporter's one-line comment on big moments, intermission interviews, and the
   recap after the game. The ticker is marked as a live reading; the EA game post stays the final
   word. Open for E5: correct or delete a wrong or overturned goal line.
   Engine Lead's notes for E5 (2026-11-14): the engine's goal lines already carry period, clock left
   (tenths), team + side, scorer + up to 2 assists (in-game names; gamertag when sure) and goal number
   per team (score after the goal from the scorebug). (a) A game-ending goal (OT winner, or any goal
   that ends the game) has no clock live, because the scorebug vanishes at once: post it as "OT winner,
   time unknown" and fill the time later from the Events screen. (b) Every event carries `sure`: post
   only sure goals, or mark the line "reading". (c) No goal review or disallowed goal seen in NHL 27
   recordings yet; the safe design is to edit the line in place by event id.
