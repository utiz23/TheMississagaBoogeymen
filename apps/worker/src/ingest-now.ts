/**
 * Manual ingestion trigger.
 *
 * Runs one ingestion cycle immediately outside the regular polling schedule.
 * Useful for recovery after a worker outage.
 *
 * Usage:
 *   pnpm --filter worker ingest-now
 *
 * This is a CLI command. It exits after the cycle completes.
 */

import { sql } from '@eanhl/db'
import { runIngestionCycle } from './ingest.js'

async function main(): Promise<void> {
  console.log('[ingest-now] Running immediate ingestion cycle...')
  const start = Date.now()
  await runIngestionCycle()
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`[ingest-now] Cycle completed in ${elapsed}s`)
}

main()
  .catch((err: unknown) => {
    console.error('[ingest-now] Fatal error:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void sql.end()
  })
