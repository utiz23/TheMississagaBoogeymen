import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FORBIDDEN_NAME_PROBLEM,
  allowedNumbers,
  checkArticleFacts,
  checkFacts,
  checkFeatureFacts,
  checkGamePosts,
  contrastCount,
  labelClaims,
  numberTokens,
  shotPairs,
  signatureWordCount,
  withoutSheetNames,
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
  label: 'meltdown' as const,
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
    { stat: 'goals', holder: 'Old Sniper', holderPressLevel: 'full', value: 61, title: 'NHL 24' },
    { stat: 'assists', holder: null, holderPressLevel: null, value: 80, title: 'NHL 25' },
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

void test('labelClaims: an AI goalie meltdown or steal only with the sheet label (C2 fix M1)', () => {
  const f = oct12Facts('game')
  for (const t of [
    'Matteo Lehmann had a meltdown.',
    'A melt-down in net.',
    'Lehmann stole the game.',
    'That win was a steal.',
  ])
    assert.equal(labelClaims(t, f).length, 1, t)
  // A steal of the puck is not a claim.
  assert.deepEqual(labelClaims('Two steals and a takeaway.', f), [])
  const melt = oct12Facts('game')
  melt.games[1] = { ...melt.games[1]!, aiGoalieInNet: true, aiGoalie: LEHMANN }
  assert.deepEqual(labelClaims('Matteo Lehmann had a meltdown.', melt), [])
  assert.equal(labelClaims('Lehmann stole the game.', melt).length, 1)
})

void test('labelClaims: no over-blocking on plain records, team slides, team season bests or a far "first" (C2 fix I3)', () => {
  const plain = oct12Facts('game')
  // A team record followed by a W-L-OTL record is no claim; a bare "team record" still is.
  assert.deepEqual(labelClaims('The team record now sits at 12-3-1.', plain), [])
  assert.equal(labelClaims('A new team record for the club.', plain).length, 1)
  // "slump" during a slide (or panic, or a losing-streak thread).
  const slide = structuredClone(oct12Facts('game'))
  slide.games[0]!.context = {
    result: 'slide',
    streakBefore: { kind: 'L', count: 2 },
    streakAfter: { kind: 'L', count: 3 },
    last10: { wins: 5, losses: 4, otl: 1 },
    margin: 'comfortable',
    surprise: 'expected',
    night: [],
  }
  assert.deepEqual(labelClaims('The team is in a slump.', slide), [])
  assert.equal(labelClaims('The team is in a slump.', plain).length, 1)
  // "season high" with a team season-best note.
  const best = structuredClone(oct12Facts('game'))
  best.games[0]!.teamNotes = ['most goals in a 6s game this season: 7']
  assert.deepEqual(labelClaims('A season-high seven goals.', best), [])
  // A longest-streak note is no season high.
  best.games[0]!.teamNotes = ['longest win streak of the season: 6']
  assert.equal(labelClaims('A season-high seven goals.', best).length, 1)
  // "first" far from "of the season".
  assert.deepEqual(
    labelClaims('He was first to the puck in the best game of the season.', plain),
    [],
  )
  assert.equal(labelClaims('His first goal of the season.', plain).length, 1)
})

// ── C3a.5: style and craft checks ───────────────────────────────────────────

const pad = (n: number) => Array.from({ length: n }, () => 'hockey').join(' ')
const has = (r: ReturnType<typeof checkFacts>, re: RegExp) => problems(r).some((p) => re.test(p))

void test('C3a.5 signature words: a post at most 1, an article at most 3 DISTINCT words (fix S3)', () => {
  assert.equal(signatureWordCount('A messy, messy, messy night.', 'barlow'), 1)
  assert.equal(signatureWordCount('Messy structure, messy finish.', 'barlow'), 2)
  assert.equal(signatureWordCount('Messily done; a clean detail.', 'barlow'), 0)
  assert.equal(signatureWordCount('The truth is, frankly, soft.', 'pettibone'), 3)
  // Generic words are not counted: Rink's "night", Quill's "trend".
  assert.equal(signatureWordCount('Night after night, the night.', 'rink'), 0)
  assert.equal(signatureWordCount('The trend holds.', 'quill'), 0)
  const post = (text: string) =>
    checkFacts(text, facts, FORBIDDEN, none, [], { reporter: 'barlow' })
  assert.deepEqual(post('A messy night, messy again.'), { ok: true })
  assert.ok(
    has(
      post('A messy night, a structure problem.'),
      /Lean less on your signature words: at most 1/,
    ),
  )
  // No reporter given: no signature count.
  assert.deepEqual(checkFacts('A messy night, a structure problem.', facts, FORBIDDEN, none), {
    ok: true,
  })
  const body = (text: string) => ({
    headline: 'Shake N Bake win the night',
    dek: 'The Boogeymen lose twice.',
    paragraphs: [`${text} ${pad(260)}`],
    summary: 'S.',
    mentions: [],
    clubs: [],
    criticized: [],
  })
  const art = (text: string) =>
    checkArticleFacts(body(text), night, FORBIDDEN, [], { reporter: 'barlow' })
  assert.deepEqual(art('Messy. Structure. Survive. Messy again.'), { ok: true })
  assert.ok(
    problems(art('Messy. Structure. Survive. Repeatable.')).some((p) => /at most 3/.test(p)),
  )
})

