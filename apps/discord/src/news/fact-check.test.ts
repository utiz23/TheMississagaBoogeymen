import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FORBIDDEN_NAME_PROBLEM,
  allowedNumbers,
  checkArticleFacts,
  checkFacts,
  checkFeatureFacts,
  labelClaims,
} from './fact-check.ts'
import { oct12Facts } from './test-fixtures.ts'

const facts = oct12Facts('game')
const night = oct12Facts('night')
const none = { mentions: [], clubs: [] }
const FORBIDDEN = ['Hidden Hank']

function problems(r: ReturnType<typeof checkFacts>): string[] {
  return r.ok ? [] : r.problems
}

void test('allowedNumbers: facts values, numbers inside strings, 0 and 1', () => {
  const a = allowedNumbers(facts)
  for (const n of [0, 1, 45, 17, 29, 14, 27, 2026, 10, 12, 79.3, 25, 2, 6])
    assert.ok(a.has(n), String(n))
  assert.equal(a.has(4), false)
  assert.equal(a.has(7), false)
})

void test('numbers on the sheet pass, in several forms', () => {
  for (const t of [
    'Outshot 45–17 across two games.',
    'Outshot 45-17 across two games.',
    'They got three shots in game two.',
    'A 2-6 loss, then a 0–6 loss.',
    'Skater B reached twenty-five goals.',
    'The goalie stopped 79.3% of shots.',
    'Another NHL 27 night.',
  ]) {
    assert.deepEqual(checkFacts(t, facts, FORBIDDEN, none), { ok: true }, t)
  }
})

void test('numbers not on the sheet fail and the problem names the number', () => {
  const four = problems(checkFacts('Only four shots in the second half.', facts, FORBIDDEN, none))
  assert.equal(four.length, 1)
  assert.match(four[0]!, /\b4\b/)
  assert.match(four[0]!, /four/)
  const won = problems(checkFacts('They won 7–1.', facts, FORBIDDEN, none))
  assert.equal(won.length, 1)
  assert.match(won[0]!, /\b7\b/)
  assert.equal(checkFacts('Down 4 goals.', facts, FORBIDDEN, none).ok, false)
  assert.equal(checkFacts('A 28.5% night.', facts, FORBIDDEN, none).ok, false)
  assert.equal(checkFacts('Forty hits.', facts, FORBIDDEN, none).ok, false)
  assert.equal(checkFacts('Thirty-eight shots.', facts, FORBIDDEN, none).ok, false)
  assert.equal(checkFacts('Seven shots.', facts, FORBIDDEN, none).ok, false)
})

void test('0, 1, zero and one are always allowed; ordinals are not checked', () => {
  assert.deepEqual(
    checkFacts(
      'Zero goals, one lesson, the fourth line, a third-period fade, 1st in nothing.',
      facts,
      FORBIDDEN,
      none,
    ),
    { ok: true },
  )
})

void test('a forbidden name fails (case-insensitive, word-bounded)', () => {
  const r = checkFacts('hidden   hank scored late.', facts, FORBIDDEN, none)
  assert.equal(r.ok, false)
  // C1.3: the problem never repeats the name (rewrite prompt, last_error, logs).
  assert.deepEqual(problems(r), ['The text names a person who is not on the fact sheet.'])
  assert.doesNotMatch(problems(r).join(' '), /hank/i)
  const two = checkFacts('Hidden Hank and Quiet Quinn.', facts, [...FORBIDDEN, 'Quiet Quinn'], none)
  assert.deepEqual(problems(two), [FORBIDDEN_NAME_PROBLEM])
  // Listed in mentions too: still no name in the problem.
  const listed = checkFacts('Hidden Hank scored.', facts, FORBIDDEN, {
    mentions: ['Hidden Hank'],
    clubs: [],
  })
  assert.deepEqual(problems(listed), [FORBIDDEN_NAME_PROBLEM])
  assert.deepEqual(checkFacts('Hidden Hanky is a different word.', facts, FORBIDDEN, none), {
    ok: true,
  })
  assert.deepEqual(checkFacts('Skater A scored.', facts, ['Skater'], none).ok, false)
  assert.deepEqual(checkFacts('Skater A scored.', facts, [''], none), { ok: true })
})

