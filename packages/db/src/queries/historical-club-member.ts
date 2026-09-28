import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '../client.js'
import {
  historicalClubMemberSeasonStats,
  players,
  type HistoricalClubMemberGameMode,
} from '../schema/index.js'
import {
  sumAdditive,
  weightedRatePassthroughOrRecompute,
  recomputeSavePct,
  passthroughGaa,
  identityOf,
  pairSkaterRoleGoalieGp,
  sumGoalieGpAcrossContributingModes,
  compareNullsLastNumeric,
  type IdentityKey,
  type GameMode,
} from './archive-club-member-aggregate.js'

/**
 * Club-scoped archive skater totals from the CLUBS → MEMBERS screen captures
 * (`historical_club_member_season_stats`).
 *
 * Distinct from `HistoricalSkaterStatsRow` (the player-card aggregate table):
 * this type is intentionally its own shape rather than reusing/widening that
 * one, because the club-member source captures a different — and partly
 * uncaptured — set of fields. Fields the screenshot source never captures
 * (`shotAttempts`, `toiSeconds`, `faceoffPct`) are omitted here; web adapters
 * supply explicit `null` for them so the shared display row still renders
 * "—" rather than a false 0.
 */
export interface ArchiveSkaterStatsRow {
  playerId: number | null
  gamertag: string
  position: string | null
  gamesPlayed: number | null
  goals: number | null
  assists: number | null
  points: number | null
  plusMinus: number | null
  pim: number | null
  shots: number | null
  hits: number | null
  takeaways: number | null
  giveaways: number | null
  passPct: string | null
}

/**
 * Club-scoped archive goalie totals. See `ArchiveSkaterStatsRow` for why this
 * is a dedicated type rather than a widened `HistoricalGoalieStatsRow`.
 * `totalShotsAgainst` and `toiSeconds` are never captured by this source and
 * are omitted; web adapters supply `null`.
 */
export interface ArchiveGoalieStatsRow {
  playerId: number | null
  gamertag: string
  gamesPlayed: number | null
  wins: number | null
  losses: number | null
  otl: number | null
  savePct: string | null
  gaa: string | null
  shutouts: number | null
  totalSaves: number | null
  totalGoalsAgainst: number | null
}

/**
 * Fetches the skater-role rows for this (title, mode) and pairs their
 * `goalie_gp` by identity — see `pairSkaterRoleGoalieGp` in
 * `archive-club-member-aggregate.ts` for the pairing rule and its
 * production-data verification (11/11 reviewed goalie rows paired, zero
 * mismatches).
 */
async function getPairedSkaterRoleGoalieGp(
  gameTitleId: number,
  gameMode: HistoricalClubMemberGameMode,
): Promise<Map<IdentityKey, number | null>> {
  const rows = await db
    .select({
      playerId: historicalClubMemberSeasonStats.playerId,
      gamertagSnapshot: historicalClubMemberSeasonStats.gamertagSnapshot,
      goalieGp: historicalClubMemberSeasonStats.goalieGp,
    })
    .from(historicalClubMemberSeasonStats)
    .where(
      and(
        eq(historicalClubMemberSeasonStats.gameTitleId, gameTitleId),
        eq(historicalClubMemberSeasonStats.gameMode, gameMode),
        eq(historicalClubMemberSeasonStats.roleGroup, 'skater'),
        eq(historicalClubMemberSeasonStats.reviewStatus, 'reviewed'),
      ),
    )

  return pairSkaterRoleGoalieGp(rows)
}

/**
 * Club-scoped historical skater totals from the CLUBS → MEMBERS screen
 * captures (`historical_club_member_season_stats`).
 *
 * Distinct from `getHistoricalSkaterStats` (which queries the
 * player-card aggregate table). Player-card season totals may include
 * games the player played for OTHER clubs in the same title; club-member
 * totals are scoped to this club only.
 *
 * `playerId` is nullable: when the importer could not resolve the
 * gamertag snapshot to a current `players` row the row is still surfaced
 * (using `gamertag_snapshot` as the displayed name) so it is visibly
 * listed rather than silently dropped. Every uncaptured field is returned
 * as `null`, never coerced to 0 — a stored 0 (e.g. `goals = 0`) is
 * preserved as-is.
 *
 * Filters to `review_status = 'reviewed'` so pending or rejected rows
 * never reach the UI.
 */
