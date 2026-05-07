import { and, count, eq, asc, desc, isNull, isNotNull, sql } from 'drizzle-orm'
import { db } from '../client.js'
import {
  eaMemberSeasonStats,
  gameTitles,
  historicalPlayerSeasonStats,
  matches,
  playerGameTitleStats,
  playerGamertagHistory,
  playerMatchStats,
  playerProfiles,
  players,
} from '../schema/index.js'
import type { GameMode } from '../schema/index.js'
import {
  getHistoricalSkaterStatsAllModes,
  getHistoricalGoalieStatsAllModes,
} from './historical.js'

/**
 * All player stats for a single match, joined with the player's current gamertag.
 *
 * Row ordering: skaters first (isGoalie = false), then goalies.
 * Within skaters: sorted by goals desc, assists desc.
 *
 * Goalie columns (saves, goalsAgainst, shotsAgainst) are nullable —
 * they will be null for skater rows even though the field exists in the table.
 */
export async function getPlayerMatchStats(matchId: number) {
  return db
    .select({
      id: playerMatchStats.id,
      playerId: playerMatchStats.playerId,
      gamertag: players.gamertag,
      position: playerMatchStats.position,
      isGoalie: playerMatchStats.isGoalie,
      // Skater core
      goals: playerMatchStats.goals,
      assists: playerMatchStats.assists,
      plusMinus: playerMatchStats.plusMinus,
      shots: playerMatchStats.shots,
      hits: playerMatchStats.hits,
      pim: playerMatchStats.pim,
      takeaways: playerMatchStats.takeaways,
      giveaways: playerMatchStats.giveaways,
      faceoffWins: playerMatchStats.faceoffWins,
      faceoffLosses: playerMatchStats.faceoffLosses,
      passAttempts: playerMatchStats.passAttempts,
      passCompletions: playerMatchStats.passCompletions,
      toiSeconds: playerMatchStats.toiSeconds,
      shotAttempts: playerMatchStats.shotAttempts,
      blockedShots: playerMatchStats.blockedShots,
      interceptions: playerMatchStats.interceptions,
      penaltiesDrawn: playerMatchStats.penaltiesDrawn,
      possession: playerMatchStats.possession,
      deflections: playerMatchStats.deflections,
      saucerPasses: playerMatchStats.saucerPasses,
      ppGoals: playerMatchStats.ppGoals,
      shGoals: playerMatchStats.shGoals,
      playerDnf: playerMatchStats.playerDnf,
      // Goalie
      saves: playerMatchStats.saves,
      goalsAgainst: playerMatchStats.goalsAgainst,
      shotsAgainst: playerMatchStats.shotsAgainst,
      breakawaySaves: playerMatchStats.breakawaySaves,
      breakawayShots: playerMatchStats.breakawayShots,
      despSaves: playerMatchStats.despSaves,
      penSaves: playerMatchStats.penSaves,
      penShots: playerMatchStats.penShots,
      pokechecks: playerMatchStats.pokechecks,
    })
    .from(playerMatchStats)
    .innerJoin(players, eq(playerMatchStats.playerId, players.id))
    .where(eq(playerMatchStats.matchId, matchId))
    .orderBy(
      asc(playerMatchStats.isGoalie), // false < true → skaters before goalies
      desc(playerMatchStats.goals),
      desc(playerMatchStats.assists),
    )
}

/**
 * Aggregated per-player stats for a game title, used by the Roster page.
 *
 * gameMode defaults to null = all-modes combined row. Pass '6s' or '3s' for
 * mode-specific rows. Multiple rows per player exist after the Phase 2 migration.
 *
 * Default ordering: points desc (most scoring first).
 * Goalie columns (wins, losses, savePct, gaa, shutouts) are nullable —
 * null indicates the player has no goalie data for this game title.
 */
export async function getRoster(gameTitleId: number, gameMode: GameMode | null = null) {
  const gameModeFilter =
    gameMode === null
      ? isNull(playerGameTitleStats.gameMode)
      : eq(playerGameTitleStats.gameMode, gameMode)
  return db
    .select({
      playerId: playerGameTitleStats.playerId,
      gamertag: players.gamertag,
      position: players.position,
      gamesPlayed: playerGameTitleStats.gamesPlayed,
      skaterGp: playerGameTitleStats.skaterGp,
      goalieGp: playerGameTitleStats.goalieGp,
      goals: playerGameTitleStats.goals,
      assists: playerGameTitleStats.assists,
      points: playerGameTitleStats.points,
      plusMinus: playerGameTitleStats.plusMinus,
      shots: playerGameTitleStats.shots,
      hits: playerGameTitleStats.hits,
      pim: playerGameTitleStats.pim,
      takeaways: playerGameTitleStats.takeaways,
      giveaways: playerGameTitleStats.giveaways,
      faceoffPct: playerGameTitleStats.faceoffPct,
      passPct: playerGameTitleStats.passPct,
      wins: playerGameTitleStats.wins,
      losses: playerGameTitleStats.losses,
      otl: playerGameTitleStats.otl,
      savePct: playerGameTitleStats.savePct,
      gaa: playerGameTitleStats.gaa,
      shutouts: playerGameTitleStats.shutouts,
      jerseyNumber: playerProfiles.jerseyNumber,
    })
    .from(playerGameTitleStats)
    .innerJoin(players, eq(playerGameTitleStats.playerId, players.id))
    .leftJoin(playerProfiles, eq(players.id, playerProfiles.playerId))
    .where(and(eq(playerGameTitleStats.gameTitleId, gameTitleId), gameModeFilter))
    .orderBy(desc(playerGameTitleStats.points))
}

