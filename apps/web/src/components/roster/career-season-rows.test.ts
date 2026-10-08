import test from 'node:test'
import assert from 'node:assert/strict'
import type { PlayerCareerSeasonRow } from '@eanhl/db/queries'
import type { PlayerPositionSeason, PositionLine } from '@eanhl/db/queries'
import { NULL_DETAIL } from '../stats/stats-table/position-adapters.ts'
import {
  buildSeasonPositions,
  buildSeasonTable,
  type EASeasonDetail,
  type SeasonGoalieRow,
  type SeasonSkaterRow,
  type SeasonTable,
} from './career-season-rows.ts'

function skaters(t: SeasonTable): SeasonSkaterRow[] {
  if (t.role !== 'skater') throw new Error('expected skater table')
  return t.rows
}
function goalies(t: SeasonTable): SeasonGoalieRow[] {
  if (t.role !== 'goalie') throw new Error('expected goalie table')
  return t.rows
}
function first<T>(rows: T[]): T {
  const r = rows[0]
  if (r === undefined) throw new Error('expected a row')
  return r
}
function expanded<E>(r: { expanded: E | null }): E {
  if (r.expanded === null) throw new Error('expected expanded detail')
  return r.expanded
}

function season(over: Partial<PlayerCareerSeasonRow>): PlayerCareerSeasonRow {
  return {
    gameTitleId: 1,
    gameTitleName: 'NHL 26',
    gameTitleSlug: 'nhl26',
    gameTitleReleaseOrder: 26,
    source: 'ea',
    skaterGp: 10,
    goals: 5,
    assists: 5,
    points: 10,
    plusMinus: 2,
    shots: 20,
    shotAttempts: 40,
    hits: 3,
    pim: 2,
    takeaways: 4,
    giveaways: 2,
    faceoffPct: '50.00',
    passPct: '70.00',
    goalieGp: 0,
    wins: null,
    losses: null,
    otl: null,
    savePct: null,
    gaa: null,
    shutouts: null,
    saves: null,
    shotsAgainst: null,
    goalsAgainst: null,
    ...over,
  }
}

const ea = {
  gameTitleId: 1,
  toiSeconds: 6000,
  goalieToiSeconds: 1200,
  powerPlayGoals: 2,
  passes: 99,
  goalieShutoutPeriods: 3,
  goalieDesperationSaves: 4,
} as unknown as EASeasonDetail

const archiveSkater = {
  powerPlayGoals: 3,
  shortHandedGoals: 0,
  gameWinningGoals: 1,
  hatTricks: null,
  passes: 50,
  passAttempts: 80,
  saucerPasses: 4,
  dekes: 10,
  dekesMade: 6,
  deflections: 2,
  faceoffWins: null,
  faceoffLosses: null,
  blockedShots: 7,
  interceptions: 8,
  pkClearZone: 1,
  penaltiesDrawn: 2,
  offsides: 3,
  fights: 0,
  fightsWon: 0,
  breakaways: 4,
  breakawayGoals: 1,
  penaltyShotAttempts: 0,
  penaltyShotGoals: 0,
}
const archive = { gameTitleId: 2, skater: archiveSkater, goalie: null }

void test('EA season takes its detail and TOI from the EA row', () => {
  const t = buildSeasonTable([season({})], [ea], [], 'skater')
  const r = first(skaters(t))
  assert.equal(r.gamesPlayed, 10)
  assert.equal(r.toiSeconds, 6000)
  assert.equal(expanded(r).powerPlayGoals, 2)
  assert.equal(r.season.source, 'ea')
  assert.equal(t.source.label, 'EA season totals')
  assert.equal(t.source.notes, undefined)
})

void test('archive season never reads EA detail; uncaptured stats stay null, never 0', () => {
  const t = buildSeasonTable(
    [season({ gameTitleId: 2, gameTitleSlug: 'nhl25', source: 'historical' })],
    [{ ...ea, gameTitleId: 2 }],
    [archive],
    'skater',
  )
  const r = first(skaters(t))
  const e = expanded(r)
  assert.equal(r.toiSeconds, null)
  assert.equal(e.powerPlayGoals, 3)
  assert.equal(e.hatTricks, null)
  assert.equal(e.dekesMade, 6)
  assert.equal(e.possessionSeconds, null)
  assert.equal(e.breakawayPct, '25.00')
  // FO% unknown when a faceoff count is missing; PASS% from the archive totals.
  assert.equal(r.faceoffPct, null)
  assert.equal(r.passPct, '62.50')
  assert.equal(e.penaltyShotPct, null)
  assert.equal(e.shortHandedGoals, 0)
  assert.equal(e.blockedShots, 7)
  assert.equal(e.passes, 50)
  assert.equal(e.faceoffWins, null)
  // S% = goals / SOG, SOG% = SOG / attempts.
  assert.equal(e.shotPct, '25.00')
  assert.equal(e.shotOnNetPct, '50.00')
  assert.equal(t.source.label, 'Archive')
  assert.equal(t.source.notes?.length, 1)
})

