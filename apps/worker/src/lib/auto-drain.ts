/**
 * Auto-drain selection policy — "may this match's OCR event rows publish?".
 *
 * Split out of `auto-drain-cli.ts` so the policy is importable (and therefore
 * testable) without executing a CLI's `main()`. The CLI is a thin front end
 * over `decideDrain` plus the two candidate queries here.
 *
 * THE CRITERION (drain iff BOTH hold):
 *   1. `gateFromL4(...).decision === 'PASS'` — the OCR box-score final matches
 *      EA-API truth exactly. HOLD / OPERATOR_CONFIRM are listed, never drained.
 *   2. Zero `fail`-severity quality flags in classes A / B / D / G.
 *
 * WHY THOSE FOUR CLASSES, AND NOT SIMPLY "ALL FLAGS". A (duplicate events),
 * B (actor resolution), D (missing penalties) and G (off-roster resolution) are
 * the validated correctness detectors. Class C was retired — measured ~94%
 * false-positive; it flags marker proximity, which is presentation, not
 * correctness. E and F are never emitted. Gating on a detector that does not
 * detect anything real would strand good matches forever, which is precisely
 * the failure this module exists to undo — so the list is explicit, not
 * "whatever `buildQualityFlags` happens to return".
 */

import { db, ocrExtractions } from '@eanhl/db'
import { liveRunFilter } from '@eanhl/db/queries'
import { and, eq, inArray, sql } from 'drizzle-orm'

import type { QualityFlag } from './quality-inputs.js'
import type { L4Gate } from './l4-api-truth.js'

/**
 * The screens whose extractions this drains: the events timeline and the action
 * tracker. Both feed `match_events` — the stranded surface. Box-score,
 * loadout and faceoff-map screens are deliberately out of scope.
 */
export const DRAINABLE_SCREENS = ['post_game_events', 'post_game_action_tracker'] as const

/** Flag classes whose `fail` severity blocks a drain. See the header for why. */
export const BLOCKING_FLAG_CLASSES: ReadonlyArray<QualityFlag['classId']> = ['A', 'B', 'D', 'G']

export interface DrainDecision {
  drain: boolean
  reason: string
  /** The fail-severity A/B/D/G flags found, reported even when the gate is what blocked. */
  blockers: QualityFlag[]
}

/** The whole selection policy, pure. */
export function decideDrain(gate: L4Gate, flags: QualityFlag[]): DrainDecision {
  const blockers = flags.filter(
    (f) => f.severity === 'fail' && BLOCKING_FLAG_CLASSES.includes(f.classId),
  )

  if (gate.decision !== 'PASS') {
    return { drain: false, reason: `gate ${gate.decision} — ${gate.reason}`, blockers }
  }
  if (blockers.length > 0) {
    return {
      drain: false,
      reason: `gate PASS but ${String(blockers.length)} blocking flag(s): ${blockers
        .map((f) => `class ${f.classId}`)
        .join(', ')}`,
      blockers,
    }
  }
  return { drain: true, reason: 'gate PASS, no fail-severity flags in A/B/D/G', blockers: [] }
}

/**
 * Pending, successfully-transformed extraction ids for the drainable screens of
 * one match, restricted to the live run.
 *
 * The live-run filter matters: a superseded run's extractions are not the
 * canonical read state, and flipping them to `reviewed` would surface a
 * rejected decode alongside the winning one.
 */
export async function pendingDrainableExtractionIds(matchId: number): Promise<number[]> {
  const rows = await db
    .select({ id: ocrExtractions.id })
    .from(ocrExtractions)
    .where(
      and(
        eq(ocrExtractions.matchId, matchId),
        inArray(ocrExtractions.screenType, [...DRAINABLE_SCREENS]),
        eq(ocrExtractions.reviewStatus, 'pending_review'),
        eq(ocrExtractions.transformStatus, 'success'),
        liveRunFilter(ocrExtractions.runId),
      ),
    )
    .orderBy(ocrExtractions.id)
  return rows.map((r) => r.id)
}

/** Every match carrying at least one drainable pending extraction. */
export async function matchesWithPendingDrainableExtractions(): Promise<number[]> {
  const rows = await db
    .selectDistinct({ matchId: ocrExtractions.matchId })
    .from(ocrExtractions)
    .where(
      and(
        sql`${ocrExtractions.matchId} IS NOT NULL`,
        inArray(ocrExtractions.screenType, [...DRAINABLE_SCREENS]),
        eq(ocrExtractions.reviewStatus, 'pending_review'),
        eq(ocrExtractions.transformStatus, 'success'),
        liveRunFilter(ocrExtractions.runId),
      ),
    )
    .orderBy(ocrExtractions.matchId)
  return rows.map((r) => r.matchId).filter((id): id is number => id !== null)
}
