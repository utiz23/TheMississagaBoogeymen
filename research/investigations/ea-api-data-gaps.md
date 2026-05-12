# EA Pro Clubs API — Known Data Gaps & Field Investigations

> Ongoing research. Update when new gaps or confirmations are found.

---

## Confirmed Missing / Always Null

### Faceoff % (FO%)

**Status: Always null. Do not display.**

FO% is `null` for all 33+ matches in the DB (as of 2026-05-01). It has never been populated. The field exists in the schema but EA does not return it in the Pro Clubs match payload. Always showed `—` in the UI.

**Resolution:** Replaced with Pass% on the `/games` score card. Pass% is populated for all 33 matches (range: 50–93%, average 77%). Pass% = `passCompletions / passAttempts`.

### blazeId / EA ID

**Status: Absent from match payloads. Permanently nullable.**

`blazeId` is not present in EA's match payload response for Pro Clubs. This was discovered during initial ingestion. Gamertag is the actual production identity anchor. `players.ea_id` is nullable permanently.

**Implication:** Player deduplication works only when gamertag is stable. Gamertag history is tracked in `player_gamertag_history`.

### Shot Coordinates / Location Data

**Status: Not in standard payloads. Possibly in other endpoints.**

Hot-zone / rink-spatial shot visualizations are blocked by missing spatial data. EA does not expose shot coordinates in the standard Pro Clubs match payload.

**Possible path:** HAR analysis of Chelhead captures suggests fields like `ShotsLocationOnIce*` / `GoalsLocationOnIce*` may exist in other endpoint families. Not verified for Pro Clubs API. Blocked pending further investigation.

---

## Confirmed Available (Previously Uncertain)

### Opponent Time on Attack (`time_on_attack_against`)

**Status: Available. Was incorrectly treated as absent.**

`time_on_attack_against` is stored in the `matches` schema and is populated by `transform.ts` from `clubs[opponentClubId].toa.timeOnAttack` in the EA payload.

**Discovery:** The "DTW gauge" (Deserve to Win) showed only BGM TOA with a "BGM only" label, implying opponent TOA was unavailable. Investigation confirmed the data is in the DB — only the view-model failed to pass it through.

**Fix (`match-recap.ts`):** `PossessionEdge.inputs` now carries `timeOnAttackSecondsAgainst: number | null` from `match.timeOnAttackAgainst`. The TOA row in the gauge now shows `us–them` format. Field is `null` only if the raw EA value was 0 or missing.

### OT/SO Outcome Detection (`clubs[id].result` codes)

**Status: Resolved. `clubs[id].result` is a numeric code, not just W/L.**

Until 2026-05-09 the worker emitted only `WIN | LOSS | DNF` because no overtime
fixture had been mined to confirm the OTL code. Investigation across 71 NHL 26
BGM matches uncovered the full code set:

- `1` regulation WIN, `2` regulation LOSS
- `5` OT/SO WIN (still 2pts), `6` OT/SO LOSS → **`OTL`**
- `10` DNF (corroborated by `winnerByDnf` on the opponent)
- `16385` (`0x4001`) WIN by opponent forfeit

Smoking gun for the OTL classification: every code-5 / code-6 match has a
strict 1-goal margin and the codes are always paired (`5 ↔ 6`). OT and shootout
share the same code — EA does not distinguish them in this field, so we lump
both into `OTL`.

**Fix (`apps/worker/src/transform.ts → deriveResult`):** Code `6` now returns
`OTL` directly. Codes `5` and `16385` join the regulation `WIN` bucket.
Unknown codes fall back to score-derived WIN/LOSS so a future EA variant
doesn't silently break ingestion.

Full investigation with cross-tab evidence:
[`research/investigations/ea-overtime-detection.md`](./ea-overtime-detection.md).

---

## Field Shape Investigations (UNVERIFIED)

### `club_season_rank` Fields

**Status: UNVERIFIED. Sourced from HAR analysis only.**

The `club_season_rank` table was designed from a HAR capture of the `seasonRank` endpoint. Field names and shapes have NOT been confirmed against live worker runs. Specifically: `wins`, `losses`, `otl` on `club_season_rank` are season-specific (current season W/L/OTL), not all-time. Do not conflate with `club_seasonal_stats`.

**Action needed:** Inspect the DB row after the next ingestion cycle to confirm all widget values are correct.

---

## Rate Limits & API Behavior

### Match History Window

EA's Pro Clubs API returns approximately the **5 most recent matches** per request. If the worker is down for more than ~25–30 minutes during active play, matches can be permanently lost.

**Source:** HAR analysis + operational observation. Documented in `docs/ea-client/ha-limit-evidence.md`.

### Request Throttling

Worker enforces 1 second between API calls (`EA_REQUEST_DELAY_MS`). Exponential backoff on 429/5xx (3 retries, `2^n × 500ms + jitter`). No concurrent requests within a cycle.

### Endpoint Families

Known Pro Clubs endpoints used:

| Endpoint | Data |
|---|---|
| `clubs/matches` (`gameType5`, `gameType10`, `club_private`) | Match results + player stats |
| `clubs/members` | Member season stats per player |
| `clubs/seasonalStats` | All-time club record (W/L/OTL official) |
| `clubs/seasonRank` | Current season standing + division thresholds |
| EA crest CDN | Opponent club crests |

**Hard limit documented:** `clubs/matches` returns at most ~5 recent matches per match type regardless of pagination. See `docs/ea-client/` for HAR evidence.

---

## Data Source Decisions

These were explicitly researched and decided. Do not change silently.

| Context | Source | Label |
|---|---|---|
| `gameMode === null` (All) | `ea_member_season_stats` | "EA season totals" |
| `gameMode === '6s'` or `'3s'` | `player_game_title_stats` | "local tracked" |
| Club record (all modes) | `club_seasonal_stats` | "EA official" |
| Club record (mode-filtered) | `club_game_title_stats` | "local · {mode} only" |

**Rule:** Never blend sources. EA totals ≠ local aggregates. Never substitute silently.
