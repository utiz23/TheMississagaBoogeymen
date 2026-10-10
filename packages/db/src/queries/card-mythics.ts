/**
 * Card season loaders and the hand-awarded Tier 6 mythic (admin tools C2;
 * plan docs/superpowers/plans/2026-10-09-admin-tools.md). Shared by the
 * worker (card recompute, the `card-mythic` CLI) and the admin page, so the
 * award/clear rules live in one place. Spec: player-cards-badges-design.md
 * Part 1 — T6 is set only by the operator; the worker's recompute never
 * overwrites a manual row.
 */
import { and, desc, eq, sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import { gameTitles, playerCardEvents, playerCardProgress, players } from '../schema/index.js'
import {
  FIRST_CARD_RELEASE_ORDER,
  computeStanding,
  emptyBadgeValues,
  laddersFor,
  mergeSeasonTotals,
  type EaTitleTotals,
  type MythicThemeKey,
  type RecordedModeGames,
  type RecordedSixesWithGoalie,
  type SeasonTotals,
} from '../cards/index.js'

async function rows<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[]
}

export interface CardTitle {
  id: number
  slug: string
  name: string
}

/** Titles that get a card per player (NHL 27 on), oldest first. */
export async function loadCardTitles(): Promise<CardTitle[]> {
  return rows<CardTitle>(sql`
    SELECT id, slug, name FROM game_titles
    WHERE release_order >= ${FIRST_CARD_RELEASE_ORDER}
    ORDER BY release_order, id`)
}

/** Season totals for the given titles: title id → player id → badge values. */
export async function loadSeasonTotals(titleIds: readonly number[]): Promise<SeasonTotals> {
  if (titleIds.length === 0) return new Map()
  const ids = sql.join(
    titleIds.map((id) => sql`${id}`),
    sql`, `,
  )
  const [ea, recordedModes, recordedSixesWithGoalie] = await Promise.all([
    rows<EaTitleTotals>(sql`
      SELECT player_id AS "playerId", game_title_id AS "gameTitleId",
        COALESCE(skater_wins, 0) AS "skaterWins", COALESCE(goalie_wins, 0) AS "goalieWins",
        COALESCE(goals, 0) AS "goals", COALESCE(assists, 0) AS "assists", COALESCE(shots, 0) AS "shots",
        COALESCE(dekes_made, 0) AS "dekesMade", COALESCE(hat_tricks, 0) AS "hatTricks",
        COALESCE(breakaways, 0) AS "breakaways", COALESCE(hits, 0) AS "hits",
        COALESCE(faceoff_wins, 0) AS "faceoffWins", COALESCE(takeaways, 0) AS "takeaways",
        COALESCE(blocked_shots, 0) AS "blockedShots", COALESCE(fights_won, 0) AS "fightsWon",
        COALESCE(goalie_games_completed, 0) AS "goalieGamesCompleted",
        COALESCE(goalie_saves, 0) AS "goalieSaves",
        COALESCE(goalie_desperation_saves, 0) AS "goalieDesperationSaves",
        COALESCE(goalie_poke_checks, 0) AS "goaliePokeChecks",
        COALESCE(goalie_shutouts, 0) AS "goalieShutouts"
      FROM ea_member_season_stats
      WHERE game_title_id IN (${ids})`),
    rows<RecordedModeGames>(sql`
      SELECT player_id AS "playerId", game_title_id AS "gameTitleId", game_mode AS "gameMode",
        SUM(games_played)::int AS "gamesPlayed"
      FROM player_game_title_stats
      WHERE game_mode IN ('3s', '6s') AND game_title_id IN (${ids})
      GROUP BY player_id, game_title_id, game_mode`),
    rows<RecordedSixesWithGoalie>(sql`
      SELECT p.player_id AS "playerId", m.game_title_id AS "gameTitleId",
        COUNT(DISTINCT p.match_id)::int AS "games"
      FROM player_match_stats p
      JOIN matches m ON m.id = p.match_id
      WHERE m.game_mode = '6s' AND m.game_title_id IN (${ids})
        AND EXISTS (SELECT 1 FROM player_match_stats g JOIN players gp ON gp.id = g.player_id
          WHERE g.match_id = p.match_id AND g.is_goalie AND gp.ai_goalie_side IS NULL)
      GROUP BY p.player_id, m.game_title_id`),
  ])
  return mergeSeasonTotals({ ea, recordedModes, recordedSixesWithGoalie })
}

