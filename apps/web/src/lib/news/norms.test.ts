import test from 'node:test'
import assert from 'node:assert/strict'
import type { NewsGameFacts } from '@eanhl/db/news'
import {
  MIN_NORM_GAMES,
  applyNorms,
  buildNorms,
  gamePatterns,
  normInputFromRow,
  normLabels,
  ordinal,
  percentile,
  type NormGameInput,
} from './norms.ts'

const g = (over: Partial<NormGameInput> = {}): NormGameInput => ({
  gameMode: '6s',
  endedEarly: false,
  hitsFor: 10,
  hitsAgainst: 15,
  shotsFor: 20,
  shotsAgainst: 18,
  timeOnAttack: 400,
  timeOnAttackAgainst: 300,
  passPct: 75,
  passPctAgainst: 70,
  ppGoals: 1,
  ppOpportunities: 3,
  ppGoalsAgainst: 0,
  ppOpportunitiesAgainst: 2,
  ...over,
})

/** Ten games: hits 10..19 for (15 against), shots 20-18, TOA 400-300, pass 70..79 vs 70. */
const ten = (): NormGameInput[] =>
  Array.from({ length: 10 }, (_, i) => g({ hitsFor: 10 + i, passPct: 70 + i }))

void test('percentile: linear between the sorted values', () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  assert.equal(percentile(v, 0.2), 2.8)
  assert.equal(percentile(v, 0.8), 8.2)
  assert.equal(percentile([5], 0.2), 5)
})

void test('buildNorms: averages (one decimal) and how often the club led (C1.2)', () => {
  assert.equal(MIN_NORM_GAMES, 10)
  const n = buildNorms(ten())
  assert.deepEqual(n, {
    sampleGames: 10,
    hits: { ours: 14.5, theirs: 15, leadPct: 40 }, // 16..19 beat 15
    shots: { ours: 20, theirs: 18, leadPct: 100 },
    timeOnAttack: { ours: 400, theirs: 300, leadPct: 100 },
    passPct: { ours: 74.5, theirs: 70, leadPct: 90 }, // 70 ties, not a lead
    ppPct: { ours: 33.3, theirs: 0, leadPct: 100 }, // 10/30 power plays; 0/20 against
  })
})

void test('buildNorms: null below 10 games; a stat with numbers in under 10 games is null (C1.2)', () => {
  assert.equal(buildNorms(ten().slice(0, 9)), null)
  const games = ten().map((x, i) =>
    i < 2 ? { ...x, timeOnAttackAgainst: null, passPct: null, ppGoalsAgainst: null } : x,
  )
  const n = buildNorms([...games, g()])
  assert.equal(n?.sampleGames, 11)
  assert.equal(n?.timeOnAttack, null) // 9 games with both numbers
  assert.equal(n?.passPct, null)
  assert.equal(n?.ppPct, null)
  assert.notEqual(n?.hits, null)
  // Power play: no opportunities at all on one side gives no rate.
  const noPp = buildNorms(ten().map((x) => ({ ...x, ppOpportunitiesAgainst: 0 })))
  assert.equal(noPp?.ppPct, null)
})

void test('buildNorms: power play lead counts a side without chances as 0% (C1.2)', () => {
  const games = ten().map((x, i) =>
    i < 5
      ? { ...x, ppGoals: 0, ppOpportunities: 0, ppGoalsAgainst: 1, ppOpportunitiesAgainst: 2 }
      : { ...x, ppGoals: 1, ppOpportunities: 2, ppGoalsAgainst: 0, ppOpportunitiesAgainst: 0 },
  )
  assert.deepEqual(buildNorms(games)?.ppPct, { ours: 50, theirs: 50, leadPct: 50 })
})

void test('normLabels: outside the 20th-80th percentile is unusual; too few numbers is null (C1.2)', () => {
  const history = ten() // hitsFor 10..19: p20 = 11.8, p80 = 17.2
  assert.deepEqual(normLabels(g({ hitsFor: 11, passPct: 80 }), history), {
    hitsFor: 'unusually low',
    hitsAgainst: 'typical', // all 15
    shotsFor: 'typical',
    shotsAgainst: 'typical',
    timeOnAttack: 'typical',
    passPct: 'unusually high', // 70..79: p80 = 77.2
  })
  assert.equal(normLabels(g({ hitsFor: 18 }), history).hitsFor, 'unusually high')
  assert.equal(normLabels(g({ hitsFor: 17.2 }), history).hitsFor, 'typical')
  assert.equal(normLabels(g({ hitsAgainst: 16 }), history).hitsAgainst, 'unusually high')
  // The game has no number: null. The earlier games have it in under 10 games: null.
  assert.equal(normLabels(g({ timeOnAttack: null }), history).timeOnAttack, null)
  const sparse = history.map((x, i) => (i === 0 ? { ...x, passPct: null } : x))
  assert.equal(normLabels(g(), sparse).passPct, null)
})

