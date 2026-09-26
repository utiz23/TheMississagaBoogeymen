import test from 'node:test'
import assert from 'node:assert/strict'
import { abbreviatePosition, playerSubline, playerTooltip } from './player-label.ts'

void test('position abbreviations, including LD/RD; unknown passes through; blank is null', () => {
  assert.equal(abbreviatePosition('leftDefenseMen'), 'LD')
  assert.equal(abbreviatePosition('defenseMen'), 'D')
  assert.equal(abbreviatePosition('weird'), 'weird')
  assert.equal(abbreviatePosition(''), null)
  assert.equal(abbreviatePosition(null), null)
})

void test('preferredPosition beats meta.position beats row position; missing meta is safe', () => {
  const meta = {
    jerseyNumber: 85,
    preferredPosition: 'rightDefenseMen',
    position: 'defenseMen',
    lastSeenIso: '2026-09-24',
  }
  assert.deepEqual(playerSubline(meta, 'center'), { jersey: '#85', pos: 'RD' })
  assert.deepEqual(playerSubline({ ...meta, preferredPosition: null }, 'center'), {
    jersey: '#85',
    pos: 'D',
  })
  assert.deepEqual(playerSubline(undefined, 'center'), { jersey: null, pos: 'C' })
  assert.deepEqual(playerSubline(undefined, null), { jersey: null, pos: null })
})

void test('tooltip says last known position, and last-seen is a local capture date', () => {
  const t = playerTooltip(
    { jerseyNumber: 7, preferredPosition: null, position: 'leftWing', lastSeenIso: '2026-09-24' },
    'HenryTheBobJr',
    null,
  )
  assert.equal(
    t,
    'HenryTheBobJr · #7 · LW (last known position) · Last locally captured 2026-09-24',
  )
  assert.equal(playerTooltip(undefined, 'Guest', null), 'Guest')
})