void test('C3a.5 format labels, one "not X ... Y" contrast, reply jabs and a number in replies', () => {
  for (const t of [
    'The tactical point is simple.',
    'It was less comfortable.',
    'The detail: shots.',
  ]) {
    assert.ok(has(checkFacts(t, facts, FORBIDDEN, none), /format label/), t)
  }
  assert.deepEqual(checkFacts('It was not luck, but the shots said 14.', facts, FORBIDDEN, none), {
    ok: true,
  })
  assert.ok(
    has(
      checkFacts(
        'It was not luck, but shots. It was not skill, but volume.',
        facts,
        FORBIDDEN,
        none,
      ),
      /2 "not X \.\.\. Y" contrasts/,
    ),
  )
  const reply = (t: string) =>
    checkGamePosts(
      [
        { reporter: 'mercer', text: 'Fine night, 2-6.', ...none, criticized: [] },
        { reporter: 'barlow', text: t, ...none, criticized: [] },
      ],
      facts,
      FORBIDDEN,
      [],
      { replies: [false, true] },
    )
  assert.deepEqual(reply('Shots were 14 to 29. That is the story.'), { ok: true })
  for (const jab of ['clicks', 'outrage', 'jealous', 'clipboard', 'shows up', 'timing']) {
    assert.ok(
      problems(reply(`Mercer chases ${jab}, 14 shots say otherwise.`)).some((p) => p.includes(jab)),
      jab,
    )
  }
  assert.ok(problems(reply('Nothing to add.')).some((p) => /name one/.test(p)))
})

void test('C3a.5 pronouns, numbers per sentence, clock times per article', () => {
  for (const w of ['we', 'us', 'our', 'ours', 'We']) {
    assert.ok(has(checkFacts(`That one hurt ${w}.`, facts, FORBIDDEN, none), /outside media/), w)
  }
  assert.deepEqual(checkFacts('Trust the usual numbers.', facts, FORBIDDEN, none), { ok: true })
  assert.equal(numberTokens('A 2-6 loss with 14 shots and 29 against.'), 3)
  assert.equal(numberTokens('Record 9-11-1, 83.1% at 3:58.'), 3)
  assert.equal(numberTokens('Two goals, three shots and six hits, plus 14.'), 4)
  assert.ok(
    has(
      checkFacts('A 2-6 loss, 14 shots, 29 against and 10 hits.', facts, FORBIDDEN, none),
      /has 4 numbers/,
    ),
  )
  const timeline = oct12Facts('night')
  timeline.games[0] = {
    ...timeline.games[0]!,
    goals: [
      { period: '1st', clock: '03:58', team: 'for', scorer: 'Skater A', assists: [] },
      { period: '2nd', clock: '10:12', team: 'against', scorer: null, assists: [] },
      { period: '3rd', clock: '18:44', team: 'against', scorer: null, assists: [] },
    ],
    clockMeaning: 'elapsed',
  } as never
  const clocks = (t: string) =>
    checkArticleFacts(
      {
        headline: 'H',
        dek: 'D',
        paragraphs: [`${t} ${pad(260)}`],
        summary: 'S',
        ...none,
        criticized: [],
      },
      timeline,
      FORBIDDEN,
    )
  assert.ok(!problems(clocks('Goals at 3:58 and 10:12.')).some((p) => /clock times/.test(p)))
  assert.ok(
    problems(clocks('Goals at 3:58, then 10:12. Then 18:44.')).some((p) => /3 clock times/.test(p)),
  )
})

