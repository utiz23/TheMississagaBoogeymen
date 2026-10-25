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
  percentile,
  type NormGameInput,
} from './norms.ts'

const g = (over: Partial<NormGameInput> = {}): NormGameInput => ({
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

void test('gamePatterns: a usual pattern held reads "as usual" (C1.2)', () => {
  // Usually out-hit (15 vs 10..14), out-shooting, more time on attack.
  const history = ten().map((x) => ({ ...x, hitsFor: 12 }))
  assert.deepEqual(gamePatterns(g({ hitsFor: 9 }), history, history), [
    'out-hit as usual',
    'out-shot the opponent as usual',
    'more time on attack as usual',
  ])
})

void test('gamePatterns: a broken pattern counts the games since it last broke (C1.2)', () => {
  const sample = ten().map((x) => ({ ...x, hitsFor: 12 }))
  // The last five earlier games were all out-shooting games; before them one out-shot game.
  const previous = [
    ...sample,
    g({ shotsFor: 15, shotsAgainst: 25 }),
    ...Array.from({ length: 5 }, () => g()),
  ]
  const p = gamePatterns(g({ hitsFor: 9, shotsFor: 10, shotsAgainst: 30 }), previous, sample)
  assert.ok(p.includes('out-shot for the first time in 6 games'), p.join(' | '))
  // Out-shot again in the next game: two in a row.
  const again = gamePatterns(
    g({ shotsFor: 10, shotsAgainst: 30 }),
    [...previous, g({ shotsFor: 10, shotsAgainst: 30 })],
    sample,
  )
  assert.ok(again.includes('out-shot for 2 games in a row'), again.join(' | '))
  // A tie in the earlier games counts as "not out-shot"; a tie now is no pattern.
  const tie = gamePatterns(
    g({ shotsFor: 10, shotsAgainst: 30 }),
    [...sample, g({ shotsFor: 20, shotsAgainst: 20 })],
    sample,
  )
  assert.ok(tie.includes('out-shot for the first time in 12 games'), tie.join(' | '))
  const even = gamePatterns(g({ shotsFor: 20, shotsAgainst: 20 }), sample, sample)
  assert.equal(
    even.some((x) => x.includes('shot')),
    false,
  )
  // The opponent out-hit nobody: the club out-hit them for once.
  const hits = gamePatterns(g({ hitsFor: 20 }), sample, sample)
  assert.ok(hits.includes('out-hit the opponent for the first time in 11 games'), hits.join(' | '))
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
  assert.equal(out.norms?.sampleGames, 10)
  assert.equal(out.norms?.hits?.ours, 14.5)
  assert.equal(out.games[0]!.labels?.hitsFor, 'unusually high')
  assert.ok(out.games[0]!.patterns.length > 0)
  // The game that ended early gets no labels and no patterns.
  assert.equal(out.games[1]!.labels, null)
  assert.deepEqual(out.games[1]!.patterns, [])
  // Under 10 earlier games: no norms, no labels, no patterns.
  const few = applyNorms([facts()], [g()], ten().slice(0, 9))
  assert.equal(few.norms, null)
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
  assert.ok(out.games[0]!.patterns.includes('out-shot for the first time in 11 games'))
  assert.ok(out.games[1]!.patterns.includes('out-shot for 2 games in a row'))
  // Norms come only from the games before the sheet.
  assert.equal(out.norms?.shots?.leadPct, 100)
})

void test('normInputFromRow: page pass %, ended early from the credited goals (C1.2)', () => {
  const row = {
    id: 5,
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
