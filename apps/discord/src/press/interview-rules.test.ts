import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORTER_IDS, type ReporterId } from '@eanhl/db/news'
import { oct12Facts } from '../news/test-fixtures.ts'
import {
  INTERVIEW_ANSWER_MS,
  INTERVIEW_AUTO_LIMIT_MS,
  INTERVIEW_OFFER_MS,
  INTERVIEW_PLAYER_LIMIT_MS,
  INTERVIEW_QUESTIONS,
  articleAllowed,
  chooseInterviewReporter,
  fallbackInterviewQuestion,
  interviewFollowUpAllowed,
  moreQuestions,
  pickAutoStory,
  saysItIsOver,
} from './interview-rules.ts'

void test('windows and limits: 30-minute offer and answer, 7 items, one a week', () => {
  assert.equal(INTERVIEW_OFFER_MS, 30 * 60_000)
  assert.equal(INTERVIEW_ANSWER_MS, 30 * 60_000)
  assert.equal(INTERVIEW_QUESTIONS, 7)
  assert.equal(INTERVIEW_PLAYER_LIMIT_MS, 7 * 86_400_000)
  assert.equal(INTERVIEW_AUTO_LIMIT_MS, 7 * 86_400_000)
})

void test('reporter: never a disabled one, not the last one twice, Father Rink rare', () => {
  const counts = new Map<ReporterId, number>()
  for (let seed = 1; seed <= 4000; seed++) {
    const r = chooseInterviewReporter({
      seed,
      disabled: ['vale'],
      lastReporter: 'barlow',
      takeReporters: [],
    })!
    counts.set(r, (counts.get(r) ?? 0) + 1)
  }
  assert.equal(counts.get('vale'), undefined)
  assert.equal(counts.get('barlow'), undefined)
  const rink = counts.get('rink') ?? 0
  assert.ok(rink > 0, 'Father Rink may interview')
  for (const id of REPORTER_IDS) {
    if (id === 'rink' || id === 'vale' || id === 'barlow') continue
    assert.ok((counts.get(id) ?? 0) > rink * 2, `${id} is asked far more often than Father Rink`)
  }
  // Only the last reporter left: they may ask again. All off: nobody.
  const others = REPORTER_IDS.filter((id) => id !== 'mercer')
  assert.equal(
    chooseInterviewReporter({
      seed: 1,
      disabled: others,
      lastReporter: 'mercer',
      takeReporters: [],
    }),
    'mercer',
  )
  assert.equal(
    chooseInterviewReporter({
      seed: 1,
      disabled: [...REPORTER_IDS],
      lastReporter: null,
      takeReporters: [],
    }),
    null,
  )
  // Seeded: the same seed gives the same reporter.
  const a = chooseInterviewReporter({
    seed: 77,
    disabled: [],
    lastReporter: null,
    takeReporters: ['quill'],
  })
  const b = chooseInterviewReporter({
    seed: 77,
    disabled: [],
    lastReporter: null,
    takeReporters: ['quill'],
  })
  assert.equal(a, b)
})

void test('automatic story: a record in a Historic game, then a milestone, then the best player of a Historic game', () => {
  const all = () => true
  const facts = oct12Facts('night')
  // The fixture night: no Historic game, Skater B's milestone.
  assert.deepEqual(pickAutoStory(facts, all), {
    playerId: 2,
    name: 'Skater B',
    strength: 2,
    why: 'a milestone (25 goals)',
  })
  // Skater B not linked: no milestone story left, and no Historic game.
  assert.equal(
    pickAutoStory(facts, (id) => id !== 2),
    null,
  )
  // A new club record makes the game Historic: its holder wins over the milestone.
  facts.games[0] = {
    ...facts.games[0]!,
    newRecords: [{ stat: 'goals', name: 'Skater A', value: 30 }],
  }
  assert.equal(pickAutoStory(facts, all)?.playerId, 1)
  assert.equal(pickAutoStory(facts, all)?.strength, 3)
  // "Leave me out" (not in people) is never picked: the next story wins.
  facts.people = facts.people.filter((p) => p.playerId !== 1)
  assert.equal(pickAutoStory(facts, all)?.playerId, 2)
  // No milestone: the best player of the Historic game who may be asked.
  facts.milestones = []
  assert.deepEqual(pickAutoStory(facts, all), {
    playerId: 2,
    name: 'Skater B',
    strength: 1,
    why: 'a historic game',
  })
})

void test('follow-up: one in all, never after a follow-up, never past the 7th item', () => {
  const at = (q: number, f: number, asking = false) => ({
    questionsAsked: q,
    followupsAsked: f,
    askingFollowup: asking,
  })
  assert.equal(interviewFollowUpAllowed(at(1, 0)), true)
  assert.equal(interviewFollowUpAllowed(at(2, 1, true)), false)
  assert.equal(interviewFollowUpAllowed(at(3, 1)), false)
  assert.equal(interviewFollowUpAllowed(at(7, 0)), false)
  assert.equal(interviewFollowUpAllowed(at(6, 0)), true)
  // The follow-up replaces a planned question: 6 + 1 = 7 items, no more.
  assert.equal(moreQuestions(at(6, 1)), false)
  assert.equal(moreQuestions(at(6, 0)), true)
  assert.equal(moreQuestions(at(7, 0)), false)
})

void test('says it is over: short stop phrases only', () => {
  for (const s of [
    "I'm done",
    'thats it',
    'No more questions.',
    'ok that is enough',
    'gotta go boys',
  ]) {
    assert.equal(saysItIsOver(s), true, s)
  }
  for (const s of [
    'We were done after the second period, the legs were gone and nobody could keep up.',
    'Good game',
    'The puck would not go in, no more to say about the bounces than that honestly',
    '',
  ]) {
    assert.equal(saysItIsOver(s), false, s)
  }
})

void test('article threshold: at least 3 usable or joke answers', () => {
  const a = (u: 'usable' | 'joke' | 'unusable') => ({ usability: u })
  assert.equal(articleAllowed([a('usable'), a('joke'), a('unusable')]), false)
  assert.equal(articleAllowed([a('usable'), a('joke'), a('usable')]), true)
  assert.equal(articleAllowed([]), false)
})

void test('fallback questions: one per position, hockey only, no numbers', () => {
  for (let i = 1; i <= 8; i++) {
    const q = fallbackInterviewQuestion(i, 'Skater A')
    assert.ok(q.length > 0 && q.length <= 280)
    assert.doesNotMatch(q, /\d/)
  }
})
