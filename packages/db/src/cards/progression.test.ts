import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyStanding,
  badgeLevel,
  badgeProgress,
  computeStanding,
  diffCardEvents,
  emptyBadgeValues,
  tierBar,
  type BadgeValues,
  type CardStanding,
} from './progression.js'
import { BADGE_LADDERS } from './badge-catalog.js'

const values = (partial: Partial<BadgeValues>): BadgeValues => ({
  ...emptyBadgeValues(),
  ...partial,
})

void test('badgeLevel counts thresholds met', () => {
  const ladder = BADGE_LADDERS.pgoals
  assert.equal(badgeLevel(ladder, 0), 0)
  assert.equal(badgeLevel(ladder, 1), 1)
  assert.equal(badgeLevel(ladder, 15), 2)
  assert.equal(badgeLevel(ladder, 16), 3)
  assert.equal(badgeLevel(ladder, 5200), 30)
  assert.equal(badgeLevel(ladder, 999999), 30)
})

void test('badgeProgress: locked, mid-level and maxed', () => {
  assert.deepEqual(badgeProgress(BADGE_LADDERS.pgoals, 0), {
    level: 0,
    value: 0,
    prevThreshold: 0,
    nextThreshold: 1,
    pct: 0,
    remaining: 1,
  })
  const mid = badgeProgress(BADGE_LADDERS.pgoals, 40)
  assert.equal(mid.level, 3)
  assert.equal(mid.prevThreshold, 16)
  assert.equal(mid.nextThreshold, 65)
  assert.equal(mid.remaining, 25)
  assert.ok(Math.abs(mid.pct - 24 / 49) < 1e-9)
  const maxed = badgeProgress(BADGE_LADDERS.pgoals, 6000)
  assert.equal(maxed.level, 30)
  assert.equal(maxed.nextThreshold, null)
  assert.equal(maxed.remaining, null)
  assert.equal(maxed.pct, 1)
})

void test('tierBar is (N-1)*5+1', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(tierBar), [1, 6, 11, 16, 21, 26])
})

void test('a player with no stats is tier 1, level 1, skater pool', () => {
  assert.deepEqual(computeStanding(emptyBadgeValues()), {
    tier: 1,
    level: 1,
    pool: 'skater',
    mythicTheme: null,
  })
})