export interface MythicCard {
  playerId: number
  gamertag: string
  gameTitleId: number
  titleName: string
  theme: MythicThemeKey
  /** When the card last changed (the award, for a manual row). */
  since: Date
}

/** Every hand-awarded Tier 6 card, newest season first. */
export async function listMythicCards(): Promise<MythicCard[]> {
  const found = await db
    .select({
      playerId: playerCardProgress.playerId,
      gamertag: players.gamertag,
      gameTitleId: playerCardProgress.gameTitleId,
      titleName: gameTitles.name,
      theme: playerCardProgress.mythicTheme,
      since: playerCardProgress.updatedAt,
    })
    .from(playerCardProgress)
    .innerJoin(players, eq(players.id, playerCardProgress.playerId))
    .innerJoin(gameTitles, eq(gameTitles.id, playerCardProgress.gameTitleId))
    .where(eq(playerCardProgress.tierPool, 'manual'))
    .orderBy(desc(gameTitles.releaseOrder), players.gamertag)
  return found.flatMap((r) => (r.theme === null ? [] : [{ ...r, theme: r.theme }]))
}

/**
 * Award a mythic: the player's card for that season becomes T6 (level 10,
 * pool 'manual') with the theme, and a `mythic_awarded` event is logged — one
 * transaction. Re-awarding swaps the theme. Returns the tier it came from.
 */
export async function awardMythic(args: {
  playerId: number
  gameTitleId: number
  theme: MythicThemeKey
}): Promise<{ fromTier: number }> {
  const thisCard = and(
    eq(playerCardProgress.playerId, args.playerId),
    eq(playerCardProgress.gameTitleId, args.gameTitleId),
  )
  return db.transaction(async (tx) => {
    const [prev] = await tx.select().from(playerCardProgress).where(thisCard)
    const now = new Date()
    const row = {
      tier: 6 as const,
      level: 10,
      tierPool: 'manual' as const,
      mythicTheme: args.theme,
      updatedAt: now,
    }
    await tx
      .insert(playerCardProgress)
      .values({ playerId: args.playerId, gameTitleId: args.gameTitleId, ...row, computedAt: now })
      .onConflictDoUpdate({
        target: [playerCardProgress.playerId, playerCardProgress.gameTitleId],
        set: row,
      })
    await tx.insert(playerCardEvents).values({
      playerId: args.playerId,
      gameTitleId: args.gameTitleId,
      kind: 'mythic_awarded',
      familyId: null,
      fromValue: prev?.tier ?? 1,
      toValue: 6,
      occurredAt: now,
    })
    return { fromTier: prev?.tier ?? 1 }
  })
}

/**
 * Clear a hand-awarded mythic: the card goes back to its stats standing for
 * that season and a `mythic_cleared` event is logged — one transaction.
 * Returns null (nothing changed) when the card has no manual mythic.
 */
export async function clearMythic(args: {
  playerId: number
  gameTitleId: number
}): Promise<{ toTier: number } | null> {
  const [who] = await db
    .select({ aiGoalieSide: players.aiGoalieSide })
    .from(players)
    .where(eq(players.id, args.playerId))
  if (who === undefined) return null
  const values =
    (await loadSeasonTotals([args.gameTitleId])).get(args.gameTitleId)?.get(args.playerId) ??
    emptyBadgeValues()
  const standing = computeStanding(values, laddersFor(who.aiGoalieSide !== null))
  const thisCard = and(
    eq(playerCardProgress.playerId, args.playerId),
    eq(playerCardProgress.gameTitleId, args.gameTitleId),
  )
  return db.transaction(async (tx) => {
    const [prev] = await tx.select().from(playerCardProgress).where(thisCard).for('update')
    if (prev?.tierPool !== 'manual') return null
    const now = new Date()
    await tx
      .update(playerCardProgress)
      .set({
        tier: standing.tier,
        level: standing.level,
        tierPool: standing.pool,
        mythicTheme: null,
        updatedAt: now,
      })
      .where(thisCard)
    await tx.insert(playerCardEvents).values({
      playerId: args.playerId,
      gameTitleId: args.gameTitleId,
      kind: 'mythic_cleared',
      familyId: null,
      fromValue: 6,
      toValue: standing.tier,
      occurredAt: now,
    })
    return { toTier: standing.tier }
  })
}
