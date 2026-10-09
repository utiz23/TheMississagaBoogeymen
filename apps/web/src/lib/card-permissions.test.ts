import test from 'node:test'
import assert from 'node:assert/strict'
import { canEditPlayerCard } from './card-permissions.ts'

void test('a member edits only their own card; an admin edits any; signed out edits none', () => {
  assert.equal(canEditPlayerCard({ role: 'user', playerId: 7 }, 7), true)
  assert.equal(canEditPlayerCard({ role: 'user', playerId: 7 }, 8), false)
  assert.equal(canEditPlayerCard({ role: 'user', playerId: null }, 7), false)
  assert.equal(canEditPlayerCard({ role: 'admin', playerId: 2 }, 8), true)
  assert.equal(canEditPlayerCard(null, 7), false)
})
