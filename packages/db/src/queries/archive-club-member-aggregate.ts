/**
 * Pure, null-safe aggregation for combining per-mode
 * `historical_club_member_season_stats` rows into an All-modes total.
 *
 * Kept separate from the DB query so the aggregation rule is unit-testable
 * without a database: SQL `SUM(...)` silently treats every NULL contributor
 * as absent (effectively 0), which is exactly the false-zero behavior this
 * module exists to avoid. Callers fetch the raw per-mode rows and pass them
 * here.
 *
 * Rule for every additive field (GP, goals, saves, …):
 *   - every contributing value null  -> null (nothing was ever captured)
 *   - any null mixed with recorded   -> null (a partial sum is not returned
 *                                        or displayed in this unit — see
 *                                        Phase 2 plan, Unit A scope)
 *   - every value recorded           -> sum (recorded 0 is a real value)
 */
export function sumAdditive(values: readonly (number | null)[]): number | null {
  if (values.length === 0) return null
  let sum = 0
  for (const v of values) {
    if (v === null) return null
    sum += v
  }
  return sum
}

/**
 * GP-weighted rate aggregation (e.g. pass_pct, save_pct-from-counts).
 *
 * - exactly one contributing row -> pass its stored rate through unchanged
 *   (never recomputed from a single sample)
 * - more than one row -> recompute only when every rate AND its GP weight
 *   is present for every contributor; otherwise null
 */
export function weightedRatePassthroughOrRecompute(
  rows: readonly { rate: string | null; weight: number | null }[],
): string | null {
  if (rows.length === 0) return null
  if (rows.length === 1) return rows[0]?.rate ?? null

  let num = 0
  let den = 0
  for (const r of rows) {
    if (r.rate === null || r.weight === null) return null
    num += Number.parseFloat(r.rate) * r.weight
    den += r.weight
  }
  return den > 0 ? (num / den).toFixed(2) : null
}

/**
 * Save percentage aggregation.
 *
 * - zero contributors -> null
 * - exactly one contributor -> its stored `savePct` is returned unchanged
 *   (never recomputed from a single sample — the same rule as
 *   `weightedRatePassthroughOrRecompute` and `passthroughGaa`)
 * - multiple contributors -> recomputed from saves / (saves + GA), only when
 *   both are complete for every contributor; otherwise null
 */
export function recomputeSavePct(
  rows: readonly { savePct: string | null; saves: number | null; goalsAgainst: number | null }[],
): string | null {
  if (rows.length === 0) return null
  if (rows.length === 1) return rows[0]?.savePct ?? null

  const sv = sumAdditive(rows.map((r) => r.saves))
  const ga = sumAdditive(rows.map((r) => r.goalsAgainst))
  if (sv === null || ga === null) return null
  const denom = sv + ga
  return denom > 0 ? ((sv / denom) * 100).toFixed(2) : null
}

/**
 * Multi-mode GAA. GAA is goals-against per 60 minutes of TOI; the club-member
 * source never captures goalie TOI, so a multi-mode combined GAA cannot be
 * derived without assuming every `goalie_gp` was a full 60-minute game. That
 * assumption is explicitly rejected here (unlike the pre-Unit-A code, which
 * made it) — multi-mode GAA is always null. Single-mode GAA passes the
 * stored value through unchanged.
 */
export function passthroughGaa(rows: readonly { gaa: string | null }[]): string | null {
  if (rows.length === 0) return null
  if (rows.length === 1) return rows[0]?.gaa ?? null
  return null
}

/** Numeric comparator: null values sort last regardless of direction. */
export function compareNullsLastNumeric(
  a: number | null,
  b: number | null,
  direction: 'asc' | 'desc',
): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return direction === 'asc' ? a - b : b - a
}

export type IdentityKey = string

/** Matched player_id when present, else the lowercased gamertag snapshot. */
export function identityOf(playerId: number | null, gamertagSnapshot: string): IdentityKey {
  return playerId !== null ? `p:${String(playerId)}` : `g:${gamertagSnapshot.toLowerCase()}`
}

/**
 * The club-member screenshot source never captures goalie GP on the
 * goalie-role row — it is captured on the paired skater-role row for the
 * same (title, mode, identity) instead (the in-game CLUBS → MEMBERS screen
 * reports "goalie games played" as a column on the skater leaderboard).
 * Pairs by matched player_id when available, otherwise by lowercased
 * gamertag snapshot. Never derives GP from GA or GAA — a goalie row with no
 * paired skater row gets `null`, not an inferred value.
 */
export function pairSkaterRoleGoalieGp(
  skaterRoleRows: readonly {
    playerId: number | null
    gamertagSnapshot: string
    goalieGp: number | null
  }[],
): Map<IdentityKey, number | null> {
  const byIdentity = new Map<IdentityKey, number | null>()
  for (const r of skaterRoleRows) {
    byIdentity.set(identityOf(r.playerId, r.gamertagSnapshot), r.goalieGp)
  }
  return byIdentity
}

export type GameMode = '6s' | '3s'

/**
 * All-modes goalie GP: sums the paired skater-role GP (see
 * `pairSkaterRoleGoalieGp`) only across the modes that actually have a
 * goalie-role row for this identity. Production currently has only 6s
 * archive rows — treating an absent 3s mode as a null contributor would make
 * every All-mode goalie GP null, which is wrong: an absent mode contributes
 * nothing (and is excluded), while a contributing mode with no paired GP is
 * a genuine null contributor (and makes the whole sum null, per the additive
 * rule).
 */
export function sumGoalieGpAcrossContributingModes(
  contributingModes: readonly GameMode[],
  pairedGpByMode: ReadonlyMap<GameMode, number | null>,
): number | null {
  return sumAdditive(contributingModes.map((m) => pairedGpByMode.get(m) ?? null))
}
