import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateInvite, type InviteStatusInput } from './invite-status.js'

const NOW = new Date('2026-10-09T12:00:00Z')
const open: InviteStatusInput = {
  expiresAt: new Date('2026-10-10T12:00:00Z'),
  acceptedAt: null,
  revokedAt: null,
  playerClaimed: false,
}

void test('an open invite is usable', () => {
  assert.equal(evaluateInvite(open, NOW), 'ok')
})

void test('a missing invite is not_found', () => {
  assert.equal(evaluateInvite(null, NOW), 'not_found')
})

void test('accepted, revoked and expired invites are refused', () => {
  assert.equal(evaluateInvite({ ...open, acceptedAt: NOW }, NOW), 'accepted')
  assert.equal(evaluateInvite({ ...open, revokedAt: NOW }, NOW), 'revoked')
  assert.equal(evaluateInvite({ ...open, expiresAt: NOW }, NOW), 'expired')
})

void test('an invite for a player another account owns is refused', () => {
  assert.equal(evaluateInvite({ ...open, playerClaimed: true }, NOW), 'player_claimed')
})

void test('a used invite reports accepted even after it expires', () => {
  const used = { ...open, acceptedAt: NOW, expiresAt: new Date('2026-10-01T00:00:00Z') }
  assert.equal(evaluateInvite(used, NOW), 'accepted')
})
