/**
 * Healthchecks.io heartbeat (launch plan item 6).
 *
 * After every ingestion cycle the worker pings HC_WORKER_PING_URL. Healthchecks
 * emails the owner when the pings stop (worker down, host off) or arrive on the
 * check's `/fail` endpoint: no successful ingest within HEALTH_STALE_MS (the
 * same rule as GET /health), or raw payloads stuck in transform_status =
 * 'error'. Unset → disabled. A ping problem is logged and never affects
 * ingestion. The ping URL is a credential: it is never logged.
 */

import { count, eq } from 'drizzle-orm'
import { db, rawMatchPayloads } from '@eanhl/db'
import { getHealthPayload } from './health.js'

const PING_URL = process.env.HC_WORKER_PING_URL ?? ''
const PING_TIMEOUT_MS = 10_000

export interface HeartbeatInput {
  healthStatus: 'ok' | 'degraded' | 'stale'
  healthMessage?: string | undefined
  transformErrors: number
}

/** Pure: whether this heartbeat reports a problem, and the text sent with it. */
export function heartbeatDecision(input: HeartbeatInput): { fail: boolean; message: string } {
  const problems: string[] = []
  if (input.healthStatus !== 'ok') {
    problems.push(input.healthMessage ?? `worker health is ${input.healthStatus}`)
  }
  if (input.transformErrors > 0) {
    problems.push(
      `${String(input.transformErrors)} raw payload(s) failed to transform — run \`pnpm --filter worker reprocess\``,
    )
  }
  return problems.length > 0
    ? { fail: true, message: problems.join('\n') }
    : { fail: false, message: 'ok' }
}

export async function sendHeartbeat(): Promise<void> {
  if (!PING_URL) return
  try {
    const { payload } = await getHealthPayload()
    const [errors] = await db
      .select({ n: count() })
      .from(rawMatchPayloads)
      .where(eq(rawMatchPayloads.transformStatus, 'error'))
    const decision = heartbeatDecision({
      healthStatus: payload.status,
      healthMessage: payload.message,
      transformErrors: errors?.n ?? 0,
    })
    const response = await fetch(decision.fail ? `${PING_URL}/fail` : PING_URL, {
      method: 'POST',
      body: decision.message,
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    })
    if (!response.ok) {
      console.error(`[heartbeat] Healthchecks answered HTTP ${String(response.status)}`)
    } else if (decision.fail) {
      console.warn(`[heartbeat] reported a problem: ${decision.message}`)
    }
  } catch (err: unknown) {
    console.error('[heartbeat] ping failed:', err instanceof Error ? err.message : String(err))
  }
}
