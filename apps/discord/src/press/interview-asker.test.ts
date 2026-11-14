import test from 'node:test'
import assert from 'node:assert/strict'
import type { NewsTake } from '@eanhl/db/news'
import { oct12Response } from '../news/test-fixtures.ts'
import {
  articleProblems,
  askInterviewQuestion,
  isCutOf,
  writeInterviewArticle,
  type InterviewArticle,
  type InterviewContext,
  type OfferedAnswer,
} from './interview-asker.ts'
import { interviewModel } from './interview-fakes.ts'

const res = oct12Response('night')
const noRecord = () => Promise.resolve()

function ctx(over: Partial<InterviewContext> = {}): InterviewContext {
  return {
    facts: res.facts,
    forbiddenNames: res.forbiddenNames,
    takes: [],
    reporter: 'pettibone',
    player: { name: 'Skater A', pressLevel: 'full' },
    topic: null,
    history: [],
    position: 1,
    ...over,
  }
}

const OFFERED: OfferedAnswer[] = [
  {
    question: 'How was the night?',
    answer: 'We got outshot badly but I kept skating hard.',
    usability: 'usable',
  },
  {
    question: 'And your season?',
    answer: 'It is fine. I want more goals, honestly.',
    usability: 'usable',
  },
  {
    question: 'Who is the best here?',
    answer: 'Me, obviously, ask anyone in the room.',
    usability: 'joke',
  },
]

const good = (over: Partial<InterviewArticle> = {}): InterviewArticle => ({
  headline: 'Skater A talks a hard night',
  dek: 'Gord Pettibone sits down with Skater A.',
  intro: ['Gord Pettibone sat down with Skater A after two losses.'],
  answers: [
    { n: 1, text: 'We got outshot badly…' },
    { n: 2, text: 'I want more goals, honestly.' },
    { n: 3, text: 'Me, obviously, ask anyone in the room.' },
  ],
  ...over,
})

void test('quote rule: an answer may only be cut, never changed, reordered or added to', () => {
  const said = 'We got outshot badly but I kept skating hard.'
  assert.equal(isCutOf(said, said), true)
  assert.equal(isCutOf('we got outshot badly', said), true)
  assert.equal(isCutOf('We got outshot… I kept skating hard', said), true)
  assert.equal(isCutOf('We got outshot... kept skating', said), true)
  assert.equal(isCutOf('We got outshot badly and I kept skating hard.', said), false) // changed word
  assert.equal(isCutOf('I kept skating hard… We got outshot', said), false) // reordered
  assert.equal(isCutOf('We got outshot badly but I kept skating very hard.', said), false) // added
  assert.equal(isCutOf('…', said), false)
})

