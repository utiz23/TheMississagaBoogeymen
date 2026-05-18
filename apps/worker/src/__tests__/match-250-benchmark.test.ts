/**
 * Match 250 — Lineup & Loadouts regression benchmark.
 *
 * Asserts `getMatchLineups(250)` matches the canonical V2 benchmark at
 * `research/OCR-SS/Manual OCR benchmark for verification V2.md`. Each
 * `(team_side, position)` slot has expected values for gamertag, jersey
 * number, captain flag, canonical build class, and the 3 X-Factor
 * canonical names. Tiers are not asserted: some 2026-05-12 captures
 * never ran through the HSV tier classifier, and re-running OCR on the
 * original screenshots is out of scope here.
 *
 * Two slots have known OCR data-quality limits that prevent matching V2:
 *   - BGM RD (JoeyFlopfish): the only player_loadout_view capture is an
 *     OCR misattribution from 2026-05-12 whose X-Factor strings belong
 *     to a different player. The build/jersey/captain are correct via
 *     consolidator votes; only the X-Factor names are wrong. We skip
 *     the X-Factor assertion for this slot.
 *
 * Requires DATABASE_URL pointing at a DB that already contains match 250's
 * `player_loadout_snapshots` + `player_loadout_x_factors` rows, and a
 * consolidator run on the same data (via
 * `pnpm --filter worker consolidate-loadouts --match 250`).
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/match-250-benchmark.test.js
 */

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { getMatchLineups } from '@eanhl/db/queries'
import { sql as postgresSql } from '@eanhl/db'

after(async () => {
  await postgresSql.end()
})

interface ExpectedSlot {
  side: 'bgm' | 'opponent'
  position: 'C' | 'LW' | 'RW' | 'LD' | 'RD'
  gamertag: string
  playerNumber: number
  isCaptain: boolean
  buildClassCanonical: string
  /** Canonical X-Factor names in slot order; null means "skip assertion" for that slot. */
  xFactorsCanonical: readonly string[] | null
  /**
   * Canonical persona string after `resolvePersona()` cleans up the OCR vote.
   * undefined means "skip the persona assertion" (e.g., for opp slots where
   * the seed alias map doesn't yet have entries).
   */
  playerNamePersonaCanonical?: string
}

