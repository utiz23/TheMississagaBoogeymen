import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedNumbers, checkArticleFacts, checkFacts } from './fact-check.ts'
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
  assert.match(problems(r).join(' '), /Hidden Hank/)
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
