# EA NHL OT/OTL Detection (NHL 26 EASHL)

_2026-05-09_

## Question

The match `result` enum is `WIN | LOSS | OTL | DNF`. Until now the worker only
emitted `WIN | LOSS | DNF` because no overtime fixture had been mined. The
`/games/[id]` and home record strip show `W-L-OTL` totals so getting OTL right
matters for the public record.

## TL;DR

The `clubs[clubId].result` field in the raw EA match payload is a numeric code,
not just W/L. Across **71 NHL 26 BGM matches** there are six observed codes:

| Code | Meaning | Our derivation |
|---:|---|---|
| `1` | Regulation WIN | `WIN` |
| `2` | Regulation LOSS | `LOSS` |
| `5` | **Overtime / Shootout WIN** (counts as 2 points) | `WIN` |
| `6` | **Overtime / Shootout LOSS** (counts as 1 point) | **`OTL`** ← new |
| `10` | DNF / disconnect | `DNF` |
| `16385` (`0x4001`) | WIN by opponent forfeit | `WIN` |

The OTL codes are the only new finding worth landing in the worker. Codes
1/2/10/16385 the transform already handles correctly.

## Evidence

Every observed code-5 and code-6 match has a **1-goal margin**, never larger:

| `our_code` | matches | min margin | max margin |
|---:|---:|---:|---:|
| 5 (WIN) | 6 | 1 | 1 |
| 6 (LOSS) | 5 | 1 | 1 |

That is the defining signature of an OT/SO result in EA NHL:

- Both regulation periods always end with the score margin we see (no scoring
  during regulation could produce that margin and a code-5/6 simultaneously).
- `clubs[ourId].result` and `clubs[oppId].result` are always paired — when ours
  is `5`, the opponent's is `6`, and vice versa.
- TOA (`time on attack`) values for code 5/6 fall in the same band as code 1/2
  (368–1027s vs 426–1027s), so it isn't a duration-based discriminator on its
  own.

Sample of the rule across the BGM history:

| match_id | mode | score | margin | result | our_code | opp_code |
|---|---|---|---:|---|---:|---:|
| 18634798730296 | 6s | 2-3 | -1 | LOSS→**OTL** | 6 | 5 |
| 18634455050491 | 6s | 4-3 | +1 | WIN | 5 | 6 |
| 18056564180136 | 6s | 2-3 | -1 | LOSS→**OTL** | 6 | 5 |
| 13780861560332 | 6s | 3-4 | -1 | LOSS→**OTL** | 6 | 5 |
| 10706211690292 | 6s | 5-6 | -1 | LOSS→**OTL** | 6 | 5 |

That accounts for 5 historical losses that should have been OTL, plus 6 wins
that came in OT (which still count as W in the W-L-OTL split).

## Fields explored that did NOT discriminate

- `clubs[id].toa` — wide overlap between regulation and OT games.
- `aggregate.<id>.toiseconds` — sum of player TOIs; not a clean game-length
  signal because EASHL substitutes mid-shift.
- Player-level `toi` / `toiseconds` — AI goalie fills net for most BGM games
  and has no player record; rare member-goalie samples don't generalize.
- `cNhlOnlineGameType`, `pNhlOnlineGameType` — playlist identifiers, not
  per-match outcome.
- `winnerByDnf`, `winnerByGoalieDnf` — already used; orthogonal to OT.

## Why `1`/`2` and `5`/`6` (not `3`/`4`)

NHL standings semantics map cleanly to a bitfield:

- bit 0 = `WIN` (1) vs `LOSS` (0): `1`/`5` win, `2`/`6` lose.
- bit 2 = OT bonus point: `5` = `1 + 4`, `6` = `2 + 4`.
- `3` and `4` would be ties from older NHL games — not produced in NHL 26.
- `10` = `2 + 8` (DNF flag layered on LOSS).
- `16385` = `1 + 16384` (forfeit-win flag on WIN).

This is an inferred decoding; we don't need to consume the bitfield directly,
just enumerate the observed values.

## Risks / unknowns

- **Shootout vs OT** is not distinguished. EA emits the same code (`5`/`6`) for
  both; the public W-L-OTL record treats them identically so this is fine.
- **3v3 modes** — 1 of the 11 OT samples was a 3s game; the same code rule
  applied. Confidence is lower for 3s overall (smaller sample) but no
  counter-examples observed.
- **Future codes** — if EA introduces a new outcome (tournaments, playoffs)
  the transform will fall through to the score-derived `WIN`/`LOSS`. Add a
  warn-log when an unknown code shows up so we notice it.

## Action

1. Update `deriveResult()` in `apps/worker/src/transform.ts` to map code 6 → `OTL`.
2. Rebuild + `reprocess --all` to backfill OTL classifications.
3. Verify the home record strip reflects OTL on the last-10 dots and the
   season `W-L-OTL` totals.
