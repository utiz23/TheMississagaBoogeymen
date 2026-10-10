/**
 * Card progression recompute: loads every card title's badge inputs, applies the
 * shared rules from @eanhl/db/cards, and writes badge levels, card standing and
 * card events (migration 0060) in one transaction. Each title is its own season.
 * Spec: docs/superpowers/specs/2026-10-07-player-cards-badges-design.md, Part 1,
 * amended by docs/superpowers/specs/2026-10-08-season-cards-design.md.
 */
import { sql, type SQL } from 'drizzle-orm'
import { db, playerBadgeLevels, playerCardEvents, playerCardProgress } from '@eanhl/db'
import {
  BADGE_FAMILIES,
  laddersFor,
  computeStanding,
  pickFeaturedBadges,
  planCardRecompute,
  type BadgeFamilyId,
  type CardStanding,
} from '@eanhl/db/cards'
import { loadCardTitles, loadSeasonTotals } from '@eanhl/db/queries'

async function rows<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[]
}

export async function currentDatabase(): Promise<string> {
  const [row] = await rows<{ name: string }>(sql`SELECT current_database() AS name`)
  return row?.name ?? '?'
}

// The card season loaders live in @eanhl/db (shared with the admin page's
// mythic awards); re-exported here for the worker's existing callers.
export { loadCardTitles, loadSeasonTotals, type CardTitle } from '@eanhl/db/queries'

export interface RecomputeResult {
  gameTitleId: number
  titleName: string
  playerId: number
  gamertag: string
  standing: CardStanding
  events: number
  firstRun: boolean
}

export async function recomputeCardProgression(opts: {
  dryRun: boolean
}): Promise<RecomputeResult[]> {
  const titles = await loadCardTitles()
  const totals = await loadSeasonTotals(titles.map((t) => t.id))
  const [storedProgress, storedLevels, names] = await Promise.all([
    db.select().from(playerCardProgress),
    db.select().from(playerBadgeLevels),
    rows<{ id: number; gamertag: string; aiGoalie: boolean }>(
      sql`SELECT id, gamertag, ai_goalie_side IS NOT NULL AS "aiGoalie" FROM players`,
    ),
  ])
  const gamertags = new Map(names.map((n) => [n.id, n.gamertag]))
  const aiGoalies = new Set(names.filter((n) => n.aiGoalie).map((n) => n.id))
  const laddersOf = (playerId: number) => laddersFor(aiGoalies.has(playerId))

  const now = new Date()
  const results: RecomputeResult[] = []
  const levelRows: (typeof playerBadgeLevels.$inferInsert)[] = []
  const progressRows: (typeof playerCardProgress.$inferInsert)[] = []
  const eventRows: (typeof playerCardEvents.$inferInsert)[] = []

  for (const title of titles) {
    const gameTitleId = title.id
    const prevStanding = new Map<number, CardStanding>(
      storedProgress
        .filter((r) => r.gameTitleId === gameTitleId)
        .map((r) => [
          r.playerId,
          { tier: r.tier, level: r.level, pool: r.tierPool, mythicTheme: r.mythicTheme ?? null },
        ]),
    )
    const prevLevels = new Map<number, Partial<Record<BadgeFamilyId, number>>>()
    for (const r of storedLevels) {
      if (r.gameTitleId !== gameTitleId) continue
      const levels = prevLevels.get(r.playerId) ?? {}
      levels[r.familyId] = r.level
      prevLevels.set(r.playerId, levels)
    }

    const plan = planCardRecompute(
      totals.get(gameTitleId) ?? new Map(),
      prevStanding,
      prevLevels,
      laddersOf,
    )
    // The featured badge compares the whole club's season, so it is picked per title.
    // A mythic card still features a badge from its stats pool.
    const featured = pickFeaturedBadges(
      plan.map((p) => ({
        playerId: p.playerId,
        pool:
          computeStanding(p.values, laddersOf(p.playerId)).pool === 'goalie' ? 'goalie' : 'skater',
        values: p.values,
        levels: p.levels,
      })),
    )
    for (const { playerId, values, levels, standing, events, firstRun, writeStanding } of plan) {
      for (const f of BADGE_FAMILIES) {
        levelRows.push({
          playerId,
          gameTitleId,
          familyId: f.id,
          value: values[f.id],
          level: levels[f.id],
          featured: featured.get(playerId) === f.id,
          computedAt: now,
        })
      }
      if (writeStanding) {
        progressRows.push({
          playerId,
          gameTitleId,
          tier: standing.tier,
          level: standing.level,
          tierPool: standing.pool,
          mythicTheme: standing.mythicTheme,
          computedAt: now,
          updatedAt: now,
        })
      }
      for (const e of events) eventRows.push({ playerId, gameTitleId, ...e, occurredAt: now })
      results.push({
        gameTitleId,
        titleName: title.name,
        playerId,
        gamertag: gamertags.get(playerId) ?? `#${String(playerId)}`,
        standing,
        events: events.length,
        firstRun,
      })
    }
  }

  if (!opts.dryRun) {
    await db.transaction(async (tx) => {
      if (levelRows.length > 0) {
        await tx
          .insert(playerBadgeLevels)
          .values(levelRows)
          .onConflictDoUpdate({
            target: [
              playerBadgeLevels.playerId,
              playerBadgeLevels.gameTitleId,
              playerBadgeLevels.familyId,
            ],
            set: {
              value: sql`excluded.value`,
              level: sql`excluded.level`,
              featured: sql`excluded.featured`,
              computedAt: sql`excluded.computed_at`,
            },
          })
      }
      if (progressRows.length > 0) {
        await tx
          .insert(playerCardProgress)
          .values(progressRows)
          .onConflictDoUpdate({
            target: [playerCardProgress.playerId, playerCardProgress.gameTitleId],
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