/**
 * EA-authoritative roster for the home page (All mode).
 *
 * Source: ea_member_season_stats — full EA season totals, not filtered by game mode.
 * wins/losses/otl come from player_game_title_stats (locally tracked team record across
 * all appearances, skater or goalie). Shape matches getRoster so consumers can use
 * RosterRow for both.
 *
 * Ordered by points desc (most scoring first).
 */
export async function getEARoster(gameTitleId: number) {
  return db
    .select({
      playerId: eaMemberSeasonStats.playerId,
      gamertag: players.gamertag,
      position: players.position,
      favoritePosition: eaMemberSeasonStats.favoritePosition,
      gamesPlayed: eaMemberSeasonStats.gamesPlayed,
      skaterGp: eaMemberSeasonStats.skaterGp,
      goalieGp: eaMemberSeasonStats.goalieGp,
      goals: eaMemberSeasonStats.goals,
      assists: eaMemberSeasonStats.assists,
      points: eaMemberSeasonStats.points,
      plusMinus: eaMemberSeasonStats.plusMinus,
      shots: eaMemberSeasonStats.shots,
      hits: eaMemberSeasonStats.hits,
      pim: eaMemberSeasonStats.pim,
      takeaways: eaMemberSeasonStats.takeaways,
      giveaways: eaMemberSeasonStats.giveaways,
      faceoffPct: eaMemberSeasonStats.faceoffPct,
      passPct: eaMemberSeasonStats.passPct,
      wins: playerGameTitleStats.wins,
      losses: playerGameTitleStats.losses,
      otl: playerGameTitleStats.otl,
      goalieWins: eaMemberSeasonStats.goalieWins,
      goalieLosses: eaMemberSeasonStats.goalieLosses,
      goalieOtl: eaMemberSeasonStats.goalieOtl,
      savePct: eaMemberSeasonStats.goalieSavePct,
      gaa: eaMemberSeasonStats.goalieGaa,
      shutouts: eaMemberSeasonStats.goalieShutouts,
      goalieSaves: eaMemberSeasonStats.goalieSaves,
      goalieShots: eaMemberSeasonStats.goalieShots,
      goalieGoalsAgainst: eaMemberSeasonStats.goalieGoalsAgainst,
      jerseyNumber: playerProfiles.jerseyNumber,
    })
    .from(eaMemberSeasonStats)
    .innerJoin(players, eq(eaMemberSeasonStats.playerId, players.id))
    .leftJoin(
      playerGameTitleStats,
      and(
        eq(playerGameTitleStats.playerId, eaMemberSeasonStats.playerId),
        eq(playerGameTitleStats.gameTitleId, eaMemberSeasonStats.gameTitleId),
        isNull(playerGameTitleStats.gameMode),
      ),
    )
    .leftJoin(playerProfiles, eq(players.id, playerProfiles.playerId))
    .where(eq(eaMemberSeasonStats.gameTitleId, gameTitleId))
    .orderBy(desc(eaMemberSeasonStats.points))
}

/**
 * Single player by surrogate PK. Returns null when not found.
 */
export async function getPlayerById(playerId: number) {
  const rows = await db.select().from(players).where(eq(players.id, playerId)).limit(1)
  return rows[0] ?? null
}

/**
 * Single player with profile metadata. Returns null when not found.
 *
 * LEFT JOINs player_profiles — the profile object will have all-null fields
 * when no profile row exists yet (before the first ingestion cycle runs after
 * the migration). Components should treat each profile field as nullable.
 */
export async function getPlayerWithProfile(playerId: number) {
  const rows = await db
    .select({
      // Player identity fields
      id: players.id,
      eaId: players.eaId,
      gamertag: players.gamertag,
      position: players.position,
      isActive: players.isActive,
      firstSeenAt: players.firstSeenAt,
      lastSeenAt: players.lastSeenAt,
      // Profile fields (nullable — null until manually populated)
      jerseyNumber: playerProfiles.jerseyNumber,
      nationality: playerProfiles.nationality,
      preferredPosition: playerProfiles.preferredPosition,
      bio: playerProfiles.bio,
      clubRoleLabel: playerProfiles.clubRoleLabel,
    })
    .from(players)
    .leftJoin(playerProfiles, eq(players.id, playerProfiles.playerId))
    .where(eq(players.id, playerId))
    .limit(1)
  return rows[0] ?? null
}

/**
 * All per-game-title aggregate rows for a player, joined with the game title
 * name and slug. Ordered newest game title first (by id desc).
 *
 * gameMode defaults to null = all-modes combined row. Multiple rows per game
 * title exist after the Phase 2 migration; the null default preserves the
 * existing one-row-per-title behavior for the player profile page.
 */
export async function getPlayerCareerStats(playerId: number, gameMode: GameMode | null = null) {
  const gameModeFilter =
    gameMode === null
      ? isNull(playerGameTitleStats.gameMode)
      : eq(playerGameTitleStats.gameMode, gameMode)
  return db
    .select({
      gameTitleId: playerGameTitleStats.gameTitleId,
      gameTitleName: gameTitles.name,
      gameTitleSlug: gameTitles.slug,
      gamesPlayed: playerGameTitleStats.gamesPlayed,
      skaterGp: playerGameTitleStats.skaterGp,
      goalieGp: playerGameTitleStats.goalieGp,
      goals: playerGameTitleStats.goals,
      assists: playerGameTitleStats.assists,
      points: playerGameTitleStats.points,
      plusMinus: playerGameTitleStats.plusMinus,
      shots: playerGameTitleStats.shots,
      hits: playerGameTitleStats.hits,
      pim: playerGameTitleStats.pim,
      takeaways: playerGameTitleStats.takeaways,
      giveaways: playerGameTitleStats.giveaways,
      faceoffPct: playerGameTitleStats.faceoffPct,
      passPct: playerGameTitleStats.passPct,
      wins: playerGameTitleStats.wins,
      losses: playerGameTitleStats.losses,
      otl: playerGameTitleStats.otl,
      savePct: playerGameTitleStats.savePct,
      gaa: playerGameTitleStats.gaa,
      shutouts: playerGameTitleStats.shutouts,
    })
    .from(playerGameTitleStats)
    .innerJoin(gameTitles, eq(playerGameTitleStats.gameTitleId, gameTitles.id))
    .where(and(eq(playerGameTitleStats.playerId, playerId), gameModeFilter))
    .orderBy(desc(playerGameTitleStats.gameTitleId))
}

