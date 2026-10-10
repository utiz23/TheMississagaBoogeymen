import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAwardForm } from './award-edit.ts'

const allowed = { titleIds: [2, 7], memberIds: [1, 2, 3, 5] }
const run = (values: Record<string, string>, players: string[] = ['3']) =>
  parseAwardForm(
    (n) => values[n] ?? null,
    (n) => (n === 'playerIds' ? players : []),
    allowed,
  )

void test('a club-vote trophy', () => {
  assert.deepEqual(run({ kind: 'trophy', trophy: 'mvp', source: 'vote', gameTitleId: '2' }), {
    ok: true,
    input: {
      kind: 'trophy',
      trophy: 'mvp',
      gameTitleId: 2,
      source: 'vote',
      reason: null,
      playerIds: [3],
    },
  })
})

void test('an archive-stats trophy needs a reason, cleaned and limited', () => {
  const base = { kind: 'trophy', trophy: 'defense', source: 'stats', gameTitleId: '2' }
  assert.equal(run(base).ok, false)
  const ok = run({ ...base, reason: '  Most blocked\n shots.  ' })
  assert.ok(ok.ok && ok.input.kind === 'trophy' && ok.input.reason === 'Most blocked shots.')
  assert.equal(run({ ...base, reason: 'x'.repeat(301) }).ok, false)
})

void test('a banner keeps the players in the order given', () => {
  const r = run({ kind: 'banner', mode: '3s', gameTitleId: '7' }, ['2', '5', '3', '5'])
  assert.deepEqual(r, {
    ok: true,
    input: { kind: 'banner', mode: '3s', gameTitleId: 7, playerIds: [2, 5, 3] },
  })
})

void test('unknown season, non-members, no players and bad values are refused', () => {
  assert.equal(run({ kind: 'trophy', trophy: 'mvp', source: 'vote', gameTitleId: '99' }).ok, false)
  assert.equal(
    run({ kind: 'trophy', trophy: 'mvp', source: 'vote', gameTitleId: '2' }, ['42']).ok,
    false,
  )
  assert.equal(
    run({ kind: 'trophy', trophy: 'mvp', source: 'vote', gameTitleId: '2' }, []).ok,
    false,
  )
  assert.equal(run({ kind: 'trophy', trophy: 'cup', source: 'vote', gameTitleId: '2' }).ok, false)
  assert.equal(run({ kind: 'banner', mode: 'pond', gameTitleId: '2' }).ok, false)
  assert.equal(run({ kind: 'banner', mode: '6s', gameTitleId: '2' }).ok, true)
  assert.equal(run({ kind: 'medal', gameTitleId: '2' }).ok, false)
})