void test('mentions must be people on the sheet or reporters', () => {
  assert.equal(checkFacts('Fine.', facts, FORBIDDEN, { mentions: ['Igor'], clubs: [] }).ok, false)
  assert.deepEqual(
    checkFacts('Fine.', facts, FORBIDDEN, { mentions: ['Skater A', 'Dex Mercer'], clubs: [] }),
    { ok: true },
  )
})

void test('clubs must be opponents on the sheet (spacing and case ignored)', () => {
  assert.deepEqual(
    checkFacts('Fine.', facts, FORBIDDEN, {
      mentions: [],
      clubs: ['shake  n bake', 'WestKent Creamers'],
    }),
    { ok: true },
  )
  const r = checkFacts('Fine.', facts, FORBIDDEN, { mentions: [], clubs: ['Other Club'] })
  assert.equal(r.ok, false)
  assert.match(problems(r).join(' '), /Other Club/)
})

void test('post length: 280 characters pass, 281 fail', () => {
  assert.deepEqual(checkFacts('a'.repeat(280), facts, FORBIDDEN, none), { ok: true })
  const r = checkFacts('a'.repeat(281), facts, FORBIDDEN, none)
  assert.equal(r.ok, false)
  assert.match(problems(r).join(' '), /280/)
})

void test('article length: 250-450 words', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ')
  assert.deepEqual(checkFacts(words(449), night, FORBIDDEN, none), { ok: true })
  assert.deepEqual(checkFacts(words(450), night, FORBIDDEN, none), { ok: true })
  assert.deepEqual(checkFacts(words(250), night, FORBIDDEN, none), { ok: true })
  assert.equal(checkFacts(words(451), night, FORBIDDEN, none).ok, false)
  assert.equal(checkFacts(words(249), night, FORBIDDEN, none).ok, false)
  assert.equal(checkFacts(words(449), oct12Facts('week'), FORBIDDEN, none).ok, true)
})

void test('checkArticleFacts checks headline and dek for numbers but not length', () => {
  const para = Array.from({ length: 300 }, () => 'word').join(' ')
  const ok = checkArticleFacts(
    {
      headline: 'Twelve Against, Two For',
      dek: 'Forty-five shots.',
      paragraphs: [para],
      summary: 'S',
      mentions: [],
      clubs: [],
      criticized: [],
    },
    night,
    FORBIDDEN,
  )
  assert.deepEqual(ok, { ok: true })
  const bad = checkArticleFacts(
    {
      headline: 'Seven goals',
      dek: 'x',
      paragraphs: [para],
      summary: 'S',
      mentions: [],
      clubs: [],
      criticized: [],
    },
    night,
    FORBIDDEN,
  )
  assert.equal(bad.ok, false)
})

void test('ids and clock digits are not stats (R16)', () => {
  const base = oct12Facts('game')
  const withIds = {
    ...base,
    people: base.people.map((p) => (p.playerId === 1 ? { ...p, playerId: 21 } : p)),
    games: base.games.map((g, i) => ({
      ...g,
      matchId: 98765 + i,
      playedAt: '2026-10-13T02:15:37.000Z',
      players: g.players.map((l) => (l.playerId === 1 ? { ...l, playerId: 21 } : l)),
      periods: [{ period: 3, goalsFor: 0, goalsAgainst: 0 }],
    })),
  }
  const a = allowedNumbers(withIds)
  for (const n of [21, 37, 15, 98765]) assert.equal(a.has(n), false, String(n))
  assert.equal(checkFacts('Skater A had 21 hits.', withIds, FORBIDDEN, none).ok, false)
  assert.equal(checkFacts('Skater A had 37 shots.', withIds, FORBIDDEN, none).ok, false)
  assert.equal(checkFacts('Fifteen shots.', withIds, FORBIDDEN, none).ok, false)
  // the night date and the title number stay allowed
  assert.deepEqual(checkFacts('NHL 27, night of 2026-10-12.', withIds, FORBIDDEN, none), {
    ok: true,
  })
})