export async function getClubMemberSkaterStats(
  gameTitleId: number,
  gameMode: HistoricalClubMemberGameMode,
): Promise<ArchiveSkaterStatsRow[]> {
  const rows = await db
    .select({
      playerId: historicalClubMemberSeasonStats.playerId,
      gamertag: sql<string>`COALESCE(${players.gamertag}, ${historicalClubMemberSeasonStats.gamertagSnapshot})`,
      position: players.position,
      gamesPlayed: historicalClubMemberSeasonStats.skaterGp,
      goals: historicalClubMemberSeasonStats.goals,
      assists: historicalClubMemberSeasonStats.assists,
      points: historicalClubMemberSeasonStats.points,
      plusMinus: historicalClubMemberSeasonStats.plusMinus,
      pim: historicalClubMemberSeasonStats.pim,
      shots: historicalClubMemberSeasonStats.shots,
      hits: historicalClubMemberSeasonStats.hits,
      takeaways: historicalClubMemberSeasonStats.takeaways,
      giveaways: historicalClubMemberSeasonStats.giveaways,
      passPct: historicalClubMemberSeasonStats.passPct,
    })
    .from(historicalClubMemberSeasonStats)
    .leftJoin(players, eq(historicalClubMemberSeasonStats.playerId, players.id))
    .where(
      and(
        eq(historicalClubMemberSeasonStats.gameTitleId, gameTitleId),
        eq(historicalClubMemberSeasonStats.roleGroup, 'skater'),
        eq(historicalClubMemberSeasonStats.gameMode, gameMode),
        eq(historicalClubMemberSeasonStats.reviewStatus, 'reviewed'),
      ),
    )
    .orderBy(
      sql`${historicalClubMemberSeasonStats.points} DESC NULLS LAST`,
      sql`${historicalClubMemberSeasonStats.goals} DESC NULLS LAST`,
      sql`${historicalClubMemberSeasonStats.assists} DESC NULLS LAST`,
      asc(sql`COALESCE(${players.gamertag}, ${historicalClubMemberSeasonStats.gamertagSnapshot})`),
    )

  return rows
}

/**
 * Club-scoped historical goalie totals from the CLUBS → MEMBERS screen
 * captures. `playerId` is nullable for the same reason as the skater query
 * above. GP is recovered from the paired skater-role row — see
 * `getPairedSkaterRoleGoalieGp`. Every other uncaptured metric (W/L/OTL on
 * most NHL 22-25 captures, shots against, TOI) is returned as `null`, never
 * coerced to 0. Reviewed rows only.
 */
