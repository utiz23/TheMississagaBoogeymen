import {
  parseDiscordGameResult,
  parseDiscordUnlockResponse,
  type DiscordGameResult,
  type DiscordUnlock,
  type DiscordUnlockSkip,
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

/** One unlock's message data, or an explicit skip. Any HTTP error (incl. 404) is a retry. */
export async function fetchUnlock(
  opts: { webBaseUrl: string; token: string; eventId: number },
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordUnlock | DiscordUnlockSkip> {
  const res = await fetchImpl(
    `${opts.webBaseUrl}/internal/discord/unlock/${String(opts.eventId)}/data`,
    { headers: { [INTERNAL_TOKEN_HEADER]: opts.token }, signal: AbortSignal.timeout(15_000) },
  )
  if (!res.ok) throw new Error(`unlock data HTTP ${String(res.status)}`)
  return parseDiscordUnlockResponse(await res.json())
}
