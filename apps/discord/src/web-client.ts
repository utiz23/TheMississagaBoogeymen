import {
  parseDiscordGameResult,
  parseDiscordUnlock,
  type DiscordGameResult,
  type DiscordUnlock,
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

/** One unlock's message data. 404 = it doesn't count any more (the poster skips it). */
export async function fetchUnlock(
  opts: { webBaseUrl: string; token: string; eventId: number },
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordUnlock> {
  const res = await fetchImpl(
    `${opts.webBaseUrl}/internal/discord/unlock/${String(opts.eventId)}/data`,
    { headers: { [INTERNAL_TOKEN_HEADER]: opts.token }, signal: AbortSignal.timeout(15_000) },
  )
  if (!res.ok) throw new Error(`unlock data HTTP ${String(res.status)}`)
  return parseDiscordUnlock(await res.json())
}
