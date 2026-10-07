/**
 * pnpm --filter @eanhl/worker card-mythic --player "<gamertag>" (--theme <key> | --clear)
 *
 * Tier 6 is hand-awarded (spec Part 1). --theme sets the player's card to
 * tier 6 with that mythic theme; --clear returns them to their stats standing.
 * The worker's recompute never overwrites a manual (tier 6) row.
 */
import { eq, sql } from 'drizzle-orm'
import { db, sql as dbSql, playerCardEvents, playerCardProgress } from '@eanhl/db'
import { computeStanding, emptyBadgeValues, mergeCareerTotals } from '@eanhl/db/cards'
import { currentDatabase, loadCareerTotalsInput } from './card-progression.js'
import { parseMythicArgs } from './lib/card-mythic-args.js'

async function main(): Promise<void> {
  const cmd = parseMythicArgs(process.argv.slice(2))
  console.log(`[card-mythic] database=${await currentDatabase()}`)

  const found = (await db.execute(
    sql`SELECT id, gamertag FROM players WHERE lower(gamertag) = lower(${cmd.player})`,
  )) as unknown as { id: number; gamertag: string }[]
  const player = found[0]
  if (player === undefined || found.length !== 1) {
    throw new Error(
      `no unique player with gamertag "${cmd.player}" (matches: ${String(found.length)})`,
    )
  }

  const statsStanding =
    cmd.action === 'clear'
      ? computeStanding(
          mergeCareerTotals(await loadCareerTotalsInput()).get(player.id) ?? emptyBadgeValues(),
        )
      : null

  await db.transaction(async (tx) => {
    const [prev] = await tx
      .select()
      .from(playerCardProgress)
      .where(eq(playerCardProgress.playerId, player.id))
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
        .values({ playerId: player.id, ...row, computedAt: now })
        .onConflictDoUpdate({ target: playerCardProgress.playerId, set: row })
      await tx.insert(playerCardEvents).values({
        playerId: player.id,
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
      .where(eq(playerCardProgress.playerId, player.id))
    await tx.insert(playerCardEvents).values({
      playerId: player.id,
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
