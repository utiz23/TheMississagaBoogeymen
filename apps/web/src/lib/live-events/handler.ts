import type { LiveEventSource, LiveEventType } from '@eanhl/db/schema'
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  checkTimestamp,
  isBearerValid,
  isSignatureValid,
  secretsConfigured,
} from './auth.ts'
import { parseLiveEvent } from './event.ts'
import type { RateLimiter } from './rate-limit.ts'

/**
 * POST /api/internal/live-events (E1). The checks, in order:
 *   1. came through the public Cloudflare tunnel → 404 (the route is Tailscale / Docker network only)
 *   2. server secrets unset or short → 503 (refuses everyone)
 *   3. rate limit (60 a minute) → 429 + Retry-After
 *   4. not `application/json` → 415; declared or real body over 4 KB → 413
 *   5. bearer token, timestamp (2-minute window), HMAC of the raw body → 401 (one answer for all three)
 *   6. v1 validation → 400 with a short reason (the sender is authenticated by then)
 *   7. stored once per id → 202 `{ ok, id, duplicate }`; a resend answers 202 with `duplicate: true`
 * Logs never hold the token, the HMAC, the headers or the body: only the outcome, the type and the id.
 */

export const MAX_BODY_BYTES = 4096
export const RATE_PER_MINUTE = 60

/** Hosts of the public site. A request naming one came through the tunnel. */
export const DEFAULT_PUBLIC_HOSTS = ['boogeymen.app']

/** Headers Cloudflare adds to every request it forwards (the tunnel included). */
const CLOUDFLARE_HEADERS = ['cf-connecting-ip', 'cf-ray', 'cf-ipcountry', 'cf-visitor', 'cdn-loop']

export interface StoredEvent {
  id: string
  type: LiveEventType
  source: LiveEventSource
  at: Date
  payload: Record<string, unknown>
}

export interface LiveEventsDeps {
  token: string | undefined
  hmacKey: string | undefined
  /** Extra public host names (a domain and its subdomains); the defaults are always included. */
  publicHosts?: readonly string[]
  limiter: RateLimiter
  store: (event: StoredEvent) => Promise<{ inserted: boolean }>
  now?: () => number
  log?: (line: string) => void
}

const json = (
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  })

const hostName = (value: string | null): string | null => {
  if (value === null) return null
  const first = value.split(',')[0]?.trim().toLowerCase() ?? ''
  // Strip a port; an IPv6 literal keeps its brackets.
  return first.replace(/:\d+$/, '')
}

/**
 * True when the request came through the public Cloudflare tunnel (or names the public site):
 * a Cloudflare header, or the public host in `Host`, `X-Forwarded-Host` or the request URL.
 */
export function cameThroughPublicTunnel(
  headers: Headers,
  publicHosts: readonly string[] = [],
  url?: string,
): boolean {
  if (CLOUDFLARE_HEADERS.some((h) => headers.has(h))) return true
  const hosts = [...DEFAULT_PUBLIC_HOSTS, ...publicHosts].map((h) => h.toLowerCase())
  const names = [hostName(headers.get('host')), hostName(headers.get('x-forwarded-host'))]
  if (url !== undefined) {
    try {
      names.push(new URL(url).hostname.toLowerCase())
    } catch {
      // A relative or broken URL names no host.
    }
  }
  return names.some(
    (name) => name !== null && hosts.some((h) => name === h || name.endsWith(`.${h}`)),
  )
}

/** Reads at most `limit` bytes of the body. Null when it is longer (the stream is cancelled). */
async function readBodyCapped(request: Request, limit: number): Promise<Uint8Array | null> {
  if (request.body === null) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export async function handleLiveEventRequest(
  request: Request,
  deps: LiveEventsDeps,
): Promise<Response> {
  const now = deps.now ?? Date.now
  const log = deps.log ?? ((line: string) => console.log(line))
  const refuse = (
    status: number,
    reason: string,
    error: string,
    headers?: Record<string, string>,
  ) => {
    log(`[live-events] refused ${String(status)} ${reason}`)
    return json(status, { ok: false, error }, headers)
  }

  // 1. Never through the public tunnel: answer as if the route did not exist.
  if (cameThroughPublicTunnel(request.headers, deps.publicHosts, request.url)) {
    log('[live-events] refused 404 public-tunnel')
    return new Response('Not Found', { status: 404 })
  }

  // 2. Unset or short secrets refuse everyone.
  const token = deps.token
  const hmacKey = deps.hmacKey
  if (!secretsConfigured(token, hmacKey) || token === undefined || hmacKey === undefined) {
    return refuse(503, 'not-configured', 'live events are not configured')
  }

  // 3. Rate limit (before any work on the body).
  const slot = deps.limiter.take()
  if (!slot.ok) {
    return json(
      429,
      { ok: false, error: 'rate limited' },
      { 'retry-after': String(slot.retryAfterS) },
    )
  }

  // 4. JSON only, at most 4 KB (the declared length first, then the real one).
  const contentType = request.headers.get('content-type') ?? ''
  if (!/^application\/json(\s*;.*)?$/i.test(contentType)) {
    return refuse(415, 'content-type', 'content-type must be application/json')
  }
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    return refuse(413, 'too-large', `body over ${String(MAX_BODY_BYTES)} bytes`)
  }

  // 5. Bearer token and timestamp before the body is read; then the HMAC of the raw body.
  if (!isBearerValid(request.headers.get('authorization'), token)) {
    return refuse(401, 'token', 'unauthorized')
  }
  const timestamp = checkTimestamp(request.headers.get(TIMESTAMP_HEADER), now())
  if (timestamp === null) return refuse(401, 'timestamp', 'unauthorized')

  const bytes = await readBodyCapped(request, MAX_BODY_BYTES)
  if (bytes === null) return refuse(413, 'too-large', `body over ${String(MAX_BODY_BYTES)} bytes`)
  let rawBody: string
  try {
    rawBody = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return refuse(400, 'utf8', 'body is not UTF-8')
  }
  if (!isSignatureValid(request.headers.get(SIGNATURE_HEADER), timestamp, rawBody, hmacKey)) {
    return refuse(401, 'signature', 'unauthorized')
  }

  // 6. v1 shape.
  const parsed = parseLiveEvent(rawBody)
  if (!parsed.ok) return refuse(400, 'invalid', parsed.error)
  const { event, at } = parsed

  // 7. Store once per id.
  try {
    const { inserted } = await deps.store({
      id: event.id,
      type: event.type,
      source: event.source,
      at,
      payload: event,
    })
    log(`[live-events] ${inserted ? 'stored' : 'duplicate'} ${event.type} ${event.id}`)
    return json(202, { ok: true, id: event.id, duplicate: !inserted })
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 200) : 'unknown error'
    log(`[live-events] store failed ${event.type} ${event.id}: ${message}`)
    return json(503, { ok: false, error: 'store unavailable, retry later' })
  }
}
