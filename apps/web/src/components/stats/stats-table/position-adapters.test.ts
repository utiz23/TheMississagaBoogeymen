import test from 'node:test'
import assert from 'node:assert/strict'
import type { PositionLine, PositionPlayerRow, PositionTable } from '@eanhl/db/queries'
import {
  POSITION_UNAVAILABLE_REASON,
  faceoffPctOf,
  positionSubsets,
  toPositionDisplayRow,
} from './position-adapters.ts'
import { POSITION_COVERAGE_NOTE, WING_SPLIT_NOTE, gpCoverageAnnotation } from './notes.ts'

function line(over: Partial<PositionLine> = {}): PositionLine {
  const detail = {
    powerPlayGoals: 1,
    shortHandedGoals: 0,
    gameWinningGoals: null,
    hatTricks: 0,
    passes: 40,
    passAttempts: 50,
    saucerPasses: 3,
    dekes: null,
    dekesMade: null,
    deflections: 1,
    faceoffWins: 6,
    faceoffLosses: 4,
    blockedShots: 2,
    interceptions: 5,
    pkClearZone: null,
    penaltiesDrawn: 1,
    offsides: null,
    fights: null,
    fightsWon: null,
    breakaways: 4,
    breakawayGoals: 1,
    penaltyShotAttempts: null,
    penaltyShotGoals: null,
    possessionSeconds: 300,
  }
  return {
    source: 'local',
    gp: 10,
    goals: 5,
    assists: 5,
    points: 10,
    plusMinus: 2,
    pim: 2,
    shots: 20,
    shotAttempts: 40,
    hits: 3,
    takeaways: 4,
    giveaways: 2,
    toiSeconds: 6000,
    detail,
    coverage: null,
    wingSplit6sOnly: false,
    ...over,
  }
}

const row = (l: PositionLine): PositionPlayerRow => ({
  playerId: 1,
  gamertag: 'Stick Menace',
  position: 'center',
  line: l,
})

void test('display row: derived rates, missing counts stay null', () => {
  const r = toPositionDisplayRow(row(line()))
  assert.equal(r.gamesPlayed, 10)
  assert.equal(r.faceoffPct, '60.00')
  assert.equal(r.passPct, '80.00')
  const e = r.expanded
  assert.ok(e)
  assert.equal(e.shotPct, '25.00')
  assert.equal(e.breakawayPct, '25.00')
  assert.equal(e.penaltyShotPct, null)
  assert.equal(e.dekes, null)
  assert.equal(r.gpCoverage, undefined)
  assert.equal(r.wingSplit6sOnly, undefined)
  assert.equal(faceoffPctOf({ faceoffWins: 3, faceoffLosses: null }), null)
})

void test('GP annotation marks partial tracking (*) and 6s-only wings (†)', () => {
  const partial = { state: 'partial' as const, coveredGp: 118, totalGp: 571 }
  assert.deepEqual(gpCoverageAnnotation(partial, false), {
    marker: '*',
    srText: 'Tracked 118 of 571 games at this position.',
  })
  assert.equal(gpCoverageAnnotation(partial, true)?.marker, '*†')
  assert.equal(
    gpCoverageAnnotation({ state: 'complete', coveredGp: 5, totalGp: 5 }, false),
    undefined,
  )
})

void test('subsets: sources, notes, unavailable slots and All Time', () => {
  const partial = { state: 'partial' as const, coveredGp: 1, totalGp: 9 }
  const table: PositionTable = {
    source: 'local',
    positions: {
      C: { rows: [row(line({ coverage: partial }))] },
      LW: { unavailable: 'no split' },
      RW: { rows: [] },
      W: { rows: [row(line({ wingSplit6sOnly: true }))] },
      D: { rows: [] },
    },
  }
  const s = positionSubsets({ current: table, allTime: { C: [], LW: [], RW: [], W: [], D: [] } })
  assert.equal(s.disabledReason, undefined)
  assert.deepEqual(
    s.options.map((o) => o.key),
    ['C', 'LW', 'RW', 'W', 'D'],
  )
  const c = s.options[0]?.current
  assert.ok(c && 'rows' in c)
  assert.equal(c.source.label, 'Tracked games')
  assert.deepEqual(c.source.notes, [POSITION_COVERAGE_NOTE])
  assert.deepEqual(s.options[1]?.current, { unavailable: 'no split' })
  const w = s.options[3]?.current
  assert.ok(w && 'rows' in w)
  assert.deepEqual(w.source.notes, [WING_SPLIT_NOTE])
  const at = s.options[0]?.allTime
  assert.ok(at && 'rows' in at)
  assert.equal(at.source.kind, 'career')

  const failed = positionSubsets({ current: 'error' })
  assert.equal(failed.disabledReason, POSITION_UNAVAILABLE_REASON)
  assert.equal(failed.options[0]?.allTime, undefined)
})