export async function getClubMemberGoalieStats(
  gameTitleId: number,
  gameMode: HistoricalClubMemberGameMode,
): Promise<ArchiveGoalieStatsRow[]> {
  const [rows, gpByIdentity] = await Promise.all([
    db
      .select({
        playerId: historicalClubMemberSeasonStats.playerId,
        gamertagSnapshot: historicalClubMemberSeasonStats.gamertagSnapshot,
        gamertag: sql<string>`COALESCE(${players.gamertag}, ${historicalClubMemberSeasonStats.gamertagSnapshot})`,
        wins: historicalClubMemberSeasonStats.wins,
        losses: historicalClubMemberSeasonStats.losses,
        otl: historicalClubMemberSeasonStats.otl,
        savePct: historicalClubMemberSeasonStats.savePct,
        gaa: historicalClubMemberSeasonStats.gaa,
        shutouts: historicalClubMemberSeasonStats.shutouts,
        totalSaves: historicalClubMemberSeasonStats.totalSaves,
        totalGoalsAgainst: historicalClubMemberSeasonStats.totalGoalsAgainst,
      })
      .from(historicalClubMemberSeasonStats)
      .leftJoin(players, eq(historicalClubMemberSeasonStats.playerId, players.id))
      .where(
        and(
          eq(historicalClubMemberSeasonStats.gameTitleId, gameTitleId),
          eq(historicalClubMemberSeasonStats.roleGroup, 'goalie'),
          eq(historicalClubMemberSeasonStats.gameMode, gameMode),
          eq(historicalClubMemberSeasonStats.reviewStatus, 'reviewed'),
        ),
      )
      .orderBy(
        sql`${historicalClubMemberSeasonStats.savePct} DESC NULLS LAST`,
        asc(historicalClubMemberSeasonStats.gaa),
        asc(
          sql`COALESCE(${players.gamertag}, ${historicalClubMemberSeasonStats.gamertagSnapshot})`,
        ),
      ),
    getPairedSkaterRoleGoalieGp(gameTitleId, gameMode),
  ])

  return rows.map((r) => ({
    playerId: r.playerId,
    gamertag: r.gamertag,
    gamesPlayed: gpByIdentity.get(identityOf(r.playerId, r.gamertagSnapshot)) ?? null,
    wins: r.wins,
    losses: r.losses,
    otl: r.otl,
    savePct: r.savePct,
    gaa: r.gaa,
    shutouts: r.shutouts,
    totalSaves: r.totalSaves,
    totalGoalsAgainst: r.totalGoalsAgainst,
  }))
}

interface RawSkaterModeRow {
  playerId: number | null
  gamertagSnapshot: string
  gamertag: string | null
  position: string | null
  skaterGp: number | null
  goals: number | null
  assists: number | null
  points: number | null
  plusMinus: number | null
  pim: number | null
  shots: number | null
  hits: number | null
  takeaways: number | null
  giveaways: number | null
  passPct: string | null
}

async function getRawSkaterModeRows(gameTitleId: number): Promise<RawSkaterModeRow[]> {
  return db
    .select({
      playerId: historicalClubMemberSeasonStats.playerId,
      gamertagSnapshot: historicalClubMemberSeasonStats.gamertagSnapshot,
      gamertag: players.gamertag,
      position: players.position,
      skaterGp: historicalClubMemberSeasonStats.skaterGp,
      goals: historicalClubMemberSeasonStats.goals,
      assists: historicalClubMemberSeasonStats.assists,
      points: historicalClubMemberSeasonStats.points,
      plusMinus: historicalClubMemberSeasonStats.plusMinus,
      pim: historicalClubMemberSeasonStats.pim,
      shots: historicalClubMemberSeasonStats.shots,
      hits: historicalClubMemberSeasonStats.hits,
      takeaways: historicalClubMemberSeasonStats.takeaways,
      giveaways: historicalClubMemberSeasonStats.giveaways,
      passPct: historicalClubMemberSeasonStats.passPct,
    })
    .from(historicalClubMemberSeasonStats)
    .leftJoin(players, eq(historicalClubMemberSeasonStats.playerId, players.id))
    .where(
      and(
        eq(historicalClubMemberSeasonStats.gameTitleId, gameTitleId),
        eq(historicalClubMemberSeasonStats.roleGroup, 'skater'),
        eq(historicalClubMemberSeasonStats.reviewStatus, 'reviewed'),
      ),
    )
}

/**
 * All-modes club-member skater totals — sums 6s + 3s rows per identity
 * group (matched player or unmatched gamertag snapshot).
 *
 * Aggregation follows the null-safe rule in `archive-club-member-aggregate.ts`:
 * a field is only summed when every contributing mode captured it; a mix of
 * null and recorded is returned as null rather than a partial sum (partial
 * coverage is out of scope for this unit). Rates use the same
 * pass-through-when-single-mode / recompute-when-complete rule.
 *
 * Identity grouping keeps unmatched (`player_id IS NULL`) rows visible by
 * grouping on the lowercased gamertag snapshot when no `players` row is
 * linked, mirroring the partial unique indexes on the source table.
 * Reviewed rows only.
 */
