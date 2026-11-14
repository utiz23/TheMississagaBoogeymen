import test from 'node:test'
import assert from 'node:assert/strict'
import * as q from './background-rules.ts'

/** The rules of the background questions (pure; task background-b2). */

const ROSTER = [
  { playerId: 1, name: 'Ann', pressLevel: 'full' as const },
  { playerId: 2, name: 'Bob', pressLevel: 'easy' as const },
  { playerId: 3, name: 'Cy', pressLevel: 'full' as const },
  { playerId: 4, name: 'Dee', pressLevel: 'out' as const },
  { playerId: 5, name: 'Eve', pressLevel: 'full' as const },
]

const Q = (id: number, question: string, aboutTeammate = false) => ({
  id,
  part: 'hockey' as const,
  question,
  aboutTeammate,
})

// ── Teammate subjects: only "full" members ──────────────────────────────────

void test('a teammate subject is a member at "full" only: never Go easy, never Leave me out, never the person asked', () => {
  assert.deepEqual(
    q.eligibleSubjects(ROSTER, 1).map((s) => s.name),
    ['Cy', 'Eve'],
  )
  assert.deepEqual(
    q.eligibleSubjects(ROSTER, 3).map((s) => s.name),
    ['Ann', 'Eve'],
  )
  // Nobody eligible: an empty list.
  assert.deepEqual(q.eligibleSubjects([ROSTER[1]!, ROSTER[3]!], 1), [])
})

void test('whatever the seed, a teammate question never names a Go easy or Leave me out teammate', () => {
  const candidates = [Q(1, 'Who calms {name} down best?', true)]
  for (let seed = 0; seed < 300; seed++) {
    const pick = q.pickBackgroundQuestion({
      candidates,
      subjects: q.eligibleSubjects(ROSTER, 1),
      seed,
    })
    assert.ok(pick !== null && pick.subject !== null)
    assert.ok(
      ['Cy', 'Eve'].includes(pick.subject.name),
      `seed ${String(seed)}: ${pick.subject.name}`,
    )
  }
})

void test('a teammate question needs an eligible subject: with none, only the other questions are offered', () => {
  const candidates = [
    Q(1, 'Who hypes {name} up best?', true),
    Q(2, 'What is the best habit of {name}?'),
  ]
  const only = q.pickBackgroundQuestion({ candidates, subjects: [], seed: 7 })
  assert.equal(only?.question.id, 2)
  assert.equal(only?.subject, null)
  assert.equal(
    q.pickBackgroundQuestion({ candidates: [candidates[0]!], subjects: [], seed: 7 }),
    null,
  )
  assert.equal(q.pickBackgroundQuestion({ candidates: [], subjects: [], seed: 7 }), null)
})

void test('the pick is deterministic for a seed and uses the whole pool over many seeds', () => {
  const candidates = [Q(1, 'a'), Q(2, 'b'), Q(3, 'c')]
  const a = q.pickBackgroundQuestion({ candidates, subjects: [], seed: 42 })
  const b = q.pickBackgroundQuestion({ candidates, subjects: [], seed: 42 })
  assert.deepEqual(a, b)
  const seen = new Set<number>()
  for (let s = 0; s < 200; s++)
    seen.add(q.pickBackgroundQuestion({ candidates, subjects: [], seed: s })!.question.id)
  assert.equal(seen.size, 3)
})