// ── Goal timeline clocks (B1) ────────────────────────────────────────────────

function withTimeline(kind: 'game' | 'night' = 'game') {
  const f = oct12Facts(kind)
  f.games[0] = {
    ...f.games[0]!,
    goals: [
      { period: '1st', clock: '03:58', side: 'for', scorer: 'Skater A', assists: ['Skater B'] },
      { period: '2nd', clock: '18:44', side: 'against', scorer: null, assists: [] },
    ],
    clockMeaning: 'elapsed',
  }
  return f
}

void test('timeline: a clock on the sheet passes, also without the leading zero (B1)', () => {
  const f = withTimeline()
  for (const t of [
    'Skater A scored at 03:58 of the first.',
    'Skater A scored at 3:58 of the first, and they answered at 18:44 of the second.',
  ]) {
    assert.deepEqual(checkFacts(t, f, FORBIDDEN, none), { ok: true }, t)
  }
})

void test('timeline: a clock not on the sheet fails as a game clock (B1)', () => {
  const p = problems(checkFacts('A goal at 12:34 of the third.', withTimeline(), FORBIDDEN, none))
  assert.deepEqual(p, ['The game clock 12:34 is not on the fact sheet.'])
  // No timeline at all: every clock fails.
  assert.equal(checkFacts('At 03:58 of the first.', oct12Facts(), FORBIDDEN, none).ok, false)
  // Articles are checked the same way.
  const night = withTimeline('night')
  const body = Array.from({ length: 300 }, () => 'word').join(' ')
  const r = checkArticleFacts(
    {
      headline: 'Late at 12:34',
      dek: 'x',
      paragraphs: [body],
      summary: 's',
      criticized: [],
      mentions: [],
      clubs: [],
    },
    night,
    FORBIDDEN,
  )
  assert.deepEqual(problems(r), ['The game clock 12:34 is not on the fact sheet.'])
})

void test('timeline: clock digits are not stats (B1)', () => {
  const f = withTimeline()
  const a = allowedNumbers(f)
  for (const n of [58, 18, 44]) assert.equal(a.has(n), false, String(n))
  assert.equal(checkFacts('They had 58 shots.', f, FORBIDDEN, none).ok, false)
  assert.equal(checkFacts('Forty-four hits.', f, FORBIDDEN, none).ok, false)
})

void test('criticized: only people on the sheet; never an "easy" player (rev 2, B4)', () => {
  assert.deepEqual(
    checkFacts('Fine.', facts, FORBIDDEN, { ...none, criticized: ['Skater A', 'Goalie G'] }),
    { ok: true },
  )
  const stranger = checkFacts('Fine.', facts, FORBIDDEN, { ...none, criticized: ['Igor'] })
  assert.deepEqual(problems(stranger), ['"Igor" in criticized is not a person on the fact sheet.'])
  const hidden = checkFacts('Fine.', facts, FORBIDDEN, { ...none, criticized: ['Hidden Hank'] })
  assert.deepEqual(problems(hidden), [FORBIDDEN_NAME_PROBLEM])
  // Skater B is at press level "easy": criticism of him stays mild.
  const easy = checkFacts('Fine.', facts, FORBIDDEN, { ...none, criticized: ['Skater B'] })
  assert.deepEqual(problems(easy), [
    'Skater B is at press level "easy": criticism of Skater B must stay mild.',
  ])
})

