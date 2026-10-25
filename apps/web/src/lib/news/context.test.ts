import test from 'node:test'
import assert from 'node:assert/strict'
import type { NewsGameFacts } from '@eanhl/db/news'
import {
  applyContext,
  headToHead,
  marginLabel,
  nightNotes,
  resultLabel,
  streakOf,
  surpriseLabel,
  teamNotes,
  titleGameFromRow,
  type TitleGameInput,
} from './context.ts'

let nextId = 1
const tg = (
  result: TitleGameInput['result'],
  over: Partial<TitleGameInput> = {},
): TitleGameInput => ({
  matchId: nextId++,
  night: '2026-05-01',
  gameMode: '6s',
  result,
  scoreFor: result === 'WIN' ? 4 : 2,
  scoreAgainst: result === 'WIN' ? 2 : 4,
  opponentName: 'Other Club',
  endedEarly: false,
  ...over,
})
const many = (n: number, result: TitleGameInput['result'], over: Partial<TitleGameInput> = {}) =>
  Array.from({ length: n }, () => tg(result, over))

void test('streakOf: the run at the newest end; an overtime loss is a loss', () => {
  assert.equal(streakOf([]), null)
  assert.deepEqual(streakOf(['WIN', 'LOSS', 'WIN', 'WIN']), { kind: 'W', count: 2 })
  assert.deepEqual(streakOf(['WIN', 'LOSS', 'OTL']), { kind: 'L', count: 2 })
})

void test('resultLabel: rolling, blip, slide, panic, turnaround, normal (spec 12.16)', () => {
  const W = (count: number) => ({ kind: 'W' as const, count })
  const L = (count: number) => ({ kind: 'L' as const, count })
  const rec = (wins: number) => ({ wins, losses: 10 - wins, otl: 0 })
  // A win that extends a win streak to 5+.
  assert.equal(resultLabel('WIN', W(4), W(5), rec(7)), 'rolling')
  assert.equal(resultLabel('WIN', W(3), W(4), rec(7)), 'normal')
  // A loss that ends a win streak of 5+.
  assert.equal(resultLabel('LOSS', W(5), L(1), rec(8)), 'blip')
  assert.equal(resultLabel('OTL', W(4), L(1), rec(8)), 'normal')
  // 3rd and 4th loss in a row: slide; 5th+: panic.
  assert.equal(resultLabel('LOSS', L(2), L(3), rec(5)), 'slide')
  assert.equal(resultLabel('OTL', L(3), L(4), rec(5)), 'slide')
  assert.equal(resultLabel('LOSS', L(4), L(5), rec(5)), 'panic')
  // 2-8 or worse in the last 10 (10 games).
  assert.equal(resultLabel('LOSS', W(1), L(1), { wins: 2, losses: 7, otl: 1 }), 'panic')
  assert.equal(resultLabel('LOSS', W(1), L(1), { wins: 2, losses: 6, otl: 0 }), 'normal')
  // A win that ends a losing streak of 3+.
  assert.equal(resultLabel('WIN', L(3), W(1), rec(3)), 'turnaround')
  assert.equal(resultLabel('WIN', L(2), W(1), rec(3)), 'normal')
  assert.equal(resultLabel('WIN', null, W(1), rec(1)), 'normal')
})

void test('marginLabel: one goal is close; a blowout beats the club 80th percentile and at least 4 (C2.2)', () => {
  // Earlier margins: 1,1,2,2,3,3,3,4,4,5 -> 80th percentile 4.
  const sample = [1, 1, 2, 2, 3, 3, 3, 4, 4, 5]
  assert.equal(marginLabel(3, 2, sample), 'close')
  assert.equal(marginLabel(2, 2, sample), 'close') // a tie after OT3
  assert.equal(marginLabel(5, 1, sample), 'comfortable') // 4 is not above the 80th percentile
  assert.equal(marginLabel(6, 1, sample), 'blowout')
  // Small margins in the club's history: the floor of 4 still applies.
  assert.equal(
    marginLabel(
      4,
      1,
      Array.from({ length: 10 }, () => 1),
    ),
    'comfortable',
  )
  assert.equal(
    marginLabel(
      5,
      1,
      Array.from({ length: 10 }, () => 1),
    ),
    'blowout',
  )
  // Under 10 earlier games: a fixed 5 goals.
  assert.equal(marginLabel(5, 1, [1]), 'comfortable')
  assert.equal(marginLabel(6, 1, [1]), 'blowout')
})

