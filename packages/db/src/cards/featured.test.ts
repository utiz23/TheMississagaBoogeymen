import test from 'node:test'
import assert from 'node:assert/strict'
import { pickFeaturedBadges, type FeaturedInput } from './featured.js'
import { badgeLevels, computeStanding, emptyBadgeValues, type BadgeValues } from './progression.js'
import { NHL27_2026_10_08 } from './test-fixtures.js'

const player = (playerId: number, partial: Partial<BadgeValues>): FeaturedInput => {
  const values = { ...emptyBadgeValues(), ...partial }
  return {
    playerId,
    pool: computeStanding(values).pool as 'skater' | 'goalie',
    values,
    levels: badgeLevels(values),
  }
}

void test('NHL 27 on 2026-10-08: leaders show their marquee badge, nobody shows games played', () => {
  const inputs = NHL27_2026_10_08.map((p, i) => player(i + 1, p.values))
  const picked = pickFeaturedBadges(inputs)
  const got = Object.fromEntries(NHL27_2026_10_08.map((p, i) => [p.gamertag, picked.get(i + 1)]))
  assert.deepEqual(got, {
    'Stick Menace': 'pgoals', // leading scorer
    silkyjoker85: 'pasts', // leading assists
    camrazz: 'pht', // leads hat tricks (also shots and dekes)
    HenryTheBobJr: 'pshots',
    JoeyFlopfish: 'ptka',
    MrHomiecide: 'phits',
    Ordinary_Samich: 'pbrk',
  })
})

void test('a player leading several badges features the most prestigious one', () => {
  const picked = pickFeaturedBadges([
    player(1, { pgoals: 20, phits: 90, pfo: 200, p6g: 12 }),
    player(2, { pgoals: 5, phits: 10, pfo: 20 }),
  ])
  assert.equal(picked.get(1), 'pgoals')
  // Hits and faceoffs are led by player 1, who already shows Goals; player 2
  // takes their best relative badge that nobody shows yet.
  assert.equal(picked.get(2), 'pfo')
})

void test('a tie for the lead goes to the relative-strength pass, not to either leader', () => {
  const picked = pickFeaturedBadges([
    player(1, { pgoals: 10, pasts: 2 }),
    player(2, { pgoals: 10, pasts: 6 }),
  ])
  // Player 2 leads assists outright; player 1 then takes Goals.
  assert.equal(picked.get(2), 'pasts')
  assert.equal(picked.get(1), 'pgoals')
})

void test('games-played badges only when nothing else is unlocked; nothing at all is null', () => {
  const picked = pickFeaturedBadges([player(1, { p6v6: 10, p6g: 1 }), player(2, {})])
  assert.equal(picked.get(1), 'p6v6')
  assert.equal(picked.get(2), null)
})

void test('a goalie card features a goalie badge', () => {
  const picked = pickFeaturedBadges([
    player(1, { gg: 30, gw: 15, gsv: 300, gdsv: 20, gso: 2, pgoals: 40 }),
    player(2, { pgoals: 10 }),
  ])
  assert.equal(picked.get(1), 'gso')
  assert.equal(picked.get(2), 'pgoals')
})
