import {
  parseDiscordCardUpdates,
  parseDiscordGameResult,
  type DiscordCardUpdates,
  type DiscordGameResult,
} from '@eanhl/db/discord'

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

export async function fetchCardUpdates(
  opts: { webBaseUrl: string; token: string; batchEventId: number },
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordCardUpdates> {
  const res = await fetchImpl(
    `${opts.webBaseUrl}/internal/discord/card-updates/${String(opts.batchEventId)}/data`,
    { headers: { [INTERNAL_TOKEN_HEADER]: opts.token }, signal: AbortSignal.timeout(15_000) },
  )
  if (!res.ok) throw new Error(`card data HTTP ${String(res.status)}`)
  return parseDiscordCardUpdates(await res.json())
}
