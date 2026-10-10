import { CARDS_FILENAME, type WebhookPayload } from './message.ts'

/**
 * POST one message to the webhook and return its id (`?wait=true`). Errors
 * name the HTTP status only: the webhook URL is a secret and must never reach
 * a log line or discord_posts.last_error.
 */
export async function sendWebhook(
  webhookUrl: string,
  payload: WebhookPayload,
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
      CARDS_FILENAME,
    )
  }
  let res: Response
  try {
    res = await fetchImpl(url, { method: 'POST', body: form, signal: AbortSignal.timeout(15_000) })
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : 'Error'
    throw new Error(`Discord webhook request failed (${name})`)
  }
  if (!res.ok) throw new Error(`Discord webhook HTTP ${String(res.status)}`)
  const json = (await res.json().catch(() => null)) as { id?: unknown } | null
  return typeof json?.id === 'string' ? json.id : null
}
