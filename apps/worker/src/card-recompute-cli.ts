/**
 * pnpm --filter @eanhl/worker card-recompute [--dry-run]
 *
 * Recomputes badge levels, card tier/level and card events for every player
 * (spec docs/superpowers/specs/2026-10-07-player-cards-badges-design.md, Part 1)
 * and prints the standing table. --dry-run computes and prints without writing.
 * Prints the connected database first — check it before trusting a write.
 */
import { sql as dbSql } from '@eanhl/db'
import { TIER_LABELS } from '@eanhl/db/cards'
import { currentDatabase, recomputeCardProgression } from './card-progression.js'

async function main(): Promise<void> {
  const dryRun = process.argv.slice(2).includes('--dry-run')
  const database = await currentDatabase()
  console.log(
    `[card-recompute] database=${database} mode=${dryRun ? 'dry-run (no writes)' : 'write'}`,
  )

  const results = await recomputeCardProgression({ dryRun })
  const notable = results
    .filter((r) => r.standing.tier > 1 || r.standing.level > 1)
    .sort(
      (a, b) =>
        b.standing.tier - a.standing.tier ||
        b.standing.level - a.standing.level ||
        a.gamertag.localeCompare(b.gamertag),
    )
  for (const r of notable) {
    const s = r.standing
    const events = r.firstRun ? 'first run' : `${String(r.events)} events`
    console.log(
      `  T${String(s.tier)} ${TIER_LABELS[s.tier].padEnd(9)} L${String(s.level).padEnd(3)} ${s.pool.padEnd(7)} ${r.gamertag.padEnd(18)} ${events}`,
    )
  }
  const events = results.reduce((sum, r) => sum + r.events, 0)
  console.log(
    `[card-recompute] players=${String(results.length)} shown=${String(notable.length)} (others T1 L1) events=${String(events)}`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`card-recompute: ${msg}\n`)
    process.exit(1)
  })
  .finally(() => {
    void dbSql.end()
  })