void test('ordinal: 1st, 2nd, 3rd, 4th, 11th-13th, 21st', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal), [
    '1st',
    '2nd',
    '3rd',
    '4th',
    '11th',
    '12th',
    '13th',
    '21st',
    '22nd',
    '23rd',
    '101st',
    '111th',
    '112th',
  ])
})

void test('gamePatterns: a usual pattern held names the club and reads "as usual" (C1.2 fix)', () => {
  // Usually out-hit (15 vs 12), out-shooting, more time on attack.
  const history = ten().map((x) => ({ ...x, hitsFor: 12 }))
  assert.deepEqual(gamePatterns(g({ hitsFor: 9 }), history, history), [
    'the Boogeymen were out-hit as usual',
    'the Boogeymen out-shot the opponent as usual',
    'the Boogeymen had more time on attack as usual',
  ])
})

const shotsP = (p: string[]) => p.filter((x) => x.includes('shot'))
const OUT_SHOT = g({ shotsFor: 10, shotsAgainst: 30 })

void test('gamePatterns: a broken pattern after a gap of 3+ games; in a row as an ordinal (C1.2 fix)', () => {
  const sample = ten().map((x) => ({ ...x, hitsFor: 12 }))
  // Out-shot once, then five out-shooting games.
  const previous = [...sample, OUT_SHOT, ...Array.from({ length: 5 }, () => g())]
  assert.deepEqual(shotsP(gamePatterns(OUT_SHOT, previous, sample)), [
    'the Boogeymen were out-shot for the first time in 6 games',
  ])
  // Exactly 3 games between: still a pattern.
  assert.deepEqual(shotsP(gamePatterns(OUT_SHOT, [...sample, OUT_SHOT, g(), g(), g()], sample)), [
    'the Boogeymen were out-shot for the first time in 4 games',
  ])
  // A gap of 1 or 2 games: no string.
  assert.deepEqual(shotsP(gamePatterns(OUT_SHOT, [...sample, OUT_SHOT, g(), g()], sample)), [])
  assert.deepEqual(shotsP(gamePatterns(OUT_SHOT, [...sample, OUT_SHOT, g()], sample)), [])
  // The game before broke it too: the 2nd, then the 3rd game in a row.
  assert.deepEqual(shotsP(gamePatterns(OUT_SHOT, [...previous, OUT_SHOT], sample)), [
    'the Boogeymen were out-shot for the 2nd game in a row',
  ])
  assert.deepEqual(shotsP(gamePatterns(OUT_SHOT, [...previous, OUT_SHOT, OUT_SHOT], sample)), [
    'the Boogeymen were out-shot for the 3rd game in a row',
  ])
})

void test('gamePatterns: never before in the title; ties are no pattern (C1.2 fix)', () => {
  const sample = ten().map((x) => ({ ...x, hitsFor: 12 }))
  // A tie earlier is not "out-shot": this is the first time this title.
  assert.deepEqual(
    shotsP(gamePatterns(OUT_SHOT, [...sample, g({ shotsFor: 20, shotsAgainst: 20 })], sample)),
    ['the Boogeymen were out-shot for the first time this title'],
  )
  assert.deepEqual(shotsP(gamePatterns(g({ shotsFor: 20, shotsAgainst: 20 }), sample, sample)), [])
  // The club out-hit the opponent for once.
  assert.ok(
    gamePatterns(g({ hitsFor: 20 }), sample, sample).includes(
      'the Boogeymen out-hit the opponent for the first time this title',
    ),
  )
  // Less time on attack: the TOA words.
  assert.ok(
    gamePatterns(g({ timeOnAttack: 200, timeOnAttackAgainst: 300 }), sample, sample).includes(
      'the Boogeymen had less time on attack for the first time this title',
    ),
  )
})

void test('gamePatterns: unknown numbers and an even history give no pattern (C1.2)', () => {
  const sample = ten().map((x) => ({ ...x, hitsFor: 12 }))
  const p = gamePatterns(g({ timeOnAttack: null, hitsFor: 9 }), sample, sample)
  assert.equal(
    p.some((x) => x.includes('attack')),
    false,
  )
  // Half out-hit, half out-hitting: nothing is usual.
  const even = sample.map((x, i) => ({ ...x, hitsFor: i % 2 === 0 ? 12 : 18 }))
  assert.equal(
    gamePatterns(g(), even, even).some((x) => x.includes('hit')),
    false,
  )
})

const facts = (endedEarly = false): NewsGameFacts =>
  ({
    matchId: 1,
    endedEarly,
    labels: null,
    patterns: [],
  }) as unknown as NewsGameFacts

