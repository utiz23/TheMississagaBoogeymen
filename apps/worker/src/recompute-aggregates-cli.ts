/**
 * pnpm --filter @eanhl/worker recompute-aggregates (--all | --title <slug>) [--dry-run]
 *
 * Rebuilds a title's precomputed aggregates (player_game_title_stats,
 * club_game_title_stats, player_position_stats) from its stored matches. The
 * worker does this each cycle for active titles; this CLI backfills archived
 * ones (NHL 26) and fills a newly added aggregate table. --dry-run only lists
 * the titles. Prints the connected database first — check it before trusting a write.
 */
import { sql } from 'drizzle-orm'
import { db, sql as dbSql } from '@eanhl/db'
import { recomputeAggregates } from './aggregate.js'
import { currentDatabase } from './card-progression.js'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const all = argv.includes('--all')
  const i = argv.indexOf('--title')
  const slug = i >= 0 ? argv[i + 1] : undefined
  if (all === (slug !== undefined)) throw new Error('pass exactly one of --all or --title <slug>')
  console.log(
    `[recompute-aggregates] database=${await currentDatabase()} mode=${dryRun ? 'dry-run (no writes)' : 'write'}`,
  )
  const titles = (await db.execute(sql`
    SELECT t.id, t.slug FROM game_titles t
    WHERE EXISTS (SELECT 1 FROM matches m WHERE m.game_title_id = t.id)
    ORDER BY t.release_order`)) as unknown as { id: number; slug: string }[]
  const chosen = all ? titles : titles.filter((t) => t.slug === slug)
  if (chosen.length === 0) throw new Error(`no title with matches${slug ? ` named "${slug}"` : ''}`)
  for (const t of chosen) {
    if (!dryRun) await recomputeAggregates(t.id)
    console.log(`[recompute-aggregates] ${t.slug}: ${dryRun ? 'would recompute' : 'recomputed'}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`recompute-aggregates: ${msg}\n`)
    process.exit(1)
  })
  .finally(() => {
    void dbSql.end()
  })
