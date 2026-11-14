import { claimWireReply, countWireRepliesTonight, finishWireReply } from '@eanhl/db/queries'
import type { ReplyStore } from './replies-store.ts'

/** The reply store on the database (the `@eanhl/db` queries); spread into `pressDbStore`. */
export const repliesDbStore: ReplyStore = {
  claimWireReply,
  finishWireReply,
  countWireRepliesTonight,
}
