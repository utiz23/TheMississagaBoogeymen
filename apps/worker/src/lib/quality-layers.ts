/**
 * Layer-score computation extracted from match-quality-cli for shared use
 * with run-quality-cli (Phase 2 of the Run-Level Quality Reporting workstream,
 * plan `/home/michal/.claude/plans/ok-plan-this-run-level-nifty-comet.md`).
 *
 * NO behavior change vs prior inline implementation; the regression-floor JSONs
 * under `docs/calibration/regression-floor-match-*.json` are the contract.
 * If any of those files cease to be byte-identical after this extraction, the
 * extraction has drifted and must be reverted or rebaselined explicitly.
 */

import { db, matchEvents, playerLoadoutSnapshots } from '@eanhl/db'
import {
  getApiPlayerStats,
  getApiTeamTotals,
  getOcrBoxScoreForMatch,
  getOcrPlayerSummaryFields,
} from '@eanhl/db/queries'
import { and, eq, sql } from 'drizzle-orm'

import { type DownstreamRow, type QualityFlag } from './quality-inputs.js'
import { computeL4, type L4FieldDiff } from './l4-api-truth.js'
import { resolveGamertagToPlayer } from '../ocr-promoters/resolve-identity.js'
import type { DbOrTx } from '../ocr-promoters/index.js'

/**
 * L1/L2/L2.5/L3 pass thresholds.
 *
 * Set at/just-below the scores of the ONE independently-verified reference run
 * — match 250 (run 583), validated field-by-field against the V2 benchmark — so
 * it passes an honest bar while every un-verified run still fails ≥1 layer.
 *
 * Tier 0 WS0.1B (2026-06-13) first replaced the unusable 0.99 bars. Tier 1
 * Item 0 (2026-06-14) then REPAIRED a player-identity contamination (a leaked
 * test sentinel `players` row, gamertag 'HenryTheBobJr', had accreted real data
 * and was bound to 250's lineup, firing a class-G off-roster penalty). Merging
 * it back restored 250's L2 from the degraded 0.854 to its true 0.9792, so L2's
 * bar is re-anchored 0.85 → 0.90. Measured active-run scores after the repair:
 *
 *   match  run   L2      L2.5(lineup)  L3      → outcome under the bars below
 *   250    583   0.9792  0.950         1.000   → PASS  (all three clear)   ◀ reference
 *   463    1946  0.820   0.825         0.919   → FAIL  (all three)
 *   968    584   0.839   0.825         0.818   → FAIL  (all three)
 *   2582   1945  0.568   0.925         0.955   → FAIL  (L2)
 *
 * 0.90 sits just under the restored 250 (0.9792) with margin, and cleanly above
 * the next real match (968 at 0.839) — exactly one green baseline, not all green.
 *
 * L1 stays at 0.99 — it is permanently null until labeled-fixture ground truth
 * exists, and `overall.pass` treats a null L1 as `true`, so the bar is inert.
 */
export const L1_THRESHOLD = 0.99
/** L2 — BGM-side event actor-resolution rate. Just below 250's restored 0.9792. */
export const L2_THRESHOLD = 0.9
/**
 * L2.5 — lineup-field accuracy on reviewed loadout anchors. A DISTINCT bar from
 * L2 (previously it reused L2_THRESHOLD): the lineup dimension scores higher
 * than event resolution, so it earns a higher floor. Below 250's 0.950.
 */
export const L2_LINEUP_THRESHOLD = 0.9
/** L3 — weighted downstream completeness. Just below 250's 1.000. */
export const L3_THRESHOLD = 0.95
/**
 * L4 — API-truth accuracy: exact-match fraction of OCR box-score team totals +
 * per-player audit lines vs EA-API truth. Mirrors L3's bar. Informational for
 * now — L4 does NOT feed `overall.pass` (Milestone ④ wires the promotion gate).
 */
export const L4_THRESHOLD = 0.95

/**
 * `DownstreamRow` and `QualityFlag` are the minimal shapes `computeLayers`
 * needs. They are owned by `quality-inputs.ts` (the producer of these rows
 * via `buildDownstreamCounts` / `buildQualityFlags`); `quality-layers.ts` is
 * the consumer. Re-imported here so a future field addition cannot silently
 * disagree between the two modules.
 */
export { type DownstreamRow, type QualityFlag } from './quality-inputs.js'

