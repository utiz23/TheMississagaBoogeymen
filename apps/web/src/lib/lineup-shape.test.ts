/**
 * Unit tests for the mode-aware lineup ladder and the 3s slot re-key.
 * Pure functions, no React/DOM.
 *
 * Tested hardest: on 3s the EA stat row — NOT the OCR position label — decides
 * the slot. That inversion is the whole point of the module, because the
 * pre-game lobby parser's fixed six-row geometry fabricates the bottom three
 * slots on a three-row 3s lobby and fills them with opponent players. The
 * fixtures below are real readings from matches 466 and 563.
 *
 * Run: node --test apps/web/src/lib/lineup-shape.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LADDER_3S,
  LADDER_6S,
  eaPositionToSlot,
  ladderFor,
  rekeyLineupToLadder,
  type LadderStatSource,
} from './lineup-shape.ts'

type Row = Parameters<typeof rekeyLineupToLadder>[0][number]

/** Minimal LineupRow — only the fields the re-key reads are meaningful. */
function row(partial: Partial<Row> & { position: string }): Row {
  return {
    snapshotId: 1,
    gamertagSnapshot: null,
    playerNameSnapshot: null,
    playerNamePersona: null,
    playerNumber: null,
    isCaptain: null,
    buildClass: null,
    buildClassCanonical: null,
    heightText: null,
    weightLbs: null,
    handedness: null,
    playerLevelNumber: null,
    playerLevelRaw: null,
    playerPrestigeNumber: null,
    platform: null,
    capturedAt: new Date(0),
    player: null,
    xFactors: [],
    attributes: null,
    ...partial,
  } as Row
}

function stat(gamertag: string, position: string, playerId?: number): LadderStatSource {
  return { gamertag, position, playerId: playerId ?? null }
}

const slots = (rows: Row[]) => rows.map((r) => r.position)
const tags = (rows: Row[]) => rows.map((r) => r.gamertagSnapshot)

// ─── ladderFor ───────────────────────────────────────────────────────────────

void test('6s and unknown mode both get the six-slot ladder', () => {
  assert.deepEqual(ladderFor('6s'), LADDER_6S)
  assert.deepEqual(ladderFor(null), LADDER_6S)
  assert.deepEqual(LADDER_6S, ['C', 'LW', 'RW', 'LD', 'RD', 'G'])
})

void test('3s gets the four-slot ladder, goalie last', () => {
  assert.deepEqual(ladderFor('3s'), LADDER_3S)
  assert.deepEqual(LADDER_3S, ['C', 'W', 'D', 'G'])
})

// ─── eaPositionToSlot ────────────────────────────────────────────────────────

void test('3s folds both wings into the neutral W slot', () => {
  assert.equal(eaPositionToSlot('3s', 'leftWing'), 'W')
  assert.equal(eaPositionToSlot('3s', 'rightWing'), 'W')
})

void test("3s maps EA's defenseMen to the neutral D slot", () => {
  // Every 3s match in the DB reports its third skater as `defenseMen`, even
  // though the in-game lobby labels that row RW.
  assert.equal(eaPositionToSlot('3s', 'defenseMen'), 'D')
})

void test('eaPositionToSlot is 3s-only and rejects unknown positions', () => {
  assert.equal(eaPositionToSlot('6s', 'center'), null)
  assert.equal(eaPositionToSlot(null, 'center'), null)
  assert.equal(eaPositionToSlot('3s', 'rover'), null)
  assert.equal(eaPositionToSlot('3s', null), null)
})

// ─── rekeyLineupToLadder — 6s passthrough ────────────────────────────────────

void test('6s returns the very same array, untouched', () => {
  const rows = [row({ position: 'LD', gamertagSnapshot: 'someone' })]
  assert.equal(rekeyLineupToLadder(rows, [], '6s', 'bgm'), rows)
  assert.equal(rekeyLineupToLadder(rows, [], null, 'bgm'), rows)
})

// ─── rekeyLineupToLadder — 3s ────────────────────────────────────────────────

