import type { ReporterId } from '@eanhl/db/news'
import type { PressStore } from './pass.ts'

/**
 * The database side of `/gm testscrum` (T8). Not part of `PressStore` on purpose (the same pattern
 * as `InterviewStore`): the methods ride on `pressDbStore` (store.ts spreads `testScrumDbStore`) and
 * are found by `testScrumStoreOf`. A store without them (an old fake) has no test scrum: the
 * command then says so (fail closed).
 */
export interface TestScrumStore {
  /** The hidden recap item a test scrum hangs on (soft-deleted, test, not a recap). Its id. */
  insertTestRecapItem(args: { reporter: ReporterId; body: string }): Promise<number>
  /** Removes that item again when the post failed. */
  deleteTestRecapItem(id: number): Promise<void>
  /** Is this thread (a person's own, or a shared one) a test scrum's? The feud check skips it. */
  isTestScrumThread(threadId: string): Promise<boolean>
}

const METHODS: readonly (keyof TestScrumStore)[] = [
  'insertTestRecapItem',
  'deleteTestRecapItem',
  'isTestScrumThread',
]

/** The press store as a test scrum store, or null when it has no such methods. */
export function testScrumStoreOf(store: PressStore): (PressStore & TestScrumStore) | null {
  const s = store as PressStore & Partial<Record<keyof TestScrumStore, unknown>>
  return METHODS.every((m) => typeof s[m] === 'function')
    ? (store as PressStore & TestScrumStore)
    : null
}
