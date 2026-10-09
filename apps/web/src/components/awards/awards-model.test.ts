/**
 * Run:
 *   node --test apps/web/src/components/awards/awards-model.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { ClubSeasonLine } from '@eanhl/db/queries'
import { buildPlayerAwards } from './awards-model.ts'

const TITLES: Record<string, number> = { 'NHL 22': 22, 'NHL 23': 23, 'NHL 26': 26, 'NHL 27': 27 }

function line(
  playerId: number,
  title: string,
  s: Partial<Omit<ClubSeasonLine, 'playerId' | 'gameTitleName'>> = {},
): ClubSeasonLine {
  return {
    playerId,
    gamertag: `P${String(playerId)}`,
    gameTitleId: TITLES[title] ?? 0,
    gameTitleName: title,
    releaseOrder: TITLES[title] ?? null,
    skaterGp: 0,
    goals: 0,
    assists: 0,
    points: 0,
    goalieGp: 0,
    wins: 0,
    shutouts: 0,
    ...s,
  }
}

const ids = (v: ReturnType<typeof buildPlayerAwards>) => v.items.map((i) => i.id)

void test('no lines: no awards, no span', () => {
  assert.deepEqual(buildPlayerAwards([], 1), {
    items: [],
    span: '',
    totals: { trophies: 0, banners: 0, accolades: 0 },
  })
})

void test('single-season record goes to the best player-title line', () => {
  const lines = [
    line(1, 'NHL 22', { goals: 300 }),
    line(1, 'NHL 26', { goals: 745 }),
    line(2, 'NHL 26', { goals: 726 }),
    line(3, 'NHL 27', { goals: 20 }),
  ]
  const p1 = buildPlayerAwards(lines, 1)
  const rec = p1.items.find((i) => i.id === 'record-G-NHL 26')
  assert.ok(rec)
  assert.equal(rec.glyph, '745')
  assert.equal(rec.when, 'NHL 26')
  assert.match(rec.basis, /Next best: 726 \(P2, NHL 26\)/)
  assert.equal(rec.meta, 'Set NHL 26')
  assert.equal(p1.span, 'NHL 22–NHL 26')
  assert.ok(!ids(buildPlayerAwards(lines, 2)).some((id) => id.startsWith('record-G')))
})

void test('a record set in the newest title is marked in progress', () => {
  const lines = [line(1, 'NHL 27', { assists: 90 }), line(2, 'NHL 26', { assists: 80 })]
  const rec = buildPlayerAwards(lines, 1).items.find((i) => i.id === 'record-A-NHL 27')
  assert.equal(rec?.meta, 'Set NHL 27 · season in progress')
})

void test('ties share the record and name each other', () => {
  const lines = [line(1, 'NHL 26', { shutouts: 5 }), line(2, 'NHL 23', { shutouts: 5 })]
  const a = buildPlayerAwards(lines, 1).items.find((i) => i.id === 'record-SO-NHL 26')
  const b = buildPlayerAwards(lines, 2).items.find((i) => i.id === 'record-SO-NHL 23')
  assert.match(a?.basis ?? '', /Shared with P2, NHL 23\./)
  assert.match(b?.basis ?? '', /Shared with P1, NHL 26\./)
})

void test('zero values never make a record', () => {
  const v = buildPlayerAwards([line(1, 'NHL 26', { goals: 10 })], 1)
  assert.ok(!ids(v).some((id) => id.includes('-W') || id.includes('-SO')))
})

void test('all-time records sum every title', () => {
  const lines = [
    line(1, 'NHL 22', { points: 600, skaterGp: 200 }),
    line(1, 'NHL 26', { points: 600, skaterGp: 300, goalieGp: 10 }),
    line(2, 'NHL 26', { points: 1000, skaterGp: 400 }),
  ]
  const v = buildPlayerAwards(lines, 1)
  const pts = v.items.find((i) => i.id === 'alltime-PTS')
  assert.equal(pts?.glyph, '1,200')
  assert.equal(pts.when, 'All-time')
  assert.match(pts.basis, /Next best: 1,000 \(P2\)\./)
  assert.equal(v.items.find((i) => i.id === 'alltime-GP')?.glyph, '510')
})

void test('games-played milestones keep every step, each in the title it was crossed', () => {
  const lines = [
    line(1, 'NHL 22', { skaterGp: 300 }),
    line(1, 'NHL 23', { skaterGp: 300 }),
    line(1, 'NHL 26', { skaterGp: 500 }),
  ]
  const ms = buildPlayerAwards(lines, 1).items.filter((i) => i.kind === 'milestone')
  const at = Object.fromEntries(ms.map((m) => [m.id, `${m.when} ${m.tier ?? ''}`]))
  assert.deepEqual(at, {
    'milestone-GP-250': 'Reached NHL 22 bronze',
    'milestone-GP-500': 'Reached NHL 23 silver',
    'milestone-GP-1000': 'Reached NHL 26 gold',
  })
})

void test('goals, assists and points keep only the highest plaque', () => {
  const lines = [
    line(1, 'NHL 22', { goals: 300, points: 2100 }),
    line(1, 'NHL 26', { goals: 800, assists: 260 }),
  ]
  const ms = buildPlayerAwards(lines, 1).items.filter((i) => i.kind === 'milestone')
  assert.deepEqual(
    ms.map((m) => `${m.short} / ${m.when}`),
    [
      '1,000 career G / Reached NHL 26',
      '250 career A / Reached NHL 26',
      '2,000 career PTS / Reached NHL 22',
    ],
  )
  assert.match(ms[0]?.basis ?? '', /Career total: 1,100\./)
})

void test('season-leader trophies for every title but the newest', () => {
  const lines = [
    line(1, 'NHL 22', { goals: 50, assists: 10, points: 60 }),
    line(2, 'NHL 22', { goals: 40, assists: 30, points: 70 }),
    line(1, 'NHL 27', { goals: 90, assists: 90, points: 180 }),
  ]
  const p1 = buildPlayerAwards(lines, 1).items.filter((i) => i.kind === 'trophy')
  assert.deepEqual(
    p1.map((t) => t.id),
    ['trophy-scorer-NHL 22'],
  )
  assert.equal(p1[0]?.basis, 'Most goals on the club in NHL 22: 50. Next best: 40 (P2).')
  const p2 = buildPlayerAwards(lines, 2).items.filter((i) => i.kind === 'trophy')
  assert.deepEqual(
    p2.map((t) => t.name),
    ['Leading Assists', 'Leading Points'],
  )
})

void test('tied season leaders share the trophy', () => {
  const lines = [
    line(1, 'NHL 22', { goals: 50 }),
    line(2, 'NHL 22', { goals: 50 }),
    line(3, 'NHL 23', { goals: 1 }),
  ]
  const t = buildPlayerAwards(lines, 2).items.find((i) => i.id === 'trophy-scorer-NHL 22')
  assert.match(t?.basis ?? '', /Shared with P1\./)
})

void test('club-vote trophies and banners come from the hand-entered list', () => {
  const lines = [
    line(1, 'NHL 22', { goals: 1 }),
    line(2, 'NHL 23', { goals: 1 }),
    line(3, 'NHL 26', { goals: 1 }),
    line(3, 'NHL 27', { goals: 1 }),
  ]
  const v = buildPlayerAwards(lines, 3, [
    { kind: 'trophy', trophy: 'mvp', title: 'NHL 23', playerIds: [3] },
    { kind: 'banner', mode: '3s', title: 'NHL 22', playerIds: [1, 2, 3] },
    { kind: 'banner', mode: 'arcade', title: 'NHL 23', playerIds: [1, 2] },
  ])
  const mvp = v.items.find((i) => i.id === 'trophy-mvp-NHL 23')
  assert.equal(mvp?.symbol, 'mvp')
  assert.equal(mvp.meta, 'NHL 23 · club vote')
  const banner = v.items.find((i) => i.id === 'banner-3s-NHL 22')
  assert.equal(banner?.glyph, '22')
  assert.equal(banner.basis, '3v3 champions in NHL 22. Won with P1 and P2.')
  assert.ok(!v.items.some((i) => i.id === 'banner-arcade-NHL 23'))
  assert.equal(v.span, 'NHL 22–NHL 27')
  // Accolades: all-time goals plus the tied one-goal season record in NHL 26 and NHL 27.
  assert.deepEqual(v.totals, { trophies: 2, banners: 1, accolades: 3 })
})

void test('order: all-time, season records, trophies, banners, milestones; newest first in each', () => {
  const lines = [
    line(1, 'NHL 22', { goals: 300, assists: 10 }),
    line(1, 'NHL 26', { goals: 5, assists: 300 }),
    line(2, 'NHL 27', { goals: 1 }),
  ]
  const clubAwards = [{ kind: 'banner', mode: 'arcade', title: 'NHL 22', playerIds: [1] }] as const
  assert.deepEqual(ids(buildPlayerAwards(lines, 1, clubAwards)), [
    'alltime-G',
    'alltime-A',
    'record-A-NHL 26',
    'record-G-NHL 22',
    'trophy-scorer-NHL 26',
    'trophy-assist-NHL 26',
    'trophy-scorer-NHL 22',
    'trophy-assist-NHL 22',
    'banner-arcade-NHL 22',
    'milestone-A-250',
    'milestone-G-250',
  ])
})
