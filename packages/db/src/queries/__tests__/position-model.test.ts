import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WING_UNSPLIT_REASON,
  archiveLine,
  buildArchivePositionTable,
  buildCareerPositionRows,
  buildLocalPositionTable,
  localLine,
  sumLines,
  type ArchivePositionSourceRow,
  type LocalPositionSourceRow,
  type PositionSlot,
} from '../position-model.js'

function local(over: Partial<LocalPositionSourceRow>): LocalPositionSourceRow {
  return {
    position: 'defenseMen',
    gp: 10,
    goals: 2,
    assists: 8,
    points: 10,
    plusMinus: 3,
    shots: 20,
    shotAttempts: 30,
    hits: 15,
    pim: 4,
    takeaways: 6,
    giveaways: 5,
    faceoffWins: 0,
    faceoffLosses: 0,
    passCompletions: 100,
    passAttempts: 130,
    blockedShots: 9,
    ppGoals: 1,
    shGoals: 0,
    hatTricks: 0,
    interceptions: 12,
    penaltiesDrawn: 2,
    possessionSeconds: 600,
    deflections: 1,
    saucerPasses: 7,
    toiSeconds: 36000,
    ...over,
  }
}

function arch(over: Partial<ArchivePositionSourceRow>): ArchivePositionSourceRow {
  return {
    gameMode: '6s',
    positionScope: 'leftWing',
    gamesPlayed: 10,
    goals: 5,
    assists: 5,
    points: 10,
    plusMinus: 1,
    pim: 2,
    shots: 30,
    shotAttempts: 50,
    hits: 8,
    takeaways: 4,
    giveaways: 3,
    statsJson: { ppg: '1', dekes: '4', dekes_attempted: '9' },
    ...over,
  }
}

const rows = (slot: PositionSlot) => {
  if (!('rows' in slot)) throw new Error(`unavailable: ${slot.unavailable}`)
  return slot.rows
}

void test('local line maps detail and measures coverage against EA position GP', () => {
  const ea = { cGp: 0, lwGp: 3, rwGp: 2, dGp: 40 }
  const l = localLine(local({}), 'D', ea)
  assert.equal(l.detail.powerPlayGoals, 1)
  assert.equal(l.detail.possessionSeconds, 600)
  assert.equal(l.detail.dekes, null)
  assert.deepEqual(l.coverage, { state: 'partial', coveredGp: 10, totalGp: 40 })
  // Tracked above EA (EA lag) counts as complete; no EA row → no coverage.
  assert.equal(localLine(local({ gp: 41 }), 'D', ea).coverage?.state, 'complete')
  assert.equal(localLine(local({}), 'D', null).coverage, null)
  // W compares against LW + RW.
  assert.equal(localLine(local({ position: 'wing', gp: 5 }), 'W', ea).coverage?.state, 'complete')
})

void test('archive W sums 6s LW + RW and 3s wing; LW over both playlists is 6s-only, flagged', () => {
  const r = [
    arch({ positionScope: 'leftWing', gamesPlayed: 10, points: 10 }),
    arch({ positionScope: 'rightWing', gamesPlayed: 4, points: 2 }),
    arch({ gameMode: '3s', positionScope: 'wing', gamesPlayed: 6, points: 9 }),
    arch({ gameMode: '3s', positionScope: 'center', gamesPlayed: 2, points: 1 }),
  ]
  const w = archiveLine(r, 'W', null)
  assert.ok(w !== null && w !== 'unsplit')
  assert.equal(w.gp, 20)
  assert.equal(w.points, 21)
  assert.equal(w.toiSeconds, null)
  assert.equal(w.detail.powerPlayGoals, 3)
  const lw = archiveLine(r, 'LW', null)
  assert.ok(lw !== null && lw !== 'unsplit')
  assert.equal(lw.gp, 10)
  assert.equal(lw.wingSplit6sOnly, true)
  assert.equal(archiveLine(r, 'LW', '3s'), 'unsplit')
  assert.equal(archiveLine(r, 'D', null), null)
  const c = archiveLine(r, 'C', null)
  assert.ok(c !== null && c !== 'unsplit')
  assert.equal(c.wingSplit6sOnly, false)
})

void test('archive detail is null when any contributing screenshot lacks the field', () => {
  const l = archiveLine(
    [
      arch({ positionScope: 'leftWing' }),
      arch({ positionScope: 'rightWing', statsJson: { dekes: '1', dekes_attempted: '2' } }),
    ],
    'W',
    '6s',
  )
  assert.ok(l !== null && l !== 'unsplit')
  assert.equal(l.detail.powerPlayGoals, null)
  assert.equal(l.detail.dekesMade, 5)
})

const who = (id: number) => ({ playerId: id, gamertag: `p${String(id)}`, playerPosition: null })

void test('archive table: 3s LW/RW unavailable; rows sorted by points', () => {
  const t = buildArchivePositionTable(
    [
      { ...arch({ gameMode: '3s', positionScope: 'wing', points: 3 }), ...who(1) },
      { ...arch({ gameMode: '3s', positionScope: 'wing', points: 9 }), ...who(2) },
    ],
    '3s',
  )
  assert.equal(t.source, 'archive')
  assert.deepEqual(t.positions.LW, { unavailable: WING_UNSPLIT_REASON })
  assert.deepEqual(
    rows(t.positions.W).map((r) => r.playerId),
    [2, 1],
  )
  assert.equal(rows(t.positions.C).length, 0)
})

void test('local table: coverage only for all playlists', () => {
  const ea = { cGp: 0, lwGp: 0, rwGp: 0, dGp: 40 }
  const all = buildLocalPositionTable([{ ...local({}), ...who(1), ea }], null)
  assert.equal(rows(all.positions.D)[0]?.line.coverage?.state, 'partial')
  const six = buildLocalPositionTable([{ ...local({}), ...who(1), ea }], '6s')
  assert.equal(rows(six.positions.D)[0]?.line.coverage, null)
})

void test('sumLines: counts add, nullable detail is all-or-null, coverage combines', () => {
  const a = localLine(local({}), 'D', { cGp: 0, lwGp: 0, rwGp: 0, dGp: 40 })
  const b = archiveLine([arch({ positionScope: 'defenseMen', gamesPlayed: 20 })], 'D', null)
  assert.ok(b !== null && b !== 'unsplit')
  const s = sumLines([a, b])
  assert.ok(s)
  assert.equal(s.gp, 30)
  assert.equal(s.source, 'mixed')
  assert.equal(s.detail.powerPlayGoals, 2)
  assert.equal(s.detail.possessionSeconds, null)
  assert.equal(s.toiSeconds, null)
  assert.deepEqual(s.coverage, { state: 'partial', coveredGp: 30, totalGp: 60 })
  assert.equal(sumLines([]), null)
})

void test('career: archive wins per player × title, local fills the rest', () => {
  const ea = { cGp: 0, lwGp: 0, rwGp: 0, dGp: 10 }
  const out = buildCareerPositionRows(
    [{ ...arch({ positionScope: 'defenseMen', gamesPlayed: 20 }), ...who(1), gameTitleId: 25 }],
    [
      { ...local({}), ...who(1), gameTitleId: 27, ea },
      // Same title as the archive row: ignored, archive wins.
      { ...local({ gp: 99 }), ...who(1), gameTitleId: 25, ea },
    ],
  )
  const d = out.D[0]
  assert.ok(d)
  assert.equal(d.line.gp, 30)
  assert.equal(d.line.coverage?.state, 'complete')
})