void test('3s re-keys BGM rows from the EA stat row, not the OCR label', () => {
  // Match 466 BGM, as the lobby OCR actually read it: three real players in
  // C/LW/RW plus two opponents snapped into the fabricated LD and G slots.
  const rows = [
    row({
      position: 'C',
      gamertagSnapshot: 'StickMenace',
      player: { id: 3, gamertag: 'Stick Menace' },
    }),
    row({ position: 'G', gamertagSnapshot: 'FROMETHEUS' }),
    row({ position: 'LD', gamertagSnapshot: 'BuckeyeBandit05' }),
    row({
      position: 'LW',
      gamertagSnapshot: 'silkyjoker85',
      player: { id: 2, gamertag: 'silkyjoker85' },
    }),
    row({
      position: 'RW',
      gamertagSnapshot: 'JoeyFlopfishx',
      player: { id: 5, gamertag: 'JoeyFlopfish' },
    }),
  ]
  const stats = [
    stat('Stick Menace', 'center', 3),
    stat('silkyjoker85', 'leftWing', 2),
    stat('JoeyFlopfish', 'defenseMen', 5),
  ]

  const out = rekeyLineupToLadder(rows, stats, '3s', 'bgm')

  assert.deepEqual(slots(out), ['C', 'W', 'D'])
  assert.deepEqual(tags(out), ['StickMenace', 'silkyjoker85', 'JoeyFlopfishx'])
})

void test('3s drops opponent players leaked into fabricated BGM slots', () => {
  const rows = [
    row({ position: 'G', gamertagSnapshot: 'FROMETHEUS' }),
    row({ position: 'LD', gamertagSnapshot: 'BuckeyeBandit05' }),
    row({ position: 'RD', gamertagSnapshot: 'someoneElse' }),
  ]
  // None appear in the BGM stat rows — they are opponents snapped in from the
  // right-hand panel. LD/RD/G don't exist in a 3s lobby, so the position
  // fallback refuses them too.
  const out = rekeyLineupToLadder(rows, [stat('Stick Menace', 'center', 3)], '3s', 'bgm')
  assert.deepEqual(out, [])
})

void test('3s falls back to the lobby label when OCR spelling drift breaks the match', () => {
  // Match 618: EA has "Slick Sl0th" (digit zero), OCR read "SlickSIoth"
  // (capital i). No normalization reconciles those, but the lobby's own RW
  // label still places the player correctly — losing him to a CPU row instead
  // would be strictly worse.
  const rows = [
    row({ position: 'C', gamertagSnapshot: 'thunderchipmunk' }),
    row({ position: 'LW', gamertagSnapshot: 'Pattydubs9142' }),
    row({ position: 'RW', gamertagSnapshot: 'SlickSIoth' }),
  ]
  const stats = [
    stat('thunderchipmunk', 'center'),
    stat('Pattydubs9142', 'leftWing'),
    stat('Slick Sl0th', 'defenseMen'),
  ]
  const out = rekeyLineupToLadder(rows, stats, '3s', 'opp')
  assert.deepEqual(slots(out), ['C', 'W', 'D'])
  assert.deepEqual(tags(out), ['thunderchipmunk', 'Pattydubs9142', 'SlickSIoth'])
})

void test('3s lets an identified player outrank a fallback guess for the same slot', () => {
  // The fabricated row must never displace the real one, whichever comes first.
  const real = row({
    position: 'RW',
    gamertagSnapshot: 'JoeyFlopfish',
    player: { id: 5, gamertag: 'JoeyFlopfish' },
  })
  const guess = row({
    position: 'RW',
    gamertagSnapshot: 'ghost',
    playerNumber: 99,
    buildClassCanonical: 'Sniper',
  })
  const stats = [stat('JoeyFlopfish', 'defenseMen', 5)]

  for (const order of [
    [real, guess],
    [guess, real],
  ]) {
    const out = rekeyLineupToLadder(order, stats, '3s', 'bgm')
    assert.deepEqual(slots(out), ['D'])
    assert.equal(out[0]?.gamertagSnapshot, 'JoeyFlopfish')
  }
})

void test('3s matches BGM rows by player id even when the gamertag drifted', () => {
  // OCR read "JoeyFlopfishx"; EA has "JoeyFlopfish". The resolved player id is
  // what saves the row — normalized tags alone would not match.
  const rows = [
    row({
      position: 'RW',
      gamertagSnapshot: 'JoeyFlopfishx',
      player: { id: 5, gamertag: 'JoeyFlopfish' },
    }),
  ]
  const out = rekeyLineupToLadder(rows, [stat('JoeyFlopfish', 'defenseMen', 5)], '3s', 'bgm')
  assert.deepEqual(slots(out), ['D'])
})

