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
import { eq, desc, and } from 'drizzle-orm'

const PORT = parseInt(process.env.HEALTH_PORT ?? '3001', 10)
const STALE_THRESHOLD_MS = parseInt(process.env.HEALTH_STALE_MS ?? '1800000', 10)

interface HealthPayload {
  status: 'ok' | 'degraded' | 'stale'
  lastSuccessfulIngest: string | null
  secondsSinceLastIngest: number | null
  message?: string
}

async function getHealthPayload(): Promise<{ payload: HealthPayload; httpStatus: number }> {
  const rows = await db
    .select({ finishedAt: ingestionLog.finishedAt })
    .from(ingestionLog)
    .where(and(eq(ingestionLog.status, 'success')))
    .orderBy(desc(ingestionLog.finishedAt))
    .limit(1)

  const lastRow = rows[0]

  if (!lastRow?.finishedAt) {
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
  const isStale = Date.now() - lastRow.finishedAt.getTime() > STALE_THRESHOLD_MS

  return {
    payload: {
      status: isStale ? 'stale' : 'ok',
      lastSuccessfulIngest: lastRow.finishedAt.toISOString(),
      secondsSinceLastIngest: secondsAgo,
      ...(isStale
        ? {
            message: `No successful ingest in ${String(Math.round(STALE_THRESHOLD_MS / 60000))} minutes`,
          }
        : {}),
    },
    httpStatus: isStale ? 503 : 200,
  }
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
