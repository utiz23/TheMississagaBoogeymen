/**
 * Run (after `pnpm --filter @eanhl/db build`):
 *   node --test apps/web/src/components/cards/locker-model.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { BadgeFamilyId } from '@eanhl/db/cards'
import { buildLockerView, lockerPreviewCard, type LockerInput } from './locker-model.ts'
import type { CardViewModel } from './card-model.ts'

const levels = (l: Partial<Record<BadgeFamilyId, number>>) =>
  Object.entries(l).map(([familyId, level]) => ({ familyId: familyId as BadgeFamilyId, level }))

/** #3 Stick Menace on the preview database: T4 L6, skater pool. */
const igor: LockerInput = {
  name: 'Igor Orlov',
  tier: 4,
  level: 6,
  equipped: 'carbon',
  pool: 'skater',
  badges: levels({
    pbrk: 28,
    pfo: 18,
    pfight: 17,
    pdekes: 17,
    pht: 17,
    pgoals: 15,
    pwins: 15,
    pshots: 14,
  }),
  events: [],
  trackedSince: new Date('2026-10-07T18:00:00Z'),
}

void test('themes: equipped, unlocked and locked tags and actions', () => {
  const v = buildLockerView(igor)
  const byKey = Object.fromEntries(v.themes.map((t) => [t.key, t]))
  assert.equal(v.themes.length, 10)
  assert.deepEqual([byKey.away?.tag, byKey.away?.action], ['T1 · UNLOCKED', 'EQUIP AWAY'])
  assert.deepEqual(
    [byKey.carbon?.tag, byKey.carbon?.action, byKey.carbon?.status],
    ['T4 · EQUIPPED (AUTO)', 'EQUIPPED', 'equipped'],
  )
  assert.deepEqual(
    [byKey.futureB?.tag, byKey.futureB?.action, byKey.futureB?.unlockNote],
    ['T5 · LOCKED · PREVIEW', 'LOCKED', null],
  )
  assert.equal(byKey.frozen?.unlockNote, 'Frozen is a T6 mythic, awarded by the club.')
  assert.equal(byKey.stormLive?.short, 'STORM')
  assert.equal(v.unlockedCount, 4)
})

void test('a locked theme two or more tiers away names its tier', () => {
  const v = buildLockerView({ ...igor, tier: 2, equipped: 'home' })
  const byKey = Object.fromEntries(v.themes.map((t) => [t.key, t]))
  assert.equal(byKey.alternate?.unlockNote, null)
  assert.equal(byKey.carbon?.unlockNote, 'Carbon-Fiber unlocks at T4 Elite.')
})

void test('skater pool: requirement counts families at the next bar', () => {
  const v = buildLockerView(igor)
  assert.deepEqual(v.requirement, {
    title: 'NEXT · T5 FRANCHISE',
    count: '1 / 4 BADGES',
    pct: 25,
    note: '4 skater badges at Tier V (LVL 21+).',
  })
})

void test('rows: top 6 of the pool by level, catalog order on ties, DONE at the bar', () => {
  const v = buildLockerView(igor)
  assert.deepEqual(
    v.rows.map((r) => r.short),
    ['BREAKAWAYS', 'FACEOFFS', 'DEKES', 'HAT TRICKS', 'FIGHTS', 'WINS'],
  )
  assert.deepEqual(
    v.rows.map((r) => r.value),
    ['DONE', 'LVL 18/21', 'LVL 17/21', 'LVL 17/21', 'LVL 17/21', 'LVL 15/21'],
  )
  assert.deepEqual(
    v.rows.map((r) => r.pct),
    [100, 86, 81, 81, 81, 71],
  )
  const first = v.rows[0]
  assert.ok(first)
  assert.equal(first.done, true)
  assert.equal(first.shape, 'round')
  assert.equal(first.theme, 'olympus') // level 28 → theme index ceil(28/3)−1 = 9
})

void test('goalie pool: requirement and rows use the 6 goalie families only', () => {
  const v = buildLockerView({
    ...igor,
    tier: 2,
    level: 8,
    equipped: 'home',
    pool: 'goalie',
    badges: levels({ gg: 12, gw: 11, gsv: 15, gdsv: 3, gso: 2, gpoke: 0, pgoals: 30, pbrk: 30 }),
  })
  assert.deepEqual(v.requirement, {
    title: 'NEXT · T3 STUD',
    count: '3 / 4 BADGES',
    pct: 75,
    note: '4 goalie badges at Tier III (LVL 11+).',
  })
  assert.deepEqual(
    v.rows.map((r) => [r.short, r.value]),
    [
      ['SAVES', 'DONE'],
      ['STARTS', 'DONE'],
      ['G WINS', 'DONE'],
      ['DESPERATION', 'LVL 3/11'],
      ['SHUTOUTS', 'LVL 2/11'],
      ['POKE CHECKS', 'LVL 0/11'],
    ],
  )
  assert.equal(v.rows[5]?.locked, true)
})

