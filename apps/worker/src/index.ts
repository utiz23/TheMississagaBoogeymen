/**
 * Ingestion worker entry point.
 *
 * Runs a non-overlapping polling loop: each cycle waits for the previous one
 * to complete before scheduling the next, preventing concurrent ingestion runs.
 *
 * Also starts the health HTTP endpoint on HEALTH_PORT (default 3001).
 *
 * Environment variables:
 *   DATABASE_URL         — required, PostgreSQL connection string
 *   POLL_INTERVAL_MS     — polling interval (default: 300000 = 5 minutes)
 *   HEALTH_PORT          — health endpoint port (default: 3001)
 *   EA_REQUEST_DELAY_MS  — throttle between EA API calls (default: 1000)
 */

import { runIngestionCycle } from './ingest.js'
import { startHealthServer } from './health.js'

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? '300000', 10)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function runLoop(): Promise<void> {
  console.log(`[worker] Starting polling loop. Interval: ${String(POLL_INTERVAL_MS)}ms`)

  for (;;) {
    const cycleStart = Date.now()

    try {
      await runIngestionCycle()
    } catch (err: unknown) {
      // runIngestionCycle catches per-title errors internally.
      // This outer catch handles catastrophic failures (e.g. DB connection lost).
      console.error('[worker] Unhandled error in ingestion cycle:', err)
    }

    const elapsed = Date.now() - cycleStart
    const delay = Math.max(0, POLL_INTERVAL_MS - elapsed)

    if (delay > 0) {
      console.log(`[worker] Cycle done in ${String(elapsed)}ms. Next cycle in ${String(delay)}ms`)
      await sleep(delay)
    } else {
      console.log(
        `[worker] Cycle overran interval by ${String(-delay)}ms. Starting next cycle immediately.`,
      )
    }
  }
}

startHealthServer()
runLoop().catch((err: unknown) => {
  console.error('[worker] Fatal loop error — exiting:', err)
  process.exit(1)
})
