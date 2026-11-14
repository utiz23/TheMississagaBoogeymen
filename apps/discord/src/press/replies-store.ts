import type { NewNewsWireReply } from '@eanhl/db/queries'
import type { PressStore } from './pass.ts'

/**
 * The database side of the wire-post replies (T4, item 3). Not part of
 * `PressStore` on purpose (the same pattern as `InterviewStore`): the methods
 * ride on `pressDbStore` (store.ts spreads `repliesDbStore`) and are found by
 * `replyStoreOf`. A store without them (an old fake in a test) gets no wire
 * answers: that path then does nothing (fail closed).
 */
export interface ReplyStore {
  /** The claim's id; null when this person already had an answer on this post. */
  claimWireReply(values: NewNewsWireReply): Promise<number | null>
  finishWireReply(
    id: number,
    outcome:
      | { status: 'answered'; answer: string; answerMessageId: string }
      | { status: 'failed'; answer?: string | null },
  ): Promise<void>
  /** Answers given or being written on this night. */
  countWireRepliesTonight(night: string): Promise<number>
}

const METHODS: readonly (keyof ReplyStore)[] = [
  'claimWireReply',
  'finishWireReply',
  'countWireRepliesTonight',
]

/** The press store as a reply store, or null when it has no reply methods. */
export function replyStoreOf(store: PressStore): (PressStore & ReplyStore) | null {
  const s = store as PressStore & Partial<Record<keyof ReplyStore, unknown>>
  return METHODS.every((m) => typeof s[m] === 'function')
    ? (store as PressStore & ReplyStore)
    : null
}