export interface LayerScores {
  l1: { score: number | null; pass: boolean | null; notes: string }
  l2: {
    score: number
    pass: boolean
    notes: string
    bgmEvents: number
    bgmResolved: number
    deductions: number
  }
  /** L2.5 — lineup-field accuracy on reviewed loadout anchors. Complementary
   *  to L2 (event resolution) — measures the *static* lineup screen rather
   *  than per-event resolution. Counts populated-vs-expected for each of the
   *  10 slot × {gamertag, persona, position, build_class_canonical} fields. */
  l2_lineup: {
    score: number
    pass: boolean
    notes: string
    populated: number
    expected: number
  }
  l3: { score: number; pass: boolean; notes: string }
  /**
   * L4 — API-truth accuracy. `gradable=false` (⇒ `score`/`pass` null) when there
   * is no EA-API truth to grade against (OCR sole source). `pass` is null when
   * ungradable or when no OCR/API fields overlap. `mismatches` feeds the review
   * queue. INFORMATIONAL — deliberately excluded from `overall.pass` (see below).
   */
  l4: {
    score: number | null
    pass: boolean | null
    gradable: boolean
    notes: string
    mismatches: L4FieldDiff[]
  }
  overall: { pass: boolean }
}

/**
 * Compute L1/L2/L2.5/L3 layer scores for a match.
 *
 * Side effects: runs read-only DB queries against `match_events` and
 * `player_loadout_snapshots` for the given `matchId`. No writes.
 */