void test('surpriseLabel: from the club win rate in the mode, title and last 10 (C2.2)', () => {
  const strong = [...many(4, 'LOSS'), ...many(16, 'WIN')] // 80% title, last 10 all wins -> 0.9
  assert.equal(surpriseLabel('LOSS', 'comfortable', strong), 'upset')
  assert.equal(surpriseLabel('LOSS', 'blowout', strong), 'big upset')
  assert.equal(surpriseLabel('WIN', 'blowout', strong), 'expected')
  const middling = Array.from({ length: 20 }, (_, i) => tg(i % 2 === 0 ? 'WIN' : 'LOSS'))
  assert.equal(surpriseLabel('LOSS', 'blowout', middling), 'expected')
  assert.equal(surpriseLabel('WIN', 'blowout', middling), 'expected')
  const weak = [...many(16, 'LOSS'), ...many(4, 'WIN'), ...many(6, 'LOSS')]
  assert.equal(surpriseLabel('WIN', 'close', weak), 'upset')
  assert.equal(surpriseLabel('WIN', 'blowout', weak), 'big upset')
  // Under 10 earlier games of the mode: expected.
  assert.equal(surpriseLabel('LOSS', 'blowout', many(9, 'WIN')), 'expected')
})

void test('nightNotes: the night so far; swept only when the night is complete (C2.2)', () => {
  assert.deepEqual(nightNotes('WIN', [], false), [])
  assert.deepEqual(nightNotes('WIN', ['WIN'], false), ['2nd win of the night, no loss yet'])
  assert.deepEqual(nightNotes('WIN', ['LOSS', 'WIN'], false), ['2nd win of the night'])
  assert.deepEqual(nightNotes('LOSS', ['WIN', 'OTL'], false), ['2nd loss of the night'])
  assert.deepEqual(nightNotes('OTL', ['LOSS', 'LOSS'], false), [
    '3rd loss of the night, no win yet',
  ])
  assert.deepEqual(nightNotes('WIN', ['WIN', 'WIN'], true), [
    '3rd win of the night, no loss yet',
    'swept the night',
  ])
  assert.deepEqual(nightNotes('LOSS', ['LOSS'], true), [
    '2nd loss of the night, no win yet',
    'lost every game of the night',
  ])
  assert.deepEqual(nightNotes('WIN', [], true), [])
})

void test('teamNotes: title milestones and season bests (C2.2)', () => {
  // 49 wins before: this win is the 50th.
  assert.ok(
    teamNotes(tg('WIN'), many(49, 'WIN', { scoreFor: 4, scoreAgainst: 2 })).includes(
      '50th win of the title',
    ),
  )
  // 99 games before: the 100th game.
  const ninetyNine = [...many(60, 'WIN'), ...many(39, 'LOSS')]
  assert.ok(teamNotes(tg('LOSS'), ninetyNine).includes('100th game of the title'))
  // Goals for crossing 250.
  const goals = many(62, 'WIN', { scoreFor: 4, scoreAgainst: 2 }) // 248 goals, 62 wins
  assert.ok(teamNotes(tg('WIN', { scoreFor: 3 }), goals).includes('250th goal of the title'))
  // The longest win streak of the season, from 4 games and longer than every earlier one.
  const prior = [...many(3, 'WIN'), tg('LOSS'), ...many(3, 'WIN')]
  assert.ok(teamNotes(tg('WIN'), prior).includes('longest win streak of the season: 4'))
  assert.ok(
    !teamNotes(tg('WIN'), [...many(4, 'WIN'), tg('LOSS'), ...many(3, 'WIN')]).some((n) =>
      n.startsWith('longest'),
    ),
  )
  assert.ok(
    teamNotes(tg('LOSS'), [...many(3, 'LOSS')]).includes('longest losing streak of the season: 4'),
  )
  // Most goals, biggest win, worst loss: from the 11th game, strictly more than before.
  const ten = many(10, 'WIN', { scoreFor: 5, scoreAgainst: 2 })
  const big = teamNotes(tg('WIN', { scoreFor: 11, scoreAgainst: 2 }), ten)
  assert.ok(big.includes('most goals in a game this season: 11'))
  assert.ok(big.includes('biggest win of the season: 11-2'))
  const worst = teamNotes(tg('LOSS', { scoreFor: 1, scoreAgainst: 8 }), [
    ...ten,
    ...many(3, 'LOSS', { scoreFor: 2, scoreAgainst: 5 }),
  ])
  assert.ok(worst.includes('worst loss of the season: 8-1'))
  // The first losses of a season are not its "worst": at least 3 earlier losses.
  assert.ok(
    !teamNotes(tg('LOSS', { scoreFor: 1, scoreAgainst: 8 }), [
      ...ten,
      ...many(2, 'LOSS', { scoreFor: 2, scoreAgainst: 5 }),
    ]).some((n) => n.startsWith('worst')),
  )
  assert.deepEqual(
    teamNotes(tg('WIN', { scoreFor: 11, scoreAgainst: 2 }), ten.slice(0, 9)).filter(
      (n) => n.startsWith('most') || n.startsWith('biggest'),
    ),
    [],
  )
})