void test('C3a.5 "X of Y shots" / "X on Y shots" must be a real goals-and-shots pair', () => {
  const pairs = shotPairs(facts)
  for (const k of ['2/14', '6/29', '23/29', '1/5', '23/29', '6/16', '0/3'])
    assert.ok(pairs.has(k), k)
  assert.deepEqual(checkFacts('Two goals on 14 shots.', facts, FORBIDDEN, none), { ok: true })
  assert.deepEqual(checkFacts('Goalie G stopped 23 of 29 shots.', facts, FORBIDDEN, none), {
    ok: true,
  })
  assert.ok(
    has(checkFacts('Two goals on 29 shots.', facts, FORBIDDEN, none), /not a goals-and-shots pair/),
  )
  assert.ok(
    has(
      checkFacts('Skater A: 1 of 14 shots.', facts, FORBIDDEN, none),
      /not a goals-and-shots pair/,
    ),
  )
})

void test('C3a.5 ended early: no numbers but the score; plus-minus and game score blocked', () => {
  const early = oct12Facts('game')
  early.games = [{ ...early.games[0]!, endedEarly: true, team: null }]
  assert.deepEqual(
    checkFacts('Shake N Bake won 6-2 in a game that ended early.', early, FORBIDDEN, none),
    {
      ok: true,
    },
  )
  assert.ok(
    has(
      checkFacts('A 6-2 loss with 5 shots from Skater A.', early, FORBIDDEN, none),
      /ended early/,
    ),
  )
  for (const t of [
    'His plus-minus was ugly.',
    'A +/- to forget.',
    'His game score says 2.',
    'A -2 skater.',
  ]) {
    assert.ok(has(checkFacts(t, facts, FORBIDDEN, none), /Plus-minus and game score/), t)
  }
})

void test('C3a.5 zero call-outs: never D/G, one per night, never two nights in a row; detected in text', () => {
  const f = oct12Facts('game')
  f.games[0] = {
    ...f.games[0]!,
    players: f.games[0]!.players.map((p) => (p.name === 'Skater B' ? { ...p, position: 'D' } : p)),
  }
  f.games = [f.games[0]!]
  const zero = (text: string, zeroCalled: string[], ctx = {}) =>
    checkFacts(text, f, FORBIDDEN, { ...none, zeroCalled }, [], ctx)
  assert.deepEqual(zero('Fine.', ['Skater A']), { ok: true })
  assert.ok(has(zero('Fine.', ['Skater B']), /no zero call-out for a defenceman or a goalie/))
  assert.ok(has(zero('Fine.', ['Goalie G']), /defenceman or a goalie/))
  assert.ok(
    has(zero('Fine.', ['Skater A'], { zeroCalledTonight: ['Goalie G'] }), /at most one per night/),
  )
  assert.ok(
    has(zero('Fine.', ['Skater A'], { zeroCalledPrevious: ['skater a'] }), /two nights in a row/),
  )
  assert.ok(has(zero('Fine.', ['Skater A', 'Goalie G']), /at most one player/))
  assert.ok(has(zero('Fine.', ['Nobody']), /not a person/))
  // Named with a zero but not listed.
  assert.ok(has(zero('Skater A had 0 points.', []), /list the player in "zeroCalled"/))
  assert.deepEqual(zero('The power play had zero goals.', []), { ok: true })
  // Two posts of one game: the second may not add a second call-out.
  const posts = checkGamePosts(
    [
      { reporter: 'barlow', text: 'Fine.', ...none, criticized: [], zeroCalled: ['Skater A'] },
      { reporter: 'quill', text: 'Fine.', ...none, criticized: [], zeroCalled: ['Skater A'] },
    ],
    f,
    FORBIDDEN,
  )
  assert.ok(problems(posts).some((p) => /at most one per night/.test(p)))
})

