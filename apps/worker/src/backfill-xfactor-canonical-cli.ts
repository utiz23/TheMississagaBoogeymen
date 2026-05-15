/**
 * Backfill `player_loadout_x_factors.x_factor_name_canonical` for rows
 * where the column is NULL (i.e. inserted before the canonical-name
 * normalizer was wired into the loadout promoter).
 *
 * Read every row with NULL canonical, compute via `normalizeXFactor`,
 * UPDATE non-null results in one transaction. Unmapped values stay NULL
 * and are logged so OCR variants needing new alias rules are surfaced.
 *
 * Usage:
 *   pnpm --filter worker build
 *   set -a && source .env && set +a
 *   pnpm --filter worker backfill-xfactor-canonical
 *   pnpm --filter worker backfill-xfactor-canonical --dry-run
 */

import { isNull } from 'drizzle-orm'
import { db, sql, playerLoadoutXFactors } from '@eanhl/db'
import { eq } from 'drizzle-orm'
import { normalizeXFactor } from './lib/normalize-xfactor.js'

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')

  const rows = await db
    .select({
      id: playerLoadoutXFactors.id,
      raw: playerLoadoutXFactors.xFactorName,
    })
    .from(playerLoadoutXFactors)
    .where(isNull(playerLoadoutXFactors.xFactorNameCanonical))

  console.log(`[backfill] ${rows.length} rows have NULL canonical${dryRun ? ' (dry run)' : ''}`)

  const matched = new Map<string, string>() // raw → canonical
  const unmatched = new Map<string, number>() // raw → count

  for (const r of rows) {
    const canonical = normalizeXFactor(r.raw)
    if (canonical) {
      matched.set(r.raw, canonical)
    } else {
      unmatched.set(r.raw, (unmatched.get(r.raw) ?? 0) + 1)
    }
  }

  console.log(
    `[backfill] ${matched.size} distinct raw values mapped; ${unmatched.size} distinct unmatched`,
  )

  // Show top unmatched so the operator can grow the alias map.
  const topUnmatched = [...unmatched.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
  for (const [raw, count] of topUnmatched) {
    console.log(`  [unmatched] ${JSON.stringify(raw)} × ${count}`)
  }

  if (dryRun) {
    console.log('[backfill] dry run — no UPDATEs issued')
    return
  }

  let updated = 0
  for (const r of rows) {
    const canonical = normalizeXFactor(r.raw)
    if (canonical === null) continue
    await db
      .update(playerLoadoutXFactors)
      .set({ xFactorNameCanonical: canonical })
      .where(eq(playerLoadoutXFactors.id, r.id))
    updated++
  }
  console.log(`[backfill] updated ${updated} rows`)
}

main()
  .catch((err: unknown) => {
    console.error('[backfill] fatal:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void sql.end()
  })
