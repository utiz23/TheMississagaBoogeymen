import type { NewsGameFacts } from '@eanhl/db/news'
import type { PressRosterEntry } from '@eanhl/db/queries'
import type { PressConfig } from './config.ts'
import { CHEL_ROLE_ID } from './config.ts'
import type { PressDeps } from './pass.ts'

/**
 * T7, the bench: people who watched a game from the team's voice call (or the coach) and may talk
 * to the press, though they did not play. Who was in the call is read from the gateway's voice
 * states and kept IN MEMORY ONLY (`VoiceTracker`): never written to the database, never logged,
 * dropped after `BENCH_KEEP_MS`. Only a person who actually takes part in a scrum or interview
 * gets a row (with their role), like a player.
 *
 * A bench person for a game: in the same voice channel as the game's players around the game's
 * end, has the Chel role, did not play the game, is not a bot, and (a known player) is not on
 * "Leave me out". The coach (`PRESS_COACH_USER_IDS`) is named "Coach <nickname>"; the GM may name
 * the coach (or, when the call check is unavailable, any bench person) without the call check.
 */

export type BenchRole = 'bench' | 'coach'

export interface BenchPerson {
  userId: string
  /** The player row of a known player; null for a person with no player row. */
  playerId: number | null
  /** What the press calls them: a player's name, "Coach Mike", or a server nickname. */
  name: string
  role: BenchRole
  /** The person's press level (a known player's; everyone else is `full`). Never `out`. */
  pressLevel: 'full' | 'easy'
}

/** The call counts from this long before the game's end ... */
export const BENCH_WINDOW_BEFORE_MS = 20 * 60_000
/** ... to this long after it. */
export const BENCH_WINDOW_AFTER_MS = 30 * 60_000
/** The voice history is kept this long in memory (a scrum is open for an hour). */
export const BENCH_KEEP_MS = 12 * 3_600_000
/** A guild member lookup is reused this long (roles and nickname rarely change in a night). */
export const MEMBER_CACHE_MS = 5 * 60_000

/** One stay of one user in one voice channel. `since` null = already there when we began to look. */
interface Stay {
  userId: string
  channelId: string
  since: Date | null
  until: Date | null
}

/**
 * Who is, and was, in which voice channel of the guild. In memory only. The gateway feeds it
 * (`snapshot` from the guild's voice states at startup, `update` for each change). Never persisted.
 */
export class VoiceTracker {
  private stays: Stay[] = []
  private ready = false

  /** True once the guild's voice states are known (else every call check says "unavailable"). */
  available(): boolean {
    return this.ready
  }

  /**
   * The guild's whole voice state (GUILD_CREATE): the stays of people no longer in a channel
   * end at `at`; a person already in a channel (that we did not know) gets an open stay with an
   * unknown start.
   */
  snapshot(states: readonly { userId: string; channelId: string }[], at: Date): void {
    const now = new Map(states.map((s) => [s.userId, s.channelId]))
    for (const stay of this.stays) {
      if (stay.until === null && now.get(stay.userId) !== stay.channelId) stay.until = at
    }
    for (const [userId, channelId] of now) {
      if (!this.stays.some((s) => s.until === null && s.userId === userId)) {
        this.stays.push({ userId, channelId, since: null, until: null })
      }
    }
    this.ready = true
    this.prune(at)
  }

  /** One change: `channelId` null = the user left voice. */
  update(userId: string, channelId: string | null, at: Date): void {
    const open = this.stays.find((s) => s.until === null && s.userId === userId)
    if (open !== undefined && open.channelId === channelId) return
    if (open !== undefined) open.until = at
    if (channelId !== null) this.stays.push({ userId, channelId, since: at, until: null })
    this.prune(at)
  }

  /** Channel id → the users who were in it at some time in `[from, to]`. */
  channelsAround(from: Date, to: Date): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>()
    for (const s of this.stays) {
      const starts = s.since?.getTime() ?? -Infinity
      const ends = s.until?.getTime() ?? Infinity
      if (starts > to.getTime() || ends < from.getTime()) continue
      const users = out.get(s.channelId) ?? new Set<string>()
      users.add(s.userId)
      out.set(s.channelId, users)
    }
    return out
  }

  private prune(now: Date): void {
    const cutoff = now.getTime() - BENCH_KEEP_MS
    this.stays = this.stays.filter((s) => s.until === null || s.until.getTime() >= cutoff)
  }

  /** How many stays are held (a test only). */
  size(): number {
    return this.stays.length
  }
}

