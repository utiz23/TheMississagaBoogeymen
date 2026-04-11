/**
 * Reprocess failed transforms.
 *
 * Queries all raw_match_payloads with transform_status = 'error',
 * re-runs the transform pipeline, and updates the status.
 *
 * Usage:
 *   pnpm --filter worker reprocess
 *   pnpm --filter worker reprocess --dry-run
 *
 * This is a CLI command, not a long-lived service. It exits after completion.
 */

import { db, sql, rawMatchPayloads, gameTitles } from '@eanhl/db'
import { eq, and } from 'drizzle-orm'
import { transformMatch } from './transform.js'
import { persistTransform } from './ingest.js'

const isDryRun = process.argv.includes('--dry-run')

async function main(): Promise<void> {
  console.log(`[reprocess] Starting${isDryRun ? ' (dry run)' : ''}`)

  // Load all active game titles keyed by id for fast lookup.
  const titleRows = await db.select().from(gameTitles)
  const titleMap = new Map(titleRows.map((t) => [t.id, t]))

  // Fetch all error payloads.
  const errorPayloads = await db
    .select()
    .from(rawMatchPayloads)
    .where(eq(rawMatchPayloads.transformStatus, 'error'))

  console.log(
    `[reprocess] Found ${String(errorPayloads.length)} payload(s) with transform_status = 'error'`,
  )

  if (errorPayloads.length === 0) {
    console.log('[reprocess] Nothing to reprocess.')
    return
  }

  let succeeded = 0
  let failed = 0

  for (const row of errorPayloads) {
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[reprocess]   ✗ failed: ${msg}`)
      await db
        .update(rawMatchPayloads)
        .set({ transformError: msg })
        .where(and(eq(rawMatchPayloads.id, row.id), eq(rawMatchPayloads.transformStatus, 'error')))
      failed++
    }
  }

  if (!isDryRun) {
    console.log(`[reprocess] Done. succeeded=${String(succeeded)} failed=${String(failed)}`)
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