export async function getClubMemberSkaterStatsAllModes(
  gameTitleId: number,
): Promise<ArchiveSkaterStatsRow[]> {
  const rawRows = await getRawSkaterModeRows(gameTitleId)

  const byIdentity = new Map<IdentityKey, RawSkaterModeRow[]>()
  for (const r of rawRows) {
    const key = identityOf(r.playerId, r.gamertagSnapshot)
    const group = byIdentity.get(key) ?? []
    group.push(r)
    byIdentity.set(key, group)
  }

  const result: ArchiveSkaterStatsRow[] = []
  for (const group of byIdentity.values()) {
    const first = group[0]
    if (first === undefined) continue
    const playerId = group.find((r) => r.playerId !== null)?.playerId ?? null
    const gamertag = group.find((r) => r.gamertag !== null)?.gamertag ?? first.gamertagSnapshot
    const position = group.find((r) => r.position !== null)?.position ?? null

    result.push({
      playerId,
      gamertag,
      position,
      gamesPlayed: sumAdditive(group.map((r) => r.skaterGp)),
      goals: sumAdditive(group.map((r) => r.goals)),
      assists: sumAdditive(group.map((r) => r.assists)),
      points: sumAdditive(group.map((r) => r.points)),
      plusMinus: sumAdditive(group.map((r) => r.plusMinus)),
      pim: sumAdditive(group.map((r) => r.pim)),
      shots: sumAdditive(group.map((r) => r.shots)),
      hits: sumAdditive(group.map((r) => r.hits)),
      takeaways: sumAdditive(group.map((r) => r.takeaways)),
      giveaways: sumAdditive(group.map((r) => r.giveaways)),
      passPct: weightedRatePassthroughOrRecompute(
        group.map((r) => ({ rate: r.passPct, weight: r.skaterGp })),
      ),
    })
  }

  result.sort((a, b) => {
    const byPoints = compareNullsLastNumeric(a.points, b.points, 'desc')
    if (byPoints !== 0) return byPoints
    const byGoals = compareNullsLastNumeric(a.goals, b.goals, 'desc')
    if (byGoals !== 0) return byGoals
    const byAssists = compareNullsLastNumeric(a.assists, b.assists, 'desc')
    if (byAssists !== 0) return byAssists
    return a.gamertag.localeCompare(b.gamertag)
  })
  return result
}

interface RawGoalieModeRow {
  playerId: number | null
  gamertagSnapshot: string
  gamertag: string | null
  gameMode: GameMode
  wins: number | null
  losses: number | null
  otl: number | null
  savePct: string | null
  gaa: string | null
  shutouts: number | null
  totalSaves: number | null
  totalGoalsAgainst: number | null
}

async function getRawGoalieModeRows(gameTitleId: number): Promise<RawGoalieModeRow[]> {
  return db
    .select({
      playerId: historicalClubMemberSeasonStats.playerId,
      gamertagSnapshot: historicalClubMemberSeasonStats.gamertagSnapshot,
      gamertag: players.gamertag,
      gameMode: historicalClubMemberSeasonStats.gameMode,
      wins: historicalClubMemberSeasonStats.wins,
      losses: historicalClubMemberSeasonStats.losses,
      otl: historicalClubMemberSeasonStats.otl,
      savePct: historicalClubMemberSeasonStats.savePct,
      gaa: historicalClubMemberSeasonStats.gaa,
      shutouts: historicalClubMemberSeasonStats.shutouts,
      totalSaves: historicalClubMemberSeasonStats.totalSaves,
      totalGoalsAgainst: historicalClubMemberSeasonStats.totalGoalsAgainst,
    })
    .from(historicalClubMemberSeasonStats)
    .leftJoin(players, eq(historicalClubMemberSeasonStats.playerId, players.id))
    .where(
      and(
        eq(historicalClubMemberSeasonStats.gameTitleId, gameTitleId),
        eq(historicalClubMemberSeasonStats.roleGroup, 'goalie'),
        eq(historicalClubMemberSeasonStats.reviewStatus, 'reviewed'),
      ),
    )
}