/** What the bench check needs to know about a guild member. */
export interface MemberInfo {
  nick: string | null
  globalName: string | null
  username: string
  roles: readonly string[]
  bot: boolean
}

/** The bench's outside world: the voice tracker and the guild member lookup. */
export interface BenchPort {
  available(): boolean
  channelsAround(from: Date, to: Date): Map<string, Set<string>>
  /** The member of the guild, or null when not found (or the lookup failed). */
  member(userId: string): Promise<MemberInfo | null>
}

/** A server name for a member: nickname, else display name, else username. */
export const memberName = (m: MemberInfo): string =>
  [m.nick, m.globalName, m.username].map((v) => v?.trim() ?? '').find((v) => v !== '') ?? 'Guest'

/** The guild member lookup over REST with a small cache (no privileged intent needed). */
export function memberDirectory(args: {
  fetchMember: (userId: string) => Promise<MemberInfo | null>
  now?: () => Date
}): (userId: string) => Promise<MemberInfo | null> {
  const now = args.now ?? (() => new Date())
  const cache = new Map<string, { at: number; value: MemberInfo | null }>()
  return async (userId) => {
    const hit = cache.get(userId)
    const t = now().getTime()
    if (hit !== undefined && t - hit.at < MEMBER_CACHE_MS) return hit.value
    let value: MemberInfo | null = null
    try {
      value = await args.fetchMember(userId)
    } catch {
      value = null
    }
    cache.set(userId, { at: t, value })
    return value
  }
}

/**
 * The bench port of this process: set once when the press clients start (`startClients`, which
 * attaches the voice events to Barlow's client), so the process entry point needs no change. A
 * `deps.bench` (a test) wins over it. Absent: the call check is unavailable.
 */
let processBench: BenchPort | undefined

export function setProcessBench(port: BenchPort | undefined): void {
  processBench = port
}

/** The bench port the handlers use: the deps' own, else the process's. */
export const benchPortOf = (deps: Pick<PressDeps, 'bench'>): BenchPort | undefined =>
  deps.bench ?? processBench

export function createBenchPort(
  tracker: VoiceTracker,
  member: (userId: string) => Promise<MemberInfo | null>,
): BenchPort {
  return {
    available: () => tracker.available(),
    channelsAround: (from, to) => tracker.channelsAround(from, to),
    member,
  }
}

// ── Resolving the bench of a game ──────────────────────────────────────────────

type BenchStore = Pick<PressDeps['store'], 'getPlayerForDiscordUser' | 'listPressRoster'>

export interface BenchGame {
  /** The Discord user ids of the game's players. */
  playerUserIds: ReadonlySet<string>
  /** The game's end. */
  endedAt: Date
}

/** The game's players' Discord ids and end time, from its sheet line. */
export async function benchGameOf(
  store: Pick<PressDeps['store'], 'getPlayerDiscordUserId'>,
  game: NewsGameFacts,
): Promise<BenchGame> {
  const ids = new Set<string>()
  for (const line of game.players) {
    const id = await store.getPlayerDiscordUserId(line.playerId)
    if (id !== null) ids.add(id)
  }
  return { playerUserIds: ids, endedAt: new Date(game.playedAt) }
}

const isCoach = (config: Pick<PressConfig, 'coachUserIds'>, userId: string): boolean =>
  (config.coachUserIds ?? []).includes(userId)

/** A person's name and press level; null when the person must not be asked (a "Leave me out" player). */
export async function describe(
  store: BenchStore,
  config: Pick<PressConfig, 'coachUserIds'>,
  roster: readonly PressRosterEntry[],
  userId: string,
  member: MemberInfo | null,
): Promise<BenchPerson | null> {
  const known = await store.getPlayerForDiscordUser(userId)
  const entry = known === null ? undefined : roster.find((r) => r.playerId === known.playerId)
  if (entry?.pressLevel === 'out') return null
  const pressLevel = entry?.pressLevel === 'easy' ? 'easy' : 'full'
  const base = known?.name ?? (member === null ? null : memberName(member))
  if (base === null) return null
  const coach = isCoach(config, userId)
  return {
    userId,
    playerId: known?.playerId ?? null,
    name: coach ? `Coach ${base}` : base,
    role: coach ? 'coach' : 'bench',
    pressLevel,
  }
}

