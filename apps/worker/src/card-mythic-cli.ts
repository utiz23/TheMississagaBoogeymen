/**
 * pnpm --filter @eanhl/worker card-mythic --player "<gamertag>" [--title <slug>] (--theme <key> | --clear)
 *
 * Tier 6 is hand-awarded (spec Part 1). --theme sets the player's card for one
 * title's season (default: the default title) to tier 6 with that mythic theme;
 * --clear returns that card to its stats standing. The worker's recompute never
 * overwrites a manual (tier 6) row.
 */
import { and, eq, sql } from 'drizzle-orm'
import { db, sql as dbSql, playerCardEvents, playerCardProgress } from '@eanhl/db'
import { computeStanding, emptyBadgeValues, laddersFor } from '@eanhl/db/cards'
import { currentDatabase, loadCardTitles, loadSeasonTotals } from './card-progression.js'
import { parseMythicArgs } from './lib/card-mythic-args.js'

async function main(): Promise<void> {
  const cmd = parseMythicArgs(process.argv.slice(2))
  console.log(`[card-mythic] database=${await currentDatabase()}`)

  const found = (await db.execute(
    sql`SELECT id, gamertag, ai_goalie_side IS NOT NULL AS "aiGoalie" FROM players WHERE lower(gamertag) = lower(${cmd.player})`,
  )) as unknown as { id: number; gamertag: string; aiGoalie: boolean }[]
  const player = found[0]
  if (player === undefined || found.length !== 1) {
    throw new Error(
      `no unique player with gamertag "${cmd.player}" (matches: ${String(found.length)})`,
    )
  }

  const cardTitles = await loadCardTitles()
  const [defaultTitle] = (await db.execute(
    sql`SELECT slug FROM game_titles WHERE is_default LIMIT 1`,
  )) as unknown as { slug: string }[]
  const slug = cmd.title ?? defaultTitle?.slug
  const title = cardTitles.find((t) => t.slug === slug)
  if (title === undefined) {
    throw new Error(
      `"${slug ?? '(no default title)'}" has no season cards (card titles: ${cardTitles.map((t) => t.slug).join(', ')})`,
    )
  }
  console.log(`[card-mythic] title=${title.slug}`)

  const statsStanding =
    cmd.action === 'clear'
      ? computeStanding(
          (await loadSeasonTotals([title.id])).get(title.id)?.get(player.id) ?? emptyBadgeValues(),
          laddersFor(player.aiGoalie),
        )
      : null
  const thisCard = and(
    eq(playerCardProgress.playerId, player.id),
    eq(playerCardProgress.gameTitleId, title.id),
  )

  await db.transaction(async (tx) => {
    const [prev] = await tx.select().from(playerCardProgress).where(thisCard)
    const now = new Date()
    if (cmd.action === 'award') {
      const row = {
        tier: 6 as const,
        level: 10,
        tierPool: 'manual' as const,
        mythicTheme: cmd.theme,
        updatedAt: now,
      }
      await tx
        .insert(playerCardProgress)
        .values({ playerId: player.id, gameTitleId: title.id, ...row, computedAt: now })
        .onConflictDoUpdate({
          target: [playerCardProgress.playerId, playerCardProgress.gameTitleId],
          set: row,
        })
      await tx.insert(playerCardEvents).values({
        playerId: player.id,
        gameTitleId: title.id,
        kind: 'mythic_awarded',
        familyId: null,
        fromValue: prev?.tier ?? 1,
        toValue: 6,
        occurredAt: now,
      })
      console.log(`[card-mythic] ${player.gamertag}: T${String(prev?.tier ?? 1)} → T6 ${cmd.theme}`)
      return
    }
    if (prev?.tierPool !== 'manual' || statsStanding === null) {
      throw new Error(`${player.gamertag} has no hand-awarded mythic to clear`)
    }
    await tx
      .update(playerCardProgress)
      .set({
        tier: statsStanding.tier,
        level: statsStanding.level,
        tierPool: statsStanding.pool,
        mythicTheme: null,
        updatedAt: now,
      })
      .where(thisCard)
    await tx.insert(playerCardEvents).values({
      playerId: player.id,
      gameTitleId: title.id,
      kind: 'mythic_cleared',
      familyId: null,
      fromValue: 6,
      toValue: statsStanding.tier,
      occurredAt: now,
    })
    console.log(`[card-mythic] ${player.gamertag}: T6 → T${String(statsStanding.tier)} (stats)`)
  })
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`card-mythic: ${msg}\n`)
    process.exit(1)
  })
  .finally(() => {
    void dbSql.end()
  })