void test('a Go easy person is never asked a question that asks for the bad side', () => {
  assert.equal(q.seedIsCritical('What does a classic bad {name} game look like?'), true)
  assert.equal(q.seedIsCritical('What kind of linemate makes {name} worse?'), true)
  assert.equal(q.seedIsCritical("What is {name}'s most frustrating offensive habit?"), true)
  assert.equal(q.seedIsCritical("Which teammate style clashes with {name}'s instincts?"), true)
  assert.equal(q.seedIsCritical('What is the best offensive habit of {name}?'), false)
  const candidates = [
    Q(1, 'What does a classic bad {name} game look like?'),
    Q(2, 'What kind of linemate makes {name} worse?'),
    Q(3, 'What is the best habit of {name}?'),
  ]
  for (let s = 0; s < 100; s++) {
    assert.equal(
      q.pickBackgroundQuestion({ candidates, subjects: [], seed: s, easy: true })?.question.id,
      3,
    )
  }
  assert.equal(
    q.pickBackgroundQuestion({
      candidates: candidates.slice(0, 2),
      subjects: [],
      seed: 1,
      easy: true,
    }),
    null,
  )
})

void test('Leave me out gets no background question; every other level may', () => {
  assert.equal(q.mayAskBackground('out'), false)
  assert.equal(q.mayAskBackground('easy'), true)
  assert.equal(q.mayAskBackground('full'), true)
})

// ── Where and when ───────────────────────────────────────────────────────────

const SCRUM_OK = {
  isMember: true,
  isTestScrum: false,
  questionNumber: 3,
  panelLength: 3,
  targetTotalKnown: true,
  askedInThisScrum: 0,
  askedInLastWeek: 0,
  lostBy: 0,
}

void test('scrum: one per person per 7 days, only as the last question of the panel, never after a loss by 3+', () => {
  assert.equal(q.scrumMayAskBackground(SCRUM_OK), true)
  assert.equal(q.BACKGROUND_SCRUM_LIMIT_MS, 7 * 86_400_000)
  // 7-day limit
  assert.equal(q.scrumMayAskBackground({ ...SCRUM_OK, askedInLastWeek: 1 }), false)
  // never more than one per panel
  assert.equal(q.scrumMayAskBackground({ ...SCRUM_OK, askedInThisScrum: 1 }), false)
  // game questions come first: not the first or a middle one
  assert.equal(q.scrumMayAskBackground({ ...SCRUM_OK, questionNumber: 1 }), false)
  assert.equal(q.scrumMayAskBackground({ ...SCRUM_OK, questionNumber: 2 }), false)
  // a panel of one has no game question before it
  assert.equal(q.scrumMayAskBackground({ ...SCRUM_OK, questionNumber: 1, panelLength: 1 }), false)
  // a volunteer's panel of two: the second question may be it
  assert.equal(q.scrumMayAskBackground({ ...SCRUM_OK, questionNumber: 2, panelLength: 2 }), true)
  // loss of 3+ goals
  assert.equal(q.scrumMayAskBackground({ ...SCRUM_OK, lostBy: 3 }), false)
  assert.equal(q.scrumMayAskBackground({ ...SCRUM_OK, lostBy: 5 }), false)
  assert.equal(q.scrumMayAskBackground({ ...SCRUM_OK, lostBy: 2 }), true)
  // an old round, a test scrum, a person who is not a member
  assert.equal(q.scrumMayAskBackground({ ...SCRUM_OK, targetTotalKnown: false }), false)
  assert.equal(q.scrumMayAskBackground({ ...SCRUM_OK, isTestScrum: true }), false)
  assert.equal(q.scrumMayAskBackground({ ...SCRUM_OK, isMember: false }), false)
})

void test('interview: one per interview, from the 5th item on, a member only', () => {
  const ok = { isMember: true, position: 5, askedInThisInterview: 0 }
  assert.equal(q.interviewMayAskBackground(ok), true)
  assert.equal(q.interviewMayAskBackground({ ...ok, position: 7 }), true)
  assert.equal(q.interviewMayAskBackground({ ...ok, position: 4 }), false)
  assert.equal(q.interviewMayAskBackground({ ...ok, position: 1 }), false)
  assert.equal(q.interviewMayAskBackground({ ...ok, askedInThisInterview: 1 }), false)
  assert.equal(q.interviewMayAskBackground({ ...ok, isMember: false }), false)
})
