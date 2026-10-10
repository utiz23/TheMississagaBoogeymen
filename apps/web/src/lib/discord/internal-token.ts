import { timingSafeEqual } from 'node:crypto'

/** Header the discord service sends to the internal routes. */
export const INTERNAL_TOKEN_HEADER = 'x-internal-token'

/** Shorter server tokens are treated as unset: refuse everyone. */
const MIN_TOKEN_LENGTH = 16

/**
 * Whether a request may reach /internal/discord/*. The Cloudflare tunnel
 * exposes every web route, so this token is the only guard. Unset, empty or
 * short server tokens refuse every request.
 */
export function isInternalTokenValid(
  provided: string | null | undefined,
  expected: string | undefined,
): boolean {
  if (expected === undefined || expected.length < MIN_TOKEN_LENGTH) return false
  if (provided === null || provided === undefined || provided.length === 0) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
