/**
 * EA Pro Clubs API HTTP client.
 *
 * Handles:
 *   - Required spoofed headers (EA API rejects requests without them)
 *   - Per-endpoint exponential backoff with jitter on 429/5xx
 *   - Configurable inter-request delay (throttle)
 *   - Cycle-level timeout via AbortController
 */

const EA_API_BASE = 'https://proclubs.ea.com/api/nhl'

/**
 * Headers required by the EA API.
 * Without these the API returns 403 or empty responses.
 */
const EA_REQUIRED_HEADERS: HeadersInit = {
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
  /** AbortSignal from the cycle-level timeout controller. */
  signal?: AbortSignal
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

    let response: Response
    try {
      response = await fetch(url, {
        headers: EA_REQUIRED_HEADERS,
        signal: options?.signal,
      })
    } catch (err) {
      // Network error or abort — don't retry aborts
      if (err instanceof Error && err.name === 'AbortError') throw err
      throw new Error(`Network error fetching ${url}: ${String(err)}`)
    }

    if (response.ok) {
      return response.json() as Promise<T>
    }

    if (RETRYABLE_STATUS.has(response.status)) {
      lastError = new EaApiError(response.status, url, `EA API ${response.status} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`)
      continue
    }

    // Non-retryable error
    throw new EaApiError(response.status, url, `EA API ${response.status} for ${url}`)
  }

  throw lastError ?? new EaApiError(0, url, 'Max retries exceeded')
}

// ─── Throttle ─────────────────────────────────────────────────────────────────

/**
 * Inter-request delay in ms. Configurable via EA_REQUEST_DELAY_MS env var.
 * Applied between sequential EA API calls within a single ingestion cycle.
 */
export function getRequestDelayMs(): number {
  const raw = process.env['EA_REQUEST_DELAY_MS']
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
