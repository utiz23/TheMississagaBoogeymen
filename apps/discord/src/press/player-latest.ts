/**
 * A player's latest message in a press thread (T6): the reporter's next line
 * replies to it. Kept in memory per process (`deps`), bounded. It only feeds
 * the lines that no answer produces: the "no answer in 15 minutes" closing of
 * a scrum or an interview. A restart forgets it, and that line is then a plain
 * post instead of a reply. Never the text, only the message id.
 */

const MAX_KEPT = 200
const latest = new WeakMap<object, Map<string, string>>()

const keyOf = (threadId: string, userId: string): string => `${threadId}/${userId}`

/** Remember `messageId` as the latest message of `userId` in `threadId` (no id: nothing kept). */
export function rememberPlayerMessage(
  owner: object,
  threadId: string,
  userId: string,
  messageId: string | null | undefined,
): void {
  if (messageId === null || messageId === undefined || messageId === '') return
  let kept = latest.get(owner)
  if (kept === undefined) latest.set(owner, (kept = new Map()))
  const key = keyOf(threadId, userId)
  kept.delete(key)
  kept.set(key, messageId)
  if (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value as string)
}

/** The latest remembered message of `userId` in `threadId`, or null. */
export function latestPlayerMessage(
  owner: object,
  threadId: string,
  userId: string,
): string | null {
  return latest.get(owner)?.get(keyOf(threadId, userId)) ?? null
}
