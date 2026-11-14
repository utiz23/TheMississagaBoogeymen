import test from 'node:test'
import assert from 'node:assert/strict'
import { BUZZ_LEVELS, planBuzz, type BuzzPlan } from '@eanhl/db/news'
import {
  applyFinalsFloor,
  finalsBlock,
  finalsDecider,
  finalsFactLines,
  finalsFloor,
  finalsMark,
  finalsMoment,
  finalsNumbers,
  finalsPostLine,
  finalsStakes,
  finalsTrusted,
  isFinalsBigMoment,
  planForLevel,
  FINALS_END,
  FINALS_START,
  MOMENT_TONE,
  type ClubFinalsFacts,
} from './club-finals.ts'
import { oct12Facts } from './news/test-fixtures.ts'

/** CF1's stored states of real live games (2026-11-14), with the opponents left out. */
const g3442: ClubFinalsFacts = {
  attempt: 3,
  round: 2,
  gameInRound: 2,
  roundWinsAfter: 1,
  roundLossesAfter: 1,
  attemptWinsAfter: 5,
  attemptLossesAfter: 2,
  isFinal: false,
  roundWon: false,
  eliminated: false,
  finalWon: false,
}
const g3440: ClubFinalsFacts = {
  attempt: 3,
  round: 1,
  gameInRound: 5,
  roundWinsAfter: 4,
  roundLossesAfter: 1,
  attemptWinsAfter: 4,
  attemptLossesAfter: 1,
  isFinal: false,
  roundWon: true,
  eliminated: false,
  finalWon: false,
}
const g3431: ClubFinalsFacts = {
  attempt: 1,
  round: 4,
  gameInRound: 5,
  roundWinsAfter: 1,
  roundLossesAfter: 4,
  attemptWinsAfter: 13,
  attemptLossesAfter: 9,
  isFinal: true,
  roundWon: false,
  eliminated: true,
  finalWon: false,
}
const g3427: ClubFinalsFacts = {
  attempt: 1,
  round: 4,
  gameInRound: 1,
  roundWinsAfter: 1,
  roundLossesAfter: 0,
  attemptWinsAfter: 13,
  attemptLossesAfter: 5,
  isFinal: true,
  roundWon: false,
  eliminated: false,
  finalWon: false,
}
const finalWon: ClubFinalsFacts = {
  ...g3427,
  gameInRound: 4,
  roundWinsAfter: 4,
  roundLossesAfter: 0,
  finalWon: true,
}
/** Round 3, the 7th game, won 4-3. */
const decider: ClubFinalsFacts = {
  ...g3440,
  round: 3,
  gameInRound: 7,
  roundWinsAfter: 4,
  roundLossesAfter: 3,
  attemptWinsAfter: 11,
  attemptLossesAfter: 6,
}

void test('the post line: a normal game, a round won, an elimination, a game of the final', () => {
  assert.equal(finalsPostLine(g3442), '**Club Finals** · Attempt 3 · Round 2 · Game 2 · Series 1–1')
  assert.equal(
    finalsPostLine(g3440),
    '**Club Finals** · Attempt 3 · Round 1 · Game 5 · Series 4–1 · **ROUND WON**',
  )
  assert.equal(
    finalsPostLine(g3431),
    '**Club Finals · THE FINAL** · Attempt 1 · Game 5 · Series 1–4 · **ELIMINATED** · run ends 13–9',
  )
  assert.equal(
    finalsPostLine(g3427),
    '**Club Finals · THE FINAL** · Attempt 1 · Game 1 · Series 1–0',
  )
  assert.equal(
    finalsPostLine(finalWon),
    '**Club Finals · THE FINAL** · Attempt 1 · Game 4 · Series 4–0 · **FINAL WON**',
  )
})

void test('the post line only prints stored numbers (changing a stored value changes the line)', () => {
  const line = finalsPostLine({
    ...g3442,
    round: 3,
    gameInRound: 6,
    roundWinsAfter: 3,
    roundLossesAfter: 2,
  })
  assert.match(line, /Round 3 · Game 6 · Series 3–2$/)
})