void test('pile-on: a person already criticised harshly tonight fails (rev 2, B4)', () => {
  const r = checkFacts('Fine.', facts, FORBIDDEN, { ...none, criticized: ['Skater A'] }, [
    'Goalie G',
    'skater a',
  ])
  assert.deepEqual(problems(r), [
    'Skater A was already criticised harshly tonight — take another angle.',
  ])
  assert.deepEqual(
    checkFacts('Fine.', facts, FORBIDDEN, { ...none, criticized: ['Skater A'] }, ['Goalie G']),
    { ok: true },
  )
  // Not criticising anyone never fails, whatever happened earlier.
  assert.deepEqual(checkFacts('Fine.', facts, FORBIDDEN, none, ['Skater A']), { ok: true })
  const para = Array.from({ length: 300 }, () => 'word').join(' ')
  const a = checkArticleFacts(
    {
      headline: 'H',
      dek: 'D',
      paragraphs: [para],
      summary: 'S',
      mentions: [],
      clubs: [],
      criticized: ['Goalie G'],
    },
    night,
    FORBIDDEN,
    ['Goalie G'],
  )
  assert.deepEqual(problems(a), [
    'Goalie G was already criticised harshly tonight — take another angle.',
  ])
})

// ── Weekly features (rev 2, B3) ─────────────────────────────────────────────

const week = oct12Facts('week')
const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ')
function feature(over: Partial<Parameters<typeof checkFeatureFacts>[0]> = {}) {
  return {
    headline: 'H',
    dek: 'D',
    paragraphs: [words(350), words(350)],
    summary: 'S',
    mentions: [],
    clubs: [],
    criticized: [],
    prediction: 'The club wins the week.',
    receipt: '',
    ...over,
  }
}
const trend = { kind: 'trend' as const, previousPrediction: null }

void test('feature: body 600-900 words', () => {
  assert.deepEqual(checkFeatureFacts(feature(), week, FORBIDDEN, trend), { ok: true })
  assert.deepEqual(
    checkFeatureFacts(feature({ paragraphs: [words(900)] }), week, FORBIDDEN, trend),
    { ok: true },
  )
  assert.deepEqual(
    problems(checkFeatureFacts(feature({ paragraphs: [words(599)] }), week, FORBIDDEN, trend)),
    ['The article body has 599 words. It must have 600 to 900.'],
  )
  assert.equal(
    checkFeatureFacts(feature({ paragraphs: [words(901)] }), week, FORBIDDEN, trend).ok,
    false,
  )
})

void test('feature: a notes column has 10-15 items, one paragraph each', () => {
  const notes = { kind: 'notes' as const, previousPrediction: null }
  const items = (n: number) => Array.from({ length: n }, () => words(Math.ceil(700 / n)))
  assert.deepEqual(checkFeatureFacts(feature({ paragraphs: items(10) }), week, FORBIDDEN, notes), {
    ok: true,
  })
  assert.deepEqual(checkFeatureFacts(feature({ paragraphs: items(15) }), week, FORBIDDEN, notes), {
    ok: true,
  })
  assert.deepEqual(
    problems(checkFeatureFacts(feature({ paragraphs: items(9) }), week, FORBIDDEN, notes)),
    ['The notes column has 9 items. It must have 10 to 15, one paragraph each.'],
  )
  assert.equal(
    checkFeatureFacts(feature({ paragraphs: items(16) }), week, FORBIDDEN, notes).ok,
    false,
  )
  // Other kinds have no item count.
  assert.deepEqual(checkFeatureFacts(feature({ paragraphs: items(20) }), week, FORBIDDEN, trend), {
    ok: true,
  })
})

void test('feature: the prediction has no digits and no number words', () => {
  for (const bad of [
    'They win 2 games.',
    'They win two games.',
    'Twenty-five shots or more.',
    'A dozen goals.',
    'They win twice.',
  ]) {
    const r = checkFeatureFacts(feature({ prediction: bad }), week, FORBIDDEN, trend)
    assert.ok(
      problems(r).some((p) => p.startsWith('The prediction must have no numbers')),
      bad,
    )
  }
  assert.deepEqual(
    checkFeatureFacts(
      feature({ prediction: 'Someone finally beats the goalie.' }),
      week,
      FORBIDDEN,
      trend,
    ),
    { ok: true },
  )
  // Names in the prediction are checked as everywhere.
  assert.deepEqual(
    problems(
      checkFeatureFacts(feature({ prediction: 'Hidden Hank scores.' }), week, FORBIDDEN, trend),
    ),
    [FORBIDDEN_NAME_PROBLEM],
  )
})

