/**
 * Run (after `pnpm --filter @eanhl/db build`):
 *   node --test apps/web/src/components/roster/action-map-model.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { CareerActionRow } from '@eanhl/db/queries'
import {
  actionLabel,
  buildGroups,
  buildMarkers,
  buildPin,
  filterCounts,
  notPlotted,
  periodName,
  shouldShowActionMap,
  visibleEvents,
  ALL_TYPES_ON,
  type ActionFilters,
} from './action-map-model.ts'

let nextId = 1
const ev = (partial: Partial<CareerActionRow> = {}): CareerActionRow => ({
  eventId: nextId++,
  matchId: 1,
  periodNumber: 1,
  clock: '10:00',
  eventType: 'shot',
  role: 'by',
  actorName: 'silkyjoker85',
  targetName: 'GOALIE',
  infraction: null,
  x: 50,
  y: 0,
  hasPosition: true,
  positionConfidence: 'interpolated',
  opponent: 'CAN',
  gameMode: '6s',
  result: 'WIN',
  scoreFor: 4,
  scoreAgainst: 2,
  playedAt: new Date('2026-10-04T23:00:00Z'),
  ...partial,
})

const all: ActionFilters = { period: 'all', role: 'all', types: ALL_TYPES_ON, isoMatchId: null }

void test('labels by type and role', () => {
  assert.equal(actionLabel(ev({ eventType: 'goal' })), 'Goal')
  assert.equal(actionLabel(ev({ eventType: 'goal', role: 'on' })), 'Goal against')
  assert.equal(actionLabel(ev({ eventType: 'shot', role: 'on' })), 'Shot against')
  assert.equal(actionLabel(ev({ eventType: 'hit' })), 'Hit')
  assert.equal(actionLabel(ev({ eventType: 'hit', role: 'on' })), 'Hit taken')
  assert.equal(actionLabel(ev({ eventType: 'faceoff' })), 'Faceoff won')
  assert.equal(actionLabel(ev({ eventType: 'faceoff', role: 'on' })), 'Faceoff lost')
  assert.equal(
    actionLabel(ev({ eventType: 'penalty', infraction: 'Tripping' })),
    'Penalty · Tripping',
  )
  assert.equal(
    actionLabel(ev({ eventType: 'penalty', role: 'on', infraction: 'Slashing' })),
    'Penalty drawn · Slashing',
  )
  assert.equal(actionLabel(ev({ eventType: 'penalty', infraction: null })), 'Penalty')
})

void test('period names: regulation, OT, OT2, OT3', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(periodName), [
    '1st period',
    '2nd period',
    '3rd period',
    'OT',
    'OT2',
    'OT3',
  ])
})

void test('each filter count ignores its own selection, and the OT segment covers every OT', () => {
  const events = [
    ev({ periodNumber: 1 }),
    ev({ periodNumber: 2 }),
    ev({ periodNumber: 2, role: 'on' }),
    ev({ periodNumber: 4, eventType: 'hit' }),
    ev({ periodNumber: 5 }),
  ]
  const narrowed: ActionFilters = { ...all, period: 2 }
  const c = filterCounts(events, narrowed)
  assert.deepEqual(c.periods, { all: 5, 1: 1, 2: 2, 3: 0, ot: 2 })
  // Role and type counts DO apply the period filter.
  assert.deepEqual(c.roles, { all: 2, by: 1, on: 1 })
  assert.equal(c.types.shot, 2)
  assert.equal(c.types.hit, 0)
  assert.equal(visibleEvents(events, narrowed).length, 2)
})

void test('an isolated game restricts every count', () => {
  const events = [ev({ matchId: 1 }), ev({ matchId: 2 }), ev({ matchId: 2, eventType: 'hit' })]
  const c = filterCounts(events, { ...all, isoMatchId: 2 })
  assert.equal(c.periods.all, 2)
  assert.equal(c.roles.by, 2)
  assert.deepEqual([c.types.shot, c.types.hit], [1, 1])
})

void test('markers: plotted non-faceoff events only; extrapolated dimmed; rink coordinates', () => {
  const shot = ev({ x: 50, y: 10 })
  const extrap = ev({ eventType: 'hit', x: -20, y: -30, positionConfidence: 'extrapolated' })
  const unknownDir = ev({ x: null, y: null })
  const faceoff = ev({ eventType: 'faceoff', x: 70, y: 20 })
  const m = buildMarkers([shot, extrap, unknownDir, faceoff], null)
  assert.deepEqual(m.map((x) => x.id).sort(), [shot.eventId, extrap.eventId].sort())
  const s = m.find((x) => x.id === shot.eventId)
  assert.ok(s)
  assert.deepEqual(
    [s.cx, s.cy, s.size, s.opacity, s.type, s.role],
    [1802.5, 392.5, 56, 1, 'shot', 'by'],
  )
  assert.equal(m.find((x) => x.id === extrap.eventId)?.opacity, 0.45)
  assert.equal(notPlotted([shot, extrap, unknownDir, faceoff]), 2)
})

void test('a pinned marker draws last at 1.5×, the others fade; goals sit above hits', () => {
  const hit = ev({ eventType: 'hit', x: 0, y: 0 })
  const goal = ev({ eventType: 'goal', x: 80, y: 0 })
  const shot = ev({ eventType: 'shot', x: -80, y: 0 })
  const plain = buildMarkers([goal, hit, shot], null)
  assert.deepEqual(
    plain.map((x) => x.type),
    ['hit', 'shot', 'goal'],
  )
  const pinned = buildMarkers([goal, hit, shot], hit.eventId)
  const last = pinned[pinned.length - 1]
  assert.ok(last)
  assert.deepEqual([last.id, last.size, last.pinned, last.opacity], [hit.eventId, 84, true, 1])
  assert.ok(pinned.slice(0, -1).every((x) => x.opacity === 0.28))
})

void test('overlapping markers are spread apart', () => {
  const a = ev({ x: 50, y: 0 })
  const b = ev({ x: 50, y: 0 })
  const [m1, m2] = buildMarkers([a, b], null)
  assert.ok(m1 && m2)
  assert.notDeepEqual([m1.dx, m1.dy], [m2.dx, m2.dy])
})

void test('game groups: newest game first, rows by period then clock (latest first)', () => {
  const older = ev({
    matchId: 1,
    playedAt: new Date('2026-09-01T23:00:00Z'),
    result: 'LOSS',
    scoreFor: 1,
    scoreAgainst: 3,
  })
  const p2 = ev({ matchId: 2, periodNumber: 2, clock: '5:00' })
  const p1early = ev({ matchId: 2, periodNumber: 1, clock: '2:00' })
  const p1late = ev({ matchId: 2, periodNumber: 1, clock: '15:30' })
  const groups = buildGroups([older, p2, p1early, p1late], 'game')
  assert.deepEqual(
    groups.map((g) => [g.label, g.sub, g.result, g.tone, g.count, g.matchId]),
    [
      ['vs CAN', 'Oct 4 · 6s', 'W 4–2', 'W', 3, 2],
      ['vs CAN', 'Sep 1 · 6s', 'L 1–3', 'L', 1, 1],
    ],
  )
  const newestGroup = groups[0]
  assert.ok(newestGroup)
  assert.deepEqual(
    newestGroup.rows.map((r) => r.id),
    [p1late.eventId, p1early.eventId, p2.eventId],
  )
  assert.equal(newestGroup.rows[0]?.meta, '1st period')
})

void test('newest and type sorts', () => {
  const a = ev({ eventType: 'goal' })
  const b = ev({ eventType: 'hit', role: 'on' })
  const c = ev({ eventType: 'hit' })
  const newest = buildGroups([a, b, c], 'newest')
  assert.equal(newest.length, 1)
  assert.equal(newest[0]?.rows[0]?.meta, '1st period · vs CAN · Oct 4')
  const byType = buildGroups([a, b, c], 'type')
  assert.deepEqual(
    byType.map((g) => [g.label, g.sub, g.count, g.matchId]),
    [
      ['Goals', '1 by · 0 on', 1, null],
      ['Hits', '1 by · 1 on', 2, null],
    ],
  )
})

void test('filters narrowed to nothing: no groups, no markers, pin dropped', () => {
  const e = ev()
  const none: ActionFilters = {
    ...all,
    types: { goal: false, shot: false, hit: false, penalty: false, faceoff: false },
  }
  const visible = visibleEvents([e], none)
  assert.deepEqual(visible, [])
  assert.deepEqual(buildGroups(visible, 'game'), [])
  assert.deepEqual(buildMarkers(visible, e.eventId), [])
  assert.equal(buildPin(visible, e.eventId), null)
  const pin = buildPin([e], e.eventId)
  assert.ok(pin)
  assert.deepEqual(
    [
      pin.label,
      pin.actor,
      pin.target,
      pin.clock,
      pin.period,
      pin.opp,
      pin.date,
      pin.mode,
      pin.result,
    ],
    ['Shot', 'silkyjoker85', 'GOALIE', '10:00', '1st period', 'CAN', 'Oct 4', '6s', 'W 4–2'],
  )
})

void test('blank names and unknown mode show dashes; DNF reads as a loss', () => {
  const e = ev({ actorName: null, targetName: null, gameMode: null, result: 'DNF', clock: null })
  const g = buildGroups([e], 'game')[0]
  assert.deepEqual([g?.sub, g?.result, g?.tone], ['Oct 4', 'DNF 4–2', 'L'])
  const row = g?.rows[0]
  assert.deepEqual([row?.actor, row?.target, row?.clock], ['—', '—', '—'])
})

void test('the section shows from 5 positioned events', () => {
  const four = [1, 2, 3, 4].map(() => ev())
  assert.equal(shouldShowActionMap([...four, ev({ hasPosition: false, x: null, y: null })]), false)
  assert.equal(shouldShowActionMap([...four, ev({ hasPosition: true, x: null, y: null })]), true)
})

void test('opponents read as the site abbreviation of the club name (never the OCR team code)', () => {
  const e = ev({ opponent: 'Junior C Allstars' })
  assert.equal(buildGroups([e], 'game')[0]?.label, 'vs JCA')
  assert.equal(buildPin([e], e.eventId)?.opp, 'JCA')
  assert.match(buildMarkers([e], null)[0]?.tip ?? '', / · vs JCA · /)
})
