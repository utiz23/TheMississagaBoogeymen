import type { ReporterId } from '@eanhl/db/news'
import type {
  InterviewAnswer,
  InterviewDetail,
  InterviewUpdate,
  NewNewsInterview,
  NewNewsInterviewAnswer,
  NewNewsItem,
} from '@eanhl/db/queries'
import type { PressStore } from './pass.ts'

/**
 * The database side of the interviews. It is not part of `PressStore` on
 * purpose: the press store's interface is shared with the scrum work (T2), so
 * the interview methods ride on the same object (`pressDbStore` spreads
 * `interviewDbStore`, see store.ts) and are found by `interviewStoreOf`. A
 * store without them (an old fake in a test) has no interviews: every
 * interview path then does nothing (fail closed).
 */
export interface InterviewStore {
  insertInterview(values: NewNewsInterview): Promise<number | null>
  getInterview(id: number): Promise<InterviewDetail | null>
  listInterviewsToOffer(): Promise<InterviewDetail[]>
  listExpiredInterviewOffers(cutoff: Date): Promise<InterviewDetail[]>
  listExpiredInterviewQuestions(cutoff: Date): Promise<InterviewDetail[]>
  listInterviewsForArticle(): Promise<InterviewDetail[]>
  /** Never with an empty patch. */
  updateInterview(id: number, patch: InterviewUpdate): Promise<void>
  claimInterviewOffer(id: number, at: Date): Promise<boolean>
  acceptInterview(id: number, cutoff: Date, at: Date): Promise<boolean>
  claimInterviewQuestion(args: {
    id: number
    questionsAsked: number
    followupsAsked: number
    question: string
    at: Date
  }): Promise<boolean>
  claimInterviewFollowup(args: {
    id: number
    questionsAsked: number
    followupsAsked: number
    question: string
    at: Date
  }): Promise<boolean>
  claimInterviewAnswer(args: {
    id: number
    questionsAsked: number
    followupsAsked: number
    at: Date
  }): Promise<boolean>
  endInterview(args: {
    id: number
    from: 'offered' | 'active'
    to: 'done' | 'stopped' | 'expired'
    cutoff: Date | null
    at: Date
  }): Promise<boolean>
  insertInterviewAnswer(values: NewNewsInterviewAnswer): Promise<number>
  listInterviewAnswers(interviewId: number): Promise<InterviewAnswer[]>
  findOpenInterviewInThread(threadId: string, userId: string): Promise<number | null>
  claimInterviewArticle(id: number): Promise<boolean>
  finishInterviewArticle(
    id: number,
    status: 'written' | 'skipped' | 'failed',
    itemId: number | null,
  ): Promise<void>
  countPlayerInterviewsSince(playerId: number, since: Date, isTest: boolean): Promise<number>
  countAutoInterviewsSince(since: Date, isTest: boolean): Promise<number>
  lastInterviewReporter(): Promise<ReporterId | null>
  latestPlayerNight(playerId: number, since: Date): Promise<string | null>
  nightForAutoInterview(since: Date, isTest: boolean): Promise<string | null>
  insertNewsItem(item: NewNewsItem): Promise<number>
}

/** Every method an interview store must have (the guard checks each one). */
const METHODS: readonly (keyof InterviewStore)[] = [
  'insertInterview',
  'getInterview',
  'listInterviewsToOffer',
  'listExpiredInterviewOffers',
  'listExpiredInterviewQuestions',
  'listInterviewsForArticle',
  'updateInterview',
  'claimInterviewOffer',
  'acceptInterview',
  'claimInterviewQuestion',
  'claimInterviewFollowup',
  'claimInterviewAnswer',
  'endInterview',
  'insertInterviewAnswer',
  'listInterviewAnswers',
  'findOpenInterviewInThread',
  'claimInterviewArticle',
  'finishInterviewArticle',
  'countPlayerInterviewsSince',
  'countAutoInterviewsSince',
  'lastInterviewReporter',
  'latestPlayerNight',
  'nightForAutoInterview',
  'insertNewsItem',
]

/** The press store as an interview store, or null when it has no interview methods. */
export function interviewStoreOf(store: PressStore): (PressStore & InterviewStore) | null {
  const s = store as PressStore & Partial<Record<keyof InterviewStore, unknown>>
  return METHODS.every((m) => typeof s[m] === 'function')
    ? (store as PressStore & InterviewStore)
    : null
}