void test('headToHead: earlier meetings with the same opponent (spacing and case ignored) (C2.5)', () => {
  const prior = [
    tg('WIN', { opponentName: 'Rival  HC', night: '2026-05-01', scoreFor: 3, scoreAgainst: 1 }),
    tg('LOSS', { opponentName: 'someone else' }),
    tg('OTL', { opponentName: 'rival hc', night: '2026-05-08', scoreFor: 2, scoreAgainst: 3 }),
  ]
  assert.deepEqual(headToHead('Rival HC', prior), {
    wins: 1,
    losses: 0,
    otl: 1,
    lastMeeting: { result: 'OTL', scoreFor: 2, scoreAgainst: 3, night: '2026-05-08' },
  })
  assert.equal(headToHead('New Club', prior), null)
})

const sheetGame = (g: TitleGameInput): NewsGameFacts =>
  ({
    matchId: g.matchId,
    night: g.night,
    gameMode: g.gameMode,
    result: g.result,
    scoreFor: g.scoreFor,
    scoreAgainst: g.scoreAgainst,
    opponentName: g.opponentName,
    endedEarly: g.endedEarly,
    context: null,
    teamNotes: [],
    headToHead: null,
  }) as unknown as NewsGameFacts

void test('applyContext: each sheet game sees the history and the earlier sheet games (C2.2)', () => {
  const history = [
    ...many(6, 'WIN', { night: '2026-05-01' }),
    ...many(5, 'WIN', { night: '2026-05-02' }),
  ]
  const a = tg('LOSS', { night: '2026-05-03', opponentName: 'Rival' })
  const b = tg('LOSS', { night: '2026-05-03', opponentName: 'Rival' })
  const out = applyContext([sheetGame(a), sheetGame(b)], [a, b], history, { nightComplete: true })
  const c0 = out[0]!.context!
  assert.equal(c0.result, 'blip')
  assert.deepEqual(c0.streakBefore, { kind: 'W', count: 11 })
  assert.deepEqual(c0.streakAfter, { kind: 'L', count: 1 })
  assert.deepEqual(c0.last10, { wins: 9, losses: 1, otl: 0 })
  assert.equal(c0.margin, 'comfortable')
  assert.equal(c0.surprise, 'upset')
  assert.deepEqual(c0.night, [])
  assert.equal(out[0]!.headToHead, null)
  const c1 = out[1]!.context!
  assert.deepEqual(c1.streakBefore, { kind: 'L', count: 1 })
  assert.deepEqual(c1.night, ['2nd loss of the night, no win yet', 'lost every game of the night'])
  assert.deepEqual(out[1]!.headToHead, {
    wins: 0,
    losses: 1,
    otl: 0,
    lastMeeting: { result: 'LOSS', scoreFor: 2, scoreAgainst: 4, night: '2026-05-03' },
  })
  // A game sheet does not know whether the night is over.
  const single = applyContext([sheetGame(b)], [b], [...history, a], { nightComplete: false })
  assert.deepEqual(single[0]!.context!.night, ['2nd loss of the night, no win yet'])
})

void test('titleGameFromRow: opponent spacing collapsed; ended early by the sheet rule (C2.2)', () => {
  const row = {
    id: 7,
    night: '2026-05-08',
    gameMode: '3s' as const,
    result: 'WIN' as const,
    scoreFor: 3,
    scoreAgainst: 0,
    opponentName: '  Real   knickerbockers ',
    creditedGoals: 3,
    hitsFor: 1,
    hitsAgainst: 1,
    shotsFor: 1,
    shotsAgainst: 0,
    timeOnAttack: 5,
    timeOnAttackAgainst: 0,
    ppGoals: null,
    ppOpportunities: null,
    ppGoalsAgainst: null,
    ppOpportunitiesAgainst: null,
    passAttempts: 0,
    passCompletions: 0,
    passAttemptsAgainst: 0,
    passCompletionsAgainst: 0,
  }
  assert.deepEqual(titleGameFromRow(row), {
    matchId: 7,
    night: '2026-05-08',
    gameMode: '3s',
    result: 'WIN',
    scoreFor: 3,
    scoreAgainst: 0,
    opponentName: 'Real knickerbockers',
    endedEarly: true,
  })
})
