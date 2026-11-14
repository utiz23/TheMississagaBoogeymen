/**
 * EA Pro Clubs API HTTP client.
 *
 * Handles:
 *   - Required spoofed headers (EA API rejects requests without them)
 *   - Per-endpoint exponential backoff with jitter on 429/5xx
 *   - Configurable inter-request delay (throttle)
 *   - A per-request time limit (default 30 s, EA_REQUEST_TIMEOUT_MS), combined with any caller signal
 */

const EA_API_BASE = 'https://proclubs.ea.com/api/nhl'

/**
 * Headers required by the EA API.
 * Without these the API returns 403 or empty responses.
 */
const EA_REQUIRED_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json',
  Referer: 'https://www.ea.com/',
}

// ─── Retry config ─────────────────────────────────────────────────────────────

const MAX_RETRIES = 3
/** Retryable HTTP status codes. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

/**
 * Compute delay for attempt N using exponential backoff with full jitter.
 * Formula: random(0, 2^attempt * BASE_DELAY_MS)
 */
function backoffDelayMs(attempt: number): number {
  const baseMs = 500
  const cap = 2 ** attempt * baseMs
  return Math.random() * cap
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

export interface EaFetchOptions {
  /** The caller's own AbortSignal. Combined with the per-request time limit. */
  signal?: AbortSignal
  /** Per-request time limit in ms. Default: `getRequestTimeoutMs()` (30 s). */
  timeoutMs?: number
}

/** The per-request time limit when nothing is set. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/**
 * Per-request time limit in ms. Configurable via EA_REQUEST_TIMEOUT_MS; a missing, non-numeric or
 * non-positive value gives the default. The limit covers the headers and the body.
 */
export function getRequestTimeoutMs(): number {
  const parsed = parseInt(process.env.EA_REQUEST_TIMEOUT_MS ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REQUEST_TIMEOUT_MS
}

/** An EA request that did not finish within its time limit. Counts as a failed request. */
export class EaTimeoutError extends Error {
  constructor(
    public readonly url: string,
    public readonly timeoutMs: number,
  ) {
    super(`EA request timed out after ${String(timeoutMs)}ms: ${url}`)
    this.name = 'EaTimeoutError'
  }
}

export class EaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message: string,
  ) {
    super(message)
    this.name = 'EaApiError'
  }
}

/**
 * Fetches a URL from the EA API with retry/backoff.
 * Retries on RETRYABLE_STATUS codes up to MAX_RETRIES times.
 * Non-retryable errors (400, 401, 403, 404) are thrown immediately.
 * Every attempt has a time limit (headers and body). A timeout throws EaTimeoutError and is not
 * retried; the caller's own abort throws the AbortError as before.
 *
 * Returns the parsed JSON body on success.
 */
export async function eaFetch<T>(url: string, options?: EaFetchOptions): Promise<T> {
  let lastError: EaApiError | undefined

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = backoffDelayMs(attempt)
      await sleep(delay)
    }

    const timeoutMs = options?.timeoutMs ?? getRequestTimeoutMs()
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout

    let response: Response
    try {
      response = await fetch(url, { headers: EA_REQUIRED_HEADERS, signal })
    } catch (err) {
      throw mapFetchError(err, url, timeoutMs, options?.signal, timeout)
    }

    if (response.ok) {
      try {
        return (await response.json()) as T
      } catch (err) {
        // The body can hang or break after the headers arrived; the same time limit covers it.
        if (timeout.aborted || options?.signal?.aborted) {
          throw mapFetchError(err, url, timeoutMs, options?.signal, timeout)
        }
        throw err
      }
    }

    if (RETRYABLE_STATUS.has(response.status)) {
      lastError = new EaApiError(
        response.status,
        url,
        `EA API ${String(response.status)} (attempt ${String(attempt + 1)}/${String(MAX_RETRIES + 1)})`,
      )
      continue
    }

    // Non-retryable error
    throw new EaApiError(response.status, url, `EA API ${String(response.status)} for ${url}`)
  }

  throw lastError ?? new EaApiError(0, url, 'Max retries exceeded')
}

/**
 * Maps a failed fetch: the caller's own abort stays an AbortError (checked first), the time limit
 * becomes EaTimeoutError, anything else is a network error.
 */
function mapFetchError(
  err: unknown,
  url: string,
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
  timeout: AbortSignal,
): Error {
  if (callerSignal?.aborted) {
    return err instanceof Error && err.name === 'AbortError'
      ? err
      : new DOMException('The operation was aborted.', 'AbortError')
  }
  if (timeout.aborted) return new EaTimeoutError(url, timeoutMs)
  if (err instanceof Error && err.name === 'AbortError') return err
  return new Error(`Network error fetching ${url}: ${String(err)}`)
}

// ─── Throttle ─────────────────────────────────────────────────────────────────

/**
 * Inter-request delay in ms. Configurable via EA_REQUEST_DELAY_MS env var.
 * Applied between sequential EA API calls within a single ingestion cycle.
 */
export function getRequestDelayMs(): number {
  const raw = process.env.EA_REQUEST_DELAY_MS
  const parsed = raw !== undefined ? parseInt(raw, 10) : NaN
  return isNaN(parsed) ? 1000 : parsed
}

/**
 * Utility: sleep for the configured inter-request delay.
 * Call between each EA API request in the ingestion loop.
 */
export async function throttle(): Promise<void> {
  await sleep(getRequestDelayMs())
}

// ─── Base URL ─────────────────────────────────────────────────────────────────

/**
 * Returns the API base URL for a game title.
 * Falls back to the default EA base if none is configured.
 */
export function getApiBaseUrl(gameTitleApiBaseUrl?: string): string {
  return gameTitleApiBaseUrl ?? EA_API_BASE
}
