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
import { getMatchLineups, getMatchEvents } from '@eanhl/db/queries'
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

// =============================================================================
// Phase 0.1 — V2 Gold benchmark expansion (commit 1: post-game goal events)
//
// Source of truth: research/OCR-SS/Manual OCR benchmark for verification V2.md,
// "Events" section (lines 1063-1080). Match 250 has 7 goal events across
// periods 2, 3, and OT, with 0 penalties.
//
// CLOCK CONVENTION: V2 reports remaining time within the period (clock counts
// DOWN from 20:00). The DB's `match_events.clock` column stores ELAPSED time
// (clock counts UP from 00:00) because the events promoter at
// apps/worker/src/ocr-promoters/events.ts:69-83 does a remaining→elapsed
// conversion before persisting. Therefore expected clock values below are
// 20:00 minus V2's reported time, in MM:SS form without leading-zero padding
// on the minutes (matching the DB's existing format).
//
// PLAYER RESOLUTION: BGM-side scorers/assists are alias-resolved to canonical
// gamertags (silkyjoker85, MrHomiecide, etc.). Opponent-side personas (Toews,
// Zubov, Whoosah, Wilde) do not have seeded `player_persona_aliases` for
// match 250's opponent club, so the assertion compares the normalized OCR
// snapshot string rather than the resolved gamertag for opp-side fields. This
// is the honest state: when the opp alias map is later seeded, the
// snapshot-vs-resolved distinction can tighten.
//
// KNOWN V2-vs-DB GAPS (documented here, expected to be closed in later phases):
//   - `goal_number_in_game` is NULL in DB for all match-250 goals. V2 reports
//     (1)/(2)/etc. sequencing per scorer per team. Goal-number population is a
//     gap the redesign should close in Phase 3a (Action Tracker + Events).
//   - `team_abbreviation` is NULL in DB for all match-250 events. V2 uses
//     "BM"/"4th". Team identity is currently carried only in `team_side`
//     ('for'/'against'). Filling team_abbreviation is also a Phase 3 task.
// =============================================================================

interface ExpectedGoalBgm {
  side: 'bgm'
  period: number
  periodLabel: string
  /** Elapsed-time clock in DB form (e.g., "13:41" for V2's "06:19 remaining"). */
  clockElapsed: string
  /** 'for' on the BGM (us) side. */
  teamSide: 'for'
  /** Resolved canonical gamertag (BGM scorers are alias-seeded). */
  scorerGamertag: string
  primaryAssistGamertag: string | null
  secondaryAssistGamertag: string | null
}

interface ExpectedGoalOpp {
  side: 'opp'
  period: number
  periodLabel: string
  clockElapsed: string
  teamSide: 'against'
  /** Normalized snapshot string; opp persona aliases aren't seeded for match 250. */
  scorerSnapshot: string
  primaryAssistSnapshot: string | null
  secondaryAssistSnapshot: string | null
}

type ExpectedGoal = ExpectedGoalBgm | ExpectedGoalOpp

const EXPECTED_GOALS: readonly ExpectedGoal[] = [
  // 2nd Period (V2 06:19 remaining → 13:41 elapsed)
  {
    side: 'bgm',
    period: 2,
    periodLabel: 'RT 2ND PERIOD',
    clockElapsed: '13:41',
    teamSide: 'for',
    scorerGamertag: 'silkyjoker85',
    primaryAssistGamertag: 'MrHomiecide',
    secondaryAssistGamertag: null,
  },
  // 2nd Period (V2 14:53 remaining → 5:07 elapsed)
  {
    side: 'bgm',
    period: 2,
    periodLabel: 'RT 2ND PERIOD',
    clockElapsed: '5:07',
    teamSide: 'for',
    scorerGamertag: 'Stick Menace',
    primaryAssistGamertag: 'MrHomiecide',
    secondaryAssistGamertag: 'silkyjoker85',
  },
  // 3rd Period (V2 08:35 remaining → 11:25 elapsed)
  {
    side: 'opp',
    period: 3,
    periodLabel: 'RT 3RD PERIOD',
    clockElapsed: '11:25',
    teamSide: 'against',
    scorerSnapshot: 'Toews',
    primaryAssistSnapshot: 'S. Zubov',
    secondaryAssistSnapshot: 'Wilde',
  },
  // 3rd Period (V2 13:58 remaining → 6:02 elapsed)
  {
    side: 'bgm',
    period: 3,
    periodLabel: 'RT 3RD PERIOD',
    clockElapsed: '6:02',
    teamSide: 'for',
    scorerGamertag: 'silkyjoker85',
    primaryAssistGamertag: 'HenryTheBobJr',
    secondaryAssistGamertag: null,
  },
  // 3rd Period (V2 18:51 remaining → 1:09 elapsed)
  {
    side: 'opp',
    period: 3,
    periodLabel: 'RT 3RD PERIOD',
    clockElapsed: '1:09',
    teamSide: 'against',
    scorerSnapshot: 'Toews',
    primaryAssistSnapshot: 'Whoosah',
    secondaryAssistSnapshot: 'Wilde',
  },
  // 3rd Period (V2 19:08 remaining → 0:52 elapsed)
  {
    side: 'opp',
    period: 3,
    periodLabel: 'RT 3RD PERIOD',
    clockElapsed: '0:52',
    teamSide: 'against',
    scorerSnapshot: 'S. Zubov',
    primaryAssistSnapshot: 'Whoosah',
    secondaryAssistSnapshot: null,
  },
  // OT (V2 17:23 remaining → 2:37 elapsed)
  {
    side: 'bgm',
    period: 4,
    periodLabel: 'RT OT',
    clockElapsed: '2:37',
    teamSide: 'for',
    scorerGamertag: 'MrHomiecide',
    primaryAssistGamertag: 'HenryTheBobJr',
    secondaryAssistGamertag: 'Stick Menace',
  },
]

