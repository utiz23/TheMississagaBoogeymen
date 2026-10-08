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
import { AI_GOALIE_LADDERS, BADGE_LADDERS } from './badge-catalog.js'
import { NHL27_2026_10_08 } from './test-fixtures.js'

const values = (partial: Partial<BadgeValues>): BadgeValues => ({
  ...emptyBadgeValues(),
  ...partial,
})

void test('badgeLevel counts thresholds met', () => {
  const ladder = BADGE_LADDERS.pgoals
  assert.equal(badgeLevel(ladder, 0), 0)
  assert.equal(badgeLevel(ladder, 4), 0)
  assert.equal(badgeLevel(ladder, 5), 1)
  assert.equal(badgeLevel(ladder, 14), 2)
  assert.equal(badgeLevel(ladder, 15), 3)
  assert.equal(badgeLevel(ladder, 800), 30)
  assert.equal(badgeLevel(ladder, 999999), 30)
})

void test('badgeProgress: locked, mid-level and maxed', () => {
  assert.deepEqual(badgeProgress(BADGE_LADDERS.pgoals, 0), {
    level: 0,
    value: 0,
    prevThreshold: 0,
    nextThreshold: 5,
    pct: 0,
    remaining: 5,
  })
  const mid = badgeProgress(BADGE_LADDERS.pgoals, 50)
  assert.equal(mid.level, 7)
  assert.equal(mid.prevThreshold, 45)
  assert.equal(mid.nextThreshold, 55)
  assert.equal(mid.remaining, 5)
  assert.ok(Math.abs(mid.pct - 5 / 10) < 1e-9)
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

void test('reproduces the 2026-10-08 NHL 27 tier table', () => {
  const got = Object.fromEntries(
    NHL27_2026_10_08.map((p) => {
      const s = computeStanding(p.values)
      return [p.gamertag, `T${String(s.tier)} L${String(s.level)} ${s.pool}`]
    }),
  )
  assert.deepEqual(got, {
    'Stick Menace': 'T2 L9 skater',
    silkyjoker85: 'T2 L9 skater',
    HenryTheBobJr: 'T2 L6 skater',
    camrazz: 'T2 L9 skater',
    JoeyFlopfish: 'T2 L6 skater',
    MrHomiecide: 'T2 L4 skater',
    Ordinary_Samich: 'T2 L1 skater',
  })
})

void test('tier N needs 4 families in one pool at the bar; 3 are not enough', () => {
  // pgoals/pasts/pshots/phits at level 29 (T5 bar): 750 / 750 / 2350 / 1850.
  const four = values({ pgoals: 750, pasts: 750, pshots: 2350, phits: 1850 })
  assert.equal(computeStanding(four).tier, 5)
  const three = values({ pgoals: 750, pasts: 750, pshots: 2350, phits: 1750 })
  assert.equal(computeStanding(three).tier, 4)
  // Goalie families don't help the skater pool and vice versa.
  const mixed = values({ pgoals: 750, pasts: 750, pshots: 2350, gg: 95 })
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

void test('AI goalie ladders: their projected full season maxes the four badges they can earn', () => {
  const season = values({ gg: 300, gw: 150, gsv: 3500, gso: 30 })
  const ai = computeStanding(season, AI_GOALIE_LADDERS)
  assert.equal(ai.tier, 5)
  assert.equal(ai.pool, 'goalie')
  // A half season is only halfway: the ladders are sized for the full season.
  assert.ok(
    computeStanding(values({ gg: 150, gw: 75, gsv: 1750, gso: 15 }), AI_GOALIE_LADDERS).tier < 5,
  )
  // Shutouts (a 1-per-level ladder) set the pace: today's ~32 starts and 3
  // shutouts are still T1; the 5th shutout makes T2.
  const now = values({ gg: 32, gw: 16, gsv: 365, gso: 3 })
  assert.equal(computeStanding(now, AI_GOALIE_LADDERS).tier, 1)
  assert.equal(computeStanding({ ...now, gso: 5 }, AI_GOALIE_LADDERS).tier, 2)
})
