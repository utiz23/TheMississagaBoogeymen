import { WebhookOutcomeUnknownError } from './webhook.ts'

const API = 'https://discord.com/api/v10'

export interface BotMessage {
  content: string
  allowed_mentions: { parse: never[]; users?: string[] }
  components?: unknown[]
  message_reference?: { message_id: string; fail_if_not_exists: false }
}

/** Failures that happen before anything is sent: safe to retry. */
const NEVER_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])

/**
 * One bot REST call. Errors name the HTTP status or error kind only: the bot
 * token must never reach a log line or a stored error. `createsMessage` marks
 * a call that posts something new: if it fails after the request left, the
 * message may exist, so the error is WebhookOutcomeUnknownError and the
 * caller must not retry. Any other call (edit, delete, thread, DM channel)
 * is safe to retry, so a network failure is a plain Error.
 */
async function call(
  token: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  createsMessage: boolean,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bot ${token}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetchImpl(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : 'Error'
    const cause = err instanceof Error ? (err.cause as { code?: unknown } | undefined) : undefined
    const code = typeof cause?.code === 'string' ? cause.code : null
    if (code !== null && NEVER_SENT.has(code)) {
      throw new Error(`Discord bot request failed before sending (${code})`)
    }
    if (createsMessage) {
      throw new WebhookOutcomeUnknownError(`Discord bot request outcome unknown (${name})`)
    }
    throw new Error(`Discord bot request failed (${name})`)
  }
  return res
}

async function idOf(res: Response, what: string): Promise<string> {
  const json = (await res.json().catch(() => null)) as { id?: unknown } | null
  if (typeof json?.id !== 'string') throw new Error(`Discord bot response had no ${what} id`)
  return json.id
}

function assertOk(res: Response): void {
  if (!res.ok) throw new Error(`Discord bot HTTP ${String(res.status)}`)
}

/** Post one message as the bot and return its id. */
export async function sendBotMessage(
  token: string,
  channelId: string,
  msg: BotMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await call(
    token,
    'POST',
    `/channels/${encodeURIComponent(channelId)}/messages`,
    msg,
    true,
    fetchImpl,
  )
  assertOk(res)
  return idOf(res, 'message')
}

/** Edit one bot message in place. Safe to retry. */
export async function editBotMessage(
  token: string,
  channelId: string,
  messageId: string,
  msg: Partial<BotMessage>,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await call(
    token,
    'PATCH',
    `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
    msg,
    false,
    fetchImpl,
  )
  assertOk(res)
}

/** Delete one bot message. 204, or 404 (already gone), means done. */
export async function deleteBotMessage(
  token: string,
  channelId: string,
  messageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await call(
    token,
    'DELETE',
    `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
    undefined,
    false,
    fetchImpl,
  )
  if (res.status === 404) return
  assertOk(res)
}

/** Start a thread on a message and return the thread (channel) id. */
export async function startThread(
  token: string,
  channelId: string,
  messageId: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await call(
    token,
    'POST',
    `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/threads`,
    { name: name.slice(0, 100) },
    false,
    fetchImpl,
  )
  assertOk(res)
  return idOf(res, 'thread')
}

/**
 * Send a DM: open (or reuse) the DM channel, then post to it. Opening the
 * channel is safe to retry; the post is a send, so the same unknown-outcome
 * rule applies. A user with DMs closed gives HTTP 403.
 */
export async function sendDirectMessage(
  token: string,
  userId: string,
  content: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const opened = await call(
    token,
    'POST',
    '/users/@me/channels',
    { recipient_id: userId },
    false,
    fetchImpl,
  )
  assertOk(opened)
  const dmChannelId = await idOf(opened, 'DM channel')
  await sendBotMessage(token, dmChannelId, { content, allowed_mentions: { parse: [] } }, fetchImpl)
}

/** Action-row-ready primary button. Callers wrap it in `{type: 1, components: [...]}`. */
function primaryButton(label: string, customId: string): unknown {
  return { type: 2, style: 1, label, custom_id: customId }
}

export function talkButton(itemId: number): unknown {
  return primaryButton('Talk to the press', `press:talk:${String(itemId)}`)
}

export function acceptButton(personId: number): unknown {
  return primaryButton('Accept', `press:accept:${String(personId)}`)
}

export function answerButton(personId: number): unknown {
  return primaryButton('Answer', `press:answer:${String(personId)}`)
}