void test('the mark is the strongest of the three, as on the site', () => {
  assert.equal(finalsMark(g3442), null)
  assert.equal(finalsMark(g3440), 'round_won')
  assert.equal(finalsMark(g3431), 'eliminated')
  assert.equal(finalsMark(finalWon), 'final_won')
})

void test('a round decided in its 7th game is a decider; no other game is', () => {
  assert.equal(finalsDecider(decider), true)
  assert.equal(finalsDecider(g3440), false)
  assert.equal(finalsDecider({ ...g3442, gameInRound: 7 }), false) // cannot happen, but never a decider
})

void test('the floor: normal, big, huge', () => {
  assert.equal(finalsFloor(g3442), 'normal')
  assert.equal(finalsFloor(g3440), 'big') // a round won
  assert.equal(finalsFloor({ ...g3440, roundWon: false, eliminated: true }), 'big') // an elimination
  assert.equal(finalsFloor(g3427), 'huge') // any game of the final
  assert.equal(finalsFloor(g3431), 'huge')
  assert.equal(finalsFloor(finalWon), 'huge')
  assert.equal(finalsFloor(decider), 'huge') // a round decided in its 7th game
})

void test('big moments: everything above a normal Club Finals game', () => {
  assert.equal(isFinalsBigMoment(g3442), false)
  for (const g of [g3440, g3431, g3427, finalWon, decider]) assert.equal(isFinalsBigMoment(g), true)
})

void test('the moment of a scrum, strongest first, and every moment has a tone line', () => {
  assert.equal(finalsMoment(g3442), null)
  assert.equal(finalsMoment(finalWon), 'final_won')
  assert.equal(finalsMoment(g3431), 'eliminated') // eliminated beats "a game of the final"
  assert.equal(finalsMoment(decider), 'decider')
  assert.equal(finalsMoment(g3440), 'round_won')
  assert.equal(finalsMoment(g3427), 'final')
  for (const m of ['final_won', 'eliminated', 'decider', 'round_won', 'final'] as const) {
    assert.ok(MOMENT_TONE[m].startsWith('Moment: '))
  }
})

void test('planForLevel gives what planBuzz gives for the same level (drift guard)', () => {
  const base = oct12Facts('game')
  for (let id = 1; id <= 400; id++) {
    const game = { ...base.games[0]!, matchId: id }
    const plan = planBuzz(game, base)
    const again = planForLevel(id, plan.level)
    assert.equal(again.posts, plan.posts, `posts of game ${String(id)}`)
    assert.deepEqual(again.articles, plan.articles, `articles of game ${String(id)}`)
  }
  for (const level of BUZZ_LEVELS) {
    const p = planForLevel(77, level)
    assert.ok(p.posts >= 1)
  }
})

const quietPlan = (
  matchId: number,
): { plan: BuzzPlan; game: { matchId: number; endedEarly: boolean } } => {
  const base = oct12Facts('game')
  const game = { ...base.games[0]!, matchId, overtime: false, scoreFor: 1, scoreAgainst: 2 }
  const plan: BuzzPlan = { level: 'quiet', score: 1, reasons: ['x'], posts: 1, articles: [] }
  return { plan, game }
}

void test('applyFinalsFloor: lifts a quiet game to its floor and draws posts and articles for it', () => {
  const { plan, game } = quietPlan(8123)
  const big = applyFinalsFloor(plan, game, g3440)
  assert.equal(big.level, 'big')
  assert.deepEqual(big.articles, ['game'])
  assert.ok(big.posts >= 3 && big.posts <= 5)
  assert.ok(big.reasons.includes('Club Finals big'))
  const huge = applyFinalsFloor(plan, game, g3427)
  assert.equal(huge.level, 'huge')
  assert.equal(huge.articles.length, 2) // a game story plus a spotlight or a column
  assert.equal(huge.articles[0], 'game')
  assert.ok(huge.posts >= 6 && huge.posts <= 8)
  const normal = applyFinalsFloor(plan, game, g3442)
  assert.equal(normal.level, 'normal')
  assert.equal(normal.posts, 2)
  assert.deepEqual(normal.articles, [])
  // Seeded: the same game gives the same plan.
  assert.deepEqual(applyFinalsFloor(plan, game, g3427), huge)
})