/**
 * Gamertag history for a player, newest entry first.
 * seenUntil = null means the entry is still the current gamertag.
 */
export async function getPlayerGamertagHistory(playerId: number) {
  return db
    .select()
    .from(playerGamertagHistory)
    .where(eq(playerGamertagHistory.playerId, playerId))
    .orderBy(desc(playerGamertagHistory.seenFrom))
}

/**
 * Recent match log for a single player.
 *
 * Joins player_match_stats with matches to surface per-game context
 * (date, opponent, result, score) alongside the player's individual line.
 * Ordered newest first. Spans all game titles — filtered only by playerId.
 *
 * isGoalie drives which stat columns are meaningful in the UI:
 *   - skaters: goals / assists / plusMinus (saves is null)
 *   - goalies:  saves / goalsAgainst       (goals/assists/plusMinus are 0)
 */
export async function getPlayerGameLog(
  playerId: number,
  gameMode: GameMode | null = null,
  limit = 20,
  offset = 0,
) {
  const gameModeFilter = gameMode === null ? undefined : eq(matches.gameMode, gameMode)
  return db
    .select({
      matchId: matches.id,
      playedAt: matches.playedAt,
      opponentName: matches.opponentName,
      result: matches.result,
      scoreFor: matches.scoreFor,
      scoreAgainst: matches.scoreAgainst,
      gameMode: matches.gameMode,
      isGoalie: playerMatchStats.isGoalie,
      goals: playerMatchStats.goals,
      assists: playerMatchStats.assists,
      plusMinus: playerMatchStats.plusMinus,
      saves: playerMatchStats.saves,
      goalsAgainst: playerMatchStats.goalsAgainst,
    })
    .from(playerMatchStats)
    .innerJoin(matches, eq(playerMatchStats.matchId, matches.id))
    .where(and(eq(playerMatchStats.playerId, playerId), gameModeFilter))
    .orderBy(desc(matches.playedAt))
    .limit(limit)
    .offset(offset)
}

/**
 * Total count of game log entries for pagination.
 * Uses the same WHERE predicate as getPlayerGameLog.
 */
export async function countPlayerGameLog(
  playerId: number,
  gameMode: GameMode | null = null,
): Promise<number> {
  const gameModeFilter = gameMode === null ? undefined : eq(matches.gameMode, gameMode)
  const rows = await db
    .select({ n: count() })
    .from(playerMatchStats)
    .innerJoin(matches, eq(playerMatchStats.matchId, matches.id))
    .where(and(eq(playerMatchStats.playerId, playerId), gameModeFilter))
  return rows[0]?.n ?? 0
}

/**
 * EA-authoritative season stats for a single player, one row per game title.
 *
 * Sourced from ea_member_season_stats — NOT local ingested matches. Returns
 * full EA season totals (e.g. 400+ GP vs ~15 locally ingested). Ordered newest
 * game title first. Returns [] when the player has no EA row yet (shouldn't
 * happen after the first member-stats poll, but treated as safe empty state).
 */
