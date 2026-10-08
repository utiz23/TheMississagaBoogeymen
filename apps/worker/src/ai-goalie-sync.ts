/**
 * AI-goalie sync: writes the two EASHL AI goaltenders' per-game lines
 * (player_match_stats) and season totals (ea_member_season_stats) for one game
 * title, derived from every game with no human BGM goalie. Idempotent: lines
 * for games that gained a human goalie (or switched side) are removed.
 * Rules: ./lib/ai-goalies.ts. Spec: docs/superpowers/specs/2026-10-08-ai-goalies-design.md.
 *
 * Runs each ingestion cycle before the aggregates, so local aggregates, game
 * logs, lineups, cards and badges treat the AI goalies like any other player.
 * Needs migration 0062 (players.ai_goalie_side); without it the sync skips.
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { db, eaMemberSeasonStats, playerMatchStats } from '@eanhl/db'
import {
  aiGoalieSeasonTotals,
  planAiGoalieLines,
  type AiGameInput,
  type AiGoalieSide,
} from './lib/ai-goalies.js'

async function rows<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[]
}

export interface AiGoalieSyncResult {
  gameTitleId: number
  aiGames: number
  perGoalie: { gamertag: string; side: AiGoalieSide; games: number }[]
  removedLines: number
  skipped?: string
}

export async function syncAiGoalies(
  gameTitleId: number,
  opts: { dryRun: boolean } = { dryRun: false },
): Promise<AiGoalieSyncResult> {
  const goalieCol = await rows<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'players' AND column_name = 'ai_goalie_side'`)
  if ((goalieCol[0]?.n ?? 0) === 0) {
    return {
      gameTitleId,
      aiGames: 0,
      perGoalie: [],
      removedLines: 0,
      skipped: 'migration 0062 not applied',
    }
  }
  const goalies = await rows<{ id: number; gamertag: string; side: AiGoalieSide }>(sql`
    SELECT id, gamertag, ai_goalie_side AS side FROM players WHERE ai_goalie_side IS NOT NULL`)
  const bySide = new Map(goalies.map((g) => [g.side, g]))
  const home = bySide.get('home')
  const away = bySide.get('away')
  if (home === undefined || away === undefined) {
    return {
      gameTitleId,
      aiGames: 0,
      perGoalie: [],
      removedLines: 0,
      skipped: 'AI goalie players missing',
    }
  }

  // A game is an AI game when no human BGM player was in goal.
  const games = await rows<AiGameInput>(sql`
    SELECT m.id::int AS "matchId", m.bgm_was_home AS "bgmWasHome",
      m.shots_against AS "shotsAgainst", m.score_against AS "scoreAgainst", m.result,
      (SELECT max(p.toi_seconds) FROM player_match_stats p
        JOIN players hp ON hp.id = p.player_id
        WHERE p.match_id = m.id AND hp.ai_goalie_side IS NULL)::int AS "toiSeconds"
    FROM matches m
    WHERE m.game_title_id = ${gameTitleId}
      AND NOT EXISTS (
        SELECT 1 FROM player_match_stats g JOIN players gp ON gp.id = g.player_id
        WHERE g.match_id = m.id AND g.is_goalie AND gp.ai_goalie_side IS NULL)
    ORDER BY m.id`)
  const lines = planAiGoalieLines(games)
  const playerFor = (side: AiGoalieSide) => (side === 'home' ? home : away)
  const want = new Set(lines.map((l) => `${String(playerFor(l.side).id)}:${String(l.matchId)}`))

  const existing = await rows<{ id: number; playerId: number; matchId: number }>(sql`
    SELECT p.id, p.player_id AS "playerId", p.match_id::int AS "matchId"
    FROM player_match_stats p JOIN matches m ON m.id = p.match_id
    WHERE m.game_title_id = ${gameTitleId} AND p.player_id IN (${home.id}, ${away.id})`)
  const stale = existing.filter((r) => !want.has(`${String(r.playerId)}:${String(r.matchId)}`))

  const now = new Date()
  const perGoalie = [home, away].map((g) => ({
    goalie: g,
    totals: aiGoalieSeasonTotals(lines.filter((l) => l.side === g.side)),
  }))

  if (!opts.dryRun) {
    await db.transaction(async (tx) => {
      if (stale.length > 0) {
        await tx.delete(playerMatchStats).where(
          inArray(
            playerMatchStats.id,
            stale.map((r) => r.id),
          ),
        )
      }
      if (lines.length > 0) {
        await tx
          .insert(playerMatchStats)
          .values(
            lines.map((l) => ({
              playerId: playerFor(l.side).id,
              matchId: l.matchId,
              position: 'goalie',
              isGoalie: true,
              saves: l.saves,
              goalsAgainst: l.goalsAgainst,
              shotsAgainst: l.shotsAgainst,
              toiSeconds: l.toiSeconds,
              teamSide: l.teamSide,
            })),
          )
          .onConflictDoUpdate({
            target: [playerMatchStats.playerId, playerMatchStats.matchId],
            set: {
              position: sql`excluded.position`,
              isGoalie: sql`excluded.is_goalie`,
              saves: sql`excluded.saves`,
              goalsAgainst: sql`excluded.goals_against`,
              shotsAgainst: sql`excluded.shots_against`,
              toiSeconds: sql`excluded.toi_seconds`,
              teamSide: sql`excluded.team_side`,
            },
          })
      }
      for (const { goalie, totals } of perGoalie) {
        const thisRow = and(
          eq(eaMemberSeasonStats.gameTitleId, gameTitleId),
          eq(eaMemberSeasonStats.playerId, goalie.id),
        )
        if (totals.gamesPlayed === 0) {
          await tx.delete(eaMemberSeasonStats).where(thisRow)
          continue
        }
        const season = {
          playerId: goalie.id,
          favoritePosition: 'goalie',
          gamesPlayed: totals.gamesPlayed,
          skaterGp: 0,
          gamesCompleted: totals.gamesCompleted,
          goalieGp: totals.gamesPlayed,
          goalieWins: totals.wins,
          goalieLosses: totals.losses,
          goalieOtl: totals.otl,
          goalieSavePct: totals.savePct,
          goalieGaa: totals.gaa,
          goalieShutouts: totals.shutouts,
          goalieSaves: totals.saves,
          goalieShots: totals.shots,
          goalieGoalsAgainst: totals.goalsAgainst,
          goalieToiSeconds: totals.toiSeconds,
          toiSeconds: totals.toiSeconds,
          goalieGamesCompleted: totals.gamesCompleted,
          goalieDnf: totals.dnf,
          goalieWinPct: totals.winPct,
          lastFetchedAt: now,
        }
        await tx
          .insert(eaMemberSeasonStats)
          .values({ gameTitleId, gamertag: goalie.gamertag, ...season })
          .onConflictDoUpdate({
            target: [eaMemberSeasonStats.gameTitleId, eaMemberSeasonStats.gamertag],
            set: season,
          })
      }
    })
  }

  return {
    gameTitleId,
    aiGames: lines.length,
    perGoalie: perGoalie.map(({ goalie, totals }) => ({
      gamertag: goalie.gamertag,
      side: goalie.side,
      games: totals.gamesPlayed,
    })),
    removedLines: stale.length,
  }
}