export async function computeLayers(
  matchId: number,
  downstream: DownstreamRow[],
  flags: QualityFlag[],
  conn: DbOrTx = db,
): Promise<LayerScores> {
  const l1 = {
    score: null as number | null,
    pass: null as boolean | null,
    notes: 'requires labeled fixture set (Phase 3 annotate-segments output)',
  }

  // L2 — BGM-side actor resolution rate. Opp-side events have no players row
  // by design, so they can't contribute. The denominator is BGM events only.
  const [bgmCounts] = (await conn
    .select({
      bgm: sql<string>`COUNT(*) FILTER (WHERE ${matchEvents.teamSide} = 'for')::text`,
      bgmResolved: sql<string>`COUNT(*) FILTER (WHERE ${matchEvents.teamSide} = 'for' AND ${matchEvents.actorPlayerId} IS NOT NULL)::text`,
    })
    .from(matchEvents)
    .where(eq(matchEvents.matchId, matchId))) as Array<{ bgm: string; bgmResolved: string }>
  const bgmEvents = Number(bgmCounts!.bgm)
  const bgmResolved = Number(bgmCounts!.bgmResolved)
  const failsDeducted = flags
    .filter((f) => f.classId === 'A' || f.classId === 'G')
    .reduce((acc, f) => {
      const match = /^(\d+)\s/.exec(f.message)
      return acc + (match && match[1] ? Number(match[1]) : 0)
    }, 0)
  const l2score = bgmEvents > 0 ? Math.max(0, (bgmResolved - failsDeducted) / bgmEvents) : 0
  const l2 = {
    score: l2score,
    pass: l2score >= L2_THRESHOLD,
    notes: `${bgmResolved}/${bgmEvents} BGM-side events resolved; deducted ${failsDeducted} for dupes / wrong-roster hits`,
    bgmEvents,
    bgmResolved,
    deductions: failsDeducted,
  }

  // L2.5 — lineup-field accuracy. Of the 10 reviewed slots × 4 critical fields
  // (gamertag_snapshot, player_name_persona, position, build_class_canonical),
  // count populated as accurate. Expected denominator = 4 × reviewed_slots
  // (caps at 40 for a complete lineup). This is a *separate* L2 dimension
  // from event resolution and surfaces the static lineup-screen quality.
  const [lineupCounts] = (await conn
    .select({
      slots: sql<string>`COUNT(*)::text`,
      gt: sql<string>`COUNT(*) FILTER (WHERE ${playerLoadoutSnapshots.gamertagSnapshot} IS NOT NULL AND length(${playerLoadoutSnapshots.gamertagSnapshot}) > 1)::text`,
      persona: sql<string>`COUNT(*) FILTER (WHERE ${playerLoadoutSnapshots.playerNamePersona} IS NOT NULL AND length(${playerLoadoutSnapshots.playerNamePersona}) > 1)::text`,
      pos: sql<string>`COUNT(*) FILTER (WHERE ${playerLoadoutSnapshots.position} IS NOT NULL)::text`,
      build: sql<string>`COUNT(*) FILTER (WHERE ${playerLoadoutSnapshots.buildClassCanonical} IS NOT NULL)::text`,
    })
    .from(playerLoadoutSnapshots)
    .where(
      and(
        eq(playerLoadoutSnapshots.matchId, matchId),
        eq(playerLoadoutSnapshots.reviewStatus, 'reviewed'),
      ),
    )) as Array<{ slots: string; gt: string; persona: string; pos: string; build: string }>
  const reviewedSlots = Number(lineupCounts!.slots)
  const lineupPopulated =
    Number(lineupCounts!.gt) +
    Number(lineupCounts!.persona) +
    Number(lineupCounts!.pos) +
    Number(lineupCounts!.build)
  const lineupExpected = 4 * reviewedSlots
  const l2_lineup_score = lineupExpected > 0 ? lineupPopulated / lineupExpected : 0
  const l2_lineup = {
    score: l2_lineup_score,
    pass: l2_lineup_score >= L2_LINEUP_THRESHOLD,
    notes: `${lineupPopulated}/${lineupExpected} fields populated across ${reviewedSlots} reviewed slot(s) (gamertag + persona + position + build_canonical)`,
    populated: lineupPopulated,
    expected: lineupExpected,
  }

  const weights: Record<string, number> = {
    match_goal_events: 2,
    match_period_summaries: 2,
    match_penalty_events: 2,
    match_shot_type_summaries: 1,
    match_faceoff_dots: 1,
    match_faceoff_zone_summaries: 1,
    'player_loadout_snapshots (reviewed)': 2,
    player_loadout_attributes: 1,
    player_loadout_x_factors: 1,
    match_events: 0,
  }
  let weightedScore = 0
  let totalWeight = 0
  const completenessLines: string[] = []
  for (const d of downstream) {
    if (d.expected === null || d.expected === 0) continue
    const ratio = Math.min(1, d.actual / d.expected)
    const w = weights[d.table] ?? 1
    if (w === 0) continue
    weightedScore += ratio * w
    totalWeight += w
    if (ratio < 1) {
      completenessLines.push(`${d.table}=${d.actual}/${d.expected}`)
    }
  }
  const l3score = totalWeight > 0 ? weightedScore / totalWeight : 0
  const l3 = {
    score: l3score,
    pass: l3score >= L3_THRESHOLD,
    notes: completenessLines.length > 0 ? `gaps: ${completenessLines.join(', ')}` : 'all gates met',
  }

  // L4 — API-truth accuracy. Grades OCR box-score team totals + per-player audit
  // lines against the EA-API truth in `matches` / `player_match_stats`. All four
  // inputs are read-only DB queries; the comparator itself is pure. The persona
  // resolver maps an OCR gamertag → players.id; resolveGamertagToPlayer ignores
  // its gameTitleId arg (`_gameTitleId`), so 0 is a harmless placeholder.
  const [ocrTeam, apiTeam, ocrPlayers, apiPlayers] = await Promise.all([
    getOcrBoxScoreForMatch(matchId),
    getApiTeamTotals(matchId),
    getOcrPlayerSummaryFields(matchId),
    getApiPlayerStats(matchId),
  ])
  const l4result = await computeL4({
    ocrTeam,
    apiTeam,
    ocrPlayers,
    apiPlayers,
    resolvePersona: async (raw) => ({
      playerId: (await resolveGamertagToPlayer(raw, 0, conn)).playerId,
    }),
  })
  const l4 = {
    score: l4result.score,
    // pass only when there's a real fraction to threshold; null when ungradable
    // or when no OCR/API fields overlapped (score null in both cases).
    pass: l4result.gradable && l4result.score !== null ? l4result.score >= L4_THRESHOLD : null,
    gradable: l4result.gradable,
    notes: l4result.notes,
    mismatches: l4result.mismatches,
  }

  return {
    l1,
    l2,
    l2_lineup,
    l3,
    l4,
    // NOTE: `overall.pass` intentionally does NOT include L4. L4 is
    // informational until Milestone ④ wires the promotion gate; adding it here
    // now would silently change every run's pass/fail verdict.
    overall: { pass: l2.pass && l2_lineup.pass && l3.pass && (l1.pass ?? true) },
  }
}
