import type { NewsFactsResponse, ReporterId } from '@eanhl/db/news'
import type {
  InterviewAnswer,
  InterviewDetail,
  InterviewUpdate,
  NewNewsInterview,
  NewNewsInterviewAnswer,
  NewNewsItem,
  NewsInterviewRow,
} from '@eanhl/db/queries'
import type { ModelCall } from '../news/writer.ts'
import { oct12Response } from '../news/test-fixtures.ts'
import { JUDGEMENT_SCHEMA } from './asker.ts'
import type { InterviewStore } from './interview-store.ts'
import { FakeStore, NAMES, NIGHT, itemRow, setup } from './test-fakes.ts'

/**
 * Interview test fakes: the scrum `FakeStore` plus the interview methods,
 * with the same claim rules as the SQL (news-interviews.ts), and a setup
 * that serves the night fixture sheet.
 */
export class InterviewFakeStore extends FakeStore implements InterviewStore {
  interviews: NewsInterviewRow[] = []
  ivAnswers: (NewNewsInterviewAnswer & { id: number })[] = []
  /** Night recaps (the night article of a `night` job): the automatic offer's source. */
  nightRecaps: { night: string; createdAt: Date; isTest: boolean }[] = []
  /** The night each player last played (`latestPlayerNight`); absent = none in 30 days. */
  playerNights = new Map<number, string>([
    [1, NIGHT],
    [2, NIGHT],
    [3, NIGHT],
  ])
  newsItems: (NewNewsItem & { id: number })[] = []

  private ivDetail = (r: NewsInterviewRow): InterviewDetail => ({
    ...r,
    name: NAMES.get(r.playerId) ?? `Player ${String(r.playerId)}`,
  })
  private iv = (id: number) => this.interviews.find((r) => r.id === id)
  private last = (r: NewsInterviewRow) => r.lastAskedAt ?? r.acceptedAt ?? r.createdAt

  insertInterview = (v: NewNewsInterview) => {
    const open = (r: NewsInterviewRow) => r.status === 'offered' || r.status === 'active'
    if (this.interviews.some((r) => r.playerId === v.playerId && open(r))) {
      return Promise.resolve(null)
    }
    const isTest = v.isTest ?? false
    if (
      v.trigger === 'auto' &&
      this.interviews.some(
        (r) => r.trigger === 'auto' && r.night === v.night && r.isTest === isTest,
      )
    ) {
      return Promise.resolve(null)
    }
    const id = this.interviews.length + 1
    this.interviews.push({
      id,
      playerId: v.playerId,
      discordUserId: v.discordUserId,
      reporter: v.reporter,
      trigger: v.trigger,
      requestedByUserId: v.requestedByUserId ?? null,
      status: v.status ?? 'offered',
      night: v.night,
      topic: v.topic ?? null,
      channelId: v.channelId,
      offerMessageId: v.offerMessageId ?? null,
      offeredAt: v.offeredAt ?? null,
      threadId: v.threadId ?? null,
      questionsAsked: v.questionsAsked ?? 0,
      followupsAsked: v.followupsAsked ?? 0,
      askingFollowup: v.askingFollowup ?? false,
      currentQuestion: v.currentQuestion ?? null,
      lastAskedAt: v.lastAskedAt ?? null,
      acceptedAt: v.acceptedAt ?? null,
      endedAt: v.endedAt ?? null,
      articleStatus: v.articleStatus ?? 'waiting',
      articleItemId: v.articleItemId ?? null,
      isTest,
      createdAt: v.createdAt ?? this.clock(),
    })
    return Promise.resolve(id)
  }
  /** The time new rows get (tests move it). */
  clock: () => Date = () => new Date('2026-10-13T03:00:00.000Z')

