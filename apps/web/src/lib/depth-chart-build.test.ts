import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDepthChart, type ChartMember } from './depth-chart-build.ts'

const m = (
  playerId: number,
  gp: Partial<Record<'lwGp' | 'cGp' | 'rwGp' | 'dGp' | 'goalieGp', number>>,
  extra: Partial<ChartMember> = {},
): ChartMember => {
  const row = { lwGp: 0, cGp: 0, rwGp: 0, dGp: 0, goalieGp: 0, ...gp }
  return {
    playerId,
    gamesPlayed: row.lwGp + row.cGp + row.rwGp + row.dGp + row.goalieGp,
    favoritePosition: null,
    preferredPosition: null,
    ...row,
    ...extra,
  }
}

const ids = (slots: ({ player: ChartMember; isDepth: boolean } | null)[]) =>
  slots.map((s) => (s === null ? null : `${String(s.player.playerId)}${s.isDepth ? 'd' : ''}`))

// NHL 27 on 2026-10-08 (EA position GP), plus a carried-over goalie.
const stick = m(3, { lwGp: 21, cGp: 43, dGp: 8 })
const silky = m(2, { lwGp: 1, cGp: 27, dGp: 32, goalieGp: 5 })
const henry = m(1, { lwGp: 28, dGp: 27 })
const joey = m(5, { lwGp: 5, cGp: 3, rwGp: 8, dGp: 25, goalieGp: 7 })
const wagner = m(230, { goalieGp: 34 })
const benson = m(12, {}, { preferredPosition: 'goalie' })

void test('main = most games; every other position with 3+ games is depth', () => {
  const chart = buildDepthChart([stick, silky, henry, joey, wagner, benson])
  assert.deepEqual(ids(chart.forwards.map((l) => l.c)), ['3', '2d', '5d', null])
  assert.deepEqual(ids(chart.forwards.map((l) => l.lw)), ['1', '3d', '5d', null])
  assert.deepEqual(ids(chart.forwards.map((l) => l.rw)), ['5d', null, null, null])
  // Defense in usage order, paired LD/RD: silky 32, henry 27 (depth), joey 25, stick 8 (depth).
  assert.deepEqual(
    chart.defense.flatMap((p) => ids([p.ld, p.rd])),
    ['2', '1d', '5', '3d', null, null],
  )
  // Goalies: the AI starter, then skaters who played 3+ goalie games as depth, then Benson (0 GP, main G).
  assert.deepEqual(ids(chart.goalies), ['230', '5d', '2d', '12'])
})

void test('lines grow past 4 when a position has more players', () => {
  const wings = Array.from({ length: 6 }, (_, i) => m(100 + i, { lwGp: 10 - i }))
  const chart = buildDepthChart(wings)
  assert.equal(chart.forwards.length, 6)
  assert.equal(chart.defense.length, 3)
})

void test('no games this title: shown once, at the profile position, else EA favorite', () => {
  const utiz = m(28, {}, { favoritePosition: 'center' })
  const cap = m(231, {}, { preferredPosition: 'rightWing', favoritePosition: 'center' })
  const chart = buildDepthChart([utiz, cap])
  assert.deepEqual(ids(chart.forwards.map((l) => l.c)), ['28', null, null, null])
  assert.deepEqual(ids(chart.forwards.map((l) => l.rw)), ['231', null, null, null])
})

void test('without an EA split, locally recorded positions decide', () => {
  const p = m(9, {}, { gamesPlayed: 6 })
  const chart = buildDepthChart([p], new Map([[9, { RW: 4, D: 2 }]]))
  assert.deepEqual(ids(chart.forwards.map((l) => l.rw)), ['9', null, null, null])
  assert.equal(chart.defense[0]?.ld, null)
})