void test('C3a.5 headline, dek and opening rules; one-game night 120-200 words', () => {
  const a = (over: object) => ({
    headline: 'Shake N Bake run the table',
    dek: 'The Boogeymen fall to 9-11-1.',
    paragraphs: [pad(260)],
    summary: 'S.',
    ...none,
    criticized: [],
    ...over,
  })
  assert.deepEqual(checkArticleFacts(a({}), night, FORBIDDEN), { ok: true })
  assert.ok(
    problems(checkArticleFacts(a({ headline: 'Two wins, one loss' }), night, FORBIDDEN)).some((p) =>
      /not a tally/.test(p),
    ),
  )
  assert.ok(
    problems(checkArticleFacts(a({ headline: 'Down to 9-11-1' }), night, FORBIDDEN)).some((p) =>
      /both the headline and the dek/.test(p),
    ),
  )
  assert.ok(
    problems(checkArticleFacts(a({ dek: 'Shake N Bake run the table' }), night, FORBIDDEN)).some(
      (p) => /dek repeats the headline/.test(p),
    ),
  )
  assert.ok(
    problems(
      checkArticleFacts(
        a({ paragraphs: [`On Monday, October 12 the club fell to 9-11-1. ${pad(260)}`] }),
        night,
        FORBIDDEN,
      ),
    ).some((p) => /opens with the date and the record/.test(p)),
  )
  const single = oct12Facts('night')
  single.games = [single.games[0]!]
  assert.deepEqual(checkArticleFacts(a({ paragraphs: [pad(150)] }), single, FORBIDDEN), {
    ok: true,
  })
  assert.ok(
    problems(checkArticleFacts(a({}), single, FORBIDDEN)).some((p) =>
      /must have 120 to 200/.test(p),
    ),
  )
  // A big game's story and spotlight/column lengths (C3a.7).
  assert.deepEqual(
    checkArticleFacts(a({ paragraphs: [pad(300)] }), facts, FORBIDDEN, [], {
      length: 'game-story',
    }),
    { ok: true },
  )
  assert.ok(
    problems(
      checkArticleFacts(a({ paragraphs: [pad(450)] }), facts, FORBIDDEN, [], {
        length: 'game-story',
      }),
    ).some((p) => /200 to 350/.test(p)),
  )
  assert.deepEqual(
    checkArticleFacts(a({ paragraphs: [pad(500)] }), facts, FORBIDDEN, [], {
      length: 'game-feature',
    }),
    { ok: true },
  )
})

void test('C3a.5 profanity: strong words always blocked; mild only Mercer/Pettibone/Vale, at most one', () => {
  const t = (text: string, reporter?: 'mercer' | 'barlow' | 'vale') =>
    checkFacts(text, facts, FORBIDDEN, none, [], reporter === undefined ? {} : { reporter })
  assert.ok(has(t('What a shitshow.', 'mercer'), /never prints/))
  assert.deepEqual(t('Hell of a night.', 'mercer'), { ok: true })
  assert.deepEqual(t('Damn, that hurt.', 'vale'), { ok: true })
  assert.ok(has(t('Hell of a night.', 'barlow'), /Only Dex Mercer, Gord Pettibone and Rico Vale/))
  assert.ok(has(t('Hell of a night.'), /Only Dex Mercer/))
  assert.ok(has(t('Hell, damn.', 'mercer'), /2 mild swear words/))
  assert.deepEqual(t('Hello there, shell game.', 'barlow'), { ok: true })
})

void test('C3a.5 profanity and pronouns: a sheet name is never read as swearing or "our" (backfill 2026-10-26)', () => {
  const named = {
    ...facts,
    games: facts.games.map((g) => ({ ...g, opponentName: 'Hell Ya Our Crew' })),
  }
  const clubs = { mentions: [], clubs: ['Hell Ya Our Crew'] }
  const t = (text: string) => checkFacts(text, named, FORBIDDEN, clubs, [], { reporter: 'barlow' })
  assert.deepEqual(t('The Boogeymen beat Hell Ya Our Crew.'), { ok: true })
  // The word outside the name still counts.
  assert.ok(has(t('Hell Ya Our Crew had a hell of a night.'), /Only Dex Mercer/))
  assert.ok(has(t('Hell Ya Our Crew beat our club.'), /never "our"/))
})

