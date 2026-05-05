import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '../client.js'
import {
  historicalClubMemberSeasonStats,
  players,
  type HistoricalClubMemberGameMode,
} from '../schema/index.js'
import type {
  HistoricalSkaterStatsRow,
  HistoricalGoalieStatsRow,
} from './historical.js'

/**
 * Club-scoped historical skater totals from the CLUBS → MEMBERS screen
 * captures (`historical_club_member_season_stats`).
 *
 * Distinct from `getHistoricalSkaterStats` (which queries the
 * player-card aggregate table). Player-card season totals may include
 * games the player played for OTHER clubs in the same title; club-member
 * totals are scoped to this club only.
 *
 * Returns rows shape-compatible with `HistoricalSkaterStatsRow` so the
 * existing `<SkaterStatsTable>` component can render the result without
 * any column changes. `playerId` is nullable: when the importer could not
 * resolve the gamertag snapshot to a current `players` row the row is
 * still surfaced (using `gamertag_snapshot` as the displayed name) so it
 * is visibly listed rather than silently dropped. Rate fields not
 * captured by the screenshot source (faceoffPct, shotAttempts, TOI) are
 * returned as null.
 *
 * Filters to `review_status = 'reviewed'` so pending or rejected rows
 * never reach the UI.
 */
export async function getClubMemberSkaterStats(
  gameTitleId: number,
  gameMode: HistoricalClubMemberGameMode,
): Promise<HistoricalSkaterStatsRow[]> {
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
      desc(historicalClubMemberSeasonStats.points),
      desc(historicalClubMemberSeasonStats.goals),
      desc(historicalClubMemberSeasonStats.assists),
      asc(sql`COALESCE(${players.gamertag}, ${historicalClubMemberSeasonStats.gamertagSnapshot})`),
    )

  return rows.map((r) => ({
    playerId: r.playerId,
    gamertag: r.gamertag,
    position: r.position,
    gamesPlayed: r.gamesPlayed ?? 0,
    goals: r.goals ?? 0,
    assists: r.assists ?? 0,
    points: r.points ?? 0,
    plusMinus: r.plusMinus ?? 0,
    pim: r.pim ?? 0,
    shots: r.shots ?? 0,
    hits: r.hits ?? 0,
    takeaways: r.takeaways ?? 0,
    giveaways: r.giveaways ?? 0,
    faceoffPct: null, // not captured by the club-member screenshot source
    passPct: r.passPct,
    shotAttempts: 0, // not captured
    toiSeconds: null, // not captured
  }))
}

/**
 * Club-scoped historical goalie totals from the CLUBS → MEMBERS screen
 * captures. Returns rows shape-compatible with `HistoricalGoalieStatsRow`.
 * `playerId` is nullable for the same reason as the skater query above.
 * Metrics not captured by the screenshots (W/L/OTL on most NHL 22–25
 * captures, shotsAgainst, TOI) come back null where the source didn't
 * provide them. Reviewed rows only.
 */
