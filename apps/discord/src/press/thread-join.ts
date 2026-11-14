import type { ReporterId } from '@eanhl/db/news'
import type { PressDiscordOps } from './pass.ts'

/**
 * Wade Barlow in the press threads (T4, "typed answers did not work live").
 * Barlow's client is the only one with the message intents, but the reporter
 * who asks starts the thread. Barlow joins every press thread: right after a
 * reporter starts it (`withBarlowJoin`), and at start-up every active thread
 * under the press channel (`joinOpenThreads`). A join is idempotent (204 when
 * already a member). A failed join is logged and never stops the thread, the
 * question or the start-up.
 *
 * Discord docs (threads.mdx): an app gets thread events for public threads it
 * can see without joining, but discord.js drops a message whose thread is not
 * in its channel cache. A member always gets the thread (THREAD_CREATE on the
 * join, and in GUILD_CREATE after a restart). The message router also reads
 * the raw gateway event (gateway.ts `attachMessages`), so it never depends on
 * that cache.
 */

const API = 'https://discord.com/api/v10'

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Errors name the HTTP status or error kind only, never the token. */
async function call(
  token: string,
  method: 'GET' | 'PUT',
  path: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  try {
    return await fetchImpl(`${API}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err: unknown) {
    throw new Error(`Discord bot request failed (${err instanceof Error ? err.name : 'Error'})`)
  }
}

/** The bot joins one thread (PUT `/channels/{thread}/thread-members/@me`). */
export async function joinThread(
  token: string,
  threadId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await call(
    token,
    'PUT',
    `/channels/${encodeURIComponent(threadId)}/thread-members/@me`,
    fetchImpl,
  )
  if (!res.ok) throw new Error(`Discord bot HTTP ${String(res.status)}`)
}

/** The active threads of the guild whose parent is `channelId`. */
export async function listActiveThreads(
  token: string,
  guildId: string,
  channelId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const res = await call(
    token,
    'GET',
    `/guilds/${encodeURIComponent(guildId)}/threads/active`,
    fetchImpl,
  )
  if (!res.ok) throw new Error(`Discord bot HTTP ${String(res.status)}`)
  const json = (await res.json().catch(() => null)) as {
    threads?: { id?: unknown; parent_id?: unknown }[]
  } | null
  return (json?.threads ?? [])
    .filter((t) => t.parent_id === channelId && typeof t.id === 'string')
    .map((t) => t.id as string)
}

/**
 * At start-up: Barlow joins every active thread under the press channel (the
 * scrum and interview threads of tonight). Never throws; one log line.
 */
export async function joinOpenThreads(args: {
  token: string
  guildId: string
  channelId: string
  log: (m: string) => void
  fetchImpl?: typeof fetch
}): Promise<number> {
  const { token, guildId, channelId, log, fetchImpl = fetch } = args
  let ids: string[]
  try {
    ids = await listActiveThreads(token, guildId, channelId, fetchImpl)
  } catch (err: unknown) {
    log(`[press] thread join: open threads not listed (${reason(err)})`)
    return 0
  }
  let joined = 0
  for (const id of ids) {
    try {
      await joinThread(token, id, fetchImpl)
      joined++
    } catch (err: unknown) {
      log(`[press] thread join: thread ${id}: failed (${reason(err)})`)
    }
  }
  log(`[press] thread join: Barlow is in ${String(joined)} of ${String(ids.length)} open threads`)
  return joined
}

/**
 * The Discord ops with Barlow joining each thread a reporter starts. Barlow's
 * own thread needs no join (the starter is a member). A failed join is logged;
 * the thread id is still returned.
 */
export function withBarlowJoin(
  ops: PressDiscordOps,
  join: (threadId: string) => Promise<void>,
  log: (m: string) => void,
): PressDiscordOps {
  return {
    ...ops,
    thread: async (r: ReporterId, channelId: string, messageId: string, name: string) => {
      const threadId = await ops.thread(r, channelId, messageId, name)
      if (r !== 'barlow') {
        try {
          await join(threadId)
        } catch (err: unknown) {
          log(`[press] thread join: thread ${threadId}: failed (${reason(err)})`)
        }
      }
      return threadId
    },
  }
}
