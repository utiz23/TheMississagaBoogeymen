/**
 * Ingestion worker entry point.
 *
 * Runs a non-overlapping polling loop: each pass waits for the previous one to complete before
 * the next starts, so ingestion never runs twice at once. Between normal passes the loop reads
 * live events and runs quick match-list checks after the horn (live events E1, `live-checks.ts`).
 *
 * Also starts the health HTTP endpoint on HEALTH_PORT (default 3001).
 *
 * Environment variables:
 *   DATABASE_URL         — required, PostgreSQL connection string
 *   POLL_INTERVAL_MS     — polling interval (default: 300000 = 5 minutes)
 *   HEALTH_PORT          — health endpoint port (default: 3001)
 *   EA_REQUEST_DELAY_MS  — throttle between EA API calls (default: 1000)
 *   HC_WORKER_PING_URL   — optional Healthchecks.io ping URL, pinged after every cycle
 */

import {
  activeClubGameEndedSince,
  deleteLiveEventsBefore,
  latestActiveClubMatchId,
  listLiveEventTriggers,
} from '@eanhl/db/queries'
import { runIngestionCycle, runQuickMatchCheck } from './ingest.js'
import { startHealthServer } from './health.js'
import { sendHeartbeat } from './heartbeat.js'
import { LiveCheckLoop } from './live-checks.js'

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? '300000', 10)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function runLoop(): Promise<void> {
  console.log(`[worker] Starting polling loop. Interval: ${String(POLL_INTERVAL_MS)}ms`)
  const loop = new LiveCheckLoop({
    runNormalPass: runIngestionCycle,
    afterNormalPass: sendHeartbeat,
    runQuickCheck: runQuickMatchCheck,
    readTriggers: (cursor) => listLiveEventTriggers(cursor),
    latestMatchId: latestActiveClubMatchId,
    gameEndedSince: activeClubGameEndedSince,
    cleanup: deleteLiveEventsBefore,
    normalIntervalMs: POLL_INTERVAL_MS,
    now: Date.now,
    sleep,
    log: (line) => console.log(line),
  })
  await loop.run()
}

startHealthServer()
runLoop().catch((err: unknown) => {
  console.error('[worker] Fatal loop error — exiting:', err)
  process.exit(1)
})
