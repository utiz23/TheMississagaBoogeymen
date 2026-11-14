/**
 * A token bucket for the live events endpoint (E1): at most `perMinute` requests a minute,
 * refilled evenly, with bursts up to `perMinute`. One bucket per web process (the site runs
 * one `web` container), shared by every caller: the endpoint has one sender.
 */
export class RateLimiter {
  private readonly perMinute: number
  private readonly now: () => number
  private tokens: number
  private last: number

  constructor(perMinute: number, now: () => number = Date.now) {
    this.perMinute = perMinute
    this.now = now
    this.tokens = perMinute
    this.last = now()
  }

  /** Takes one token. When none is left, says how many seconds until the next one. */
  take(): { ok: true } | { ok: false; retryAfterS: number } {
    const t = this.now()
    const refill = ((t - this.last) / 60_000) * this.perMinute
    this.tokens = Math.min(this.perMinute, this.tokens + Math.max(0, refill))
    this.last = t
    if (this.tokens >= 1) {
      this.tokens -= 1
      return { ok: true }
    }
    const missing = 1 - this.tokens
    return { ok: false, retryAfterS: Math.max(1, Math.ceil((missing * 60) / this.perMinute)) }
  }
}