  getInterview = (id: number) => {
    const r = this.iv(id)
    return Promise.resolve(r === undefined ? null : this.ivDetail(r))
  }
  listInterviewsToOffer = () =>
    Promise.resolve(
      this.interviews
        .filter((r) => r.status === 'offered' && r.offeredAt === null)
        .map(this.ivDetail),
    )
  listExpiredInterviewOffers = (cutoff: Date) =>
    Promise.resolve(
      this.interviews
        .filter((r) => r.status === 'offered' && r.offeredAt !== null && r.offeredAt <= cutoff)
        .map(this.ivDetail),
    )
  listExpiredInterviewQuestions = (cutoff: Date) =>
    Promise.resolve(
      this.interviews
        .filter((r) => r.status === 'active' && this.last(r) <= cutoff)
        .map(this.ivDetail),
    )
  listInterviewsForArticle = () =>
    Promise.resolve(
      this.interviews
        .filter(
          (r) => (r.status === 'done' || r.status === 'stopped') && r.articleStatus === 'waiting',
        )
        .map(this.ivDetail),
    )
  updateInterview = (id: number, patch: InterviewUpdate) => {
    if (Object.keys(patch).length === 0) throw new Error('empty patch')
    const r = this.iv(id)
    if (r !== undefined) Object.assign(r, patch)
    return Promise.resolve()
  }
  claimInterviewOffer = (id: number, at: Date) => {
    const r = this.iv(id)
    if (r === undefined || r.status !== 'offered' || r.offeredAt !== null) {
      return Promise.resolve(false)
    }
    r.offeredAt = at
    return Promise.resolve(true)
  }
  acceptInterview = (id: number, cutoff: Date, at: Date) => {
    const r = this.iv(id)
    if (r === undefined || r.status !== 'offered' || r.offeredAt === null || r.offeredAt < cutoff) {
      return Promise.resolve(false)
    }
    Object.assign(r, { status: 'active', acceptedAt: at, lastAskedAt: at })
    return Promise.resolve(true)
  }
  private openFor = (args: { id: number; questionsAsked: number; followupsAsked: number }) => {
    const r = this.iv(args.id)
    return r !== undefined &&
      r.status === 'active' &&
      r.questionsAsked === args.questionsAsked &&
      r.followupsAsked === args.followupsAsked
      ? r
      : undefined
  }
  claimInterviewQuestion = (args: {
    id: number
    questionsAsked: number
    followupsAsked: number
    question: string
    at: Date
  }) => {
    const r = this.openFor(args)
    if (r === undefined || r.currentQuestion !== null) return Promise.resolve(false)
    Object.assign(r, {
      questionsAsked: args.questionsAsked + 1,
      askingFollowup: false,
      currentQuestion: args.question,
      lastAskedAt: args.at,
    })
    return Promise.resolve(true)
  }
  claimInterviewFollowup = (args: {
    id: number
    questionsAsked: number
    followupsAsked: number
    question: string
    at: Date
  }) => {
    const r = this.openFor(args)
    if (r === undefined || r.currentQuestion !== null) return Promise.resolve(false)
    Object.assign(r, {
      followupsAsked: args.followupsAsked + 1,
      askingFollowup: true,
      currentQuestion: args.question,
      lastAskedAt: args.at,
    })
    return Promise.resolve(true)
  }
  claimInterviewAnswer = (args: {
    id: number
    questionsAsked: number
    followupsAsked: number
    at: Date
  }) => {
    const r = this.openFor(args)
    if (r === undefined || r.currentQuestion === null) return Promise.resolve(false)
    Object.assign(r, { currentQuestion: null, lastAskedAt: args.at })
    return Promise.resolve(true)
  }
  endInterview = (args: {
    id: number
    from: 'offered' | 'active'
    to: 'done' | 'stopped' | 'expired'
    cutoff: Date | null
    at: Date
  }) => {
    const r = this.iv(args.id)
    if (r === undefined || r.status !== args.from) return Promise.resolve(false)
    if (args.cutoff !== null) {
      const when = args.from === 'offered' ? r.offeredAt : this.last(r)
      if (when === null || when > args.cutoff) return Promise.resolve(false)
    }
    Object.assign(r, { status: args.to, endedAt: args.at, currentQuestion: null })
    return Promise.resolve(true)
  }
  insertInterviewAnswer = (v: NewNewsInterviewAnswer) => {
    const id = this.ivAnswers.length + 1
    this.ivAnswers.push({ ...v, id })
    return Promise.resolve(id)
  }
  listInterviewAnswers = (interviewId: number): Promise<InterviewAnswer[]> =>
    Promise.resolve(
      this.ivAnswers
        .filter((a) => a.interviewId === interviewId)
        .sort((a, b) => a.position - b.position || a.id - b.id)
        .map((a) => ({
          position: a.position,
          isFollowup: a.isFollowup ?? false,
          question: a.question,
          answer: a.answer,
          usability: a.usability,
        })),
    )
  findOpenInterviewInThread = (threadId: string, userId: string) => {
    const hit = [...this.interviews]
      .reverse()
      .find(
        (r) =>
          r.threadId === threadId &&
          r.discordUserId === userId &&
          r.status === 'active' &&
          r.currentQuestion !== null,
      )
    return Promise.resolve(hit?.id ?? null)
  }
  claimInterviewArticle = (id: number) => {
    const r = this.iv(id)
    if (r === undefined || r.articleStatus !== 'waiting') return Promise.resolve(false)
    r.articleStatus = 'writing'
    return Promise.resolve(true)
  }
  finishInterviewArticle = (
    id: number,
    status: 'written' | 'skipped' | 'failed',
    itemId: number | null,
  ) => {
    const r = this.iv(id)
    if (r !== undefined && r.articleStatus === 'writing') {
      r.articleStatus = status
      r.articleItemId = itemId
    }
    return Promise.resolve()
  }
  countPlayerInterviewsSince = (playerId: number, since: Date, isTest: boolean) =>
    Promise.resolve(
      this.interviews.filter(
        (r) =>
          r.playerId === playerId &&
          r.trigger === 'player' &&
          r.isTest === isTest &&
          r.status !== 'expired' &&
          r.createdAt > since,
      ).length,
    )
  countAutoInterviewsSince = (since: Date, isTest: boolean) =>
    Promise.resolve(
      this.interviews.filter(
        (r) => r.trigger === 'auto' && r.isTest === isTest && r.createdAt > since,
      ).length,
    )
  lastInterviewReporter = () =>
    Promise.resolve((this.interviews.at(-1)?.reporter ?? null) as ReporterId | null)
  latestPlayerNight = (playerId: number) => Promise.resolve(this.playerNights.get(playerId) ?? null)
  nightForAutoInterview = (since: Date, isTest: boolean) => {
    const hit = [...this.nightRecaps]
      .filter((n) => n.createdAt > since && (isTest || !n.isTest))
      .filter(
        (n) =>
          !this.interviews.some(
            (r) => r.trigger === 'auto' && r.night === n.night && r.isTest === isTest,
          ),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
    return Promise.resolve(hit?.night ?? null)
  }
  insertNewsItem = (item: NewNewsItem) => {
    const id = 500 + this.newsItems.length + 1
    this.newsItems.push({ ...item, id })
    // Also visible to the trial mirror (listItemsToMirror reads `items`).
    this.items.push(
      itemRow({
        id,
        kind: item.kind,
        reporter: item.reporter,
        matchId: item.matchId ?? null,
        night: item.night ?? null,
        slug: item.slug ?? null,
        headline: item.headline ?? null,
        dek: item.dek ?? null,
        body: item.body,
        isTest: item.isTest ?? false,
        discordStatus: 'pending',
        discordMessageId: null,
        discordChannelId: null,
        sendAfter: item.sendAfter ?? null,
      }),
    )
    return Promise.resolve(id)
  }
}

/** The press test setup on the night sheet with an interview store. */
export function interviewSetup(opts: { response?: NewsFactsResponse; model?: ModelCall } = {}) {
  const t = setup({
    response: opts.response ?? oct12Response('night'),
    ...(opts.model ? { model: opts.model } : {}),
  })
  const store = new InterviewFakeStore()
  t.deps.store = store
  return { ...t, store }
}

export type Judgement = { usability: string; chase?: string; followUp: string; closing: string }

/**
 * A fake model for interviews: questions, judgements and articles in order;
 * every review passes unless `reviews` scripts a rejection. Records each request.
 */
export function interviewModel(
  script: {
    questions?: string[]
    judgements?: Judgement[]
    articles?: unknown[]
    reviews?: { ok: boolean; problems: string[] }[]
  } = {},
) {
  const questions = [...(script.questions ?? [])]
  const judgements = [...(script.judgements ?? [])]
  const articles = [...(script.articles ?? [])]
  const reviews = [...(script.reviews ?? [])]
  const reqs: Parameters<ModelCall>[0][] = []
  const call: ModelCall = (req) => {
    reqs.push(req)
    let json: unknown
    if (req.purpose === 'review') json = reviews.shift() ?? { ok: true, problems: [] }
    else if (req.schema === JUDGEMENT_SCHEMA) json = judgements.shift()
    else if ('headline' in ((req.schema as { properties?: object }).properties ?? {})) {
      json = articles.shift()
    } else {
      const q = questions.shift()
      json = q === undefined ? undefined : { question: q }
    }
    if (json === undefined) return Promise.reject(new Error('fake model: nothing scripted'))
    return Promise.resolve({
      json,
      refused: false,
      model: 'claude-opus-5-5',
      usage: { input_tokens: 10, output_tokens: 5 },
    })
  }
  return { call, reqs }
}