void test('feature: a receipt when there is a previous prediction, one or two sentences; else empty', () => {
  const prev = { kind: 'trend' as const, previousPrediction: 'The club wins the week.' }
  assert.deepEqual(
    checkFeatureFacts(feature({ receipt: 'It came true. Barely.' }), week, FORBIDDEN, prev),
    { ok: true },
  )
  assert.deepEqual(problems(checkFeatureFacts(feature(), week, FORBIDDEN, prev)), [
    "The receipt is empty. Say in one or two sentences whether last week's prediction came true.",
  ])
  assert.deepEqual(
    problems(checkFeatureFacts(feature({ receipt: 'One. Two. Three.' }), week, FORBIDDEN, prev)),
    ['The receipt has 3 sentences. It must have one or two.'],
  )
  assert.deepEqual(
    problems(checkFeatureFacts(feature({ receipt: 'It came true.' }), week, FORBIDDEN, trend)),
    ['There was no previous prediction, so the receipt must be an empty string.'],
  )
  // The receipt's numbers come from the sheet like any other text.
  assert.equal(
    checkFeatureFacts(feature({ receipt: 'They won 7 games.' }), week, FORBIDDEN, prev).ok,
    false,
  )
})

void test('history weekStart dates are not stats; the week key still is allowed (rev 2)', () => {
  const w = {
    ...oct12Facts('week'),
    key: '2026-10-12',
    history: [
      {
        weekStart: '2026-09-21',
        wins: 3,
        losses: 2,
        otl: 0,
        goalsFor: 15,
        goalsAgainst: 11,
        shotsFor: 80,
        shotsAgainst: 66,
        ppGoals: 2,
        ppOpportunities: 5,
      },
    ],
  }
  const allowed = allowedNumbers(w)
  for (const n of [15, 11, 80, 66, 5]) assert.ok(allowed.has(n), String(n))
  // 21 comes only from the history date: an invented "21 shots" must fail.
  assert.equal(allowed.has(21), false)
  assert.equal(checkFacts('They had 21 shots.', w, FORBIDDEN, none).ok, false)
  // The week's own key stays allowed (12 from 2026-10-12).
  assert.ok(allowed.has(12))
})

// ── Part C1: AI goalies (spec 12.8) ─────────────────────────────────────────

const LEHMANN = {
  name: 'Matteo Lehmann',
  saves: 10,
  shotsAgainst: 16,
  goalsAgainst: 6,
  savePct: 62.5,
}

void test('AI goalie: the name on the sheet is allowed in text and mentions, never in criticized (C1.1)', () => {
  const f = oct12Facts('game')
  f.games[1] = { ...f.games[1]!, aiGoalieInNet: true, aiGoalie: LEHMANN }
  assert.deepEqual(
    checkFacts('Matteo Lehmann stopped 10 of 16.', f, FORBIDDEN, {
      mentions: ['Matteo Lehmann'],
      clubs: [],
    }),
    { ok: true },
  )
  // Not a person: no pile-on list, no press level.
  const harsh = checkFacts('Fine.', f, FORBIDDEN, { ...none, criticized: ['Matteo Lehmann'] })
  assert.deepEqual(problems(harsh), [
    '"Matteo Lehmann" in criticized is not a person on the fact sheet.',
  ])
  // With an AI goalie in net, both AI goalie names are allowed (C2.12).
  const other = checkFacts('Fine.', f, FORBIDDEN, { mentions: ['Jonas Wagner'], clubs: [] })
  assert.deepEqual(other, { ok: true })
  // Without the line the name is not allowed either.
  assert.equal(
    checkFacts('Fine.', facts, FORBIDDEN, { mentions: ['Matteo Lehmann'], clubs: [] }).ok,
    false,
  )
})

void test('AI goalie: week totals names are allowed in an article (C1.1)', () => {
  const w = oct12Facts('week')
  w.aiGoalieWeek = [{ ...LEHMANN, games: 2 }]
  const r = checkArticleFacts(
    {
      headline: 'A week',
      dek: 'Fine.',
      paragraphs: [Array.from({ length: 260 }, () => 'word').join(' ')],
      summary: 'Fine.',
      mentions: ['Matteo Lehmann'],
      clubs: [],
      criticized: [],
    },
    w,
    FORBIDDEN,
  )
  assert.deepEqual(r, { ok: true })
})

