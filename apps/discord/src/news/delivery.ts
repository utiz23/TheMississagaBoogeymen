import { deleteBotMessage, sendBotMessage } from '../bot-rest.ts'
import type { PressDiscord } from '../press/config.ts'
import { deleteWebhookMessage, sendWebhook, WebhookOutcomeUnknownError } from '../webhook.ts'
import type { NewsDeps } from './cycle.ts'
import { toBotMessage } from './messages.ts'

/**
 * The news desk's Discord side (`NewsDeps.send` / `remove`). `bots` null: the
 * webhook, exactly as before. `bots` set (PRESS_MODE=live): each post goes out
 * as its reporter's bot to the bots' channel; only a game recap gets the
 * "Talk to the press" button. A message is deleted the way it was sent. Errors
 * name the HTTP status or error kind only: never a token or the webhook URL.
 */
export function newsDelivery(args: {
  webhookUrl: string | null
  bots: PressDiscord | null
  log: (message: string) => void
  fetchImpl?: typeof fetch
}): Pick<NewsDeps, 'send' | 'remove'> {
  const { webhookUrl, bots, log, fetchImpl = fetch } = args
  const webhook = () => {
    if (webhookUrl === null) throw new Error('no news webhook configured')
    return webhookUrl
  }

  const send: NewsDeps['send'] =
    bots === null
      ? async (m) => ({
          messageId: await sendWebhook(webhook(), m.payload, null, fetchImpl),
          via: 'webhook',
          channelId: null,
        })
      : async (m) => {
          const msg = toBotMessage(m.payload, m.isGameRecap ? m.itemId : null)
          try {
            const token = bots.tokens[m.reporter]
            const messageId = await sendBotMessage(token, bots.channelId, msg, fetchImpl)
            return { messageId, via: 'bot', channelId: bots.channelId }
          } catch (err: unknown) {
            // Discord answered OK without an id: the message probably exists, never send it again.
            if (err instanceof Error && /no message id/.test(err.message)) {
              throw new WebhookOutcomeUnknownError(err.message)
            }
            throw err
          }
        }

  const remove: NewsDeps['remove'] = async (d) => {
    // A message whose way out is not configured cannot be deleted: it stays on Discord,
    // and resolving marks the item deleted so it is not tried again every pass.
    const tag = `news item ${String(d.id)}`
    if (d.via === 'bot') {
      if (bots === null || d.channelId === null) {
        log(`${tag}: bot message not deleted: bots not configured`)
        return
      }
      await deleteBotMessage(bots.tokens[d.reporter], d.channelId, d.messageId, fetchImpl)
      return
    }
    if (webhookUrl === null) {
      log(`${tag}: webhook message not deleted: no news webhook is set — it stays`)
      return
    }
    await deleteWebhookMessage(webhookUrl, d.messageId, fetchImpl)
  }

  return { send, remove }
}
