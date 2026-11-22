/**
 * Run: node --test apps/web/src/lib/game-score-explainer.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAllTeamScores } from './match-recap.ts'
import {
  ANCHOR_HENRY_BIG,
  ANCHOR_SILKY,
  EXAMPLE_CAMRAZZ,
  EXAMPLE_HENRY,
  EXAMPLE_LEHMANN,
  goalieCanBeStar,
  goalieWeightRows,
  scoreGoalieLine,
  scoreSkaterLine,
  skaterWeightGroups,
  ZERO_GOALIE,
  ZERO_SKATER,
} from './game-score-explainer.ts'

type ScoreArgs = Parameters<typeof buildAllTeamScores>

const round2 = (x: number) => Math.round(x * 100) / 100

void test('the example game scores match the site: camrazz 17.53, Lehmann 13.00, Henry 11.50', () => {
  assert.equal(round2(scoreSkaterLine(EXAMPLE_CAMRAZZ, true).total), 17.53)
  assert.equal(round2(scoreGoalieLine(EXAMPLE_LEHMANN, true).total), 13)
  assert.equal(round2(scoreSkaterLine(EXAMPLE_HENRY, true).total), 11.5)
})

void test('the explainer totals equal the game page ranking (same win bonus, same order)', () => {
  const skater = {
    isGoalie: false,
    position: 'center',
    saves: null,
    goalsAgainst: null,
    shotsAgainst: null,
    despSaves: null,
    breakawaySaves: null,
    penSaves: null,
    pokechecks: null,
  }
  const bgm = [
    { ...skater, ...EXAMPLE_HENRY, playerId: 3, gamertag: 'HenryTheBobJr' },
    { ...skater, ...EXAMPLE_CAMRAZZ, playerId: 1, gamertag: 'camrazz' },
    {
      ...skater,
      ...ZERO_SKATER,
      ...EXAMPLE_LEHMANN,
      isGoalie: true,
      position: 'goalie',
      playerId: 2,
      gamertag: 'Matteo Lehmann',
    },
  ]
  const match = { result: 'WIN', scoreFor: 4, scoreAgainst: 0 } as ScoreArgs[0]
  const ranked = buildAllTeamScores(match, bgm as ScoreArgs[1], [] as unknown as ScoreArgs[2])
  assert.deepEqual(
    ranked.map((e) => [e.gamertag, round2(e.score)]),
    [
      ['camrazz', 17.53],
      ['Matteo Lehmann', 13],
      ['HenryTheBobJr', 11.5],
    ],
  )
})

void test('the scale anchors: silky 8.60 (Nov 9), Henry 21.99 (Oct 8)', () => {
  assert.equal(round2(scoreSkaterLine(ANCHOR_SILKY, true).total), 8.6)
  assert.equal(round2(scoreSkaterLine(ANCHOR_HENRY_BIG, true).total), 21.99)
})

void test('no win, no bonus', () => {
  const won = scoreSkaterLine(EXAMPLE_CAMRAZZ, true).total
  const lost = scoreSkaterLine(EXAMPLE_CAMRAZZ, false).total
  assert.equal(round2(won - lost), 1)
})

void test('weight tables come from the formula: 12 skater stats, goal 4, SV% 15 at full volume', () => {
  const rows = skaterWeightGroups().flatMap((g) => g.rows)
  assert.equal(rows.length, 12)
  assert.equal(rows[0]?.weight, 4)
  assert.ok(!skaterWeightGroups().some((g) => g.group === 'Other'), 'every stat has plain words')
  const goalie = goalieWeightRows()
  assert.equal(goalie[0]?.weight, 15)
  assert.equal(goalie.length, 7)
})

void test('goalie star rule: .900 or better and at least one shot', () => {
  assert.equal(goalieCanBeStar({ saves: 9, shotsAgainst: 10 }), true)
  assert.equal(goalieCanBeStar({ saves: 8, shotsAgainst: 10 }), false)
  assert.equal(goalieCanBeStar({ ...ZERO_GOALIE }), false)
})
