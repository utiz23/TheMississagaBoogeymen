import test from 'node:test'
import assert from 'node:assert/strict'
import { toGoalieDisplayRow, toSkaterDisplayRow } from './row-adapters.ts'

const skaterIn = {
  playerId: 3,
  gamertag: 'Stick Menace',
  position: 'center',
  gamesPlayed: 0,
  goals: 0,
  assists: 0,
  points: 0,
  plusMinus: 0,
  pim: 0,
  shots: 0,
  hits: 0,
  takeaways: 0,
  giveaways: 0,
  faceoffPct: null,
  passPct: '72.50',
  shotAttempts: 0,
  toiSeconds: null,
}

void test('adapter passes values through: 0 stays 0, null stays null', () => {
  const r = toSkaterDisplayRow(skaterIn)
  assert.equal(r.goals, 0)
  assert.equal(r.shotAttempts, 0)
  assert.equal(r.faceoffPct, null)
  assert.equal(r.toiSeconds, null)
  assert.equal(r.expanded, null)
})

void test('expanded payload is merged by playerId only; unmatched (null id) rows get none', () => {
  const expanded = new Map([[3, { playerId: 3, powerPlayGoals: 31 } as never]])
  assert.deepEqual(toSkaterDisplayRow(skaterIn, expanded).expanded, { powerPlayGoals: 31 })
  assert.equal(toSkaterDisplayRow({ ...skaterIn, playerId: null }, expanded).expanded, null)
  assert.equal(toSkaterDisplayRow({ ...skaterIn, playerId: 99 }, expanded).expanded, null)
})

const goalieIn = {
  playerId: 5,
  gamertag: 'JoeyFlopfish',
  gamesPlayed: 2,
  wins: null,
  losses: null,
  otl: null,
  savePct: '81.82',
  gaa: '2.95',
  shutouts: 0,
  totalSaves: 27,
  totalShotsAgainst: 33,
  totalGoalsAgainst: 6,
  toiSeconds: 7313,
}

void test('goalie recordUnavailable is carried only when the source flags it', () => {
  assert.equal(
    toGoalieDisplayRow({ ...goalieIn, recordUnavailable: true } as never).recordUnavailable,
    true,
  )
  assert.equal(toGoalieDisplayRow(goalieIn as never).recordUnavailable, false)
  const flagged = toGoalieDisplayRow({ ...goalieIn, recordUnavailable: true } as never)
  assert.equal(flagged.wins, null)
  assert.equal(flagged.savePct, '81.82')
})

// ─── Archive club-member rows: fields the source never captures at all ─────

const archiveSkaterIn = {
  playerId: 2,
  gamertag: 'silkyjoker85',
  position: 'center',
  gamesPlayed: 48,
  goals: 10,
  assists: 20,
  points: 30,
  plusMinus: 5,
  pim: 4,
  shots: null,
  hits: 12,
  takeaways: 3,
  giveaways: 2,
  passPct: '76.50',
  // No shotAttempts / toiSeconds / faceoffPct keys at all — the club-member
  // source never captures them.
}

void test('archive skater row: omitted fields adapt to null, not 0', () => {
  const r = toSkaterDisplayRow(archiveSkaterIn)
  assert.equal(r.shotAttempts, null)
  assert.equal(r.toiSeconds, null)
  assert.equal(r.faceoffPct, null)
  // A genuinely uncaptured value (shots null on NHL 25 rows) stays null.
  assert.equal(r.shots, null)
  // Recorded values pass through unchanged.
  assert.equal(r.goals, 10)
  assert.equal(r.gamertag, 'silkyjoker85')
})

const archiveGoalieIn = {
  playerId: 2,
  gamertag: 'silkyjoker85',
  gamesPlayed: 48,
  wins: null,
  losses: null,
  otl: null,
  savePct: '76.50',
  gaa: '3.93',
  shutouts: 2,
  totalSaves: 587,
  totalGoalsAgainst: 180,
  // No totalShotsAgainst / toiSeconds keys at all.
}

void test('archive goalie row: omitted fields adapt to null, not 0', () => {
  const r = toGoalieDisplayRow(archiveGoalieIn)
  assert.equal(r.totalShotsAgainst, null)
  assert.equal(r.toiSeconds, null)
  assert.equal(r.recordUnavailable, false)
  assert.equal(r.gamesPlayed, 48)
  assert.equal(r.totalSaves, 587)
})
