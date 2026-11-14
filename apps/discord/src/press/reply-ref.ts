import type { BotMessage } from '../bot-rest.ts'

/**
 * A bot message as a Discord reply to `messageId` (T4, item 2: a reporter's
 * line replies to the player's answer). Unchanged when there is no id. A
 * deleted target does not fail the send (`fail_if_not_exists: false`).
 */
export function replyingTo(msg: BotMessage, messageId: string | null | undefined): BotMessage {
  if (messageId === null || messageId === undefined || messageId === '') return msg
  return { ...msg, message_reference: { message_id: messageId, fail_if_not_exists: false } }
}
