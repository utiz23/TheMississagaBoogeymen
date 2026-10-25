import { parseNewsFactsResponse, type NewsFactsResponse } from '@eanhl/db/news'
import { INTERNAL_TOKEN_HEADER } from '../web-client.ts'

/**
 * How long to wait for a sheet (C2 fix A): a week sheet loads 20-30 games and
 * their history, so it gets 60 s; game and night sheets 30 s.
 */
export function factsTimeoutMs(kind: 'game' | 'night' | 'week'): number {
  return kind === 'week' ? 60_000 : 30_000
}

/**
 * One news fact sheet from the web app: `/internal/news/game/<matchId>`,
 * `/night/<YYYY-MM-DD>` or `/week/<monday YYYY-MM-DD>`. Any HTTP error
 * (404 = unknown or no counted game) throws; the cycle retries next pass.
 * The error names the status only, never the token. `includeInactive` (the
 * backfill only) also loads games of a title that is not active.
 */
export async function fetchNewsFacts(
  opts: {
    webBaseUrl: string
    token: string
    kind: 'game' | 'night' | 'week'
    key: string
    includeInactive?: boolean
  },
  fetchImpl: typeof fetch = fetch,
): Promise<NewsFactsResponse> {
  const query = opts.includeInactive === true ? '?includeInactive=1' : ''
  const res = await fetchImpl(
    `${opts.webBaseUrl}/internal/news/${opts.kind}/${encodeURIComponent(opts.key)}${query}`,
    {
      headers: { [INTERNAL_TOKEN_HEADER]: opts.token },
      signal: AbortSignal.timeout(factsTimeoutMs(opts.kind)),
    },
  )
  if (!res.ok) throw new Error(`news ${opts.kind} facts HTTP ${String(res.status)}`)
  return parseNewsFactsResponse(await res.json())
}