void test('AI goalie: in net without a line (ended early), both AI goalie names are still allowed (C2.12)', () => {
  const f = oct12Facts('game')
  f.games[0] = { ...f.games[0]!, aiGoalieInNet: true, aiGoalie: null }
  for (const name of ['Matteo Lehmann', 'Jonas Wagner']) {
    assert.deepEqual(
      checkFacts(`${name} was in net.`, f, FORBIDDEN, { mentions: [name], clubs: [] }),
      { ok: true },
      name,
    )
  }
  // No AI goalie in net anywhere: neither name.
  assert.equal(
    checkFacts('Fine.', facts, FORBIDDEN, { mentions: ['Jonas Wagner'], clubs: [] }).ok,
    false,
  )
})

// ── Part C1: club lore (spec 12.13) ─────────────────────────────────────────

void test('lore: the farm team is an allowed club name; lore is never a stat source (C1.7)', () => {
  assert.deepEqual(
    checkFacts('The Oregon Outlaws are the farm team.', facts, FORBIDDEN, {
      mentions: [],
      clubs: ['Oregon Outlaws', 'oregon  outlaws'],
    }),
    { ok: true },
  )
  const f = oct12Facts('game')
  f.lore = [...f.lore, 'The club was founded in 1987.']
  assert.equal(allowedNumbers(f).has(1987), false)
  assert.equal(checkFacts('Founded in 1987.', f, FORBIDDEN, none).ok, false)
})

// ── Part C1: team norms (spec 12.10) ────────────────────────────────────────

void test('norms: the averages and lead % may be quoted; labels, patterns and the sample size may not (C1.2)', () => {
  const f = oct12Facts('game') // a post: no word-count rule
  const before = allowedNumbers(f)
  for (const n of [42, 13, 16.8, 35.7, 14.2, 312.5]) assert.equal(before.has(n), false, String(n))
  f.norms = {
    '3s': null,
    '6s': {
      sampleGames: 42,
      hits: { ours: 14.2, theirs: 16.8, leadPct: 35.7 },
      shots: null,
      timeOnAttack: { ours: 312.5, theirs: 300, leadPct: 60 },
      passPct: null,
      ppPct: null,
    },
  }
  f.games[0] = {
    ...f.games[0]!,
    labels: {
      hitsFor: 'typical',
      hitsAgainst: 'unusually low',
      shotsFor: 'unusually low',
      shotsAgainst: 'typical',
      timeOnAttack: null,
      passPct: null,
    },
    patterns: ['the Boogeymen were out-shot for the first time in 13 games'],
  }
  const a = allowedNumbers(f)
  for (const n of [14.2, 16.8, 35.7, 312.5]) assert.ok(a.has(n), String(n))
  assert.equal(a.has(42), false, 'sampleGames is not a stat')
  // Patterns are words: their run counts are not stats (C1 fix 3).
  assert.equal(a.has(13), false, 'a pattern count is not a stat')
  assert.deepEqual(checkFacts('Out-hit in 35.7% of games.', f, FORBIDDEN, none), { ok: true })
  assert.equal(checkFacts('Across 42 games.', f, FORBIDDEN, none).ok, false)
})

void test('club record holders are allowed names; a null holder adds none; holders are not people for criticized (C2.4)', () => {
  const f = oct12Facts('game')
  f.records = [
    { stat: 'goals', holder: 'Old Sniper', value: 61, title: 'NHL 24' },
    { stat: 'assists', holder: null, value: 80, title: 'NHL 25' },
  ]
  assert.deepEqual(
    problems(
      checkFacts('Old Sniper set the record with 61 in NHL 24.', f, FORBIDDEN, {
        mentions: ['Old Sniper'],
        clubs: [],
      }),
    ),
    [],
  )
  assert.deepEqual(
    problems(
      checkFacts('Fine.', f, FORBIDDEN, { mentions: [], clubs: [], criticized: ['Old Sniper'] }),
    ),
    ['"Old Sniper" in criticized is not a person on the fact sheet.'],
  )
  assert.deepEqual(
    problems(
      checkFacts('Fine.', oct12Facts('game'), FORBIDDEN, { mentions: ['Old Sniper'], clubs: [] }),
    ),
    ['"Old Sniper" is not a person on the fact sheet.'],
  )
})