export async function getPlayerEASeasonStats(playerId: number) {
  return db
    .select({
      gameTitleId: eaMemberSeasonStats.gameTitleId,
      gameTitleName: gameTitles.name,
      gameTitleSlug: gameTitles.slug,
      favoritePosition: eaMemberSeasonStats.favoritePosition,

      gamesPlayed: eaMemberSeasonStats.gamesPlayed,
      gamesCompleted: eaMemberSeasonStats.gamesCompleted,
      gamesCompletedFc: eaMemberSeasonStats.gamesCompletedFc,
      playerQuitDisc: eaMemberSeasonStats.playerQuitDisc,

      skaterGp: eaMemberSeasonStats.skaterGp,
      lwGp: eaMemberSeasonStats.lwGp,
      rwGp: eaMemberSeasonStats.rwGp,
      cGp: eaMemberSeasonStats.cGp,
      dGp: eaMemberSeasonStats.dGp,

      skaterWins: eaMemberSeasonStats.skaterWins,
      skaterLosses: eaMemberSeasonStats.skaterLosses,
      skaterOtl: eaMemberSeasonStats.skaterOtl,
      skaterWinnerByDnf: eaMemberSeasonStats.skaterWinnerByDnf,
      skaterWinPct: eaMemberSeasonStats.skaterWinPct,
      skaterDnf: eaMemberSeasonStats.skaterDnf,

      goals: eaMemberSeasonStats.goals,
      assists: eaMemberSeasonStats.assists,
      points: eaMemberSeasonStats.points,
      pointsPerGame: eaMemberSeasonStats.pointsPerGame,
      powerPlayGoals: eaMemberSeasonStats.powerPlayGoals,
      shortHandedGoals: eaMemberSeasonStats.shortHandedGoals,
      gameWinningGoals: eaMemberSeasonStats.gameWinningGoals,
      hatTricks: eaMemberSeasonStats.hatTricks,
      plusMinus: eaMemberSeasonStats.plusMinus,
      pim: eaMemberSeasonStats.pim,
      prevGoals: eaMemberSeasonStats.prevGoals,
      prevAssists: eaMemberSeasonStats.prevAssists,

      shots: eaMemberSeasonStats.shots,
      shotPct: eaMemberSeasonStats.shotPct,
      shotsPerGame: eaMemberSeasonStats.shotsPerGame,
      shotAttempts: eaMemberSeasonStats.shotAttempts,
      shotOnNetPct: eaMemberSeasonStats.shotOnNetPct,
      breakaways: eaMemberSeasonStats.breakaways,
      breakawayGoals: eaMemberSeasonStats.breakawayGoals,
      breakawayPct: eaMemberSeasonStats.breakawayPct,

      passes: eaMemberSeasonStats.passes,
      passAttempts: eaMemberSeasonStats.passAttempts,
      passPct: eaMemberSeasonStats.passPct,
      interceptions: eaMemberSeasonStats.interceptions,
      dekes: eaMemberSeasonStats.dekes,
      dekesMade: eaMemberSeasonStats.dekesMade,
      deflections: eaMemberSeasonStats.deflections,
      saucerPasses: eaMemberSeasonStats.saucerPasses,
      screenChances: eaMemberSeasonStats.screenChances,
      screenGoals: eaMemberSeasonStats.screenGoals,
      possessionSeconds: eaMemberSeasonStats.possessionSeconds,
      xfactorZoneUsed: eaMemberSeasonStats.xfactorZoneUsed,

      hits: eaMemberSeasonStats.hits,
      hitsPerGame: eaMemberSeasonStats.hitsPerGame,
      fights: eaMemberSeasonStats.fights,
      fightsWon: eaMemberSeasonStats.fightsWon,
      blockedShots: eaMemberSeasonStats.blockedShots,
      pkClearZone: eaMemberSeasonStats.pkClearZone,
      offsides: eaMemberSeasonStats.offsides,
      offsidesPerGame: eaMemberSeasonStats.offsidesPerGame,
      penaltiesDrawn: eaMemberSeasonStats.penaltiesDrawn,
      takeaways: eaMemberSeasonStats.takeaways,
      giveaways: eaMemberSeasonStats.giveaways,

      faceoffTotal: eaMemberSeasonStats.faceoffTotal,
      faceoffWins: eaMemberSeasonStats.faceoffWins,
      faceoffLosses: eaMemberSeasonStats.faceoffLosses,
      faceoffPct: eaMemberSeasonStats.faceoffPct,
      penaltyShotAttempts: eaMemberSeasonStats.penaltyShotAttempts,
      penaltyShotGoals: eaMemberSeasonStats.penaltyShotGoals,
      penaltyShotPct: eaMemberSeasonStats.penaltyShotPct,
      toiSeconds: eaMemberSeasonStats.toiSeconds,

      goalieGp: eaMemberSeasonStats.goalieGp,
      goalieWins: eaMemberSeasonStats.goalieWins,
      goalieLosses: eaMemberSeasonStats.goalieLosses,
      goalieOtl: eaMemberSeasonStats.goalieOtl,
      goalieSavePct: eaMemberSeasonStats.goalieSavePct,
      goalieGaa: eaMemberSeasonStats.goalieGaa,
      goalieShutouts: eaMemberSeasonStats.goalieShutouts,
      goalieSaves: eaMemberSeasonStats.goalieSaves,
      goalieShots: eaMemberSeasonStats.goalieShots,
      goalieGoalsAgainst: eaMemberSeasonStats.goalieGoalsAgainst,

      shotLocations: eaMemberSeasonStats.shotLocations,
    })
    .from(eaMemberSeasonStats)
    .innerJoin(gameTitles, eq(eaMemberSeasonStats.gameTitleId, gameTitles.id))
    .where(eq(eaMemberSeasonStats.playerId, playerId))
    .orderBy(desc(eaMemberSeasonStats.gameTitleId))
}

/**
 * Unified career-by-season view for the player profile page.
 *
 * Returns one row per game title (newest first) blending sources:
 *   - For active titles (NHL 26), use EA member-season-stats (authoritative).
 *   - For prior titles (NHL 22-25), use hand-reviewed historical_player_season_stats
 *     aggregated across modes via existing all-modes helpers.
 *
 * Both skater and goalie columns are present on every row; rows where a role's
 * GP is 0 should be filtered/displayed by the consumer based on selectedRole.
 */
export interface PlayerCareerSeasonRow {
  gameTitleId: number
  gameTitleName: string
  gameTitleSlug: string
  source: 'ea' | 'historical'
  // Skater stats (skaterGp is 0 if player did not play skater that season)
  skaterGp: number
  goals: number
  assists: number
  points: number
  plusMinus: number
  shots: number
  shotAttempts: number // for derived shot-on-net% in UI
  hits: number
  pim: number
  takeaways: number
  giveaways: number
  faceoffPct: string | null
  passPct: string | null
  // Goalie stats (goalieGp is 0 if player did not play goalie that season)
  goalieGp: number
  wins: number | null
  losses: number | null
  otl: number | null
  savePct: string | null
  gaa: string | null
  shutouts: number | null
  saves: number | null
  shotsAgainst: number | null
  goalsAgainst: number | null
}

/**
 * One row per game title for the player's career-by-season profile view.
 *
 * Source precedence per title:
 *   - EA member-season row exists -> source='ea' (authoritative live data)
 *   - Otherwise fall back to reviewed historical_player_season_stats rows,
 *     aggregated across both 6s and 3s modes via the existing all-modes
 *     helpers (which sum counts and recompute rate fields like FO%, save%,
 *     and GAA from the summed underlying counters).
 *
 * The titles enumerated come from the union of EA + reviewed historical rows
 * for this playerId, so titles with no data for the player are excluded
 * automatically. Result is sorted newest title first.
 */
