import type { Client } from 'discord.js'
import { Events } from 'discord.js'
import { VoiceTracker, type MemberInfo } from './bench.ts'

/**
 * T7: the gateway side of the bench. Barlow's client has the `GuildVoiceStates` intent (not
 * privileged: no portal switch). The voice state is read from the RAW events (like the typed
 * answers), so it never depends on the discord.js cache: GUILD_CREATE (the whole voice state of
 * the guild at start-up and after a reconnect) and VOICE_STATE_UPDATE (a join, a leave or a move).
 * Everything goes into the in-memory `VoiceTracker` only (bench.ts): nothing is stored or logged.
 * A guild member (roles, nickname, bot flag) is read over REST when needed (no GuildMembers
 * intent, which is privileged).
 */

export type VoiceRaw =
  | { kind: 'snapshot'; states: { userId: string; channelId: string }[] }
  | { kind: 'update'; userId: string; channelId: string | null }

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** A raw gateway packet as a voice event of `guildId`, or null (another event, another guild, bad shape). */
export function voiceFromRaw(
  packet: { t?: unknown; d?: unknown },
  guildId: string,
): VoiceRaw | null {
  const d = packet.d
  if (typeof d !== 'object' || d === null) return null
  const o = d as Record<string, unknown>
  if (packet.t === 'GUILD_CREATE') {
    if (o['id'] !== guildId || !Array.isArray(o['voice_states'])) return null
    const states: { userId: string; channelId: string }[] = []
    for (const v of o['voice_states'] as unknown[]) {
      if (typeof v !== 'object' || v === null) continue
      const s = v as Record<string, unknown>
      const userId = str(s['user_id'])
      const channelId = str(s['channel_id'])
      if (userId !== null && channelId !== null) states.push({ userId, channelId })
    }
    return { kind: 'snapshot', states }
  }
  if (packet.t === 'VOICE_STATE_UPDATE') {
    if (o['guild_id'] !== guildId) return null
    const userId = str(o['user_id'])
    if (userId === null) return null
    return { kind: 'update', userId, channelId: str(o['channel_id']) }
  }
  return null
}

/** What the guild's voice-state cache holds, as a snapshot (users in a channel only). */
export function snapshotOfCache(
  states: Iterable<{ id: string; channelId: string | null }>,
): { userId: string; channelId: string }[] {
  const out: { userId: string; channelId: string }[] = []
  for (const s of states)
    if (s.channelId !== null) out.push({ userId: s.id, channelId: s.channelId })
  return out
}

/**
 * Feed the tracker from the raw events of one client. The client may have received the guild's
 * GUILD_CREATE before this is attached (the login resolves late), so the guild's voice-state cache
 * seeds the tracker once as well (now when ready, else on ready).
 */
export function attachVoice(
  client: Client,
  tracker: VoiceTracker,
  guildId: string,
  now: () => Date = () => new Date(),
): void {
  client.on(Events.Raw, (packet: { t?: unknown; d?: unknown }) => {
    const ev = voiceFromRaw(packet, guildId)
    if (ev === null) return
    if (ev.kind === 'snapshot') tracker.snapshot(ev.states, now())
    else tracker.update(ev.userId, ev.channelId, now())
  })
  const seed = (): void => {
    const guild = client.guilds.cache.get(guildId)
    if (guild === undefined || tracker.available()) return
    tracker.snapshot(snapshotOfCache(guild.voiceStates.cache.values()), now())
  }
  if (client.isReady()) seed()
  else client.once(Events.ClientReady, seed)
}

const API = 'https://discord.com/api/v10'

/** A guild member over REST (`GET /guilds/{guild}/members/{user}`); null when not a member (404). */
export async function fetchGuildMember(
  token: string,
  guildId: string,
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MemberInfo | null> {
  let res: Response
  try {
    res = await fetchImpl(
      `${API}/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(15_000) },
    )
  } catch (err: unknown) {
    throw new Error(`Discord bot request failed (${err instanceof Error ? err.name : 'Error'})`)
  }
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Discord bot HTTP ${String(res.status)}`)
  const body = (await res.json()) as {
    nick?: string | null
    roles?: unknown
    user?: { username?: string; global_name?: string | null; bot?: boolean }
  }
  return {
    nick: body.nick ?? null,
    globalName: body.user?.global_name ?? null,
    username: body.user?.username ?? '',
    roles: Array.isArray(body.roles)
      ? body.roles.filter((r): r is string => typeof r === 'string')
      : [],
    bot: body.user?.bot === true,
  }
}