void test('article check: answers by number, in order, at least 3, cut only; the intro quotes nobody', () => {
  const c = ctx()
  assert.deepEqual(articleProblems(good(), c, OFFERED), [])
  const marked = good({
    answers: [...good().answers.slice(0, 2), { n: 3, text: 'Me… ask anyone…' }],
  })
  assert.deepEqual(articleProblems(marked, c, OFFERED), [])
  // A cut without "…" hides that words were taken out: refused.
  const unmarked = good({
    answers: [...good().answers.slice(0, 2), { n: 3, text: 'Me, ask anyone.' }],
  })
  assert.match(
    articleProblems(unmarked, c, OFFERED).join(' '),
    /Answer 3 is not the player's words/,
  )
  const added = good({
    answers: [{ n: 1, text: 'We got outshot badly, sadly.' }, ...good().answers.slice(1)],
  })
  assert.match(articleProblems(added, c, OFFERED).join(' '), /Answer 1 is not the player's words/)
  const few = good({ answers: good().answers.slice(0, 2) })
  assert.match(articleProblems(few, c, OFFERED).join(' '), /Print at least 3 answers/)
  const order = good({ answers: [...good().answers].reverse() })
  assert.match(articleProblems(order, c, OFFERED).join(' '), /in interview order/)
  const unknown = good({ answers: [...good().answers, { n: 9, text: 'Made up.' }] })
  assert.match(
    articleProblems(unknown, c, OFFERED).join(' '),
    /Answer 9 is not one of the listed answers/,
  )
  const quoting = good({ intro: ['Skater A says "I kept skating hard" after the night.'] })
  assert.match(articleProblems(quoting, c, OFFERED).join(' '), /The intro quotes nobody/)
  const qa = good({ intro: ['Q: is this the intro?'] })
  assert.match(articleProblems(qa, c, OFFERED).join(' '), /starts with "Q:" or "A:"/)
})

void test('article check: numbers from the sheet only, one teammate named, no forbidden name, no strong word', () => {
  const c = ctx()
  // 7 is on no sheet line (the fixture keeps 4 and 7 off the sheet).
  const number = good({ intro: ['Gord Pettibone sat down with Skater A after 7 losses.'] })
  assert.ok(articleProblems(number, c, OFFERED).some((p) => /7/.test(p)))
  const teammate = good({ intro: ['Gord Pettibone sat down with Skater A and Skater B.'] })
  assert.match(articleProblems(teammate, c, OFFERED).join(' '), /names Skater B/)
  const forbidden = good({ dek: 'Skater A and Hidden Hank talk.' })
  assert.match(articleProblems(forbidden, c, OFFERED).join(' '), /not on the fact sheet/)
  const swearing = [
    { ...OFFERED[0]!, answer: 'We got fucking outshot badly.' },
    ...OFFERED.slice(1),
  ]
  const strong = good({
    answers: [{ n: 1, text: 'We got fucking outshot badly.' }, ...good().answers.slice(1)],
  })
  assert.match(articleProblems(strong, c, swearing).join(' '), /never prints/)
  const cutOut = good({
    answers: [{ n: 1, text: 'We got… outshot badly.' }, ...good().answers.slice(1)],
  })
  assert.deepEqual(articleProblems(cutOut, c, swearing), [])
})

void test('article writer: a changed answer is sent back for a rewrite; the review sees the jokes marked', async () => {
  const bad = good({
    answers: [{ n: 1, text: 'We outworked them all night.' }, ...good().answers.slice(1)],
  })
  const m = interviewModel({ articles: [bad, good()] })
  const out = await writeInterviewArticle(m.call, ctx(), OFFERED, noRecord)
  assert.equal(out.ok, true)
  const writes = m.reqs.filter((r) => r.purpose === 'write')
  assert.equal(writes.length, 2)
  assert.match(writes[1]!.user, /Answer 1 is not the player's words/)
  const review = m.reqs.find((r) => r.purpose === 'review')!
  assert.match(review.user, /Me, obviously, ask anyone in the room\./)
  assert.match(review.user, /\(a JOKE: never state it as fact\)/)
  assert.match(review.user, /Paragraphs that start with "A:" are the player's answers/)
})

void test('article writer: gives up after 3 writes (no article, no throw)', async () => {
  const bad = good({ answers: good().answers.slice(0, 1) })
  const m = interviewModel({ articles: [bad, bad, bad] })
  const out = await writeInterviewArticle(m.call, ctx(), OFFERED, noRecord)
  assert.equal(out.ok, false)
  assert.equal(m.reqs.filter((r) => r.purpose === 'write').length, 3)
})

void test('question writer: "Go easy" gets no takes and the no-criticism review rule; the topic is in the prompt', async () => {
  const take: NewsTake = {
    id: 1,
    reporter: 'pettibone',
    critics: [],
    defender: null,
    playerId: 2,
    player: 'Skater B',
    take: 'Skater B floats on the backcheck.',
    spread: 'some',
    dataAngle: null,
    intensity: 0,
    mild: true,
  }
  const m = interviewModel({ questions: ['What has been working for you?'] })
  const q = await askInterviewQuestion(
    m.call,
    ctx({ player: { name: 'Skater B', pressLevel: 'easy' }, takes: [take], topic: 'his faceoffs' }),
    noRecord,
  )
  assert.equal(q, 'What has been working for you?')
  const write = m.reqs.find((r) => r.purpose === 'write')!
  assert.doesNotMatch(write.user, /floats on the backcheck/)
  assert.match(write.user, /press level "easy": no criticism at all/)
  assert.match(write.user, /his faceoffs/)
  assert.match(write.system, /INTERVIEW RULES/)
  assert.match(write.system, /Hockey only/)
  const review = m.reqs.find((r) => r.purpose === 'review')!
  assert.match(review.user, /any criticism of Skater B, even mild, is a problem/)
})

void test('question writer: a number off the sheet or a second teammate fails the check; null after 4 writes', async () => {
  const m = interviewModel({
    questions: [
      'Seven shots, Skater A — why 7?',
      'What about Skater B and you?',
      'Why 7 again?',
      'Skater B says hi?',
    ],
  })
  assert.equal(await askInterviewQuestion(m.call, ctx(), noRecord), null)
  assert.equal(m.reqs.filter((r) => r.purpose === 'write').length, 4)
  assert.equal(m.reqs.filter((r) => r.purpose === 'review').length, 0)
})
