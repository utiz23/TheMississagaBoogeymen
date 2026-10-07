/**
 * Card progression recompute: loads every player's badge inputs, applies the
 * shared rules from @eanhl/db/cards, and writes badge levels, card standing and
 * card events (migration 0060) in one transaction.
 * Spec: docs/superpowers/specs/2026-10-07-player-cards-badges-design.md, Part 1.
 */
import { sql, type SQL } from 'drizzle-orm'
import { db, playerBadgeLevels, playerCardEvents, playerCardProgress } from '@eanhl/db'
import {
  BADGE_FAMILIES,
  mergeCareerTotals,
  planCardRecompute,
  type BadgeFamilyId,
  type CardStanding,
  type CareerTotalsInput,
  type EaTitleTotals,
  type HistoryTitleTotals,
  type RecordedModeGames,
  type RecordedSixesWithGoalie,
} from '@eanhl/db/cards'

async function rows<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[]
}

export async function currentDatabase(): Promise<string> {
  const [row] = await rows<{ name: string }>(sql`SELECT current_database() AS name`)
  return row?.name ?? '?'
}

export async function loadCareerTotalsInput(): Promise<CareerTotalsInput> {
  const [ea, history, recordedModes, recordedSixesWithGoalie] = await Promise.all([
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
      FROM ea_member_season_stats`),
    rows<HistoryTitleTotals>(sql`
      SELECT player_id AS "playerId", game_title_id AS "gameTitleId", game_mode AS "gameMode",
        (COALESCE(skater_gp, 0) + COALESCE(goalie_gp, 0))::int AS "gamesPlayed",
        COALESCE(wins, 0) AS "wins", COALESCE(goals, 0) AS "goals", COALESCE(assists, 0) AS "assists",
        COALESCE(shots, 0) AS "shots", COALESCE(hits, 0) AS "hits", COALESCE(takeaways, 0) AS "takeaways",
        COALESCE(blocked_shots, 0) AS "blockedShots", COALESCE(total_saves, 0) AS "saves",
        COALESCE(shutouts, 0) AS "shutouts"
      FROM historical_club_member_season_stats
      WHERE player_id IS NOT NULL AND review_status = 'reviewed'`),
    rows<RecordedModeGames>(sql`
      SELECT player_id AS "playerId", game_mode AS "gameMode", SUM(games_played)::int AS "gamesPlayed"
      FROM player_game_title_stats
      WHERE game_mode IN ('3s', '6s')
      GROUP BY player_id, game_mode`),
    rows<RecordedSixesWithGoalie>(sql`
      SELECT p.player_id AS "playerId", COUNT(DISTINCT p.match_id)::int AS "games"
      FROM player_match_stats p
      JOIN matches m ON m.id = p.match_id
      WHERE m.game_mode = '6s'
        AND EXISTS (SELECT 1 FROM player_match_stats g WHERE g.match_id = p.match_id AND g.is_goalie)
      GROUP BY p.player_id`),
  ])
  return { ea, history, recordedModes, recordedSixesWithGoalie }
}

export interface RecomputeResult {
  playerId: number
  gamertag: string
  standing: CardStanding
  events: number
  firstRun: boolean
}

export async function recomputeCardProgression(opts: {
  dryRun: boolean
}): Promise<RecomputeResult[]> {
  const totals = mergeCareerTotals(await loadCareerTotalsInput())
  const [storedProgress, storedLevels, names] = await Promise.all([
    db.select().from(playerCardProgress),
    db.select().from(playerBadgeLevels),
    rows<{ id: number; gamertag: string }>(sql`SELECT id, gamertag FROM players`),
  ])

  const prevStanding = new Map<number, CardStanding>(
    storedProgress.map((r) => [
      r.playerId,
      { tier: r.tier, level: r.level, pool: r.tierPool, mythicTheme: r.mythicTheme ?? null },
    ]),
  )
  const prevLevels = new Map<number, Partial<Record<BadgeFamilyId, number>>>()
  for (const r of storedLevels) {
    const levels = prevLevels.get(r.playerId) ?? {}
    levels[r.familyId] = r.level
    prevLevels.set(r.playerId, levels)
  }
  const gamertags = new Map(names.map((n) => [n.id, n.gamertag]))

  const now = new Date()
  const results: RecomputeResult[] = []
  const levelRows: (typeof playerBadgeLevels.$inferInsert)[] = []
  const progressRows: (typeof playerCardProgress.$inferInsert)[] = []
  const eventRows: (typeof playerCardEvents.$inferInsert)[] = []

  for (const {
    playerId,
    values,
    levels,
    standing,
    events,
    firstRun,
    writeStanding,
  } of planCardRecompute(totals, prevStanding, prevLevels)) {
    for (const f of BADGE_FAMILIES) {
      levelRows.push({
        playerId,
        familyId: f.id,
        value: values[f.id],
        level: levels[f.id],
        computedAt: now,
      })
    }
    if (writeStanding) {
      progressRows.push({
        playerId,
        tier: standing.tier,
        level: standing.level,
        tierPool: standing.pool,
        mythicTheme: standing.mythicTheme,
        computedAt: now,
        updatedAt: now,
      })
    }
    for (const e of events) eventRows.push({ playerId, ...e, occurredAt: now })
    results.push({
      playerId,
      gamertag: gamertags.get(playerId) ?? `#${String(playerId)}`,
      standing,
      events: events.length,
      firstRun,
    })
  }

  if (!opts.dryRun) {
    await db.transaction(async (tx) => {
      if (levelRows.length > 0) {
        await tx
          .insert(playerBadgeLevels)
          .values(levelRows)
          .onConflictDoUpdate({
            target: [playerBadgeLevels.playerId, playerBadgeLevels.familyId],
            set: {
              value: sql`excluded.value`,
              level: sql`excluded.level`,
              computedAt: sql`excluded.computed_at`,
            },
          })
      }
      if (progressRows.length > 0) {
        await tx
          .insert(playerCardProgress)
          .values(progressRows)
          .onConflictDoUpdate({
            target: playerCardProgress.playerId,
            set: {
              tier: sql`excluded.tier`,
              level: sql`excluded.level`,
              tierPool: sql`excluded.tier_pool`,
              mythicTheme: sql`excluded.mythic_theme`,
              computedAt: sql`excluded.computed_at`,
              updatedAt: sql`excluded.updated_at`,
            },
            // A mythic awarded by `card-mythic` after this run read the table must survive.
            setWhere: sql`"player_card_progress"."tier_pool" <> 'manual'`,
          })
      }
      if (eventRows.length > 0) await tx.insert(playerCardEvents).values(eventRows)
    })
  }

  return results
}