void test('C3a.5 penalty minutes only from 10; label claims wired in; stances and takes', () => {
  assert.ok(
    has(checkFacts('Skater A took 2 penalty minutes.', facts, FORBIDDEN, none), /only from 10/),
  )
  assert.deepEqual(checkFacts('Skater A sat 10 penalty minutes.', facts, FORBIDDEN, none), {
    ok: true,
  })
  assert.ok(has(checkFacts('A career high for Skater A.', facts, FORBIDDEN, none), /career high/))
  const f = oct12Facts('game')
  f.threads = [
    {
      key: 'pp-drought@2026-10-08',
      kind: 'pp-drought',
      subject: null,
      since: '2026-10-08',
      status: 'open',
      summary: 'No power-play goal in 2 games.',
    },
  ]
  const st = (stances: { threadKey: string; stance: string }[]) =>
    checkFacts('Fine.', f, FORBIDDEN, { ...none, stances })
  assert.deepEqual(st([{ threadKey: 'pp-drought@2026-10-08', stance: 'It lasts.' }]), { ok: true })
  assert.ok(
    has(st([{ threadKey: 'rival:x@2026-01-01', stance: 'No.' }]), /not a thread on the fact sheet/),
  )
  // A stance's text gets the number check too.
  const posts = checkGamePosts(
    [
      {
        reporter: 'quill',
        text: 'Fine.',
        ...none,
        criticized: [],
        stances: [{ threadKey: 'pp-drought@2026-10-08', stance: 'It lasts 7 more games.' }],
      },
    ],
    f,
    FORBIDDEN,
  )
  assert.ok(problems(posts).some((p) => /The number 7 is not on the fact sheet/.test(p)))
  const takes = (takesUsed: number[], offeredTakes: number[]) =>
    checkFacts('Fine.', facts, FORBIDDEN, { ...none, takesUsed }, [], { offeredTakes })
  assert.deepEqual(takes([3], [3, 5]), { ok: true })
  assert.ok(has(takes([4], [3]), /Take 4 was not offered/))
  assert.ok(has(takes([3, 5], [3, 5]), /at most one reporter take/))
})

void test('C2 re-review: a score never cancels a record claim; a steal needs goalie context', () => {
  const plain = oct12Facts('game')
  for (const t of [
    'The Boogeymen set a team record in an 11-2 rout.',
    'A new club record: 7-3 win.',
    'A new team record for the club.',
  ]) {
    assert.equal(labelClaims(t, plain).length, 1, t)
  }
  for (const t of [
    'The team record now sits at 12-3-1.',
    'The team record stands at 12-3-1 after it.',
  ]) {
    assert.deepEqual(labelClaims(t, plain), [], t)
  }
  for (const t of [
    'Lehmann stole the game.',
    'Matteo Lehmann, quietly, stole it.',
    'A steal in net for the AI.',
    'That win was a steal.',
    'They stole a win.',
  ]) {
    assert.equal(labelClaims(t, plain).length, 1, t)
  }
  for (const t of [
    'A steal and a goal for Skater A.',
    'Skater A had a steal in the slot.',
    'Two steals.',
  ]) {
    assert.deepEqual(labelClaims(t, plain), [], t)
  }
})

void test('C3a.9 feature: the prediction and the receipt never repeat inside the body; the verdict fits', () => {
  const judged: { kind: 'trend'; previousPrediction: string | null } = {
    kind: 'trend',
    previousPrediction: 'The club wins the week.',
  }
  const receipt = 'Last week I said the club wins the week, and it did.'
  const p = (over: object, rules = judged) =>
    problems(checkFeatureFacts(feature(over), week, FORBIDDEN, rules))
  assert.deepEqual(p({ receipt, receiptVerdict: 'hit' }), [])
  assert.ok(
    p({
      receipt,
      receiptVerdict: 'hit',
      paragraphs: [words(340), 'The club wins the week.', words(340)],
    }).some((x) => /prediction is printed on its own/.test(x)),
  )
  assert.ok(
    p({
      receipt,
      receiptVerdict: 'hit',
      paragraphs: [`${receipt} ${words(340)}`, words(340)],
    }).some((x) => /receipt is printed on its own/.test(x)),
  )
  assert.ok(p({ receipt, receiptVerdict: null }).some((x) => /must be "hit" or "miss"/.test(x)))
  assert.ok(
    p({ receiptVerdict: 'miss' }, { kind: 'trend', previousPrediction: null }).some((x) =>
      /must be "none"/.test(x),
    ),
  )
  // A short receipt ("It did.") is no repeat even when the body has those words.
  assert.deepEqual(
    p({
      receipt: 'It did.',
      receiptVerdict: 'hit',
      paragraphs: [`It did. ${words(340)}`, words(340)],
    }),
    [],
  )
})

void test('C3a fix S2: the two-sentence contrast "It wasn\'t luck. It was structure." counts once', () => {
  assert.equal(contrastCount("It wasn't luck. It was structure."), 1)
  assert.equal(contrastCount('It was not luck, but shots.'), 1)
  assert.equal(contrastCount("It wasn't luck. It was structure. It was not skill, but volume."), 2)
  assert.equal(contrastCount('Shots were 14. It was a loss.'), 0)
  assert.ok(
    has(
      checkFacts(
        "It wasn't luck. It was 14 shots. It was not skill, but volume.",
        facts,
        FORBIDDEN,
        none,
      ),
      /2 "not X \.\.\. Y" contrasts/,
    ),
  )
})

