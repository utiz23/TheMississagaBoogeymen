import type { ReporterId } from '@eanhl/db/news'
import type { FeudRow } from '@eanhl/db/queries'
import type { PressStore } from './pass.ts'

/**
 * The database side of the feuds (T5, migration 0076). Not part of
 * `PressStore` on purpose (the same pattern as `InterviewStore` and
 * `ReplyStore`): the methods ride on `pressDbStore` and are found by
 * `feudStoreOf`. A store without them (an old fake in a test, or a host that
 * has not got the migration) has no feud effects: nothing is added and every
 * level reads "none".
 */
export interface FeudStore {
  addFeudPoints(args: {
    playerId: number
    reporter: ReporterId
    points: number
    at: Date
  }): Promise<void>
  listFeuds(args: { now: Date; playerIds?: readonly number[] | null }): Promise<FeudRow[]>
  /** A scrum or interview thread (a message in any other thread is not the press's business). */
  isPressThread(threadId: string): Promise<boolean>
}

const METHODS: readonly (keyof FeudStore)[] = ['addFeudPoints', 'listFeuds', 'isPressThread']

/** The press store as a feud store, or null when it has no feud methods. */
export function feudStoreOf(store: PressStore): (PressStore & FeudStore) | null {
  const s = store as PressStore & Partial<Record<keyof FeudStore, unknown>>
  return METHODS.every((m) => typeof s[m] === 'function') ? (store as PressStore & FeudStore) : null
}
