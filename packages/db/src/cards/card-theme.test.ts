import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isThemeEquippable,
  isThemeUnlocked,
  pickBestBadge,
  resolveCardTheme,
  resolveEquippedTheme,
  themeTier,
  topBadges,
} from './card-theme.js'

void test('theme follows tier; tier 6 uses the awarded mythic', () => {
  assert.deepEqual(
    ([1, 2, 3, 4, 5] as const).map((t) => resolveCardTheme(t, null)),
    ['away', 'home', 'alternate', 'carbon', 'futureB'],
  )
  assert.equal(resolveCardTheme(6, 'inferno'), 'inferno')
  assert.equal(resolveCardTheme(6, null), 'futureB')
  assert.equal(resolveCardTheme(3, 'inferno'), 'alternate')
})

void test('unlock tier per theme: one per tier to T5, the five mythics at T6', () => {
  assert.equal(themeTier('away'), 1)
  assert.equal(themeTier('futureB'), 5)
  assert.equal(themeTier('frozen'), 6)
  assert.equal(themeTier('olympus'), 6)
  assert.equal(isThemeUnlocked('carbon', 3), false)
  assert.equal(isThemeUnlocked('carbon', 4), true)
  assert.equal(isThemeUnlocked('inferno', 5), false)
  assert.equal(isThemeUnlocked('inferno', 6), true)
})

void test('top badges: earned only, highest level first, ties in catalog order, at most n', () => {
  const rows = [
    { familyId: 'phits' as const, level: 12 },
    { familyId: 'pgoals' as const, level: 15 },
    { familyId: 'pwins' as const, level: 15 },
    { familyId: 'gso' as const, level: 0 },
    { familyId: 'pblk' as const, level: 3 },
    { familyId: 'pasts' as const, level: 9 },
  ]
  assert.deepEqual(
    topBadges(rows).map((r) => r.familyId),
    ['pwins', 'pgoals', 'phits', 'pasts'],
  )
  assert.deepEqual(
    topBadges(rows, 10).map((r) => r.familyId),
    ['pwins', 'pgoals', 'phits', 'pasts', 'pblk'],
  )
  assert.deepEqual(pickBestBadge(rows), { familyId: 'pwins', level: 15 })
  assert.equal(pickBestBadge([{ familyId: 'gso', level: 0 }]), null)
  assert.equal(pickBestBadge([]), null)
})

void test('equippable: regular themes by tier, mythics only as the awarded one', () => {
  assert.equal(isThemeEquippable('home', 2, null), true)
  assert.equal(isThemeEquippable('carbon', 3, null), false)
  assert.equal(isThemeEquippable('futureB', 6, 'inferno'), true)
  assert.equal(isThemeEquippable('inferno', 6, 'inferno'), true)
  assert.equal(
    isThemeEquippable('frozen', 6, 'inferno'),
    false,
    'a non-awarded mythic stays locked',
  )
  assert.equal(isThemeEquippable('inferno', 6, null), false, 'no award, no mythic')
  assert.equal(isThemeEquippable('inferno', 5, 'inferno'), false)
})

void test('equipped theme: the pick where allowed, otherwise AUTO', () => {
  assert.equal(resolveEquippedTheme(4, null, null), 'carbon', 'no pick = AUTO')
  assert.equal(resolveEquippedTheme(4, null, 'away'), 'away', 'a lower theme can be worn')
  assert.equal(resolveEquippedTheme(5, null, 'away'), 'away', 'a pick survives a tier-up')
  assert.equal(resolveEquippedTheme(2, null, 'carbon'), 'home', 'locked on this card: AUTO')
  assert.equal(resolveEquippedTheme(6, 'inferno', 'frozen'), 'inferno', 'unawarded mythic: AUTO')
  assert.equal(resolveEquippedTheme(6, 'inferno', 'carbon'), 'carbon')
})
