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

void test('top 4 lines and 3 pairs: main cards always stay, depth fills the rest by games', () => {
  const wings = Array.from({ length: 6 }, (_, i) => m(100 + i, { lwGp: 10 - i }))
  // Two players whose main is LW but who have no games yet (carried over / pinned).
  const newcomers = [
    m(200, {}, { preferredPosition: 'leftWing' }),
    m(201, {}, { preferredPosition: 'leftWing' }),
  ]
  // Players with a main elsewhere who also play LW (depth).
  const depthLw = [m(300, { cGp: 30, lwGp: 9 }), m(301, { dGp: 30, lwGp: 7 })]
  const chart = buildDepthChart([...wings, ...newcomers, ...depthLw])
  assert.equal(chart.forwards.length, 4)
  assert.equal(chart.defense.length, 3)
  // Six LW mains + two newcomers: top 4 by games, depth never displaces a main.
  assert.deepEqual(ids(chart.forwards.map((l) => l.lw)), ['100', '101', '102', '103'])

  const few = buildDepthChart([wings[0] ?? m(1, {}), ...newcomers, ...depthLw])
  // One playing LW main, two newcomer mains, one slot left for the best LW depth (9 games).
  assert.deepEqual(ids(few.forwards.map((l) => l.lw)), ['100', '300d', '200', '201'])
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