export async function getClubMemberGoalieStats(
  gameTitleId: number,
  gameMode: HistoricalClubMemberGameMode,
): Promise<HistoricalGoalieStatsRow[]> {
  const rows = await db
    .select({
      playerId: historicalClubMemberSeasonStats.playerId,
      gamertag: sql<string>`COALESCE(${players.gamertag}, ${historicalClubMemberSeasonStats.gamertagSnapshot})`,
      gamesPlayed: historicalClubMemberSeasonStats.goalieGp,
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
      desc(historicalClubMemberSeasonStats.savePct),
      asc(historicalClubMemberSeasonStats.gaa),
      asc(sql`COALESCE(${players.gamertag}, ${historicalClubMemberSeasonStats.gamertagSnapshot})`),
    )

  return rows.map((r) => ({
    playerId: r.playerId,
    gamertag: r.gamertag,
    gamesPlayed: r.gamesPlayed ?? 0,
    wins: r.wins,
    losses: r.losses,
    otl: r.otl,
    savePct: r.savePct,
    gaa: r.gaa,
    shutouts: r.shutouts,
    totalSaves: r.totalSaves,
    totalShotsAgainst: null, // not captured
    totalGoalsAgainst: r.totalGoalsAgainst,
    toiSeconds: null, // not captured
  }))
}

/**
 * All-modes club-member skater totals — sums 6s + 3s rows per identity
 * group (matched player or unmatched gamertag snapshot) and recomputes
 * pass_pct as a weighted-by-skater_gp average. Reviewed rows only.
 *
 * Identity grouping keeps unmatched (`player_id IS NULL`) rows visible
 * by grouping on the lowercased gamertag snapshot when no `players` row
 * is linked. This mirrors the partial unique indexes on the source
 * table.
 */
export async function getClubMemberSkaterStatsAllModes(
  gameTitleId: number,
): Promise<HistoricalSkaterStatsRow[]> {
  const identityKey = sql<string>`COALESCE('p:' || ${historicalClubMemberSeasonStats.playerId}::text, 'g:' || lower(${historicalClubMemberSeasonStats.gamertagSnapshot}))`
  const displayGamertag = sql<string>`COALESCE(MAX(${players.gamertag}), MAX(${historicalClubMemberSeasonStats.gamertagSnapshot}))`

  const rows = await db
    .select({
      playerId: historicalClubMemberSeasonStats.playerId,
      gamertag: displayGamertag,
      position: sql<string | null>`MAX(${players.position})`,
      gamesPlayed: sql<string>`COALESCE(SUM(${historicalClubMemberSeasonStats.skaterGp}), 0)`,
      goals: sql<string>`COALESCE(SUM(${historicalClubMemberSeasonStats.goals}), 0)`,
      assists: sql<string>`COALESCE(SUM(${historicalClubMemberSeasonStats.assists}), 0)`,
      points: sql<string>`COALESCE(SUM(${historicalClubMemberSeasonStats.points}), 0)`,
      plusMinus: sql<string>`COALESCE(SUM(${historicalClubMemberSeasonStats.plusMinus}), 0)`,
      pim: sql<string>`COALESCE(SUM(${historicalClubMemberSeasonStats.pim}), 0)`,
      shots: sql<string>`COALESCE(SUM(${historicalClubMemberSeasonStats.shots}), 0)`,
      hits: sql<string>`COALESCE(SUM(${historicalClubMemberSeasonStats.hits}), 0)`,
      takeaways: sql<string>`COALESCE(SUM(${historicalClubMemberSeasonStats.takeaways}), 0)`,
      giveaways: sql<string>`COALESCE(SUM(${historicalClubMemberSeasonStats.giveaways}), 0)`,
      // weighted-average pass_pct by skater_gp
      passPctNum: sql<string | null>`SUM(${historicalClubMemberSeasonStats.passPct} * ${historicalClubMemberSeasonStats.skaterGp})`,
      passPctDen: sql<string | null>`SUM(CASE WHEN ${historicalClubMemberSeasonStats.passPct} IS NOT NULL THEN ${historicalClubMemberSeasonStats.skaterGp} ELSE 0 END)`,
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
    .groupBy(identityKey, historicalClubMemberSeasonStats.playerId)

  const toInt = (v: string | number | null): number =>
    v === null ? 0 : typeof v === 'number' ? v : Number.parseInt(v, 10) || 0

  const result: HistoricalSkaterStatsRow[] = rows.map((r) => {
    const num = r.passPctNum ? parseFloat(r.passPctNum) : null
    const den = r.passPctDen ? parseFloat(r.passPctDen) : null
    const passPct = num !== null && den !== null && den > 0 ? (num / den).toFixed(2) : null
    return {
      playerId: r.playerId,
      gamertag: r.gamertag,
      position: r.position,
      gamesPlayed: toInt(r.gamesPlayed),
      goals: toInt(r.goals),
      assists: toInt(r.assists),
      points: toInt(r.points),
      plusMinus: toInt(r.plusMinus),
      pim: toInt(r.pim),
      shots: toInt(r.shots),
      hits: toInt(r.hits),
      takeaways: toInt(r.takeaways),
      giveaways: toInt(r.giveaways),
      faceoffPct: null,
      passPct,
      shotAttempts: 0,
      toiSeconds: null,
    }
  })
  result.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.goals !== a.goals) return b.goals - a.goals
    if (b.assists !== a.assists) return b.assists - a.assists
    return a.gamertag.localeCompare(b.gamertag)
  })
  return result
}