void test('applyNorms: norms from the earlier games without ended-early ones; labels per game (C1.2)', () => {
  const history = [...ten(), g({ endedEarly: true, hitsFor: 99 })]
  const out = applyNorms(
    [facts(), facts(true)],
    [g({ hitsFor: 18 }), g({ endedEarly: true })],
    history,
  )
  assert.equal(out.norms['6s']?.sampleGames, 10)
  assert.equal(out.norms['6s']?.hits?.ours, 14.5)
  assert.equal(out.norms['3s'], null)
  assert.equal(out.games[0]!.labels?.hitsFor, 'unusually high')
  assert.ok(out.games[0]!.patterns.length > 0)
  // The game that ended early gets no labels and no patterns.
  assert.equal(out.games[1]!.labels, null)
  assert.deepEqual(out.games[1]!.patterns, [])
  // Under 10 earlier games: no norms, no labels, no patterns.
  const few = applyNorms([facts()], [g()], ten().slice(0, 9))
  assert.deepEqual(few.norms, { '3s': null, '6s': null })
  assert.equal(few.games[0]!.labels, null)
  assert.deepEqual(few.games[0]!.patterns, [])
})

void test('applyNorms: a later game of the sheet sees the earlier ones for its pattern (C1.2)', () => {
  const sample = ten() // out-shooting every game
  const out = applyNorms(
    [facts(), facts()],
    [g({ shotsFor: 10, shotsAgainst: 30 }), g({ shotsFor: 10, shotsAgainst: 30 })],
    sample,
  )
  assert.ok(
    out.games[0]!.patterns.includes('the Boogeymen were out-shot for the first time this title'),
  )
  assert.ok(
    out.games[1]!.patterns.includes('the Boogeymen were out-shot for the 2nd game in a row'),
  )
  // Norms come only from the games before the sheet.
  assert.equal(out.norms['6s']?.shots?.leadPct, 100)
})

void test('normInputFromRow: page pass %, ended early from the credited goals (C1.2)', () => {
  const row = {
    id: 5,
    night: '2026-10-12',
    gameMode: '6s' as const,
    result: 'WIN' as const,
    scoreAgainst: 1,
    opponentName: 'Rivals',
    scoreFor: 3,
    creditedGoals: 3,
    hitsFor: 9,
    hitsAgainst: 11,
    shotsFor: 25,
    shotsAgainst: 20,
    timeOnAttack: 400,
    timeOnAttackAgainst: 350,
    ppGoals: 1,
    ppOpportunities: 3,
    ppGoalsAgainst: null,
    ppOpportunitiesAgainst: 2,
    passAttempts: 3,
    passCompletions: 2,
    passAttemptsAgainst: 0,
    passCompletionsAgainst: 0,
  }
  assert.deepEqual(normInputFromRow(row), {
    gameMode: '6s',
    endedEarly: false,
    hitsFor: 9,
    hitsAgainst: 11,
    shotsFor: 25,
    shotsAgainst: 20,
    timeOnAttack: 400,
    timeOnAttackAgainst: 350,
    passPct: 66.7,
    passPctAgainst: null,
    ppGoals: 1,
    ppOpportunities: 3,
    ppGoalsAgainst: null,
    ppOpportunitiesAgainst: 2,
  })
  assert.equal(normInputFromRow({ ...row, scoreFor: 4 }).endedEarly, true)
  assert.equal(normInputFromRow({ ...row, timeOnAttack: 200 }).endedEarly, true)
  assert.equal(normInputFromRow({ ...row, shotsFor: 5, shotsAgainst: 4 }).endedEarly, true)
})

void test('applyNorms: norms, labels and patterns per game mode; a game without a mode gets none (C2.1)', () => {
  // Ten 6s games out-shooting the opponent, ten 3s games with 40 hits and out-shot every time.
  const six = ten()
  const three = Array.from({ length: 10 }, () =>
    g({ gameMode: '3s', hitsFor: 40, hitsAgainst: 5, shotsFor: 5, shotsAgainst: 15 }),
  )
  const out = applyNorms(
    [facts(), facts(), facts()],
    [
      g({ hitsFor: 18 }),
      g({ gameMode: '3s', hitsFor: 18, shotsFor: 5, shotsAgainst: 15 }),
      g({ gameMode: null }),
    ],
    [...three.slice(0, 5), ...six, ...three.slice(5)],
  )
  assert.equal(out.norms['6s']?.sampleGames, 10)
  assert.equal(out.norms['6s']?.hits?.ours, 14.5)
  assert.equal(out.norms['3s']?.sampleGames, 10)
  assert.equal(out.norms['3s']?.hits?.ours, 40)
  // 18 hits: unusually high in 6s, unusually low in 3s.
  assert.equal(out.games[0]!.labels?.hitsFor, 'unusually high')
  assert.equal(out.games[1]!.labels?.hitsFor, 'unusually low')
  // Patterns from the same mode: out-shot is the usual in 3s, not news.
  assert.ok(out.games[1]!.patterns.includes('the Boogeymen were out-shot as usual'))
  assert.ok(out.games[0]!.patterns.includes('the Boogeymen out-shot the opponent as usual'))
  // No mode: no norms to compare with.
  assert.equal(out.games[2]!.labels, null)
  assert.deepEqual(out.games[2]!.patterns, [])
})