void test('3s matches opponent rows by normalized gamertag only', () => {
  // Opponent stat rows never carry a resolved player id, so spacing and case
  // are all that stand between the OCR string and EA's.
  const rows = [
    row({ position: 'C', gamertagSnapshot: 'CGindian' }),
    row({ position: 'RW', gamertagSnapshot: 'QcLeroux92' }),
  ]
  const stats = [stat('CG indian', 'center'), stat('QcLeroux92', 'defenseMen')]
  const out = rekeyLineupToLadder(rows, stats, '3s', 'opp')
  assert.deepEqual(slots(out), ['C', 'D'])
})

void test('3s ignores a player id on the opponent side', () => {
  // `side: 'opp'` must not consult the id map — an id collision across the two
  // tables would otherwise put the wrong team's player on the ladder. The row
  // sits in `G`, which the lobby fallback also refuses, so a match on id is the
  // only thing that could place it: an empty result proves id wasn't consulted.
  const rows = [
    row({ position: 'G', gamertagSnapshot: 'nomatch', player: { id: 5, gamertag: 'x' } }),
  ]
  const out = rekeyLineupToLadder(rows, [stat('someone', 'center', 5)], '3s', 'opp')
  assert.deepEqual(out, [])
})

void test('3s collapses one player read into two slots, keeping the richer row', () => {
  // Match 563: the six-row geometry reported JoeyFlopfish in both LD and RW.
  // Both resolve to the same EA `defenseMen` row, so only one D can survive.
  const lean = row({
    position: 'RW',
    gamertagSnapshot: 'JoeyFlopfish',
    player: { id: 5, gamertag: 'JoeyFlopfish' },
  })
  const rich = row({
    position: 'LD',
    gamertagSnapshot: 'JoeyFlopfish',
    player: { id: 5, gamertag: 'JoeyFlopfish' },
    playerNumber: 8,
    buildClassCanonical: 'Grinder',
  })

  const out = rekeyLineupToLadder(
    [lean, rich],
    [stat('JoeyFlopfish', 'defenseMen', 5)],
    '3s',
    'bgm',
  )

  assert.deepEqual(slots(out), ['D'])
  assert.equal(out[0]?.playerNumber, 8)
  // Order-independent: the richer row wins whichever way round they arrive.
  const flipped = rekeyLineupToLadder(
    [rich, lean],
    [stat('JoeyFlopfish', 'defenseMen', 5)],
    '3s',
    'bgm',
  )
  assert.equal(flipped[0]?.playerNumber, 8)
})

void test('3s returns rows in ladder order regardless of input order', () => {
  const rows = [
    row({ position: 'RW', gamertagSnapshot: 'dee' }),
    row({ position: 'C', gamertagSnapshot: 'cee' }),
    row({ position: 'LW', gamertagSnapshot: 'dubya' }),
  ]
  const stats = [stat('dee', 'defenseMen'), stat('cee', 'center'), stat('dubya', 'leftWing')]
  const out = rekeyLineupToLadder(rows, stats, '3s', 'opp')
  assert.deepEqual(slots(out), ['C', 'W', 'D'])
  assert.deepEqual(tags(out), ['cee', 'dubya', 'dee'])
})

void test('3s keeps a human goalie when EA reports one', () => {
  // EA has never reported a 3s goalie, but if it does the slot exists for it.
  const rows = [row({ position: 'G', gamertagSnapshot: 'netminder' })]
  const out = rekeyLineupToLadder(rows, [stat('netminder', 'goalie')], '3s', 'opp')
  assert.deepEqual(slots(out), ['G'])
})

void test('3s drops a row whose EA position is one the ladder has no slot for', () => {
  const rows = [row({ position: 'C', gamertagSnapshot: 'weird' })]
  const out = rekeyLineupToLadder(rows, [stat('weird', 'rover')], '3s', 'opp')
  assert.deepEqual(out, [])
})

void test('3s with no OCR rows yields an empty ladder, not a throw', () => {
  assert.deepEqual(rekeyLineupToLadder([], [stat('a', 'center')], '3s', 'bgm'), [])
})

void test('3s with no EA rows for the side leans entirely on the lobby labels', () => {
  // EA occasionally has no roster for the opponent. The lobby reading is then
  // the only source there is, so it stands rather than blanking the roster.
  const rows = [row({ position: 'C', gamertagSnapshot: 'cee' }), row({ position: 'LD' })]
  const out = rekeyLineupToLadder(rows, [], '3s', 'opp')
  assert.deepEqual(slots(out), ['C'])
})
