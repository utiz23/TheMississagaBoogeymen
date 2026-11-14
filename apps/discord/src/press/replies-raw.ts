import type { MessageInput } from './gateway.ts'
import type { ReferencedMessage } from './replies.ts'

/**
 * One raw gateway MESSAGE_CREATE (the API message object) as router input
 * (T4). Reading the raw event means a message is never lost because its
 * thread is not in discord.js's channel cache. Null when it is not a usable
 * message (no id, no channel, no author).
 */

/** Discord message types: 0 = default, 19 = reply. */
const DEFAULT = 0
const REPLY = 19
/** Thread channel types: announcement, public, private. */
const THREAD_TYPES = new Set([10, 11, 12])

type Raw = Record<string, unknown>

const obj = (v: unknown): Raw | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Raw) : null
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** The custom ids of a message's buttons (action rows of components). */
function customIdsOf(components: unknown): string[] {
  const out: string[] = []
  if (!Array.isArray(components)) return out
  for (const row of components) {
    const r = obj(row)
    const inner = r?.['components']
    if (!Array.isArray(inner)) continue
    for (const c of inner) {
      const id = str(obj(c)?.['custom_id'])
      if (id !== null) out.push(id)
    }
  }
  return out
}

/** The Reply's target: read from `referenced_message`, or unknown (deleted, not sent). */
function referenceOf(d: Raw): ReferencedMessage | null {
  if (d['type'] !== REPLY) return null
  const messageId = str(obj(d['message_reference'])?.['message_id'])
  if (messageId === null) return null
  const ref = obj(d['referenced_message'])
  if (ref === null) return { messageId, authorId: null, content: null, customIds: [] }
  return {
    messageId,
    authorId: str(obj(ref['author'])?.['id']),
    content: str(ref['content']),
    customIds: customIdsOf(ref['components']),
  }
}

/**
 * `isThread(channelId)`: true / false from the client's cache, null when the
 * channel is not cached. Then the raw `channel_type` decides when present,
 * else the message counts as a thread message (the thread lookup in the
 * database decides; an uncached channel is almost always a new thread).
 */
export function messageFromRaw(
  data: unknown,
  isThread: (channelId: string) => boolean | null,
): MessageInput | null {
  const d = obj(data)
  if (d === null) return null
  const id = str(d['id'])
  const channelId = str(d['channel_id'])
  const author = obj(d['author'])
  const userId = str(author?.['id'])
  if (id === null || channelId === null || userId === null) return null
  const type = d['type']
  const cached = isThread(channelId)
  const channelType = d['channel_type']
  const inThread =
    cached ?? (typeof channelType === 'number' ? THREAD_TYPES.has(channelType) : true)
  return {
    channelId,
    guildId: str(d['guild_id']),
    userId,
    userIsBot: author?.['bot'] === true || str(d['webhook_id']) !== null,
    isPlain: type === DEFAULT || type === REPLY,
    inThread,
    text: str(d['content']) ?? '',
    messageId: id,
    reference: referenceOf(d),
  }
}
