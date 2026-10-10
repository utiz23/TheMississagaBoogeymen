import test from 'node:test'
import assert from 'node:assert/strict'
import type { CardRosterRow } from '../../components/cards/card-adapters.ts'
import { cardForGame, emptySlotLabel, type GameCardInput } from './game-card.ts'

const identity = {
  playerId: 3,
  gamertag: 'Stick Menace',
  playerName: 'Igor Orlov',
  jerseyNumber: 28,
  clientPlatform: 'xbox',
  nationality: 'US',
} as unknown as CardRosterRow

const skater: GameCardInput = {
  position: 'LW',
  stat: {
    playerId: 3,
    gamertag: 'Stick Menace',
    goals: 1,
    assists: 3,
    plusMinus: -1,
    saves: null,
    shotsAgainst: null,
    goalsAgainst: null,
  },
  identity,
  summary: { tier: 2, level: 4, theme: 'home', bestBadge: { familyId: 'p6g', level: 2 } },
  jerseyNumber: null,
  score: 17.534,
  starRank: 2,
  positionLabel: null,
}

void test('skater: game score, star tag, G · A · +/- · PTS, identity and theme kept', () => {
  const c = cardForGame(skater).front
  assert.equal(c.name, 'Igor Orlov')
  assert.equal(c.jersey, '28')
  assert.equal(c.position, 'LW')
  assert.equal(c.role, 'skater')
  assert.equal(c.record, 'GS 17.53')
  assert.equal(c.winPct, '⭐ 2nd')
  assert.deepEqual(c.stats, [
    { label: 'G', value: '1' },
    { label: 'A', value: '3' },
    { label: '+/-', value: '-1' },
    { label: 'PTS', value: '4' },
  ])
  assert.equal(c.theme, 'home')
  assert.equal(c.tier, 2)
  assert.equal(c.platform, 'xbox')
  assert.equal(c.nationality, 'US')
  assert.equal(cardForGame(skater).back, null)
})

void test('positive plus-minus is signed; zero is plain; non-star has no tag', () => {
  const c = cardForGame({ ...skater, stat: { ...skater.stat, plusMinus: 2 }, starRank: null }).front
  assert.equal(c.stats[2]?.value, '+2')
  assert.equal(c.winPct, '')
  assert.equal(
    cardForGame({ ...skater, stat: { ...skater.stat, plusMinus: 0 } }).front.stats[2]?.value,
    '0',
  )
})

void test('goalie: SV · SV% · GA · SA (the compact card highlights the 2nd stat)', () => {
  const c = cardForGame({
    ...skater,
    position: 'G',
    stat: { ...skater.stat, saves: 31, shotsAgainst: 33, goalsAgainst: 2 },
  }).front
  assert.equal(c.role, 'goalie')
  assert.deepEqual(c.stats, [
    { label: 'SV', value: '31' },
    { label: 'SV%', value: '.939' },
    { label: 'GA', value: '2' },
    { label: 'SA', value: '33' },
  ])
})

void test('goalie with no shots against: SV% is a dash', () => {
  const c = cardForGame({
    ...skater,
    position: 'G',
    stat: { ...skater.stat, saves: 0, shotsAgainst: 0 },
  }).front
  assert.equal(c.stats[1]?.value, '—')
  const n = cardForGame({
    ...skater,
    position: 'G',
    stat: { ...skater.stat, saves: null, shotsAgainst: null },
  }).front
  // — = not captured, never a fake 0 (the match page's rule).
  assert.deepEqual(
    n.stats.map((s) => s.value),
    ['—', '—', '—', '—'],
  )
})

void test('goalie GA is the stored goals-against, not SA − SV (AI goalies differ)', () => {
  const c = cardForGame({
    ...skater,
    position: 'G',
    stat: { ...skater.stat, saves: 0, shotsAgainst: 3, goalsAgainst: 5 },
  }).front
  assert.equal(c.stats[2]?.value, '5')
})

void test('positionLabel overrides the slot tag (box-score defence shows D)', () => {
  const c = cardForGame({ ...skater, position: 'LD', positionLabel: 'D' }).front
  assert.equal(c.position, 'D')
  assert.equal(c.role, 'skater')
})

void test('guest: gamertag, Away theme, tier 1, no badge/flag/platform, lineup jersey', () => {
  const c = cardForGame({
    ...skater,
    stat: { ...skater.stat, playerId: null, gamertag: 'Guesty' },
    identity: null,
    summary: undefined,
    jerseyNumber: 44,
  }).front
  assert.equal(c.name, 'Guesty')
  assert.equal(c.jersey, '44')
  assert.equal(c.theme, 'away')
  assert.equal(c.tier, 1)
  assert.equal(c.level, 1)
  assert.equal(c.badge, null)
  assert.equal(c.nationality, null)
  assert.equal(c.platform, null)
})

void test('no score ⇒ empty record; unknown jersey ⇒ ##', () => {
  const c = cardForGame({ ...skater, identity: null, summary: undefined, score: null }).front
  assert.equal(c.record, '')
  assert.equal(c.jersey, '##')
})

void test('emptySlotLabel', () => {
  assert.equal(emptySlotLabel('RW', null), 'RW')
  assert.equal(emptySlotLabel('RW', 'OcrName'), 'RW · OcrName')
})