export async function getPlayerCareerSeasons(
  playerId: number,
): Promise<PlayerCareerSeasonRow[]> {
  // 1. Find every distinct game_title_id where this player has data
  //    (either EA stats or reviewed historical stats).
  const titleIdRows = await db
    .selectDistinct({
      gameTitleId: gameTitles.id,
      gameTitleName: gameTitles.name,
      gameTitleSlug: gameTitles.slug,
    })
    .from(gameTitles)
    .where(
      // Title list must match what the historical helpers can actually return.
      // getHistoricalSkaterStatsAllModes filters to position_scope='all_skaters';
      // getHistoricalGoalieStatsAllModes filters to role_group='goalie' / position_scope='goalie'.
      // If a player only has position-specific rows (e.g. wing-only) for a title, that
      // title is excluded here — otherwise the title would appear in the title-list but
      // produce no data, requiring a silent skip. This keeps the title-list and the
      // emit-loop consistent. Documented data gap: such players' missing titles will
      // need an importer-side fix to backfill the all_skaters aggregate row.
      sql`${gameTitles.id} IN (
        SELECT ${eaMemberSeasonStats.gameTitleId}
          FROM ${eaMemberSeasonStats}
          WHERE ${eaMemberSeasonStats.playerId} = ${playerId}
        UNION
        SELECT ${historicalPlayerSeasonStats.gameTitleId}
          FROM ${historicalPlayerSeasonStats}
          WHERE ${historicalPlayerSeasonStats.playerId} = ${playerId}
            AND ${historicalPlayerSeasonStats.reviewStatus} = 'reviewed'
            AND (
              (${historicalPlayerSeasonStats.roleGroup} = 'skater'
                AND ${historicalPlayerSeasonStats.positionScope} = 'all_skaters')
              OR
              (${historicalPlayerSeasonStats.roleGroup} = 'goalie'
                AND ${historicalPlayerSeasonStats.positionScope} = 'goalie')
            )
      )`,
    )

  // 2. Fetch EA rows keyed by gameTitleId.
  const eaRows = await db
    .select({
      gameTitleId: eaMemberSeasonStats.gameTitleId,
      skaterGp: eaMemberSeasonStats.skaterGp,
      goals: eaMemberSeasonStats.goals,
      assists: eaMemberSeasonStats.assists,
      points: eaMemberSeasonStats.points,
      plusMinus: eaMemberSeasonStats.plusMinus,
      shots: eaMemberSeasonStats.shots,
      shotAttempts: eaMemberSeasonStats.shotAttempts,
      hits: eaMemberSeasonStats.hits,
      pim: eaMemberSeasonStats.pim,
      takeaways: eaMemberSeasonStats.takeaways,
      giveaways: eaMemberSeasonStats.giveaways,
      faceoffPct: eaMemberSeasonStats.faceoffPct,
      passPct: eaMemberSeasonStats.passPct,
      goalieGp: eaMemberSeasonStats.goalieGp,
      wins: eaMemberSeasonStats.goalieWins,
      losses: eaMemberSeasonStats.goalieLosses,
      otl: eaMemberSeasonStats.goalieOtl,
      savePct: eaMemberSeasonStats.goalieSavePct,
      gaa: eaMemberSeasonStats.goalieGaa,
      shutouts: eaMemberSeasonStats.goalieShutouts,
      saves: eaMemberSeasonStats.goalieSaves,
      shotsAgainst: eaMemberSeasonStats.goalieShots,
      goalsAgainst: eaMemberSeasonStats.goalieGoalsAgainst,
    })
    .from(eaMemberSeasonStats)
    .where(eq(eaMemberSeasonStats.playerId, playerId))

  const eaByTitle = new Map(eaRows.map((r) => [r.gameTitleId, r]))

  // 3. For each title not covered by EA, build a historical row using the
  //    existing all-modes aggregation helpers. They sum counts across 6s+3s
  //    rows for the player and recompute rate fields (FO%, pass%, save%, GAA)
  //    from the summed underlying counters.
  const result: PlayerCareerSeasonRow[] = []
  for (const t of titleIdRows) {
    const eaRow = eaByTitle.get(t.gameTitleId)
    if (eaRow !== undefined) {
      result.push({
        gameTitleId: t.gameTitleId,
        gameTitleName: t.gameTitleName,
        gameTitleSlug: t.gameTitleSlug,
        source: 'ea',
        skaterGp: eaRow.skaterGp,
        goals: eaRow.goals,
        assists: eaRow.assists,
        points: eaRow.points,
        plusMinus: eaRow.plusMinus,
        shots: eaRow.shots,
        shotAttempts: eaRow.shotAttempts,
        hits: eaRow.hits,
        pim: eaRow.pim,
        takeaways: eaRow.takeaways,
        giveaways: eaRow.giveaways,
        faceoffPct: eaRow.faceoffPct,
        passPct: eaRow.passPct,
        goalieGp: eaRow.goalieGp,
        wins: eaRow.wins,
        losses: eaRow.losses,
        otl: eaRow.otl,
        savePct: eaRow.savePct,
        gaa: eaRow.gaa,
        shutouts: eaRow.shutouts,
        saves: eaRow.saves,
        shotsAgainst: eaRow.shotsAgainst,
        goalsAgainst: eaRow.goalsAgainst,
      })
      continue
    }

    // Historical path: call all-modes helpers, find the row for this player.
    // Note: the goalie helper uses field names `totalSaves`, `totalShotsAgainst`,
    // `totalGoalsAgainst` (mirroring the source schema columns); we map those
    // onto the unified `saves` / `shotsAgainst` / `goalsAgainst` shape here.
    const [skRows, glRows] = await Promise.all([
      getHistoricalSkaterStatsAllModes(t.gameTitleId),
      getHistoricalGoalieStatsAllModes(t.gameTitleId),
    ])
    const sk = skRows.find((r) => r.playerId === playerId)
    const gl = glRows.find((r) => r.playerId === playerId)

    // Defensive: title list is derived from this player's rows, so at least
    // one of (sk, gl) should be defined. Skip the title if neither is, to
    // avoid emitting an empty row.
    if (sk === undefined && gl === undefined) continue

    result.push({
      gameTitleId: t.gameTitleId,
      gameTitleName: t.gameTitleName,
      gameTitleSlug: t.gameTitleSlug,
      source: 'historical',
      skaterGp: sk?.gamesPlayed ?? 0,
      goals: sk?.goals ?? 0,
      assists: sk?.assists ?? 0,
      points: sk?.points ?? 0,
      plusMinus: sk?.plusMinus ?? 0,
      shots: sk?.shots ?? 0,
      shotAttempts: sk?.shotAttempts ?? 0,
      hits: sk?.hits ?? 0,
      pim: sk?.pim ?? 0,
      takeaways: sk?.takeaways ?? 0,
      giveaways: sk?.giveaways ?? 0,
      faceoffPct: sk?.faceoffPct ?? null,
      passPct: sk?.passPct ?? null,
      goalieGp: gl?.gamesPlayed ?? 0,
      wins: gl?.wins ?? null,
      losses: gl?.losses ?? null,
      otl: gl?.otl ?? null,
      savePct: gl?.savePct ?? null,
      gaa: gl?.gaa ?? null,
      shutouts: gl?.shutouts ?? null,
      saves: gl?.totalSaves ?? null,
      shotsAgainst: gl?.totalShotsAgainst ?? null,
      goalsAgainst: gl?.totalGoalsAgainst ?? null,
    })
  }

  // 4. Sort newest title first. In this schema, newer titles have LOWER ids
  //    (NHL 26 = id 1, NHL 22 = id 6), so ascending id puts newest first.
  result.sort((a, b) => a.gameTitleId - b.gameTitleId)
  return result
}

