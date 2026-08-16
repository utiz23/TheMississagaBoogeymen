/**
 * HTTP health endpoint.
 *
 * Exposes last successful ingestion time so external monitors can detect
 * a stuck or offline worker.
 *
 * GET /health → 200 { status, lastSuccessfulIngest, secondsSinceLastIngest }
 * GET /health → 503 if no successful ingest in the last STALE_THRESHOLD_MS
 *
 * Port: HEALTH_PORT env var (default: 3001)
 * Stale threshold: HEALTH_STALE_MS env var (default: 1800000 = 30 minutes)
 */

import { createServer } from 'node:http'
import { db, ingestionLog } from '@eanhl/db'
import { eq, desc, and, isNotNull } from 'drizzle-orm'

const PORT = parseInt(process.env.HEALTH_PORT ?? '3001', 10)
const STALE_THRESHOLD_MS = parseInt(process.env.HEALTH_STALE_MS ?? '1800000', 10)

interface HealthPayload {
  status: 'ok' | 'degraded' | 'stale'
  lastSuccessfulIngest: string | null
  secondsSinceLastIngest: number | null
  message?: string
}

export interface LatestCompletedSuccess {
  finishedAt: Date
}

/** Smallest structurally typed executor `fetchLatestCompletedSuccess` needs —
 *  lets tests pass a transaction (`tx`) in place of the production `db`. */
export type HealthQueryExecutor = Pick<typeof db, 'select'>

/** DB-facing half: the query itself. Filters on status AND a non-null finishedAt
 *  so a successful-but-unfinished row (finishedAt IS NULL) can never win the
 *  ORDER BY ... DESC — Postgres sorts NULL first under DESC, which is what let
 *  an incomplete row shadow real completed ingestions. */
export async function fetchLatestCompletedSuccess(
  executor: HealthQueryExecutor = db,
): Promise<LatestCompletedSuccess | null> {
  const rows = await executor
    .select({ finishedAt: ingestionLog.finishedAt })
    .from(ingestionLog)
    .where(and(eq(ingestionLog.status, 'success'), isNotNull(ingestionLog.finishedAt)))
    .orderBy(desc(ingestionLog.finishedAt))
    .limit(1)

  const lastRow = rows[0]
  if (!lastRow) return null
  if (lastRow.finishedAt === null) {
    // Unreachable while the isNotNull(finishedAt) filter above is intact — a
    // filtered row can never have a null finishedAt. Throwing here (rather
    // than silently falling back to null, which looks identical to "no
    // successful ingestion recorded") turns a broken filter into a loud
    // failure instead of a masked one.
    throw new Error(
      'fetchLatestCompletedSuccess: query returned a status=success row with finished_at IS NULL — the isNotNull(finishedAt) filter is not being applied',
    )
  }
  return { finishedAt: lastRow.finishedAt }
}

/** Pure half: shapes the payload/status from a resolved row. No DB access. */
export function buildHealthPayload(
  lastRow: LatestCompletedSuccess | null,
  staleThresholdMs: number = STALE_THRESHOLD_MS,
): { payload: HealthPayload; httpStatus: number } {
  if (!lastRow) {
    return {
      payload: {
        status: 'degraded',
        lastSuccessfulIngest: null,
        secondsSinceLastIngest: null,
        message: 'No successful ingestion recorded yet',
      },
      httpStatus: 503,
    }
  }

  const secondsAgo = Math.floor((Date.now() - lastRow.finishedAt.getTime()) / 1000)
  const isStale = Date.now() - lastRow.finishedAt.getTime() > staleThresholdMs

  return {
    payload: {
      status: isStale ? 'stale' : 'ok',
      lastSuccessfulIngest: lastRow.finishedAt.toISOString(),
      secondsSinceLastIngest: secondsAgo,
      ...(isStale
        ? {
            message: `No successful ingest in ${String(Math.round(staleThresholdMs / 60000))} minutes`,
          }
        : {}),
    },
    httpStatus: isStale ? 503 : 200,
  }
}

export async function getHealthPayload(
  staleThresholdMs: number = STALE_THRESHOLD_MS,
): Promise<{ payload: HealthPayload; httpStatus: number }> {
  const lastRow = await fetchLatestCompletedSuccess()
  return buildHealthPayload(lastRow, staleThresholdMs)
}

export function startHealthServer(): void {
  const server = createServer((req, res) => {
    if (req.url !== '/health' && req.url !== '/') {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    getHealthPayload()
      .then(({ payload, httpStatus }) => {
        res.writeHead(httpStatus, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      })
      .catch((err: unknown) => {
        console.error('[health] Error querying DB:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'error', message: 'Internal error' }))
      })
  })

  server.listen(PORT, () => {
    console.log(`[health] Listening on http://0.0.0.0:${String(PORT)}/health`)
  })
}
