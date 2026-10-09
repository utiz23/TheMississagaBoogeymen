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
  assert.deepEqual(buildPlayerAwards([], 1), { items: [], span: '' })
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
  assert.equal(rec.season, 'NHL 26')
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
  assert.equal(pts.season, 'NHL 26')
  assert.match(pts.basis, /Next best: 1,000 \(P2\)\./)
  assert.equal(v.items.find((i) => i.id === 'alltime-GP')?.glyph, '510')
})

void test('milestones land in the title where the threshold was crossed', () => {
  const lines = [
    line(1, 'NHL 22', { goals: 300 }),
    line(1, 'NHL 23', { goals: 300 }),
    line(1, 'NHL 26', { goals: 500 }),
  ]
  const ms = buildPlayerAwards(lines, 1).items.filter((i) => i.kind === 'milestone')
  const at = Object.fromEntries(ms.map((m) => [m.id, `${m.season} ${m.tier ?? ''}`]))
  assert.deepEqual(at, {
    'milestone-G-250': 'NHL 22 bronze',
    'milestone-G-500': 'NHL 23 silver',
    'milestone-G-1000': 'NHL 26 gold',
  })
})

void test('one title crossing several thresholds earns each', () => {
  const ms = buildPlayerAwards([line(1, 'NHL 26', { points: 2100 })], 1).items.filter(
    (i) => i.kind === 'milestone',
  )
  assert.deepEqual(
    ms.map((m) => m.short),
    ['2,000 PTS', '1,000 PTS', '500 PTS'],
  )
})

void test('newest season first; all-time, then records, then milestones', () => {
  const lines = [line(1, 'NHL 22', { goals: 300 }), line(1, 'NHL 27', { goals: 5 })]
  assert.deepEqual(ids(buildPlayerAwards(lines, 1)), [
    'alltime-G',
    'record-G-NHL 22',
    'milestone-G-250',
  ])
})