/**
 * All-modes club-member goalie totals — sums underlying counts per identity
 * group using the null-safe rule (see `getClubMemberSkaterStatsAllModes`).
 *
 * GP is summed only across the modes that actually have a goalie-role row
 * for that identity — see `sumGoalieGpAcrossContributingModes` — never
 * derived from GA or GAA. A mode with no goalie row simply doesn't
 * contribute; a contributing mode whose paired GP is missing is a genuine
 * null contributor and makes the whole sum null. Save percentage passes the
 * stored value through unchanged when only one mode contributes, and is
 * otherwise recomputed from saves/(saves+GA) only when both are complete
 * across every contributing mode — see `recomputeSavePct`. GAA is
 * intentionally never combined across modes — see `passthroughGaa` —
 * because that would require assuming every `goalie_gp` was a full
 * 60-minute game, which this source cannot verify. Multi-mode GAA is
 * therefore always null; single-mode passes the stored value through.
 * Reviewed rows only.
 */
export async function getClubMemberGoalieStatsAllModes(
  gameTitleId: number,
): Promise<ArchiveGoalieStatsRow[]> {
  const [rawRows, gp6s, gp3s] = await Promise.all([
    getRawGoalieModeRows(gameTitleId),
    getPairedSkaterRoleGoalieGp(gameTitleId, '6s'),
    getPairedSkaterRoleGoalieGp(gameTitleId, '3s'),
  ])

  const byIdentity = new Map<IdentityKey, RawGoalieModeRow[]>()
  for (const r of rawRows) {
    const key = identityOf(r.playerId, r.gamertagSnapshot)
    const group = byIdentity.get(key) ?? []
    group.push(r)
    byIdentity.set(key, group)
  }

  const result: ArchiveGoalieStatsRow[] = []
  for (const [key, group] of byIdentity.entries()) {
    const first = group[0]
    if (first === undefined) continue
    const playerId = group.find((r) => r.playerId !== null)?.playerId ?? null
    const gamertag = group.find((r) => r.gamertag !== null)?.gamertag ?? first.gamertagSnapshot
    const contributingModes = [...new Set(group.map((r) => r.gameMode))]
    const pairedGpByMode = new Map<GameMode, number | null>([
      ['6s', gp6s.get(key) ?? null],
      ['3s', gp3s.get(key) ?? null],
    ])

    result.push({
      playerId,
      gamertag,
      gamesPlayed: sumGoalieGpAcrossContributingModes(contributingModes, pairedGpByMode),
      wins: sumAdditive(group.map((r) => r.wins)),
      losses: sumAdditive(group.map((r) => r.losses)),
      otl: sumAdditive(group.map((r) => r.otl)),
      savePct: recomputeSavePct(
        group.map((r) => ({
          savePct: r.savePct,
          saves: r.totalSaves,
          goalsAgainst: r.totalGoalsAgainst,
        })),
      ),
      gaa: passthroughGaa(group.map((r) => ({ gaa: r.gaa }))),
      shutouts: sumAdditive(group.map((r) => r.shutouts)),
      totalSaves: sumAdditive(group.map((r) => r.totalSaves)),
      totalGoalsAgainst: sumAdditive(group.map((r) => r.totalGoalsAgainst)),
    })
  }

  result.sort((a, b) => {
    const bySavePct = compareNullsLastNumeric(
      a.savePct === null ? null : Number.parseFloat(a.savePct),
      b.savePct === null ? null : Number.parseFloat(b.savePct),
      'desc',
    )
    if (bySavePct !== 0) return bySavePct
    const byGamesPlayed = compareNullsLastNumeric(a.gamesPlayed, b.gamesPlayed, 'desc')
    if (byGamesPlayed !== 0) return byGamesPlayed
    return a.gamertag.localeCompare(b.gamertag)
  })
  return result
}