export interface BenchResult {
  /** False when the call cannot be checked (no voice data): `people` is then empty. */
  available: boolean
  people: BenchPerson[]
}

/**
 * The bench of one game: everyone in the same voice channel as the game's players around the
 * game's end, who has the Chel role, did not play, is no bot, and is not on "Leave me out".
 * In-memory voice data only. The coach (if in the call) is named as the coach.
 */
export async function benchForGame(
  deps: Pick<PressDeps, 'bench'> & { store: BenchStore },
  config: Pick<PressConfig, 'coachUserIds' | 'benchRoleId'>,
  game: BenchGame,
): Promise<BenchResult> {
  const port = benchPortOf(deps)
  if (port === undefined || !port.available()) return { available: false, people: [] }
  const channels = port.channelsAround(
    new Date(game.endedAt.getTime() - BENCH_WINDOW_BEFORE_MS),
    new Date(game.endedAt.getTime() + BENCH_WINDOW_AFTER_MS),
  )
  const watchers = new Set<string>()
  for (const users of channels.values()) {
    if (![...users].some((u) => game.playerUserIds.has(u))) continue
    for (const u of users) if (!game.playerUserIds.has(u)) watchers.add(u)
  }
  const roster = watchers.size === 0 ? [] : await deps.store.listPressRoster()
  const role = config.benchRoleId ?? CHEL_ROLE_ID
  const people: BenchPerson[] = []
  for (const userId of [...watchers].sort()) {
    const member = await port.member(userId)
    if (member === null || member.bot || !member.roles.includes(role)) continue
    const person = await describe(deps.store, config, roster, userId, member)
    if (person !== null) people.push(person)
  }
  return { available: true, people }
}

/** The GM's private line on `/gm ask`, `/gm note` and `/gm interview`: who was in the call and did not play. */
export function callLine(result: BenchResult): string {
  if (!result.available) return 'Call check unavailable: no voice data yet.'
  if (result.people.length === 0) return 'In the call, not playing: nobody.'
  return `In the call, not playing: ${result.people.map((p) => p.name).join(', ')}`
}

export type NamedBench = { ok: true; person: BenchPerson } | { ok: false; why: string }

/**
 * A bench person the GM names (a Discord user id) for a game. The coach is always allowed. Anyone
 * else must have been on the bench (in the call), or, when the call check is unavailable, be a
 * known player or a member with the Chel role. Never someone who played the game.
 */
export async function nameBench(
  deps: Pick<PressDeps, 'bench'> & { store: BenchStore },
  config: Pick<PressConfig, 'coachUserIds' | 'benchRoleId'>,
  game: BenchGame,
  userId: string,
): Promise<NamedBench> {
  if (game.playerUserIds.has(userId)) return { ok: false, why: 'played that game' }
  const roster = await deps.store.listPressRoster()
  const port = benchPortOf(deps)
  const member = port === undefined ? null : await port.member(userId)
  if (member?.bot === true) return { ok: false, why: 'is a bot' }
  const coach = isCoach(config, userId)
  const person = await describe(deps.store, config, roster, userId, member)
  if (person === null) {
    // "Leave me out", or no name at all (not on the server, no player row).
    const known = await deps.store.getPlayerForDiscordUser(userId)
    return {
      ok: false,
      why: known === null ? 'cannot be found on the server' : 'is on Leave me out',
    }
  }
  if (coach) return { ok: true, person }
  const bench = await benchForGame(deps, config, game)
  if (bench.available) {
    const hit = bench.people.find((p) => p.userId === userId)
    return hit === undefined ? { ok: false, why: 'was not in the call' } : { ok: true, person: hit }
  }
  // The call cannot be checked: the GM's word counts for a known player or a member with the role.
  const role = config.benchRoleId ?? CHEL_ROLE_ID
  if (person.playerId !== null || member?.roles.includes(role) === true) {
    return { ok: true, person }
  }
  return { ok: false, why: 'cannot be found on the server' }
}

/**
 * The columns that name a bench person on a press row (`news_scrum_people`, `news_interviews`,
 * `news_gm_asks`): the role, and a display name for the coach and for a person with no player
 * row. A known player on the bench keeps their own name (no display name).
 */
export function personColumns(p: BenchPerson): {
  personRole: BenchRole
  displayName: string | null
} {
  return {
    personRole: p.role,
    displayName: p.role === 'coach' || p.playerId === null ? p.name : null,
  }
}
