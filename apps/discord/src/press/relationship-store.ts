import type { ReporterId } from '@eanhl/db/news'
import type { RelationshipRow } from '@eanhl/db/queries'
import type { PressStore } from './pass.ts'

/**
 * The database side of the relationships (T5 feuds, T9 signed scale; migration 0078). Not part of
 * `PressStore` on purpose (the same pattern as `InterviewStore` and `ReplyStore`): the methods ride on
 * `pressDbStore` and are found by `relationshipStoreOf`. A store without them (an old fake in a test, or a
 * host that has not got the migration) has no relationship effects: nothing is added and every level
 * reads "neutral".
 */
export interface RelationshipStore {
  /** Signed points: negative = toward feud, positive = toward favour. */
  addRelationshipPoints(args: {
    playerId: number
    reporter: ReporterId
    points: number
    at: Date
  }): Promise<void>
  listRelationships(args: {
    now: Date
    playerIds?: readonly number[] | null
  }): Promise<RelationshipRow[]>
  /** A scrum or interview thread (a message in any other thread is not the press's business). */
  isPressThread(threadId: string): Promise<boolean>
}

const METHODS: readonly (keyof RelationshipStore)[] = [
  'addRelationshipPoints',
  'listRelationships',
  'isPressThread',
]

/** The press store as a relationship store, or null when it has no relationship methods. */
export function relationshipStoreOf(store: PressStore): (PressStore & RelationshipStore) | null {
  const s = store as PressStore & Partial<Record<keyof RelationshipStore, unknown>>
  return METHODS.every((m) => typeof s[m] === 'function')
    ? (store as PressStore & RelationshipStore)
    : null
}
