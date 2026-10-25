import { CARDS_FILENAME, type MessagePayload, type WebhookPayload } from './message.ts'

/**
 * The request may have reached Discord (timeout, connection reset after the
 * upload): the message may exist. The caller must not retry it, or the
 * channel can get the same post twice.
 */
export class WebhookOutcomeUnknownError extends Error {
  override name = 'WebhookOutcomeUnknownError'
}

/** Failures that happen before anything is sent: safe to retry. */
const NEVER_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])

/**
 * POST one message to the webhook and return its id (`?wait=true`). Errors
 * name the HTTP status or error name only: the webhook URL is a secret and
 * must never reach a log line or discord_posts.last_error. An HTTP status or
 * a refused connection is a definite failure; anything else is
 * WebhookOutcomeUnknownError.
 */
export async function sendWebhook(
  webhookUrl: string,
  payload: WebhookPayload | MessagePayload,
  image: Uint8Array | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = new URL(webhookUrl)
  url.searchParams.set('wait', 'true')
  const form = new FormData()
  form.append('payload_json', JSON.stringify(payload))
  if (image !== null) {
    form.append(
      'files[0]',
      new Blob([new Uint8Array(image)], { type: 'image/png' }),
      payload.attachments?.[0]?.filename ?? CARDS_FILENAME,
    )
  }
  let res: Response
  try {
    res = await fetchImpl(url, { method: 'POST', body: form, signal: AbortSignal.timeout(15_000) })
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : 'Error'
    const cause = err instanceof Error ? (err.cause as { code?: unknown } | undefined) : undefined
    const code = typeof cause?.code === 'string' ? cause.code : null
    if (code !== null && NEVER_SENT.has(code)) {
      throw new Error(`Discord webhook request failed before sending (${code})`)
    }
    throw new WebhookOutcomeUnknownError(`Discord webhook request outcome unknown (${name})`)
  }
  if (!res.ok) throw new Error(`Discord webhook HTTP ${String(res.status)}`)
  const json = (await res.json().catch(() => null)) as { id?: unknown } | null
  return typeof json?.id === 'string' ? json.id : null
}

/**
 * Delete one message this webhook posted (`DELETE <url>/messages/<id>`).
 * 204, or 404 (already gone), means done. Any other status throws an error
 * that names the status only; a network error names the error kind only.
 * The webhook URL never reaches the message.
 */
export async function deleteWebhookMessage(
  webhookUrl: string,
  messageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = new URL(webhookUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/messages/${encodeURIComponent(messageId)}`
  let res: Response
  try {
    res = await fetchImpl(url, { method: 'DELETE', signal: AbortSignal.timeout(15_000) })
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : 'Error'
    throw new Error(`Discord webhook delete request failed (${name})`)
  }
  if (res.status === 204 || res.status === 404 || res.ok) return
  throw new Error(`Discord webhook delete HTTP ${String(res.status)}`)
}
