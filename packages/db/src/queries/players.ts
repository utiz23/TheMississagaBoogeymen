import { eq, asc, desc } from 'drizzle-orm'
import { db } from '../client.js'
import { playerGameTitleStats, playerMatchStats, players } from '../schema/index.js'

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
