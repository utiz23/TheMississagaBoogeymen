import test from 'node:test'
import assert from 'node:assert/strict'
import type { LineupRow } from '@eanhl/db/queries'
import {
  bucketByPosition,
  discordDisplayOrder,
  findStat,
  lineupSlots,
  normalizeLineupTag,
} from './lineup-slots.ts'

const row = (over: Partial<LineupRow>): LineupRow =>
  ({
    position: null,
    gamertagSnapshot: null,
    buildClass: null,
    buildClassCanonical: null,
    playerNumber: null,
    xFactors: [],
    player: null,
    ...over,
  }) as unknown as LineupRow

const stats = [
  { playerId: 1, gamertag: 'RAIDERS G7' },
  { playerId: 2, gamertag: 'Silky' },
  { playerId: null, gamertag: 'Guesty' },
]

void test('normalizeLineupTag strips spaces and case', () => {
  assert.equal(normalizeLineupTag('RAIDERS G7'), 'raidersg7')
})

void test('findStat: BGM rows match by player id first, then by normalized tag', () => {
  assert.equal(findStat(stats, 'bgm', row({ player: { id: 2, gamertag: 'x' } }))?.gamertag, 'Silky')
  assert.equal(findStat(stats, 'bgm', row({ gamertagSnapshot: 'RAIDERSG7' }))?.playerId, 1)
  assert.equal(findStat(stats, 'opp', row({ player: { id: 2, gamertag: 'nobody' } })), null)
  assert.equal(findStat(stats, 'bgm', row({})), null)
})

void test('bucketByPosition: first row per slot wins; OCR noise rows are dropped; box-score rows kept', () => {
  const ladder = ['C', 'LW', 'RW', 'LD', 'RD', 'G'] as const
  const ocr = bucketByPosition(
    [
      row({ position: 'C', gamertagSnapshot: 'A', playerNumber: 9 }),
      row({ position: 'C', gamertagSnapshot: 'B', playerNumber: 10 }),
      row({ position: 'LW', gamertagSnapshot: 'cpu', playerNumber: 1 }),
      row({ position: 'RW', gamertagSnapshot: 'Bare' }),
    ],
    'ocr',
    ladder,
  )
  assert.equal(ocr.get('C')?.gamertagSnapshot, 'A')
  assert.equal(ocr.has('LW'), false)
  assert.equal(ocr.has('RW'), false)
  const box = bucketByPosition(
    [row({ position: 'RW', gamertagSnapshot: 'Bare' })],
    'boxScore',
    ladder,
  )
  assert.equal(box.get('RW')?.gamertagSnapshot, 'Bare')
})

void test('lineupSlots: one slot per ladder position, empty when nobody played it', () => {
  const ladder = ['C', 'LW', 'RW', 'LD', 'RD', 'G'] as const
  const slots = lineupSlots(
    [
      row({ position: 'C', gamertagSnapshot: 'Silky' }),
      row({ position: 'G', gamertagSnapshot: 'Guesty' }),
    ],
    'boxScore',
    ladder,
    stats,
  )
  assert.deepEqual(
    slots.map((s) => s.position),
    [...ladder],
  )
  assert.equal(slots[0]?.stat?.playerId, 2)
  assert.equal(slots[1]?.row, null)
  assert.equal(slots[5]?.stat?.gamertag, 'Guesty')
})

void test('discordDisplayOrder: two rows, goalie centred under 6s', () => {
  assert.deepEqual(discordDisplayOrder('6s'), ['LW', 'C', 'RW', 'LD', 'G', 'RD'])
  assert.deepEqual(discordDisplayOrder('3s'), ['W', 'C', 'D', 'G'])
  assert.deepEqual(discordDisplayOrder(null), ['LW', 'C', 'RW', 'LD', 'G', 'RD'])
})
