/**
 * Expected per-match roster authority — returns the list of (team_side, position)
 * pairs that should be visible for a given match. Used by the loadout promoter
 * (Task 2A-17 step 8) to write blocked_observability ocr_promotions rows for
 * absent slots.
 *
 * Authority chain (Task 2A-13a discovery):
 *   1. `player_match_stats` (BGM side) UNION `opponent_player_match_stats` (opp
 *      side) — both are populated by the EA-ingest worker for every match that
 *      passed through the transformer. They provide: position (EA format) and
 *      team_side (integer 0=home/1=away). These tables exist for all 4 test
 *      matches (1, 2, 250, 463) and are the only per-match roster source in the
 *      schema (no dedicated match_lineups table exists).
 *   2. `[]` — when neither table has rows for the match, the promoter skips
 *      observability blocking entirely.
 *
 * There is NO secondary fallback: player_match_stats + opponent_player_match_stats
 * together constitute the single authority. An empty result from both means the
 * match was never ingested through the EA transformer, and the OCR pipeline has
 * no ground truth to compare against.
 *
 * Position mapping (EA API → ExpectedSlot):
 *   EA 'center'    → 'C'
 *   EA 'leftWing'  → 'LW'
 *   EA 'rightWing' → 'RW'
 *   EA 'goalie'    → 'G'  (not seen in current data but handled)
 *   EA 'defenseMen'→ 'LD' for the first row per (match_id, team_side), 'RD' for
 *                    the second. EA does not distinguish LD/RD; this assignment
 *                    is stable within a call (ordered by id ASC) but ARBITRARY
 *                    as to which physical player maps to LD vs RD. The promoter
 *                    only cares that "two defenseman slots exist" — it does NOT
 *                    match by player identity, so the LD/RD split is sufficient
 *                    for observability blocking purposes. Task 2B-0a checkpoints
 *                    this before Phase 2B cutover.
 *
 * team_side derivation:
 *   BGM rows come from player_match_stats  → teamSide = 'for'
 *   Opp rows come from opponent_player_match_stats → teamSide = 'against'
 *   The integer team_side column (home/away) is NOT used here; the table
 *   identity already encodes the for/against distinction.
 *
 * Discovery findings (matches 1, 2, 250, 463):
 *   player_match_stats:
 *     match  1: 3 rows (center, defenseMen, leftWing)         — 3s match
 *     match  2: 3 rows (center, defenseMen, leftWing)         — 3s match
 *     match 250: 5 rows (center, defenseMen×2, leftWing, rightWing) — 6s match
 *     match 463: 5 rows (center, defenseMen×2, leftWing, rightWing) — 6s match
 *   opponent_player_match_stats:
 *     same counts and positions as BGM (symmetric EA payload)
 *   No goalie rows in any of the 4 matches (EA does not include the goalie
 *   position in per-player stats; the goalie plays as a skater in the stats).
 *   No match_lineups table exists in the schema.
 *
 * Task 2B-0a will verify this authority is sufficient before Phase 2B cutover.
 *
 * @module expected-roster
 */

import { eq } from 'drizzle-orm'
import { db as defaultDb, type Database } from '../client.js'
import { playerMatchStats, opponentPlayerMatchStats } from '../schema/index.js'

export type ExpectedSlot = {
  teamSide: 'for' | 'against'
  position: 'C' | 'LW' | 'RW' | 'LD' | 'RD' | 'G'
}

/** Map EA API position string to ExpectedSlot position. Returns null when unknown. */
function mapPosition(eaPosition: string | null): 'C' | 'LW' | 'RW' | 'G' | 'defenseMen' | null {
  switch (eaPosition) {
    case 'center':
      return 'C'
    case 'leftWing':
      return 'LW'
    case 'rightWing':
      return 'RW'
    case 'goalie':
      return 'G'
    case 'defenseMen':
      return 'defenseMen' // resolved to LD/RD in caller via counter
    default:
      return null
  }
}

/**
 * Converts a list of {id, position} rows (all from the same match + team side)
 * into ExpectedSlot entries. Defensemen are assigned LD, RD in id-ascending
 * order to produce stable (though arbitrary) L/R splits per call.
 */
function toExpectedSlots(
  rows: Array<{ id: number; position: string | null }>,
  teamSide: 'for' | 'against',
): ExpectedSlot[] {
  // Sort by id ascending so the LD/RD assignment is deterministic.
  const sorted = [...rows].sort((a, b) => a.id - b.id)
  const slots: ExpectedSlot[] = []
  let dmenCount = 0
  for (const row of sorted) {
    const mapped = mapPosition(row.position)
    if (mapped === null) continue
    if (mapped === 'defenseMen') {
      slots.push({ teamSide, position: dmenCount === 0 ? 'LD' : 'RD' })
      dmenCount++
    } else {
      slots.push({ teamSide, position: mapped })
    }
  }
  return slots
}

/**
 * Returns the (team_side, position) pairs expected for a given match.
 *
 * See module docblock for the full authority chain and discovery findings.
 * When neither authority table has rows the function returns `[]` and the
 * loadout promoter writes no blocked_observability rows.
 *
 * @param matchId - Surrogate `matches.id` (bigserial PK).
 * @param db      - Drizzle db instance; defaults to the shared module-level db.
 */
export async function getExpectedSlotsForMatch(
  matchId: number,
  db: Database = defaultDb,
): Promise<ExpectedSlot[]> {
  // Query both sides in parallel — they are independent tables.
  const [bgmRows, oppRows] = await Promise.all([
    db
      .select({ id: playerMatchStats.id, position: playerMatchStats.position })
      .from(playerMatchStats)
      .where(eq(playerMatchStats.matchId, matchId)),
    db
      .select({ id: opponentPlayerMatchStats.id, position: opponentPlayerMatchStats.position })
      .from(opponentPlayerMatchStats)
      .where(eq(opponentPlayerMatchStats.matchId, matchId)),
  ])

  if (bgmRows.length === 0 && oppRows.length === 0) {
    // No authority available — no observability blocking.
    return []
  }

  return [...toExpectedSlots(bgmRows, 'for'), ...toExpectedSlots(oppRows, 'against')]
}