type PlayerProfileRow = Awaited<ReturnType<typeof getPlayerWithProfile>>
type PlayerCareerRow = Awaited<ReturnType<typeof getPlayerCareerStats>>[number]
type PlayerEASeasonRow = Awaited<ReturnType<typeof getPlayerEASeasonStats>>[number]
type PlayerGameLogRow = Awaited<ReturnType<typeof getPlayerGameLog>>[number]
type EARosterRow = Awaited<ReturnType<typeof getEARoster>>[number]

export interface ProfileContributionMetric {
  label: string
  value: number
}

export interface ProfileContributionSummary {
  role: 'skater' | 'goalie'
  metrics: ProfileContributionMetric[]
  sampleSize: number
}

export interface ProfileRecentFormSkater {
  role: 'skater'
  gamesAnalyzed: number
  record: { wins: number; losses: number; otl: number }
  recentResults: ('WIN' | 'LOSS' | 'OTL' | 'DNF')[]
  goals: number
  assists: number
  points: number
  plusMinus: number
  bestGame: PlayerGameLogRow | null
}

export interface ProfileRecentFormGoalie {
  role: 'goalie'
  gamesAnalyzed: number
  record: { wins: number; losses: number; otl: number }
  recentResults: ('WIN' | 'LOSS' | 'OTL' | 'DNF')[]
  saves: number
  goalsAgainst: number
  savePct: number | null
  bestGame: PlayerGameLogRow | null
}

export interface PlayerProfileOverview {
  player: NonNullable<PlayerProfileRow>
  currentEaSeason: PlayerEASeasonRow | null
  currentLocalSeason: PlayerCareerRow | null
  primaryRole: 'skater' | 'goalie'
  secondaryRole: 'skater' | 'goalie' | null
  skaterContribution: ProfileContributionSummary | null
  goalieContribution: ProfileContributionSummary | null
  skaterRecentForm: ProfileRecentFormSkater | ProfileRecentFormGoalie | null
  goalieRecentForm: ProfileRecentFormSkater | ProfileRecentFormGoalie | null
  trendGames: PlayerGameLogRow[]
}

function normalizedMetric(
  values: number[],
  current: number | null,
  lowerIsBetter = false,
): number | null {
  if (current === null || values.length < 2) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  if (max === min) return 50

  const raw = lowerIsBetter
    ? ((max - current) / (max - min)) * 100
    : ((current - min) / (max - min)) * 100

  return Math.max(0, Math.min(100, Math.round(raw)))
}

function currentRoleFromSeasonRow(
  player: NonNullable<PlayerProfileRow>,
  season: PlayerEASeasonRow | null,
): 'skater' | 'goalie' {
  const preferredPosition = player.preferredPosition ?? player.position
  const preferredRole = preferredPosition === 'goalie' ? 'goalie' : 'skater'

  if (!season) return preferredRole
  if (season.goalieGp > season.skaterGp) return 'goalie'
  if (season.skaterGp > season.goalieGp) return 'skater'
  return preferredRole
}

function roleGames(
  rows: PlayerGameLogRow[],
  role: 'skater' | 'goalie',
  limit = 5,
): PlayerGameLogRow[] {
  const filtered = rows.filter((row) => row.isGoalie === (role === 'goalie'))
  return filtered.slice(0, limit)
}

