/**
 * pnpm --filter @eanhl/worker ai-goalie-sync [--dry-run] [--title <slug>]
 *
 * Writes the AI goalies' per-game lines and season totals for every title with
 * matches (or one title), then recomputes that title's aggregates. The worker
 * does this each cycle for active titles; this CLI backfills archived ones
 * (NHL 26). --dry-run prints the counts without writing.
 * Prints the connected database first — check it before trusting a write.
 */
import { sql } from 'drizzle-orm'
import { db, sql as dbSql } from '@eanhl/db'
import { recomputeAggregates } from './aggregate.js'
import { syncAiGoalies } from './ai-goalie-sync.js'
import { currentDatabase } from './card-progression.js'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const i = argv.indexOf('--title')
  const slug = i >= 0 ? argv[i + 1] : undefined
  console.log(
    `[ai-goalie-sync] database=${await currentDatabase()} mode=${dryRun ? 'dry-run (no writes)' : 'write'}`,
  )
  const titles = (await db.execute(sql`
    SELECT t.id, t.slug FROM game_titles t
    WHERE EXISTS (SELECT 1 FROM matches m WHERE m.game_title_id = t.id)
    ORDER BY t.release_order`)) as unknown as { id: number; slug: string }[]
  const chosen = slug === undefined ? titles : titles.filter((t) => t.slug === slug)
  if (chosen.length === 0) throw new Error(`no title with matches${slug ? ` named "${slug}"` : ''}`)
  for (const t of chosen) {
    const r = await syncAiGoalies(t.id, { dryRun })
    if (r.skipped !== undefined) throw new Error(`${t.slug}: ${r.skipped}`)
    if (!dryRun) await recomputeAggregates(t.id)
    console.log(
      `[ai-goalie-sync] ${t.slug}: ai_games=${String(r.aiGames)} ${r.perGoalie.map((g) => `${g.gamertag}(${g.side})=${String(g.games)}`).join(' ')} removed=${String(r.removedLines)}`,
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`ai-goalie-sync: ${msg}\n`)
    process.exit(1)
  })
  .finally(() => {
    void dbSql.end()
  })