/** Normalize a snapshot for comparison: strip leading "-," or "-." ornament
 * prefix, collapse whitespace, uppercase. Handles V2's "-, SIlky" vs DB's
 * "-. Silky" (different punctuation) and case-mixing in the OCR output. */
function normalizeSnapshot(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .replace(/^-\s*[,.]?\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

void test('match 250: post-game goal events match V2 benchmark', async () => {
  if (!process.env['DATABASE_URL']) {
    console.warn('[match-250-benchmark] DATABASE_URL not set; skipping')
    return
  }
  const events = await getMatchEvents(250)
  const goals = events.filter((e) => e.eventType === 'goal')

  assert.equal(
    goals.length,
    EXPECTED_GOALS.length,
    `expected ${EXPECTED_GOALS.length} goals in match 250, got ${goals.length}`,
  )

  for (const expected of EXPECTED_GOALS) {
    const tag = `P${expected.period}@${expected.clockElapsed}/${expected.teamSide}`
    const matches = goals.filter(
      (g) =>
        g.periodNumber === expected.period &&
        g.clock === expected.clockElapsed &&
        g.teamSide === expected.teamSide,
    )
    assert.equal(
      matches.length,
      1,
      `${tag}: expected exactly 1 matching goal, got ${matches.length}`,
    )
    const goal = matches[0]!

    assert.equal(goal.periodLabel, expected.periodLabel, `${tag}: periodLabel`)

    if (expected.side === 'bgm') {
      assert.equal(
        goal.scorer?.gamertag,
        expected.scorerGamertag,
        `${tag}: BGM scorer canonical gamertag`,
      )
      assert.equal(
        goal.primaryAssist?.gamertag ?? null,
        expected.primaryAssistGamertag,
        `${tag}: BGM primary assist canonical gamertag`,
      )
      assert.equal(
        goal.secondaryAssist?.gamertag ?? null,
        expected.secondaryAssistGamertag,
        `${tag}: BGM secondary assist canonical gamertag`,
      )
    } else {
      assert.equal(
        normalizeSnapshot(goal.scorerSnapshot),
        normalizeSnapshot(expected.scorerSnapshot),
        `${tag}: opp scorer snapshot (normalized)`,
      )
      assert.equal(
        normalizeSnapshot(goal.primaryAssistSnapshot),
        normalizeSnapshot(expected.primaryAssistSnapshot),
        `${tag}: opp primary assist snapshot (normalized)`,
      )
      assert.equal(
        normalizeSnapshot(goal.secondaryAssistSnapshot),
        normalizeSnapshot(expected.secondaryAssistSnapshot),
        `${tag}: opp secondary assist snapshot (normalized)`,
      )
    }
  }
})

void test('match 250: no penalty events (V2 says 0 penalties)', async () => {
  if (!process.env['DATABASE_URL']) return
  const events = await getMatchEvents(250)
  const penalties = events.filter((e) => e.eventType === 'penalty')
  assert.equal(penalties.length, 0, 'V2 benchmark says match 250 has no penalty events')
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