function buildRecentForm(
  rows: PlayerGameLogRow[],
  role: 'skater' | 'goalie',
): ProfileRecentFormSkater | ProfileRecentFormGoalie | null {
  if (rows.length === 0) return null

  const recentResults = rows.map((row) => row.result)

  const record = rows.reduce(
    (acc, row) => {
      if (row.result === 'WIN') acc.wins += 1
      else if (row.result === 'LOSS') acc.losses += 1
      else if (row.result === 'OTL') acc.otl += 1
      return acc
    },
    { wins: 0, losses: 0, otl: 0 },
  )

  if (role === 'goalie') {
    const saves = rows.reduce((sum, row) => sum + (row.saves ?? 0), 0)
    const goalsAgainst = rows.reduce((sum, row) => sum + (row.goalsAgainst ?? 0), 0)
    const shotsAgainst = saves + goalsAgainst
    const bestGame =
      rows.reduce<PlayerGameLogRow | null>((best, row) => {
        if (!best) return row
        const bestPct =
          best.saves !== null && best.goalsAgainst !== null && best.saves + best.goalsAgainst > 0
            ? best.saves / (best.saves + best.goalsAgainst)
            : -1
        const rowPct =
          row.saves !== null && row.goalsAgainst !== null && row.saves + row.goalsAgainst > 0
            ? row.saves / (row.saves + row.goalsAgainst)
            : -1
        if (rowPct !== bestPct) return rowPct > bestPct ? row : best
        return (row.saves ?? 0) > (best.saves ?? 0) ? row : best
      }, null) ?? null

    return {
      role: 'goalie',
      gamesAnalyzed: rows.length,
      record,
      recentResults,
      saves,
      goalsAgainst,
      savePct: shotsAgainst > 0 ? Number(((saves / shotsAgainst) * 100).toFixed(1)) : null,
      bestGame,
    }
  }

  const goals = rows.reduce((sum, row) => sum + row.goals, 0)
  const assists = rows.reduce((sum, row) => sum + row.assists, 0)
  const points = goals + assists
  const plusMinus = rows.reduce((sum, row) => sum + row.plusMinus, 0)
  const bestGame =
    rows.reduce<PlayerGameLogRow | null>((best, row) => {
      if (!best) return row
      const bestPts = best.goals + best.assists
      const rowPts = row.goals + row.assists
      if (rowPts !== bestPts) return rowPts > bestPts ? row : best
      if (row.goals !== best.goals) return row.goals > best.goals ? row : best
      return row.plusMinus > best.plusMinus ? row : best
    }, null) ?? null

  return {
    role: 'skater',
    gamesAnalyzed: rows.length,
    record,
    recentResults,
    goals,
    assists,
    points,
    plusMinus,
    bestGame,
  }
}

function buildSkaterContribution(
  current: EARosterRow,
  group: EARosterRow[],
): ProfileContributionSummary | null {
  if (current.skaterGp <= 0 || group.length < 5) return null

  const perGp = (value: number, gp: number) => (gp > 0 ? value / gp : 0)
  const scoring = group.map((row) => perGp(row.goals, row.skaterGp))
  const playmaking = group.map((row) => perGp(row.assists, row.skaterGp))
  const shooting = group.map((row) => perGp(row.shots, row.skaterGp))
  const physicality = group.map((row) => perGp(row.hits, row.skaterGp))
  const possession = group.map(
    (row) => perGp(row.takeaways, row.skaterGp) - perGp(row.giveaways, row.skaterGp),
  )
  const discipline = group.map((row) => perGp(row.pim, row.skaterGp))

  return {
    role: 'skater',
    sampleSize: current.skaterGp,
    metrics: [
      {
        label: 'Scoring',
        value: normalizedMetric(scoring, perGp(current.goals, current.skaterGp)) ?? 0,
      },
      {
        label: 'Playmaking',
        value: normalizedMetric(playmaking, perGp(current.assists, current.skaterGp)) ?? 0,
      },
      {
        label: 'Shooting',
        value: normalizedMetric(shooting, perGp(current.shots, current.skaterGp)) ?? 0,
      },
      {
        label: 'Physicality',
        value: normalizedMetric(physicality, perGp(current.hits, current.skaterGp)) ?? 0,
      },
      {
        label: 'Possession',
        value:
          normalizedMetric(
            possession,
            perGp(current.takeaways, current.skaterGp) - perGp(current.giveaways, current.skaterGp),
          ) ?? 0,
      },
      {
        label: 'Discipline',
        value: normalizedMetric(discipline, perGp(current.pim, current.skaterGp), true) ?? 0,
      },
    ],
  }
}

function buildGoalieContribution(
  current: EARosterRow,
  group: EARosterRow[],
): ProfileContributionSummary | null {
  if (current.goalieGp <= 0 || group.length < 5) return null

  const decisions = (row: EARosterRow) =>
    (row.goalieWins ?? 0) + (row.goalieLosses ?? 0) + (row.goalieOtl ?? 0)
  const perGp = (value: number | null, gp: number) => (value !== null && gp > 0 ? value / gp : null)
  const winRate = (row: EARosterRow) => {
    const total = decisions(row)
    return total > 0 ? (row.goalieWins ?? 0) / total : null
  }

  const savePct = group
    .map((row) => (row.savePct !== null ? parseFloat(row.savePct) : null))
    .filter((value): value is number => value !== null)
  const gaa = group
    .map((row) => (row.gaa !== null ? parseFloat(row.gaa) : null))
    .filter((value): value is number => value !== null)
  const winRates = group
    .map((row) => winRate(row))
    .filter((value): value is number => value !== null)
  const savesPerGp = group
    .map((row) => perGp(row.goalieSaves ?? null, row.goalieGp))
    .filter((value): value is number => value !== null)
  const shutoutsPerGp = group
    .map((row) => perGp(row.shutouts ?? null, row.goalieGp))
    .filter((value): value is number => value !== null)
  const workloadPerGp = group
    .map((row) => perGp(row.goalieShots ?? null, row.goalieGp))
    .filter((value): value is number => value !== null)

  return {
    role: 'goalie',
    sampleSize: current.goalieGp,
    metrics: [
      {
        label: 'Win Rate',
        value: normalizedMetric(winRates, winRate(current)) ?? 0,
      },
      {
        label: 'Save %',
        value: normalizedMetric(savePct, current.savePct !== null ? parseFloat(current.savePct) : null) ?? 0,
      },
      {
        label: 'GAA',
        value: normalizedMetric(gaa, current.gaa !== null ? parseFloat(current.gaa) : null, true) ?? 0,
      },
      {
        label: 'Saves / GP',
        value: normalizedMetric(savesPerGp, perGp(current.goalieSaves ?? null, current.goalieGp)) ?? 0,
      },
      {
        label: 'SO / GP',
        value: normalizedMetric(shutoutsPerGp, perGp(current.shutouts ?? null, current.goalieGp)) ?? 0,
      },
      {
        label: 'Workload',
        value: normalizedMetric(workloadPerGp, perGp(current.goalieShots ?? null, current.goalieGp)) ?? 0,
      },
    ],
  }
}

