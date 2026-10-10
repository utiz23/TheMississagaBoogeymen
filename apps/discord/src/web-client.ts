import { parseDiscordGameResult, type DiscordGameResult } from '@eanhl/db/discord'

export const INTERNAL_TOKEN_HEADER = 'x-internal-token'

export async function fetchGameResult(
  opts: { webBaseUrl: string; token: string; matchId: number },
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordGameResult> {
  const res = await fetchImpl(`${opts.webBaseUrl}/internal/discord/game/${String(opts.matchId)}`, {
    headers: { [INTERNAL_TOKEN_HEADER]: opts.token },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`game data HTTP ${String(res.status)}`)
  return parseDiscordGameResult(await res.json())
}
