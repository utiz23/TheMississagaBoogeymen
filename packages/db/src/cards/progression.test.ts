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
  assert.equal(badgeLevel(ladder, 5), 2)
  assert.equal(badgeLevel(ladder, 6), 3)
  assert.equal(badgeLevel(ladder, 550), 30)
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
  const mid = badgeProgress(BADGE_LADDERS.pgoals, 45)
  assert.equal(mid.level, 8)
  assert.equal(mid.prevThreshold, 39)
  assert.equal(mid.nextThreshold, 50)
  assert.equal(mid.remaining, 5)
  assert.ok(Math.abs(mid.pct - 6 / 11) < 1e-9)
  const maxed = badgeProgress(BADGE_LADDERS.pgoals, 6000)
  assert.equal(maxed.level, 30)
  assert.equal(maxed.nextThreshold, null)
  assert.equal(maxed.remaining, null)
  assert.equal(maxed.pct, 1)
})

void test('tier bars are 5 / 12 / 20 / 29; T6 reads as T5', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(tierBar), [1, 5, 12, 20, 29, 29])
})

void test('a player with no stats is tier 1, level 1, skater pool', () => {
  assert.deepEqual(computeStanding(emptyBadgeValues()), {
    tier: 1,
    level: 1,
    pool: 'skater',
    mythicTheme: null,
  })
})

// NHL 27 season totals from the live database on 2026-10-08, five weeks into
// the title (EA season totals + site-recorded mode games; Dekes = successful
// dekes). Season-cards spec: regulars are Rookie by week 2, Stud by week 6-10.
// prettier-ignore
const NHL27_2026_10_08: { gamertag: string; values: BadgeValues }[] = [
  { gamertag: 'Stick Menace', values: {p3v3: 6, p6v6: 64, p6g: 12, pwins: 35, pgoals: 67, pasts: 66, pshots: 302, pdekes: 94, pht: 7, pbrk: 10, phits: 156, pfo: 564, ptka: 189, pblk: 38, pfight: 6, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },
  { gamertag: 'silkyjoker85', values: {p3v3: 6, p6v6: 59, p6g: 12, pwins: 31, pgoals: 19, pasts: 72, pshots: 167, pdekes: 19, pht: 0, pbrk: 8, phits: 212, pfo: 359, ptka: 178, pblk: 70, pfight: 0, gg: 5, gw: 2, gsv: 48, gdsv: 4, gpoke: 0, gso: 0} },
  { gamertag: 'HenryTheBobJr', values: {p3v3: 1, p6v6: 54, p6g: 10, pwins: 25, pgoals: 46, pasts: 56, pshots: 246, pdekes: 36, pht: 5, pbrk: 6, phits: 58, pfo: 0, ptka: 144, pblk: 21, pfight: 0, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },
  { gamertag: 'camrazz', values: {p3v3: 6, p6v6: 47, p6g: 12, pwins: 28, pgoals: 55, pasts: 48, pshots: 350, pdekes: 149, pht: 8, pbrk: 11, phits: 108, pfo: 28, ptka: 104, pblk: 20, pfight: 1, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },
  { gamertag: 'JoeyFlopfish', values: {p3v3: 6, p6v6: 42, p6g: 12, pwins: 24, pgoals: 18, pasts: 43, pshots: 136, pdekes: 22, pht: 3, pbrk: 2, phits: 69, pfo: 44, ptka: 121, pblk: 27, pfight: 0, gg: 4, gw: 3, gsv: 54, gdsv: 1, gpoke: 0, gso: 0} },
  { gamertag: 'MrHomiecide', values: {p3v3: 0, p6v6: 34, p6g: 9, pwins: 15, pgoals: 8, pasts: 28, pshots: 74, pdekes: 7, pht: 0, pbrk: 0, phits: 125, pfo: 15, ptka: 76, pblk: 25, pfight: 3, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },
  { gamertag: 'Ordinary_Samich', values: {p3v3: 0, p6v6: 23, p6g: 2, pwins: 9, pgoals: 12, pasts: 17, pshots: 84, pdekes: 16, pht: 0, pbrk: 4, phits: 57, pfo: 0, ptka: 31, pblk: 11, pfight: 0, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },
]

void test('reproduces the 2026-10-08 NHL 27 tier table', () => {
  const got = Object.fromEntries(
    NHL27_2026_10_08.map((p) => {
      const s = computeStanding(p.values)
      return [p.gamertag, `T${String(s.tier)} L${String(s.level)} ${s.pool}`]
    }),
  )
  assert.deepEqual(got, {
    'Stick Menace': 'T2 L8 skater',
    silkyjoker85: 'T2 L8 skater',
    HenryTheBobJr: 'T2 L6 skater',
    camrazz: 'T2 L8 skater',
    JoeyFlopfish: 'T2 L5 skater',
    MrHomiecide: 'T2 L3 skater',
    Ordinary_Samich: 'T2 L1 skater',
  })
})

void test('tier N needs 4 families in one pool at the bar; 3 are not enough', () => {
  // pgoals/pasts/pshots/phits at level 29 (T5 bar): 515 / 635 / 2430 / 1870.
  const four = values({ pgoals: 515, pasts: 635, pshots: 2430, phits: 1870 })
  assert.equal(computeStanding(four).tier, 5)
  const three = values({ pgoals: 515, pasts: 635, pshots: 2430, phits: 1740 })
  assert.equal(computeStanding(three).tier, 4)
  // Goalie families don't help the skater pool and vice versa.
  const mixed = values({ pgoals: 515, pasts: 635, pshots: 2430, gg: 56 })
  assert.equal(computeStanding(mixed).tier, 1)
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
