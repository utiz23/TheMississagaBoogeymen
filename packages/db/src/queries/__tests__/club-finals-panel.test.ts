import test from 'node:test'
import assert from 'node:assert/strict'
import { panelViewFromGame } from '../club-finals-panel.js'

const base = {
  round: 1,
  roundWon: false,
  eliminated: false,
  attemptWinsAfter: 2,
  attemptLossesAfter: 1,
  roundResults: 'WWL',
}

void test('a game in a running round: the boxes and the attempt record as stored', () => {
  assert.deepEqual(panelViewFromGame(base), {
    round: 1,
    boxes: 'WWL',
    attemptWins: 2,
    attemptLosses: 1,
    retry: false,
  })
})

void test('a won round: the next round with empty boxes, attempt record carried', () => {
  assert.deepEqual(
    panelViewFromGame({ ...base, roundWon: true, attemptWinsAfter: 4, roundResults: 'WWLWW' }),
    { round: 2, boxes: '', attemptWins: 4, attemptLosses: 1, retry: false },
  )
})

void test('the 4th loss: round 1, 0-0, retry (the 2026-11-13 19:46 read)', () => {
  assert.deepEqual(panelViewFromGame({ ...base, eliminated: true, roundResults: 'LLLL' }), {
    round: 1,
    boxes: '',
    attemptWins: 0,
    attemptLosses: 0,
    retry: true,
  })
})