void test('applyFinalsFloor: never lowers a level, never touches a game with no state or one that ended early', () => {
  const { plan, game } = quietPlan(8124)
  const huge: BuzzPlan = {
    level: 'huge',
    score: 20,
    reasons: [],
    posts: 7,
    articles: ['game', 'column'],
  }
  assert.equal(applyFinalsFloor(huge, game, g3440), huge)
  const historic: BuzzPlan = { ...huge, level: 'historic' }
  assert.equal(applyFinalsFloor(historic, game, g3427), historic)
  assert.equal(applyFinalsFloor(plan, game, null), plan)
  assert.equal(applyFinalsFloor(plan, { ...game, endedEarly: true }, g3427), plan)
})

void test('stakes come from the stored record only', () => {
  assert.equal(finalsStakes(g3442), null)
  assert.equal(
    finalsStakes({ ...g3442, roundWinsAfter: 3, roundLossesAfter: 3 }),
    'Next game: win or go home.',
  )
  assert.equal(
    finalsStakes({ ...g3442, roundWinsAfter: 3, roundLossesAfter: 0 }),
    'Next game: one win from the next round.',
  )
  assert.equal(
    finalsStakes({ ...g3442, round: 3, roundWinsAfter: 3, roundLossesAfter: 0 }),
    'Next game: one win from the final.',
  )
  assert.equal(
    finalsStakes({ ...g3427, roundWinsAfter: 3, roundLossesAfter: 0 }),
    'Next game: one win from the title.',
  )
  assert.equal(
    finalsStakes({ ...g3442, roundWinsAfter: 1, roundLossesAfter: 3 }),
    'Next game: one loss from elimination.',
  )
  assert.equal(finalsStakes(g3440), 'Next: Round 2, Game 1.')
  assert.equal(finalsStakes({ ...g3440, round: 3 }), 'Next: the final, Game 1.')
  assert.equal(finalsStakes(g3431), null)
  assert.equal(finalsStakes(finalWon), null)
})

void test('writer facts: the stored values, in the site words, with the opponent on a night sheet', () => {
  assert.deepEqual(finalsFactLines(g3440), [
    'Game 5 of Round 1 in Attempt 3 of the Club Finals. Series after this game: 4 wins and 1 loss for the Boogeymen (4–1).',
    'The Boogeymen won the round (their 4th win).',
    'Next: Round 2, Game 1.',
  ])
  const el = finalsFactLines(g3431, 'Fake Club')
  assert.match(
    el[0]!,
    /^The game against Fake Club: Game 5 of The Final in Attempt 1 of the Club Finals\./,
  )
  assert.ok(el.some((l) => l.includes('eliminated') && l.includes('13 wins and 9 losses')))
  assert.ok(finalsFactLines(decider).some((l) => l.includes('7th game')))
})

void test('the block: markers, the rules, one set of lines per game, none when empty', () => {
  assert.equal(finalsBlock([]), null)
  const b = finalsBlock([{ opponent: null, facts: g3440 }])!
  assert.ok(b.startsWith(FINALS_START))
  assert.ok(b.endsWith(FINALS_END))
  assert.match(b, /a round is first to 4 wins/)
  assert.match(b, /at most 3 numbers in all/)
  assert.deepEqual(finalsTrusted([]), [])
  const t = finalsTrusted([{ opponent: null, facts: g3440 }])
  assert.ok(t.length >= 2 && t.slice(1).every((l) => l.startsWith('Club tracker: ')))
})

void test('the numbers the facts allow: the stored values plus the rule limits', () => {
  assert.equal(finalsNumbers([]).size, 0)
  const n = finalsNumbers([g3431])
  for (const v of [1, 4, 5, 7, 9, 13]) assert.ok(n.has(v), String(v))
  assert.ok(!n.has(42))
})