void test("threads: a summary's numbers may be quoted; the key's player id and the since date may not; stances are not stats; the sheet key stays (C2.8)", () => {
  const f = oct12Facts('game')
  f.threads = [
    {
      key: 'player-slump:83@2026-03-19',
      kind: 'player-slump',
      subject: 'Skater A',
      since: '2026-03-19',
      status: 'open',
      summary: 'Skater A: no goal in 51 games',
    },
  ]
  f.stances = [
    {
      threadKey: 'player-slump:83@2026-03-19',
      reporter: 'quill',
      stance: 'He will score 33 soon.',
      night: '2026-09-30',
    },
  ]
  const a = allowedNumbers(f)
  assert.ok(a.has(51))
  for (const x of [83, 19, 33, 30]) assert.equal(a.has(x), false, String(x))
  // The sheet's own key (a date) still counts.
  assert.ok(a.has(2026) && a.has(12))
})

void test('ranked facts: the text may be quoted; the id and the weight are not stats (C2.7)', () => {
  const f = oct12Facts('game')
  f.topFacts = [
    { id: 'g90001:p83:big:goals', text: 'Skater A: 51 shots', weight: 77, subject: 'Skater A' },
  ]
  const a = allowedNumbers(f)
  assert.ok(a.has(51))
  assert.equal(a.has(77), false)
  assert.equal(a.has(83), false)
  assert.equal(a.has(90001), false)
})

void test('labelClaims: drama only when a label supports it (C2)', () => {
  const plain = oct12Facts('game')
  const claims = [
    'A career-high night for Skater A.',
    'His season high in shots.',
    'The slump goes on.',
    'What an upset.',
    'Time to panic.',
    'A blowout.',
    'His first goal of the season came late.',
    'A new club record for Skater A.',
    'He broke the club scoring record.',
  ]
  for (const t of claims) assert.equal(labelClaims(t, plain).length, 1, t)
  // A plain win-loss record and ordinary words are not claims.
  assert.deepEqual(
    labelClaims('They are 9-11-1 on the record this title, first in shots.', plain),
    [],
  )
  assert.deepEqual(labelClaims('The first period of the game; the season goes on.', plain), [])

  // A deep copy: the fixture's game objects are shared.
  const f = structuredClone(oct12Facts('game'))
  const g = f.games[0]!
  const p = g.players[0]!
  p.bests = ['career high shots']
  p.streaks = [{ kind: 'noGoal', games: 9, status: 'extended' }]
  p.firsts = ['first goal of the season']
  g.context = {
    result: 'panic',
    streakBefore: { kind: 'L', count: 4 },
    streakAfter: { kind: 'L', count: 5 },
    last10: { wins: 2, losses: 7, otl: 1 },
    margin: 'blowout',
    surprise: 'big upset',
    night: [],
  }
  g.newRecords = [{ stat: 'goals', name: 'Skater A', value: 62 }]
  for (const t of claims) assert.deepEqual(labelClaims(t, f), [], t)
  // A season high is supported by a career high too; a slump by a thread alone.
  const t = oct12Facts('game')
  t.threads = [
    {
      key: 'player-slump:1@2026-10-01',
      kind: 'player-slump',
      subject: 'Skater A',
      since: '2026-10-01',
      status: 'open',
      summary: 'Skater A: no goal in 9 games',
    },
  ]
  assert.deepEqual(labelClaims('The slump.', t), [])
  assert.deepEqual(labelClaims('A career high.', plain), [
    'It says "career high", but no line on the fact sheet has a career high.',
  ])
})