// Career totals from the live database on 2026-10-07 (EA NHL 26+27, reviewed
// NHL 22-25 history, site-recorded mode games; Dekes = successful dekes).
// The spec's tier table.
// prettier-ignore
const LIVE_2026_10_07: { gamertag: string; values: BadgeValues }[] = [
  { gamertag: 'HenryTheBobJr', values: {p3v3: 12, p6v6: 1230, p6g: 24, pwins: 348, pgoals: 898, pasts: 2466, pshots: 5087, pdekes: 284, pht: 12, pbrk: 54, phits: 5017, pfo: 0, ptka: 5130, pblk: 1095, pfight: 1, gg: 0, gw: 0, gsv: 16, gdsv: 0, gpoke: 0, gso: 0} },
  { gamertag: 'silkyjoker85', values: {p3v3: 57, p6v6: 1596, p6g: 30, pwins: 390, pgoals: 2107, pasts: 2969, pshots: 7813, pdekes: 357, pht: 61, pbrk: 106, phits: 5743, pfo: 4559, ptka: 5562, pblk: 1032, pfight: 4, gg: 21, gw: 8, gsv: 1185, gdsv: 21, gpoke: 4, gso: 3} },
  { gamertag: 'Stick Menace', values: {p3v3: 30, p6v6: 590, p6g: 29, pwins: 359, pgoals: 1438, pasts: 993, pshots: 4792, pdekes: 796, pht: 110, pbrk: 285, phits: 4591, pfo: 2098, ptka: 2294, pblk: 328, pfight: 81, gg: 4, gw: 3, gsv: 484, gdsv: 0, gpoke: 1, gso: 1} },
  { gamertag: 'JoeyFlopfish', values: {p3v3: 65, p6v6: 1751, p6g: 28, pwins: 339, pgoals: 1961, pasts: 2857, pshots: 7212, pdekes: 217, pht: 29, pbrk: 65, phits: 5501, pfo: 972, ptka: 6313, pblk: 1291, pfight: 0, gg: 19, gw: 11, gsv: 2092, gdsv: 15, gpoke: 0, gso: 5} },
  { gamertag: 'camrazz', values: {p3v3: 23, p6v6: 476, p6g: 24, pwins: 210, pgoals: 909, pasts: 743, pshots: 3267, pdekes: 727, pht: 69, pbrk: 121, phits: 2479, pfo: 352, ptka: 1763, pblk: 294, pfight: 8, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },
  { gamertag: 'Ordinary_Samich', values: {p3v3: 4, p6v6: 112, p6g: 11, pwins: 129, pgoals: 221, pasts: 203, pshots: 850, pdekes: 153, pht: 14, pbrk: 51, phits: 724, pfo: 29, ptka: 554, pblk: 115, pfight: 5, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },
  { gamertag: 'SCOOT BOY 42', values: {p3v3: 0, p6v6: 4, p6g: 0, pwins: 62, pgoals: 162, pasts: 104, pshots: 958, pdekes: 199, pht: 21, pbrk: 65, phits: 838, pfo: 388, ptka: 307, pblk: 54, pfight: 2, gg: 10, gw: 7, gsv: 129, gdsv: 7, gpoke: 3, gso: 1} },
  { gamertag: 'MrHomiecide', values: {p3v3: 0, p6v6: 419, p6g: 12, pwins: 88, pgoals: 336, pasts: 524, pshots: 2325, pdekes: 122, pht: 7, pbrk: 31, phits: 2612, pfo: 918, ptka: 1352, pblk: 295, pfight: 11, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },
  { gamertag: 'Pratt2016', values: {p3v3: 3, p6v6: 71, p6g: 15, pwins: 36, pgoals: 9, pasts: 27, pshots: 130, pdekes: 2, pht: 0, pbrk: 1, phits: 68, pfo: 31, ptka: 76, pblk: 32, pfight: 0, gg: 39, gw: 19, gsv: 736, gdsv: 27, gpoke: 1, gso: 4} },
  { gamertag: 'joseph4577', values: {p3v3: 0, p6v6: 226, p6g: 0, pwins: 15, pgoals: 346, pasts: 217, pshots: 1351, pdekes: 10, pht: 3, pbrk: 2, phits: 1773, pfo: 8, ptka: 622, pblk: 86, pfight: 0, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },]

void test('reproduces the approved 2026-10-07 tier table', () => {
  const got = Object.fromEntries(
    LIVE_2026_10_07.map((p) => {
      const s = computeStanding(p.values)
      return [p.gamertag, `T${String(s.tier)} L${String(s.level)} ${s.pool}`]
    }),
  )
  assert.deepEqual(got, {
    HenryTheBobJr: 'T3 L9 skater',
    silkyjoker85: 'T4 L5 skater',
    'Stick Menace': 'T4 L6 skater',
    JoeyFlopfish: 'T4 L3 skater',
    camrazz: 'T3 L7 skater',
    Ordinary_Samich: 'T1 L10 skater',
    'SCOOT BOY 42': 'T1 L10 skater',
    MrHomiecide: 'T2 L8 skater',
    Pratt2016: 'T2 L8 goalie',
    joseph4577: 'T2 L2 skater',
  })
})

void test('stats alone never exceed tier 5', () => {
  const huge = values(
    Object.fromEntries(
      Object.keys(emptyBadgeValues()).map((k) => [k, 1_000_000]),
    ) as Partial<BadgeValues>,
  )
  const s = computeStanding(huge)
  assert.equal(s.tier, 5)
  assert.equal(s.level, 10)
})

const standing = (
  tier: CardStanding['tier'],
  level: number,
  pool: CardStanding['pool'] = 'skater',
): CardStanding => ({
  tier,
  level,
  pool,
  mythicTheme: pool === 'manual' ? 'inferno' : null,
})

void test('applyStanding: first computation is taken as-is', () => {
  assert.deepEqual(applyStanding(null, standing(2, 4)), standing(2, 4))
})

void test('applyStanding: never downgrades tier or level', () => {
  assert.deepEqual(applyStanding(standing(3, 6), standing(2, 9)), standing(3, 6))
  assert.deepEqual(applyStanding(standing(3, 6), standing(3, 4)), standing(3, 6))
  assert.deepEqual(applyStanding(standing(3, 6), standing(3, 8)), standing(3, 8))
  assert.deepEqual(applyStanding(standing(3, 6), standing(4, 1)), standing(4, 1))
})

void test('applyStanding: a hand-awarded mythic survives recomputes', () => {
  assert.deepEqual(
    applyStanding(standing(6, 10, 'manual'), standing(5, 10)),
    standing(6, 10, 'manual'),
  )
})

void test('diffCardEvents: first computation emits nothing', () => {
  const levels = { ...emptyBadgeValues(), pgoals: 5 }
  assert.deepEqual(diffCardEvents(null, { standing: standing(2, 3), levels }), [])
})

void test('diffCardEvents: tier up beats level up; badge rises are listed; drops are silent', () => {
  const before = { ...emptyBadgeValues(), pgoals: 5, phits: 9 }
  const after = { ...emptyBadgeValues(), pgoals: 7, phits: 8 }
  assert.deepEqual(
    diffCardEvents(
      { standing: standing(2, 9), levels: before },
      { standing: standing(3, 1), levels: after },
    ),
    [
      { kind: 'tier_up', familyId: null, fromValue: 2, toValue: 3 },
      { kind: 'badge_level_up', familyId: 'pgoals', fromValue: 5, toValue: 7 },
    ],
  )
  assert.deepEqual(
    diffCardEvents(
      { standing: standing(2, 3), levels: before },
      { standing: standing(2, 5), levels: before },
    ),
    [{ kind: 'level_up', familyId: null, fromValue: 3, toValue: 5 }],
  )
})
