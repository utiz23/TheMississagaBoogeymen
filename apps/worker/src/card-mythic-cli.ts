/**
 * pnpm --filter @eanhl/worker card-mythic --player "<gamertag>" [--title <slug>] (--theme <key> | --clear)
 *
 * Tier 6 is hand-awarded (spec Part 1). --theme sets the player's card for one
 * title's season (default: the default title) to tier 6 with that mythic theme;
 * --clear returns that card to its stats standing. The worker's recompute never
 * overwrites a manual (tier 6) row.
 */
import { sql } from 'drizzle-orm'
import { db, sql as dbSql } from '@eanhl/db'
import { awardMythic, clearMythic, loadCardTitles } from '@eanhl/db/queries'
import { currentDatabase } from './card-progression.js'
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

  // The award/clear transaction is shared with the admin page (@eanhl/db).
  if (cmd.action === 'award') {
    const { fromTier } = await awardMythic({
      playerId: player.id,
      gameTitleId: title.id,
      theme: cmd.theme,
    })
    console.log(`[card-mythic] ${player.gamertag}: T${String(fromTier)} → T6 ${cmd.theme}`)
    return
  }
  const cleared = await clearMythic({ playerId: player.id, gameTitleId: title.id })
  if (cleared === null) throw new Error(`${player.gamertag} has no hand-awarded mythic to clear`)
  console.log(`[card-mythic] ${player.gamertag}: T6 → T${String(cleared.toTier)} (stats)`)
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
