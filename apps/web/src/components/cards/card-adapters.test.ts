/**
 * Run (after `pnpm --filter @eanhl/db build`):
 *   node --test apps/web/src/components/cards/card-adapters.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { cardFromProfile, cardFromRosterRow, type CardRosterRow } from './card-adapters.ts'

const row: CardRosterRow = {
  playerId: 3,
  gamertag: 'Stick Menace',
  playerName: 'Igor Orlov',
  jerseyNumber: 91,
  position: 'leftWing',
  favoritePosition: 'leftWing',
  preferredPosition: null,
  skaterWins: 35,
  skaterLosses: 30,
  skaterOtl: 3,
  goalieWins: null,
  goalieLosses: null,
  goalieOtl: null,
  skaterGp: 68,
  goalieGp: 0,
  goals: 65,
  assists: 65,
  points: 130,
  savePct: null,
  gaa: null,
  nationality: 'CA',
  clientPlatform: 'xbox',
}

void test('roster row → front-only card using the batch summary', () => {
  const card = cardFromRosterRow(row, {
    tier: 4,
    level: 6,
    theme: 'carbon',
    bestBadge: { familyId: 'pbrk', level: 28 },
  })
  assert.equal(card.back, null)
  assert.deepEqual(
    {
      name: card.front.name,
      jersey: card.front.jersey,
      role: card.front.role,
      position: card.front.position,
      record: card.front.record,
      winPct: card.front.winPct,
      stats: card.front.stats.map((s) => s.value).join(' '),
      tier: card.front.tier,
      level: card.front.level,
      theme: card.front.theme,
      badge: card.front.badge?.familyId,
    },
    {
      name: 'Igor Orlov',
      jersey: '91',
      role: 'skater',
      position: 'LW',
      record: '35–30–3',
      winPct: '51% Win',
      stats: '68 65 65 130',
      tier: 4,
      level: 6,
      theme: 'carbon',
      badge: 'pbrk',
    },
  )
})

void test('a player the worker has not computed shows as tier 1, level 1, Away, no badge', () => {
  const card = cardFromRosterRow({ ...row, playerName: null, jerseyNumber: null })
  assert.deepEqual(
    [
      card.front.name,
      card.front.jersey,
      card.front.tier,
      card.front.level,
      card.front.theme,
      card.front.badge,
    ],
    ['Stick Menace', '##', 1, 1, 'away', null],
  )
})

void test('goalie roster rows use goalie record and stats', () => {
  const card = cardFromRosterRow({
    ...row,
    preferredPosition: 'goalie',
    goalieWins: 8,
    goalieLosses: 6,
    goalieOtl: 1,
    goalieGp: 15,
    savePct: '81.20',
    gaa: '3.40',
  })
  assert.equal(card.front.role, 'goalie')
  assert.equal(card.front.position, 'G')
  assert.equal(card.front.record, '8–6–1')
  assert.deepEqual(
    card.front.stats.map((s) => `${s.label}=${s.value}`),
    ['GP=15', 'SV%=.812', 'GAA=3.40', 'W=8'],
  )
})

void test('profile → card with a back: ledger, role-pool badges, career source label', () => {
  const card = cardFromProfile({
    player: {
      id: 3,
      gamertag: 'Stick Menace',
      playerName: 'Igor Orlov',
      jerseyNumber: 91,
      nationality: 'CA',
      position: 'leftWing',
      preferredPosition: null,
    },
    season: {
      gameTitleId: 7,
      clientPlatform: 'xbox',
      skaterGp: 68,
      goalieGp: 6,
      goals: 65,
      assists: 65,
      points: 130,
      skaterWins: 35,
      skaterLosses: 30,
      skaterOtl: 3,
      goalieWins: 2,
      goalieLosses: 3,
      goalieOtl: 1,
      goalieSavePct: '70.00',
      goalieGaa: '4.10',
    },
    trendGames: [
      { result: 'WIN', isGoalie: false, goals: 2, assists: 1, saves: null, goalsAgainst: null },
      { result: 'DNF', isGoalie: false, goals: 0, assists: 1, saves: null, goalsAgainst: null },
    ],
    career: [
      {
        gameTitleId: 7,
        gameTitleName: 'NHL 27',
        skaterGp: 68,
        goals: 65,
        assists: 65,
        points: 130,
        goalieGp: 6,
        wins: 2,
        losses: 3,
        otl: 1,
        savePct: '70.00',
        gaa: '4.10',
        shutouts: 0,
      },
      {
        gameTitleId: 3,
        gameTitleName: 'NHL 22',
        skaterGp: 100,
        goals: 50,
        assists: 40,
        points: 90,
        goalieGp: 0,
        wins: null,
        losses: null,
        otl: null,
        savePct: null,
        gaa: null,
        shutouts: null,
      },
    ],
    role: 'skater',
    progress: {
      standing: { tier: 4, level: 6, mythicTheme: null },
      badges: [
        { familyId: 'pbrk', value: 285, level: 28 },
        { familyId: 'phits', value: 4475, level: 14 },
        { familyId: 'gsv', value: 50, level: 3 },
      ],
    },
  })
  assert.equal(card.front.theme, 'carbon')
  assert.equal(card.front.platform, 'xbox')
  assert.deepEqual(card.front.badge, { familyId: 'pbrk', level: 28 })
  assert.ok(card.back)
  assert.deepEqual(
    card.back.ledger.rows.map((r) => [r.label, ...r.cells].join(' ')),
    ['LAST 10 2 2 2 4', 'NHL 27 68 65 65 130', 'CAREER 168 115 105 220'],
  )
  assert.deepEqual(
    card.back.badges.top.map((b) => b.familyId),
    ['pbrk', 'phits'],
  )
  assert.equal(card.back.badges.pool, 15)
  assert.equal(card.back.source, 'CAREER · NHL 22–27')
})

void test('profile viewed as goalie uses the goalie side; missing progress falls back to tier 1', () => {
  const card = cardFromProfile({
    player: {
      id: 12,
      gamertag: 'Pratt2016',
      playerName: null,
      jerseyNumber: null,
      nationality: null,
      position: 'goalie',
      preferredPosition: 'goalie',
    },
    season: null,
    trendGames: [],
    career: [],
    role: 'goalie',
    progress: null,
  })
  assert.deepEqual(
    [card.front.position, card.front.record, card.front.tier, card.front.theme, card.back?.source],
    ['G', '—', 1, 'away', 'CAREER'],
  )
  assert.deepEqual(
    card.front.stats.map((s) => s.value),
    ['0', '—', '—', '—'],
  )
})