/**
 * All-modes club-member goalie totals — sums underlying counts per
 * identity group and recomputes save_pct exactly from
 * sum(saves) / (sum(saves) + sum(GA)).
 *
 * GAA aggregation: the screenshot source does not capture TOI for
 * goalies, so the most defensible combined GAA is goals-against per
 * goalie game, computed from the summed counts:
 *   combined_gaa = sum(total_goals_against) / sum(goalie_gp)
 * (assuming each `goalie_gp` corresponds to a standard 60-minute game,
 * which is how the in-game leaderboard reports it). When either sum is
 * null/zero the field is null. Reviewed rows only.
 */
export async function getClubMemberGoalieStatsAllModes(
  gameTitleId: number,
): Promise<HistoricalGoalieStatsRow[]> {
  const identityKey = sql<string>`COALESCE('p:' || ${historicalClubMemberSeasonStats.playerId}::text, 'g:' || lower(${historicalClubMemberSeasonStats.gamertagSnapshot}))`
  const displayGamertag = sql<string>`COALESCE(MAX(${players.gamertag}), MAX(${historicalClubMemberSeasonStats.gamertagSnapshot}))`

  const rows = await db
    .select({
      playerId: historicalClubMemberSeasonStats.playerId,
      gamertag: displayGamertag,
      gamesPlayed: sql<string>`COALESCE(SUM(${historicalClubMemberSeasonStats.goalieGp}), 0)`,
      wins: sql<string | null>`SUM(${historicalClubMemberSeasonStats.wins})`,
      losses: sql<string | null>`SUM(${historicalClubMemberSeasonStats.losses})`,
      otl: sql<string | null>`SUM(${historicalClubMemberSeasonStats.otl})`,
      shutouts: sql<string | null>`SUM(${historicalClubMemberSeasonStats.shutouts})`,
      totalSaves: sql<string | null>`SUM(${historicalClubMemberSeasonStats.totalSaves})`,
      totalGoalsAgainst: sql<string | null>`SUM(${historicalClubMemberSeasonStats.totalGoalsAgainst})`,
      gaaGpDen: sql<string | null>`SUM(CASE WHEN ${historicalClubMemberSeasonStats.totalGoalsAgainst} IS NOT NULL THEN ${historicalClubMemberSeasonStats.goalieGp} ELSE 0 END)`,
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
    .groupBy(identityKey, historicalClubMemberSeasonStats.playerId)

  const toIntOrNull = (v: string | number | null): number | null =>
    v === null ? null : typeof v === 'number' ? v : Number.parseInt(v, 10)
  const toInt = (v: string | number | null): number => toIntOrNull(v) ?? 0

  const result: HistoricalGoalieStatsRow[] = rows.map((r) => {
    const sv = toIntOrNull(r.totalSaves)
    const ga = toIntOrNull(r.totalGoalsAgainst)
    const gpForGaa = toIntOrNull(r.gaaGpDen)
    const savePct =
      sv !== null && ga !== null && sv + ga > 0
        ? ((sv / (sv + ga)) * 100).toFixed(2)
        : null
    // Combined GAA = sum(GA) / sum(GP) over rows where GA is non-null.
    // Each goalie_gp is a 60-minute game in the in-game leaderboard, so
    // this mirrors the standard season-level GAA definition.
    const gaa =
      ga !== null && gpForGaa !== null && gpForGaa > 0
        ? (ga / gpForGaa).toFixed(2)
        : null
    return {
      playerId: r.playerId,
      gamertag: r.gamertag,
      gamesPlayed: toInt(r.gamesPlayed),
      wins: toIntOrNull(r.wins),
      losses: toIntOrNull(r.losses),
      otl: toIntOrNull(r.otl),
      savePct,
      gaa,
      shutouts: toIntOrNull(r.shutouts),
      totalSaves: sv,
      totalShotsAgainst: null,
      totalGoalsAgainst: ga,
      toiSeconds: null,
    }
  })
  result.sort((a, b) => {
    const sa = a.savePct === null ? -1 : parseFloat(a.savePct)
    const sb = b.savePct === null ? -1 : parseFloat(b.savePct)
    if (sb !== sa) return sb - sa
    if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed
    return a.gamertag.localeCompare(b.gamertag)
  })
  return result
}
