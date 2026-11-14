import type { NewNewsWireReply } from '@eanhl/db/queries'
import type { FakeStore } from './test-fakes.ts'
import type { ReplyStore } from './replies-store.ts'

/** A stored wire answer in the fake: the claim plus its outcome. */
export type WireRow = NewNewsWireReply & {
  id: number
  status: 'claimed' | 'answered' | 'failed'
  answer: string | null
  answerMessageId: string | null
}

/**
 * Adds the reply-store methods to a press fake store (the same claim rules as
 * the SQL: one row per post and person; only a claimed row is finished).
 * Returns the stored rows.
 */
export function withReplyStore(store: FakeStore): WireRow[] {
  const rows: WireRow[] = []
  const methods: ReplyStore = {
    claimWireReply: (v) => {
      if (rows.some((r) => r.itemId === v.itemId && r.discordUserId === v.discordUserId)) {
        return Promise.resolve(null)
      }
      const id = rows.length + 1
      rows.push({ ...v, id, status: 'claimed', answer: null, answerMessageId: null })
      return Promise.resolve(id)
    },
    finishWireReply: (id, outcome) => {
      const r = rows.find((x) => x.id === id)
      if (r !== undefined && r.status === 'claimed') {
        r.status = outcome.status
        r.answer = outcome.answer ?? null
        if (outcome.status === 'answered') r.answerMessageId = outcome.answerMessageId
      }
      return Promise.resolve()
    },
    countWireRepliesTonight: (night) =>
      Promise.resolve(
        rows.filter((r) => r.night === night && (r.status === 'claimed' || r.status === 'answered'))
          .length,
      ),
  }
  Object.assign(store, methods)
  return rows
}
