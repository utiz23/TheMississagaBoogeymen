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
 *   EA_REQUEST_TIMEOUT_MS — time limit for one EA request (default: 30000; ea-client)
 *   WORKER_WATCHDOG_MS   — no loop progress for this long: exit so Docker restarts the worker
 *                          (default: 900000 = 15 minutes; `watchdog.ts`)
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
import {
  DEFAULT_WATCHDOG_MS,
  WATCHDOG_CHECK_EVERY_MS,
  Watchdog,
  parsePositiveMs,
} from './watchdog.js'

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? '300000', 10)

const WATCHDOG_MS = parsePositiveMs(process.env.WORKER_WATCHDOG_MS, DEFAULT_WATCHDOG_MS)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function runLoop(): Promise<void> {
  console.log(
    `[worker] Starting polling loop. Interval: ${String(POLL_INTERVAL_MS)}ms. ` +
      `Watchdog: ${String(WATCHDOG_MS)}ms`,
  )
  // A timer outside the loop: it exits the process when the loop stops making progress, so
  // Docker (restart: unless-stopped) starts a fresh worker.
  const watchdog = new Watchdog({
    limitMs: WATCHDOG_MS,
    checkEveryMs: WATCHDOG_CHECK_EVERY_MS,
    now: Date.now,
    exit: (code) => process.exit(code),
    log: (line) => console.error(line),
  })
  watchdog.start()
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
    onProgress: (step) => watchdog.progress(step),
  })
  await loop.run()
}

startHealthServer()
runLoop().catch((err: unknown) => {
  console.error('[worker] Fatal loop error — exiting:', err)
  process.exit(1)
})
