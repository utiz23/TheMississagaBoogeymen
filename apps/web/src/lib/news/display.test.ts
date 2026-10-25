/**
 * News display helpers: paragraphs, read time, day labels, score chips.
 *
 * Run: node --test apps/web/src/lib/news/display.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { FEATURE_KINDS } from '@eanhl/db/news'
import {
  FEATURE_KICKERS,
  articleKicker,
  dayKeyLabel,
  dayKeyLabelWithWeekday,
  readMinutes,
  scoreChips,
  splitParagraphs,
} from './display.ts'

test('splitParagraphs splits on blank lines and drops empties', () => {
  assert.deepEqual(splitParagraphs('One.\n\nTwo.\n  \n\nThree.\n'), ['One.', 'Two.', 'Three.'])
  assert.deepEqual(splitParagraphs(''), [])
})

test('readMinutes is at least 1 and rounds at 200 words a minute', () => {
  assert.equal(readMinutes('short'), 1)
  assert.equal(readMinutes(Array(800).fill('word').join(' ')), 4)
  assert.equal(readMinutes(Array(650).fill('word').join(' ')), 3)
})

test('dayKeyLabel reads a night key in the club zone, not the server zone', () => {
  const year = String(new Date().getFullYear())
  assert.equal(dayKeyLabel(`${year}-10-12`), 'Oct 12')
  assert.equal(dayKeyLabel('not-a-date'), 'not-a-date')
})

test('dayKeyLabelWithWeekday adds the weekday', () => {
  // 2026-10-12 is a Monday.
  assert.match(dayKeyLabelWithWeekday('2026-10-12'), /^Mon Oct 12/)
})

test('scoreChips: null, odd or partial facts give fewer chips, never an error', () => {
  assert.deepEqual(scoreChips(null), [])
  assert.deepEqual(scoreChips('x'), [])
  assert.deepEqual(scoreChips({ games: 'no' }), [])
  const good = {
    matchId: 7,
    result: 'LOSS',
    scoreFor: 2,
    scoreAgainst: 6,
    opponentName: 'Shake N Bake',
  }
  assert.deepEqual(
    scoreChips({
      games: [good, { matchId: '8' }, null, { ...good, result: 'DNF' }, { ...good, matchId: 9 }],
    }),
    [
      { ...good, shots: null },
      { ...good, matchId: 9, shots: null },
    ],
  )
})

test('scoreChips reads the shot counts when the sheet has them', () => {
  const game = {
    matchId: 7,
    result: 'WIN',
    scoreFor: 4,
    scoreAgainst: 2,
    opponentName: 'X',
    team: { shotsFor: 30, shotsAgainst: 18 },
  }
  assert.deepEqual(scoreChips({ games: [game] })[0]?.shots, { for: 30, against: 18 })
})

test('articleKicker: night recap, feature kinds, none for posts (rev 2, A6)', () => {
  const a = (over: Partial<Parameters<typeof articleKicker>[0]> = {}) =>
    articleKicker({ kind: 'article', night: null, weekStart: null, featureKind: null, ...over })
  assert.equal(a({ night: '2026-10-12' }), 'Night recap')
  assert.equal(a({ weekStart: '2026-10-12', featureKind: 'trend' }), 'Numbers Desk')
  assert.equal(a({ weekStart: '2026-10-12', featureKind: 'spotlight' }), 'Spotlight')
  assert.equal(a({ weekStart: '2026-10-12', featureKind: 'notes' }), 'Notes')
  assert.equal(a({ weekStart: '2026-10-12', featureKind: 'bigpicture' }), 'Big Country')
  assert.equal(a({ weekStart: '2026-10-12', featureKind: 'rink' }), 'Midnight Column')
  // Every kind has a label.
  for (const k of FEATURE_KINDS) assert.ok(FEATURE_KICKERS[k].length > 0, k)
  // A weekly piece from before revision 2 has no kind.
  assert.equal(a({ weekStart: '2026-10-12' }), 'Week in review')
  // The kicker follows the piece, not the reporter.
  assert.equal(a({ night: '2026-10-12' }), a({ night: '2026-10-13' }))
  assert.equal(a(), null)
  // Posts (game recaps, reactions) have no kicker.
  assert.equal(
    articleKicker({ kind: 'post', night: '2026-10-12', weekStart: null, featureKind: null }),
    null,
  )
})
