/**
 * Expected per-match roster authority — returns the list of (team_side, position)
 * pairs that should be visible for a given match. Used by the loadout promoter
 * (Task 2A-17 step 8) to write blocked_observability ocr_promotions rows for
 * absent slots.
 *
 * Phase 2A-13 ships this as a STUB returning []. Task 2A-13a is the discovery +
 * implementation step that wires the authoritative source.
 *
 * Fallback chain (per Task 2A-13a):
 *   1. match_lineups (or whichever table holds rosters) — if populated, return verbatim
 *   2. player_match_stats — derive (team_side, position) from post-game stats rows
 *   3. otherwise return [] (no observability blocking)
 *
 * The promoter treats `[]` as "no expected roster known" — it does NOT write any
 * blocked_observability rows in that case.
 *
 * TODO(2A-13a): wire the authoritative source.
 */

export type ExpectedSlot = {
  teamSide: 'for' | 'against'
  position: 'C' | 'LW' | 'RW' | 'LD' | 'RD' | 'G'
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getExpectedSlotsForMatch(matchId: number): Promise<ExpectedSlot[]> {
  // TODO(Task 2A-13a): discover authoritative table + implement fallback chain
  return []
}