/**
 * Profile-focused loader shape for the player page hero, current-season snapshot,
 * contribution wheel, and recent-form block.
 */
export async function getPlayerProfileOverview(playerId: number): Promise<PlayerProfileOverview | null> {
  const [player, eaSeasonRows, allModeCareerRows, recentRows] = await Promise.all([
    getPlayerWithProfile(playerId),
    getPlayerEASeasonStats(playerId),
    getPlayerCareerStats(playerId, null),
    getPlayerGameLog(playerId, null, 25, 0),
  ])

  if (!player) return null

  const currentEaSeason = eaSeasonRows[0] ?? null
  const currentSeasonId = currentEaSeason?.gameTitleId ?? allModeCareerRows[0]?.gameTitleId ?? null
  const currentLocalSeason =
    (currentSeasonId !== null
      ? allModeCareerRows.find((row) => row.gameTitleId === currentSeasonId)
      : null) ?? allModeCareerRows[0] ?? null

  const primaryRole = currentRoleFromSeasonRow(player, currentEaSeason)
  // Secondary role requires meaningful participation: ≥3 GP in current EA season OR ≥10 GP in
  // tracked local history for the current title. A single appearance is not enough to show a strip.
  const secondaryRole =
    currentEaSeason !== null
      ? primaryRole === 'skater'
        ? currentEaSeason.goalieGp >= 3 || (currentLocalSeason?.goalieGp ?? 0) >= 10
          ? 'goalie'
          : null
        : currentEaSeason.skaterGp >= 3 || (currentLocalSeason?.skaterGp ?? 0) >= 10
          ? 'skater'
          : null
      : null

  let skaterContribution: ProfileContributionSummary | null = null
  let goalieContribution: ProfileContributionSummary | null = null
  if (currentSeasonId !== null) {
    const roster = await getEARoster(currentSeasonId)
    const current = roster.find((row) => row.playerId === playerId) ?? null
    if (current) {
      const skaterGroup = roster.filter((row) => row.skaterGp > 0)
      const goalieGroup = roster.filter((row) => row.goalieGp > 0)
      skaterContribution = buildSkaterContribution(current, skaterGroup)
      goalieContribution = buildGoalieContribution(current, goalieGroup)
    }
  }

  const skaterRecentForm = buildRecentForm(roleGames(recentRows, 'skater', 5), 'skater')
  const goalieRecentForm = buildRecentForm(roleGames(recentRows, 'goalie', 5), 'goalie')

  return {
    player,
    currentEaSeason,
    currentLocalSeason,
    primaryRole,
    secondaryRole,
    skaterContribution,
    goalieContribution,
    skaterRecentForm,
    goalieRecentForm,
    trendGames: recentRows,
  }
}

/**
 * Per-position game counts for a single player in a game title.
 * Used by the player profile page to display positional usage.
 * Ordered by game count descending so the primary position appears first.
 */
export async function getPlayerPositionUsage(playerId: number, gameTitleId: number) {
  return db
    .select({
      position: playerMatchStats.position,
      gameCount: count(),
    })
    .from(playerMatchStats)
    .innerJoin(matches, eq(playerMatchStats.matchId, matches.id))
    .where(
      and(
        eq(playerMatchStats.playerId, playerId),
        eq(matches.gameTitleId, gameTitleId),
        isNotNull(playerMatchStats.position),
      ),
    )
    .groupBy(playerMatchStats.position)
    .orderBy(desc(count()))
}

/**
 * Top N players by points for the home page performers strip.
 *
 * Returns a slim projection — only the fields needed for the compact display.
 * Default limit of 5 keeps the home page tight; callers can override.
 * gameMode defaults to null = all-modes combined row.
 */
export async function getTopPerformers(
  gameTitleId: number,
  limit = 5,
  gameMode: GameMode | null = null,
) {
  const gameModeFilter =
    gameMode === null
      ? isNull(playerGameTitleStats.gameMode)
      : eq(playerGameTitleStats.gameMode, gameMode)
  return db
    .select({
      playerId: playerGameTitleStats.playerId,
      gamertag: players.gamertag,
      goals: playerGameTitleStats.goals,
      assists: playerGameTitleStats.assists,
      points: playerGameTitleStats.points,
      hits: playerGameTitleStats.hits,
    })
    .from(playerGameTitleStats)
    .innerJoin(players, eq(playerGameTitleStats.playerId, players.id))
    .where(and(eq(playerGameTitleStats.gameTitleId, gameTitleId), gameModeFilter))
    .orderBy(desc(playerGameTitleStats.points), desc(playerGameTitleStats.goals))
    .limit(limit)
}

/**
 * Per-player, per-position game counts for a game title — used to determine
 * depth-chart eligibility. Only rows with a non-null position are returned.
 *
 * Consumers should apply their own threshold (e.g. gameCount >= 2) before
 * treating a position as eligible. This query returns raw counts without filtering.
 */
export async function getPlayerPositionEligibility(gameTitleId: number) {
  return db
    .select({
      playerId: playerMatchStats.playerId,
      position: playerMatchStats.position,
      gameCount: count(),
    })
    .from(playerMatchStats)
    .innerJoin(matches, eq(playerMatchStats.matchId, matches.id))
    .where(and(eq(matches.gameTitleId, gameTitleId), isNotNull(playerMatchStats.position)))
    .groupBy(playerMatchStats.playerId, playerMatchStats.position)
}
