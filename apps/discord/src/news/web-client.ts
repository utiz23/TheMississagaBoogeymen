import { parseNewsFactsResponse, type NewsFactsResponse } from '@eanhl/db/news'
import { INTERNAL_TOKEN_HEADER } from '../web-client.ts'

/**
 * One news fact sheet from the web app: `/internal/news/game/<matchId>`,
 * `/night/<YYYY-MM-DD>` or `/week/<monday YYYY-MM-DD>`. Any HTTP error
 * (404 = unknown or no counted game) throws; the cycle retries next pass.
 * The error names the status only, never the token.
 */
export async function fetchNewsFacts(
  opts: { webBaseUrl: string; token: string; kind: 'game' | 'night' | 'week'; key: string },
  fetchImpl: typeof fetch = fetch,
): Promise<NewsFactsResponse> {
  const res = await fetchImpl(
    `${opts.webBaseUrl}/internal/news/${opts.kind}/${encodeURIComponent(opts.key)}`,
    { headers: { [INTERNAL_TOKEN_HEADER]: opts.token }, signal: AbortSignal.timeout(30_000) },
  )
  if (!res.ok) throw new Error(`news ${opts.kind} facts HTTP ${String(res.status)}`)
  return parseNewsFactsResponse(await res.json())
}
