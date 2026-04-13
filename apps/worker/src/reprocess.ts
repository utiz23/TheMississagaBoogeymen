/**
 * Reprocess transforms from raw_match_payloads.
 *
 * Default: reprocesses only rows with transform_status = 'error'.
 * With --all: reprocesses ALL rows regardless of status (used to backfill
 * new schema columns after a migration adds fields to player_match_stats
 * or matches).
 *
 * Usage:
 *   pnpm --filter worker reprocess              # error rows only
 *   pnpm --filter worker reprocess --all        # all rows (backfill)
 *   pnpm --filter worker reprocess --dry-run    # preview without writing
 *
 * This is a CLI command, not a long-lived service. It exits after completion.
 */

import { db, sql, rawMatchPayloads, gameTitles } from '@eanhl/db'
import { eq, and, inArray } from 'drizzle-orm'
import { transformMatch } from './transform.js'
import { persistTransform } from './ingest.js'
import { recomputeAggregates } from './aggregate.js'

const isDryRun = process.argv.includes('--dry-run')
const isAll = process.argv.includes('--all')

async function main(): Promise<void> {
  console.log(`[reprocess] Starting${isDryRun ? ' (dry run)' : ''}${isAll ? ' (--all mode)' : ''}`)

  // Load all game titles keyed by id for fast lookup.
  const titleRows = await db.select().from(gameTitles)
  const titleMap = new Map(titleRows.map((t) => [t.id, t]))

  // In --all mode, reprocess every payload. Otherwise, only errors.
  const targetPayloads = isAll
    ? await db.select().from(rawMatchPayloads)
    : await db.select().from(rawMatchPayloads).where(eq(rawMatchPayloads.transformStatus, 'error'))

  const modeLabel = isAll ? 'total' : "with transform_status = 'error'"
  console.log(`[reprocess] Found ${String(targetPayloads.length)} payload(s) ${modeLabel}`)

  if (targetPayloads.length === 0) {
    console.log('[reprocess] Nothing to reprocess.')
    return
  }

  let succeeded = 0
  let failed = 0
  const affectedGameTitleIds = new Set<number>()

  for (const row of targetPayloads) {
    const title = titleMap.get(row.gameTitleId)
    if (!title) {
      console.warn(
        `[reprocess] Unknown game_title_id ${String(row.gameTitleId)} for payload ${String(row.id)} — skipping`,
      )
      continue
    }

    console.log(`[reprocess] ea_match_id=${row.eaMatchId} game=${title.slug} type=${row.matchType}`)

    if (isDryRun) {
      console.log(`[reprocess]   (dry run — skipping actual reprocessing)`)
      continue
    }

    try {
      const result = transformMatch(
        row.payload,
        row.gameTitleId,
        title.eaClubId,
        row.matchType as Parameters<typeof transformMatch>[3],
      )
      await persistTransform(result)
      await db
        .update(rawMatchPayloads)
        .set({ transformStatus: 'success', transformError: null })
        .where(eq(rawMatchPayloads.id, row.id))
      console.log(`[reprocess]   ✓ success`)
      succeeded++
      affectedGameTitleIds.add(row.gameTitleId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[reprocess]   ✗ failed: ${msg}`)
      // Only overwrite the error message — do not clear a 'success' status on failure.
      await db
        .update(rawMatchPayloads)
        .set({ transformStatus: 'error', transformError: msg })
        .where(
          and(
            eq(rawMatchPayloads.id, row.id),
            inArray(rawMatchPayloads.transformStatus, ['error', 'pending']),
          ),
        )
      failed++
    }
  }

  if (!isDryRun) {
    console.log(`[reprocess] Done. succeeded=${String(succeeded)} failed=${String(failed)}`)

    // After a successful reprocess pass, recompute aggregates for affected titles.
    if (succeeded > 0) {
      console.log(
        `[reprocess] Recomputing aggregates for ${String(affectedGameTitleIds.size)} game title(s)...`,
      )
      for (const gameTitleId of affectedGameTitleIds) {
        try {
          await recomputeAggregates(gameTitleId)
          console.log(`[reprocess] Aggregates recomputed for game_title_id=${String(gameTitleId)}`)
        } catch (err) {
          console.error(
            `[reprocess] Aggregate recomputation failed for game_title_id=${String(gameTitleId)}:`,
            err,
          )
        }
      }
    }
  }
}

main()
  .catch((err: unknown) => {
    console.error('[reprocess] Fatal error:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void sql.end()
  })
