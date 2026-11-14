import type {
  AskableQuestion,
  InterviewAnswer,
  NewBackgroundAsk,
  OpenBackgroundAsk,
  WriterFact,
} from '@eanhl/db/queries'
import type { ModelCall } from '../news/writer.ts'
import { oct12Response } from '../news/test-fixtures.ts'
import { JUDGEMENT_SCHEMA } from './asker.ts'
import type { BackgroundStore } from './background-store.ts'
import { InterviewFakeStore } from './interview-fakes.ts'
import { setup } from './test-fakes.ts'

/**
 * Test fakes for the background questions (task background-b2): the interview fake store plus the
 * background methods, with the same rules as the SQL (one ask per panel or interview, a question
 * never asked twice, a proposed fact only from a real answered ask, at most 2 per answer).
 */
export interface FakeAsk extends NewBackgroundAsk {
  id: number
  answeredAt: Date | null
  answerScrumId: number | null
  answerInterviewId: number | null
}

export interface FakeFact {
  id: number
  askId: number
  playerId: number
  subjectPlayerId: number | null
  text: string
  /** Always `proposed`: the fake (like the SQL) has no way to insert another status. */
  status: 'proposed'
  scrumAnswerId: number | null
  interviewAnswerId: number | null
}

export const BANK: AskableQuestion[] = [
  { id: 1, part: 'hockey', question: 'What is the best habit of {name}?', aboutTeammate: false },
  { id: 2, part: 'room', question: 'Who on the team hypes {name} up best?', aboutTeammate: true },
  { id: 3, part: 'career', question: 'When did {name} first join the team?', aboutTeammate: false },
]

export class BgFakeStore extends InterviewFakeStore implements BackgroundStore {
  switchOn = true
  bank: AskableQuestion[] = BANK.map((q) => ({ ...q }))
  asks: FakeAsk[] = []
  facts: FakeFact[] = []
  /** Confirmed facts a writer may read (the real query never returns another status). */
  confirmed: WriterFact[] = []
  now = new Date('2026-10-13T03:00:00.000Z')

  backgroundQuestionsOn = () => Promise.resolve(this.switchOn)
  listAskableBackgroundQuestions = (playerId: number, isTest: boolean) =>
    Promise.resolve(
      this.bank.filter(
        (q) =>
          !this.asks.some(
            (a) => a.questionId === q.id && a.playerId === playerId && a.isTest === isTest,
          ),
      ),
    )
  countBackgroundAsksSince = (playerId: number, since: Date, isTest: boolean) =>
    Promise.resolve(
      this.asks.filter(
        (a) =>
          a.playerId === playerId && a.kind === 'scrum' && a.isTest === isTest && a.at >= since,
      ).length,
    )
  countBackgroundAsksFor = (by: { scrumPersonId: number } | { interviewId: number }) =>
    Promise.resolve(
      this.asks.filter((a) =>
        'scrumPersonId' in by
          ? a.scrumPersonId === by.scrumPersonId
          : a.interviewId === by.interviewId,
      ).length,
    )
  insertBackgroundAsk = (ask: NewBackgroundAsk) => {
    const dup = this.asks.some(
      (a) =>
        (ask.scrumPersonId !== undefined && a.scrumPersonId === ask.scrumPersonId) ||
        (ask.interviewId !== undefined && a.interviewId === ask.interviewId),
    )
    if (dup) return Promise.resolve(null)
    const id = this.asks.length + 1
    this.asks.push({ ...ask, id, answeredAt: null, answerScrumId: null, answerInterviewId: null })
    return Promise.resolve(id)
  }
  getOpenBackgroundAsk = (by: { scrumPersonId: number } | { interviewId: number }) => {
    const a = this.asks.find(
      (x) =>
        x.answeredAt === null &&
        ('scrumPersonId' in by
          ? x.scrumPersonId === by.scrumPersonId
          : x.interviewId === by.interviewId),
    )
    if (a === undefined) return Promise.resolve(null)
    const q = this.bank.find((x) => x.id === a.questionId)!
    const subject = this.roster.find((r) => r.playerId === a.subjectPlayerId)
    const open: OpenBackgroundAsk = {
      id: a.id,
      questionId: a.questionId,
      playerId: a.playerId,
      subjectPlayerId: a.subjectPlayerId,
      subjectName: subject?.name ?? null,
      part: q.part,
      question: q.question,
      aboutTeammate: q.aboutTeammate,
      isTest: a.isTest,
    }
    return Promise.resolve(open)
  }
  completeBackgroundAsk = (
    askId: number,
    answer: { scrumAnswerId: number } | { interviewAnswerId: number },
    at: Date,
  ) => {
    const a = this.asks.find((x) => x.id === askId)
    if (a === undefined || a.answeredAt !== null) return Promise.resolve(false)
    a.answeredAt = at
    a.answerScrumId = 'scrumAnswerId' in answer ? answer.scrumAnswerId : null
    a.answerInterviewId = 'interviewAnswerId' in answer ? answer.interviewAnswerId : null
    return Promise.resolve(true)
  }
  insertProposedBackgroundFacts = (askId: number, texts: readonly string[]) => {
    const a = this.asks.find((x) => x.id === askId)
    if (a === undefined || a.answeredAt === null || a.isTest) return Promise.resolve([])
    const ids: number[] = []
    for (const text of texts.slice(0, 2)) {
      const mine = this.facts.filter((f) => f.askId === askId).length
      if (mine >= 2) break
      const id = this.facts.length + 1
      this.facts.push({
        id,
        askId,
        playerId: a.playerId,
        subjectPlayerId: a.subjectPlayerId,
        text,
        status: 'proposed',
        scrumAnswerId: a.answerScrumId,
        interviewAnswerId: a.answerInterviewId,
      })
      ids.push(id)
    }
    return Promise.resolve(ids)
  }
  getConfirmedBackground = (_playerId: number, pressLevel: string | null) =>
    Promise.resolve({
      own: pressLevel === 'out' ? [] : [...this.confirmed],
      fromTeammates: [] as WriterFact[],
    })

