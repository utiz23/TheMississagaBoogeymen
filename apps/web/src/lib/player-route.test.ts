/**
 * Player page URL resolution (player-route.ts). The member list mirrors live
 * data on 2026-10-24, including player 2's earlier gamertag "Utiz23", which is
 * player 28's current one.
 *
 * Run: node --test apps/web/src/lib/player-route.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { MemberGamertag } from '@eanhl/db/queries'
import { memberPaths, resolvePlayerRoute } from './player-route.ts'

const MEMBERS: MemberGamertag[] = [
  { playerId: 2, gamertag: 'silkyjoker85', current: true },
  { playerId: 3, gamertag: 'Stick Menace', current: true },
  { playerId: 10, gamertag: 'SCOOT BOY 42', current: true },
  { playerId: 28, gamertag: 'Utiz23', current: true },
  { playerId: 3, gamertag: 'StickMenace', current: false },
  { playerId: 2, gamertag: 'Utiz23', current: false },
]

void test('the canonical slug renders the page', () => {
  assert.deepEqual(resolvePlayerRoute('silkyjoker85', MEMBERS), { kind: 'page', playerId: 2 })
  assert.deepEqual(resolvePlayerRoute('stick-menace', MEMBERS), { kind: 'page', playerId: 3 })
  assert.deepEqual(resolvePlayerRoute('scoot-boy-42', MEMBERS), { kind: 'page', playerId: 10 })
})

void test('old numeric URLs redirect to the slug', () => {
  assert.deepEqual(resolvePlayerRoute('2', MEMBERS), {
    kind: 'redirect',
    path: '/roster/silkyjoker85',
  })
  assert.deepEqual(resolvePlayerRoute('0003', MEMBERS), {
    kind: 'redirect',
    path: '/roster/stick-menace',
  })
})

void test('other spellings of a current gamertag redirect', () => {
  for (const segment of ['Stick%20Menace', 'STICK-MENACE', 'Stick Menace', 'stick_menace']) {
    assert.deepEqual(
      resolvePlayerRoute(segment, MEMBERS),
      { kind: 'redirect', path: '/roster/stick-menace' },
      segment,
    )
  }
})

void test('an earlier gamertag redirects to the current slug', () => {
  assert.deepEqual(resolvePlayerRoute('stickmenace', MEMBERS), {
    kind: 'redirect',
    path: '/roster/stick-menace',
  })
})

void test("a current gamertag beats someone else's earlier one", () => {
  assert.deepEqual(resolvePlayerRoute('utiz23', MEMBERS), { kind: 'page', playerId: 28 })
})

void test('non-members and junk are missing', () => {
  for (const segment of ['999999999', 'not-a-member', '---', '%E0%A4%A', '2pac']) {
    assert.deepEqual(resolvePlayerRoute(segment, MEMBERS), { kind: 'missing' }, segment)
  }
})

void test('a slug clash: the lower id keeps the slug, the other its number', () => {
  const clash: MemberGamertag[] = [
    { playerId: 40, gamertag: 'Ice_Man', current: true },
    { playerId: 7, gamertag: 'ice man', current: true },
  ]
  const paths = memberPaths(clash)
  assert.equal(paths.get(7), '/roster/ice-man')
  assert.equal(paths.get(40), '/roster/40')
  assert.deepEqual(resolvePlayerRoute('40', clash), { kind: 'page', playerId: 40 })
  assert.deepEqual(resolvePlayerRoute('ice-man', clash), { kind: 'page', playerId: 7 })
})

void test('a member whose gamertag has no slug keeps the numeric URL', () => {
  const digits: MemberGamertag[] = [{ playerId: 9, gamertag: '2024', current: true }]
  assert.deepEqual(resolvePlayerRoute('9', digits), { kind: 'page', playerId: 9 })
})