void test('T5 and T6: no stat requirement, no rows, no repeated awarded note', () => {
  const t5 = buildLockerView({ ...igor, tier: 5, level: 10, equipped: 'futureB' })
  assert.deepEqual(t5.requirement, {
    title: 'NEXT · T6 LEGEND',
    count: 'AWARDED',
    pct: null,
    note: 'T6 mythic cards are awarded by the club, not earned from stats.',
  })
  assert.deepEqual(t5.rows, [])
  assert.equal(t5.themes.find((t) => t.key === 'inferno')?.unlockNote, null)
  assert.equal(t5.levelNote, 'Top tier from stats. Level stays full.')

  const t6 = buildLockerView({ ...igor, tier: 6, level: 10, equipped: 'stormLive', pool: 'manual' })
  assert.deepEqual(t6.requirement, {
    title: 'T6 LEGEND · MAX TIER',
    count: 'COMPLETE',
    pct: 100,
    note: 'All themes unlocked.',
  })
  assert.deepEqual(t6.rows, [])
  assert.equal(t6.unlockedCount, 10)
  assert.equal(t6.themes.filter((t) => t.status === 'locked').length, 0)
  assert.equal(t6.themes.find((t) => t.key === 'stormLive')?.status, 'equipped')
})

void test('no standing yet: T1, nothing earned, no history', () => {
  const v = buildLockerView({
    name: 'Utiz23',
    tier: 1,
    level: 1,
    equipped: 'away',
    pool: null,
    badges: [],
    events: [],
    trackedSince: null,
  })
  assert.equal(v.requirement.count, '0 / 4 BADGES')
  assert.equal(v.requirement.note, '4 skater badges at Tier II (LVL 6+).')
  assert.equal(v.rows.length, 6)
  assert.ok(v.rows.every((r) => r.locked && r.value === 'LVL 0/6'))
  assert.deepEqual(v.history, [])
  assert.equal(v.historyEmpty, 'No card history yet.')
  assert.equal(v.unlockedCount, 1)
})

void test('history: newest-first lines with dates in the operator zone', () => {
  const v = buildLockerView({
    ...igor,
    events: [
      {
        kind: 'mythic_cleared',
        familyId: null,
        fromValue: 6,
        toValue: 4,
        occurredAt: new Date('2026-10-06T18:00:00Z'),
      },
      {
        kind: 'mythic_awarded',
        familyId: null,
        fromValue: 4,
        toValue: 6,
        occurredAt: new Date('2026-10-05T18:00:00Z'),
      },
      {
        kind: 'tier_up',
        familyId: null,
        fromValue: 3,
        toValue: 4,
        occurredAt: new Date('2026-10-04T03:00:00Z'),
      },
      {
        kind: 'level_up',
        familyId: null,
        fromValue: 5,
        toValue: 6,
        occurredAt: new Date('2026-09-28T18:00:00Z'),
      },
      {
        kind: 'badge_level_up',
        familyId: 'pgoals',
        fromValue: 15,
        toValue: 16,
        occurredAt: new Date('2026-09-02T18:00:00Z'),
      },
    ],
  })
  assert.deepEqual(v.history, [
    { date: 'OCT 06', text: 'Mythic cleared · back to T4' },
    { date: 'OCT 05', text: 'T6 Legend · Mythic card awarded' },
    { date: 'OCT 03', text: 'T4 Elite · Carbon-Fiber unlocked' }, // 03:00 UTC = Oct 3, 21:00 in Edmonton
    { date: 'SEP 28', text: 'Level 6 reached' },
    { date: 'SEP 02', text: 'Goals · Level 16' },
  ])
  assert.equal(buildLockerView(igor).historyEmpty, 'History starts Oct 7, 2026.')
})

void test('header strings, level note and tier track', () => {
  const v = buildLockerView(igor)
  assert.equal(v.subline, 'IGOR ORLOV · T4 ELITE · LVL 6/10 · 4 / 10 THEMES')
  assert.equal(v.tierLabel, 'ELITE')
  assert.equal(v.level, 6)
  assert.equal(
    v.levelNote,
    'Average progress of the best 4 skater badges toward T5 Franchise. Never goes down.',
  )
  assert.deepEqual(
    v.track.map((s) => [s.tier, s.label, s.theme, s.note, s.state]),
    [
      [1, 'PROSPECT', 'AWAY', null, 'done'],
      [2, 'ROOKIE', 'HOME', null, 'done'],
      [3, 'STUD', 'ALTERNATE', null, 'done'],
      [4, 'ELITE', 'CARBON-FIBER', null, 'now'],
      [5, 'FRANCHISE', 'HARDLIGHT', null, 'next'],
      [6, 'LEGEND', '5 MYTHICS', 'AWARDED', 'next'],
    ],
  )
})

void test('preview card: locked themes at their own tier and level 1, front only', () => {
  const card = {
    front: { tier: 4, level: 6, theme: 'carbon' },
    back: { source: 'x' },
  } as unknown as CardViewModel
  const v = buildLockerView(igor)
  const frozen = v.themes.find((t) => t.key === 'frozen')
  const away = v.themes.find((t) => t.key === 'away')
  assert.ok(frozen && away)
  const locked = lockerPreviewCard(card, frozen)
  assert.deepEqual([locked.front.theme, locked.front.tier, locked.front.level], ['frozen', 6, 1])
  assert.equal(locked.back, null)
  const open = lockerPreviewCard(card, away)
  assert.deepEqual([open.front.theme, open.front.tier, open.front.level], ['away', 4, 6])
})