void test('C3a fix I5: a zero is a call-out only when the named player is its subject, not a goal allowed', () => {
  const z = (text: string) => checkFacts(text, facts, FORBIDDEN, { ...none, zeroCalled: [] })
  for (const t of [
    'Goalie G stopped all 23 shots and allowed no goals.',
    'Goalie G made 23 saves; the opponent had no goals in the first.',
    'Skater A scored, and Shake N Bake had zero shots in the 3rd.',
    'Goalie G conceded no goals.',
    'Skater A had 2 points and no goals against while he was out there.',
  ]) {
    assert.ok(!has(z(t), /zeroCalled/), t)
  }
  for (const t of ['Skater A had 0 points.', 'Skater A finished with no shots.']) {
    assert.ok(has(z(t), /list the player in "zeroCalled"/), t)
  }
})

void test('C3a fix M3: digits inside sheet names are not numbers (per sentence, ended early)', () => {
  const f = oct12Facts('game')
  f.people = [...f.people, { playerId: 9, name: 'Sniper 99', pressLevel: 'full' }]
  f.games = [{ ...f.games[0]!, opponentName: 'Club 77', players: [...f.games[0]!.players] }]
  const t = 'Sniper 99 had 2 points, 5 shots and 14 team shots against Club 77 in NHL 27.'
  assert.equal(numberTokens(t), 6)
  assert.equal(numberTokens(withoutSheetNames(t, f)), 3)
  assert.ok(
    !has(
      checkFacts(t, f, FORBIDDEN, { mentions: ['Sniper 99'], clubs: ['Club 77'] }),
      /numbers\. Use at most 3/,
    ),
  )
  const early = structuredClone(f)
  early.games = [{ ...early.games[0]!, endedEarly: true, team: null }]
  assert.deepEqual(
    checkFacts('Club 77 won 6-2 in NHL 27; it ended early.', early, FORBIDDEN, {
      mentions: [],
      clubs: ['Club 77'],
    }),
    { ok: true },
  )
})

void test('C3a fix M4: "shows up on the scoresheet" is no jab; "no one" is not a number', () => {
  const reply = (t: string) =>
    checkGamePosts(
      [
        { reporter: 'mercer', text: 'Fine night, 2-6.', ...none, criticized: [] },
        { reporter: 'barlow', text: t, ...none, criticized: [] },
      ],
      facts,
      FORBIDDEN,
      [],
      { replies: [false, true] },
    )
  assert.deepEqual(reply('Skater A shows up on the scoresheet: 2 points.'), { ok: true })
  assert.ok(
    problems(reply('Mercer only shows up after a loss, 14 shots or not.')).some((p) =>
      p.includes('shows up'),
    ),
  )
  assert.ok(problems(reply('No one saw that coming.')).some((p) => /name one/.test(p)))
  // A prediction with "no one" has no number in it.
  const f = checkFeatureFacts(
    {
      headline: 'H',
      dek: 'D',
      paragraphs: [Array.from({ length: 700 }, () => 'word').join(' ')],
      summary: 'S',
      mentions: [],
      clubs: [],
      criticized: [],
      prediction: 'No one stops this club next week.',
      receipt: '',
    },
    oct12Facts('week'),
    FORBIDDEN,
    { kind: 'trend', previousPrediction: null },
  )
  assert.deepEqual(f, { ok: true })
})

void test('C3a fix M5: at most one mild swear word across headline, dek, summary and body', () => {
  const art = (over: object) => ({
    headline: 'Shake N Bake run the table',
    dek: 'The Boogeymen fall again.',
    paragraphs: [`What a night. ${pad(260)}`],
    summary: 'S.',
    mentions: [],
    clubs: [],
    criticized: [],
    ...over,
  })
  const run = (over: object) =>
    problems(checkArticleFacts(art(over), night, FORBIDDEN, [], { reporter: 'mercer' }))
  assert.deepEqual(run({ headline: 'Hell of a run for Shake N Bake' }), [])
  assert.ok(
    run({ headline: 'Hell of a run for Shake N Bake', paragraphs: [`Damn. ${pad(260)}`] }).some(
      (p) => /2 mild swear words across headline, dek, summary and body/.test(p),
    ),
  )
})
