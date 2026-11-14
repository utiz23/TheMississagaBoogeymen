import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Live events auth (E1). Every request carries three headers:
 *   Authorization: Bearer <LIVE_EVENTS_TOKEN>
 *   X-Live-Events-Timestamp: <unix time in whole seconds>
 *   X-Live-Events-Signature: sha256=<hex HMAC-SHA256 with LIVE_EVENTS_HMAC_KEY of "<timestamp>.<raw body>">
 * The timestamp must be within 2 minutes of the server clock (replay window). Every compare is
 * constant time. Nothing here logs or returns a secret.
 */

export const TIMESTAMP_HEADER = 'x-live-events-timestamp'
export const SIGNATURE_HEADER = 'x-live-events-signature'
export const REPLAY_WINDOW_S = 120
/** Shorter server secrets are treated as unset: the endpoint refuses everyone. */
export const MIN_SECRET_LENGTH = 32

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest()

/** True when both server secrets are set and long enough. */
export function secretsConfigured(token: string | undefined, hmacKey: string | undefined): boolean {
  return (
    token !== undefined &&
    token.length >= MIN_SECRET_LENGTH &&
    hmacKey !== undefined &&
    hmacKey.length >= MIN_SECRET_LENGTH
  )
}

/**
 * Checks `Authorization: Bearer <token>`. Both sides are hashed first, so the compare is
 * constant time and does not show the token's length.
 */
export function isBearerValid(authorization: string | null, expected: string): boolean {
  if (authorization === null) return false
  const match = /^Bearer ([^\s]+)$/.exec(authorization)
  if (!match?.[1]) return false
  return timingSafeEqual(sha256(match[1]), sha256(expected))
}

/** Parses the timestamp header and checks the replay window. Null when bad or too old/new. */
export function checkTimestamp(header: string | null, nowMs: number): number | null {
  if (header === null || !/^\d{1,12}$/.test(header)) return null
  const ts = Number(header)
  if (Math.abs(nowMs / 1000 - ts) > REPLAY_WINDOW_S) return null
  return ts
}

/** The hex HMAC a sender puts after `sha256=`. */
export function signLiveEvent(
  rawBody: string,
  timestamp: number | string,
  hmacKey: string,
): string {
  return createHmac('sha256', hmacKey)
    .update(`${String(timestamp)}.${rawBody}`, 'utf8')
    .digest('hex')
}

/** Checks `sha256=<64 hex>` against the HMAC of "<timestamp>.<raw body>", constant time. */
export function isSignatureValid(
  header: string | null,
  timestamp: number,
  rawBody: string,
  hmacKey: string,
): boolean {
  if (header === null) return false
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header)
  if (!match?.[1]) return false
  const provided = Buffer.from(match[1].toLowerCase(), 'hex')
  const expected = Buffer.from(signLiveEvent(rawBody, timestamp, hmacKey), 'hex')
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}