void test('archive season without archive detail or attempts yields null rates', () => {
  const t = buildSeasonTable(
    [season({ source: 'historical', shots: 0, goals: 0, shotAttempts: 0 })],
    [],
    [],
    'skater',
  )
  const e = expanded(first(skaters(t)))
  assert.equal(e.shotPct, null)
  assert.equal(e.shotOnNetPct, null)
  assert.equal(e.blockedShots, null)
})

void test('rows keep input order and filter by role GP', () => {
  const rows = [
    season({ gameTitleId: 1, gameTitleSlug: 'nhl26' }),
    season({ gameTitleId: 2, gameTitleSlug: 'nhl25', source: 'historical', skaterGp: 0 }),
    season({ gameTitleId: 3, gameTitleSlug: 'nhl24', source: 'historical' }),
  ]
  const t = buildSeasonTable(rows, [ea], [], 'skater')
  assert.deepEqual(
    skaters(t).map((r) => r.season.gameTitleSlug),
    ['nhl26', 'nhl24'],
  )
  assert.equal(t.source.label, 'EA + archive')
})

void test('archive goalie: TOI from minutes, SA and GAA derived when not stored', () => {
  const t = buildSeasonTable(
    [
      season({
        source: 'historical',
        goalieGp: 138,
        saves: 1912,
        goalsAgainst: 443,
        shotsAgainst: null,
        gaa: null,
      }),
    ],
    [ea],
    [
      {
        gameTitleId: 1,
        skater: null,
        goalie: {
          desperationSaves: 99,
          breakawayShots: 74,
          breakawaySaves: 52,
          penaltyShots: 3,
          penaltyShotSaves: 3,
          pkClearZone: 0,
          minutesPlayed: 7208,
        },
      },
    ],
    'goalie',
  )
  const r = first(goalies(t))
  assert.equal(r.toiSeconds, 432480)
  assert.equal(r.gaa, '3.69')
  assert.equal(r.totalShotsAgainst, 2355)
  const e = expanded(r)
  assert.equal(e.desperationSaves, 99)
  assert.equal(e.breakawaySavePct, '70.27')
  assert.equal(e.shutoutPeriods, null)
})

void test('goalie rows map goalie fields and EA goalie detail', () => {
  const t = buildSeasonTable(
    [
      season({ goalieGp: 4, wins: 3, saves: 90, shotsAgainst: 100, goalsAgainst: 10 }),
      season({ gameTitleId: 2, gameTitleSlug: 'nhl25', source: 'historical', goalieGp: 0 }),
    ],
    [ea],
    [],
    'goalie',
  )
  const rows = goalies(t)
  assert.equal(rows.length, 1)
  const r = first(rows)
  assert.equal(r.gamesPlayed, 4)
  assert.equal(r.totalShotsAgainst, 100)
  assert.equal(r.toiSeconds, 1200)
  assert.equal(expanded(r).shutoutPeriods, 3)
  assert.equal(r.recordUnavailable, false)
})

function posLine(over: Partial<PositionLine>): PositionLine {
  return {
    source: 'local',
    gp: 10,
    goals: 4,
    assists: 6,
    points: 10,
    plusMinus: 1,
    pim: 2,
    shots: 20,
    shotAttempts: 30,
    hits: 5,
    takeaways: 3,
    giveaways: 2,
    toiSeconds: 6000,
    detail: { ...NULL_DETAIL, powerPlayGoals: 2 },
    coverage: null,
    wingSplit6sOnly: false,
    ...over,
  }
}

void test('position seasons: one row per season with a line, tracked vs archive badge, notes', () => {
  const none = { C: null, LW: null, RW: null, W: null, D: null }
  const seasons: PlayerPositionSeason[] = [
    {
      gameTitleId: 7,
      gameTitleName: 'NHL 26',
      gameTitleSlug: 'nhl26',
      gameTitleReleaseOrder: 26,
      source: 'local',
      lines: {
        ...none,
        D: posLine({ coverage: { state: 'partial', coveredGp: 118, totalGp: 571 } }),
      },
    },
    {
      gameTitleId: 2,
      gameTitleName: 'NHL 25',
      gameTitleSlug: 'nhl25',
      gameTitleReleaseOrder: 25,
      source: 'archive',
      lines: { ...none, D: posLine({ source: 'archive', toiSeconds: null }), C: posLine({}) },
    },
  ]
  const p = buildSeasonPositions(seasons)
  assert.deepEqual(
    p.D.rows.map((r) => [r.season.gameTitleSlug, r.season.source]),
    [
      ['nhl26', 'tracked'],
      ['nhl25', 'historical'],
    ],
  )
  const d26 = first(p.D.rows)
  assert.equal(d26.gpCoverage?.coveredGp, 118)
  assert.equal(expanded(d26).powerPlayGoals, 2)
  assert.equal(p.D.source.label, 'Archive + tracked')
  assert.equal(p.D.source.notes?.length, 1)
  assert.equal(p.C.source.label, 'Archive')
  assert.equal(p.LW.rows.length, 0)

  const t = buildSeasonTable([season({})], [ea], [], 'skater', 'error')
  assert.equal(t.role === 'skater' ? t.positions : null, 'error')
  assert.equal(buildSeasonTable([season({})], [ea], [], 'skater').role === 'skater', true)
})
