import type { PressLevel } from '@eanhl/db/news'
import type {
  AskableQuestion,
  NewBackgroundAsk,
  OpenBackgroundAsk,
  PressRosterEntry,
  WriterBackground,
} from '@eanhl/db/queries'
import type { PressStore } from './pass.ts'

/**
 * The database side of the background questions (task background-b2). Like the interview store it
 * is not part of `PressStore`: the methods ride on the same object (`pressDbStore` spreads
 * `backgroundDbStore`) and are found by `backgroundStoreOf`. A store without them (an old fake in a
 * test, a press service built before migration 0084) asks no background question and proposes no
 * fact: every path then does nothing (fail closed).
 */
export interface BackgroundStore {
  /** The admin switch. False on any failure. */
  backgroundQuestionsOn(): Promise<boolean>
  listAskableBackgroundQuestions(playerId: number, isTest: boolean): Promise<AskableQuestion[]>
  countBackgroundAsksSince(playerId: number, since: Date, isTest: boolean): Promise<number>
  countBackgroundAsksFor(by: { scrumPersonId: number } | { interviewId: number }): Promise<number>
  insertBackgroundAsk(ask: NewBackgroundAsk): Promise<number | null>
  getOpenBackgroundAsk(
    by: { scrumPersonId: number } | { interviewId: number },
  ): Promise<OpenBackgroundAsk | null>
  completeBackgroundAsk(
    askId: number,
    answer: { scrumAnswerId: number } | { interviewAnswerId: number },
    at: Date,
  ): Promise<boolean>
  insertProposedBackgroundFacts(
    askId: number,
    texts: readonly string[],
    at: Date,
  ): Promise<number[]>
  /** Confirmed background facts only (the query gives nothing for "Leave me out"). */
  getConfirmedBackground(playerId: number, pressLevel: PressLevel | null): Promise<WriterBackground>
  listPressRoster(): Promise<PressRosterEntry[]>
}

const METHODS: readonly (keyof BackgroundStore)[] = [
  'backgroundQuestionsOn',
  'listAskableBackgroundQuestions',
  'countBackgroundAsksSince',
  'countBackgroundAsksFor',
  'insertBackgroundAsk',
  'getOpenBackgroundAsk',
  'completeBackgroundAsk',
  'insertProposedBackgroundFacts',
  'getConfirmedBackground',
  'listPressRoster',
]

/** The press store as a background store, or null when it has no background methods. */
export function backgroundStoreOf(store: PressStore): (PressStore & BackgroundStore) | null {
  const s = store as PressStore & Partial<Record<keyof BackgroundStore, unknown>>
  return METHODS.every((m) => typeof s[m] === 'function')
    ? (store as PressStore & BackgroundStore)
    : null
}