  private aboutTeammateInterview = (answerId: number) =>
    this.asks.some((a) => a.answerInterviewId === answerId && a.subjectPlayerId !== null)
  private aboutTeammateScrum = (answerId: number) =>
    this.asks.some((a) => a.answerScrumId === answerId && a.subjectPlayerId !== null)

  override listInterviewAnswers = (interviewId: number): Promise<InterviewAnswer[]> =>
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
          aboutTeammate: this.aboutTeammateInterview(a.id),
        })),
    )
  override listScrumAnswers = (personId: number) =>
    Promise.resolve(
      this.answers
        .map((a, i) => ({ a, id: i + 1 }))
        .filter(({ a }) => a.personId === personId)
        .map(({ a, id }) => ({
          question: a.question,
          answer: a.answer,
          usability: a.usability,
          reporter: a.reporter ?? null,
          aboutTeammate: this.aboutTeammateScrum(id),
        })),
    )
}

/** The press test setup on the night sheet with the background fake store. */
export function bgSetup(opts: { model?: ModelCall } = {}) {
  const t = setup({
    response: oct12Response('night'),
    ...(opts.model ? { model: opts.model } : {}),
  })
  const store = new BgFakeStore()
  t.deps.store = store
  return { ...t, store }
}

export type BgJudgement = { usability: string; chase?: string; followUp: string; closing: string }

/**
 * A fake model: it routes each request by its schema (questions, judgements, background questions,
 * facts). A background question is told apart by its system prompt. Every review passes. It
 * records each request, so a test can count them: this is the ONLY model in these tests (no real
 * call is possible).
 */
export function bgModel(
  script: {
    questions?: string[]
    background?: string[]
    judgements?: BgJudgement[]
    facts?: string[][]
  } = {},
) {
  const questions = [...(script.questions ?? [])]
  const background = [...(script.background ?? [])]
  const judgements = [...(script.judgements ?? [])]
  const facts = [...(script.facts ?? [])]
  const reqs: Parameters<ModelCall>[0][] = []
  const call: ModelCall = (req) => {
    reqs.push(req)
    let json: unknown
    if (req.purpose === 'review') json = { ok: true, problems: [] }
    else if (req.schema === JUDGEMENT_SCHEMA) json = judgements.shift()
    else if ('facts' in ((req.schema as { properties?: object }).properties ?? {})) {
      const f = facts.shift()
      json = f === undefined ? undefined : { facts: f }
    } else if (req.system.includes('BACKGROUND QUESTION RULES')) {
      const q = background.shift()
      json = q === undefined ? undefined : { question: q }
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
  const kinds = () => ({
    backgroundQuestions: reqs.filter(
      (r) => r.purpose === 'write' && r.system.includes('BACKGROUND QUESTION RULES'),
    ).length,
    proposers: reqs.filter(
      (r) =>
        r.purpose === 'write' &&
        'facts' in ((r.schema as { properties?: object }).properties ?? {}),
    ).length,
  })
  return { call, reqs, kinds }
}