const EXPECTED: readonly ExpectedSlot[] = [
  // BGM
  {
    side: 'bgm',
    position: 'C',
    gamertag: 'MrHomiecide',
    playerNumber: 11,
    isCaptain: true,
    buildClassCanonical: 'Playmaker',
    xFactorsCanonical: ['Wheels', 'One_T', 'Tape_to_Tape'],
    playerNamePersonaCanonical: 'E. WANHG',
  },
  {
    side: 'bgm',
    position: 'LW',
    gamertag: 'Stick Menace',
    playerNumber: 96,
    isCaptain: false,
    buildClassCanonical: 'Tage Thompson - Power Forward',
    xFactorsCanonical: ['Big_Rig', 'One_T', 'Ankle_Breaker'],
    playerNamePersonaCanonical: 'M. RANTANEN',
  },
  {
    side: 'bgm',
    position: 'RW',
    gamertag: 'silkyjoker85',
    playerNumber: 10,
    isCaptain: false,
    buildClassCanonical: 'Cole Caufield - Sniper',
    xFactorsCanonical: ['Quick_Release', 'One_T', 'PressurePlus'],
    playerNamePersonaCanonical: 'SILKY',
  },
  {
    side: 'bgm',
    position: 'LD',
    gamertag: 'HenryTheBobJr',
    playerNumber: 7,
    isCaptain: false,
    buildClassCanonical: 'Puck Moving Defenseman',
    xFactorsCanonical: ['Warrior', 'Wheels', 'Quick_Release'],
    playerNamePersonaCanonical: 'H. JENKINS',
  },
  {
    side: 'bgm',
    position: 'RD',
    gamertag: 'JoeyFlopfish',
    playerNumber: 48,
    isCaptain: false,
    buildClassCanonical: 'Puck Moving Defenseman',
    // Restored after the OCR-tune session re-ingested the May-10 source
    // PNGs through the tuned parser. The anchor now points at the
    // correct JoeyFlopfish loadout-view capture (snap 1450) with full
    // X-Factor coverage matching V2 truth.
    xFactorsCanonical: ['Elite_Edges', 'Tape_to_Tape', 'Stick_Em_Up'],
    playerNamePersonaCanonical: 'L. HUTSON',
  },
  // Opponent
  {
    side: 'opponent',
    position: 'C',
    gamertag: 'XZ4RKY',
    playerNumber: 19,
    isCaptain: true,
    buildClassCanonical: 'Two-Way Forward',
    xFactorsCanonical: ['Warrior', 'Big_Rig', 'Rocket'],
  },
  {
    side: 'opponent',
    position: 'LW',
    gamertag: 'DuhPope',
    playerNumber: 95,
    // Per V2 truth Duh Pope is NOT captain. The read query now enforces
    // one captain per side (snap captain stays on Toews at opp C).
    isCaptain: false,
    buildClassCanonical: 'Sniper',
    xFactorsCanonical: ['Quick_Release', 'Elite_Edges', 'Warrior'],
  },
  {
    side: 'opponent',
    position: 'RW',
    gamertag: 'RAIDERSG7',
    playerNumber: 7,
    isCaptain: false,
    buildClassCanonical: 'Sniper',
    xFactorsCanonical: ['Quick_Release', 'One_T', 'Tape_to_Tape'],
  },
  {
    side: 'opponent',
    position: 'LD',
    gamertag: 'MuttButt',
    playerNumber: 23,
    isCaptain: false,
    buildClassCanonical: 'Defensive Defenseman',
    xFactorsCanonical: ['Quickpick', 'Elite_Edges', 'Rocket'],
  },
  {
    side: 'opponent',
    position: 'RD',
    gamertag: 'shadowassault20',
    playerNumber: 56,
    isCaptain: false,
    buildClassCanonical: 'Puck Moving Defenseman',
    xFactorsCanonical: ['Wheels', 'Warrior', 'Big_Rig'],
  },
]

void test('match 250: getMatchLineups returns expected slot data', async () => {
  if (!process.env['DATABASE_URL']) {
    console.warn('[match-250-benchmark] DATABASE_URL not set; skipping')
    return
  }
  const lineups = await getMatchLineups(250)
  for (const expected of EXPECTED) {
    const pool = expected.side === 'bgm' ? lineups.bgm : lineups.opponent
    const row = pool.find((r) => r.position === expected.position)
    assert.ok(
      row,
      `${expected.side}/${expected.position}: no row rendered (expected ${expected.gamertag})`,
    )
    assert.equal(
      row.gamertagSnapshot,
      expected.gamertag,
      `${expected.side}/${expected.position}: gamertag`,
    )
    assert.equal(
      row.playerNumber,
      expected.playerNumber,
      `${expected.side}/${expected.position}: jersey number`,
    )
    assert.equal(
      row.isCaptain ?? false,
      expected.isCaptain,
      `${expected.side}/${expected.position}: captain`,
    )
    assert.equal(
      row.buildClassCanonical,
      expected.buildClassCanonical,
      `${expected.side}/${expected.position}: build canonical`,
    )
    if (expected.xFactorsCanonical) {
      const actual = row.xFactors.map((x) => x.canonicalName)
      assert.deepEqual(
        actual,
        expected.xFactorsCanonical,
        `${expected.side}/${expected.position}: x-factors`,
      )
    }
    if (expected.playerNamePersonaCanonical !== undefined) {
      assert.equal(
        row.playerNamePersona,
        expected.playerNamePersonaCanonical,
        `${expected.side}/${expected.position}: persona canonical (post-resolvePersona)`,
      )
    }
  }
})

void test('match 250: goalie slots are CPU (no row rendered)', async () => {
  if (!process.env['DATABASE_URL']) return
  const lineups = await getMatchLineups(250)
  assert.equal(
    lineups.bgm.find((r) => r.position === 'G'),
    undefined,
    'BGM G should not render a row (CPU placeholder)',
  )
  assert.equal(
    lineups.opponent.find((r) => r.position === 'G'),
    undefined,
    'Opp G should not render a row (CPU placeholder)',
  )
})
