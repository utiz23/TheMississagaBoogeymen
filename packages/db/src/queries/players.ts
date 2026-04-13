import { eq, asc, desc } from 'drizzle-orm'
import { db } from '../client.js'
import {
  gameTitles,
  matches,
  playerGameTitleStats,
  playerGamertagHistory,
  playerMatchStats,
  players,
} from '../schema/index.js'

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
      goals: playerMatchStats.goals,
      assists: playerMatchStats.assists,
      plusMinus: playerMatchStats.plusMinus,
      shots: playerMatchStats.shots,
      hits: playerMatchStats.hits,
      pim: playerMatchStats.pim,
      takeaways: playerMatchStats.takeaways,
      giveaways: playerMatchStats.giveaways,
      saves: playerMatchStats.saves,
      goalsAgainst: playerMatchStats.goalsAgainst,
      shotsAgainst: playerMatchStats.shotsAgainst,
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
 * Default ordering: points desc (most scoring first).
 * Goalie columns (wins, losses, savePct, gaa, shutouts) are nullable —
 * null indicates the player has no goalie data for this game title.
 */
export async function getRoster(gameTitleId: number) {
  return db
    .select({
      playerId: playerGameTitleStats.playerId,
      gamertag: players.gamertag,
      position: players.position,
      gamesPlayed: playerGameTitleStats.gamesPlayed,
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
      savePct: playerGameTitleStats.savePct,
      gaa: playerGameTitleStats.gaa,
      shutouts: playerGameTitleStats.shutouts,
    })
    .from(playerGameTitleStats)
    .innerJoin(players, eq(playerGameTitleStats.playerId, players.id))
    .where(eq(playerGameTitleStats.gameTitleId, gameTitleId))
    .orderBy(desc(playerGameTitleStats.points))
}

/**
 * Single player by surrogate PK. Returns null when not found.
 */
export async function getPlayerById(playerId: number) {
  const rows = await db.select().from(players).where(eq(players.id, playerId)).limit(1)
  return rows[0] ?? null
}

/**
 * All per-game-title aggregate rows for a player, joined with the game title
 * name and slug. Ordered newest game title first (by id desc).
 */
export async function getPlayerCareerStats(playerId: number) {
  return db
    .select({
      gameTitleId: playerGameTitleStats.gameTitleId,
      gameTitleName: gameTitles.name,
      gameTitleSlug: gameTitles.slug,
      gamesPlayed: playerGameTitleStats.gamesPlayed,
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
      savePct: playerGameTitleStats.savePct,
      gaa: playerGameTitleStats.gaa,
      shutouts: playerGameTitleStats.shutouts,
    })
    .from(playerGameTitleStats)
    .innerJoin(gameTitles, eq(playerGameTitleStats.gameTitleId, gameTitles.id))
    .where(eq(playerGameTitleStats.playerId, playerId))
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
export async function getPlayerGameLog(playerId: number, limit = 15) {
  return db
    .select({
      matchId: matches.id,
      playedAt: matches.playedAt,
      opponentName: matches.opponentName,
      result: matches.result,
      scoreFor: matches.scoreFor,
      scoreAgainst: matches.scoreAgainst,
      isGoalie: playerMatchStats.isGoalie,
      goals: playerMatchStats.goals,
      assists: playerMatchStats.assists,
      plusMinus: playerMatchStats.plusMinus,
      saves: playerMatchStats.saves,
      goalsAgainst: playerMatchStats.goalsAgainst,
    })
    .from(playerMatchStats)
    .innerJoin(matches, eq(playerMatchStats.matchId, matches.id))
    .where(eq(playerMatchStats.playerId, playerId))
    .orderBy(desc(matches.playedAt))
    .limit(limit)
}

/**
 * Top N players by points for the home page performers strip.
 *
 * Returns a slim projection — only the fields needed for the compact display.
 * Default limit of 5 keeps the home page tight; callers can override.
 */
export async function getTopPerformers(gameTitleId: number, limit = 5) {
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
    .where(eq(playerGameTitleStats.gameTitleId, gameTitleId))
    .orderBy(desc(playerGameTitleStats.points), desc(playerGameTitleStats.goals))
    .limit(limit)
}
