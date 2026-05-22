/**
 * Read-side queries against the Phase 0 evidence-layer tables.
 *
 * Phase 2+ promoters use these as a thin abstraction over Drizzle for the
 * common access patterns: list segments per match, group field evidence by
 * (screen, field, slot) for consensus, fetch promotion outcomes for triage.
 *
 * Schema lives in `packages/db/src/schema/ocr-evidence.ts`; the column shapes
 * are defined in Round 4 §6 of the redesign synthesis.
 */

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../client.js'
import {
  ocrFieldEvidence,
  ocrPromotions,
  ocrSegments,
  type OcrPromotionStatus,
  type OcrSegmentState,
} from '../schema/ocr-evidence.js'

/**
 * All segments for a match, ordered by t_start_sec (NULLs last so manual
 * screenshot batches appear after timed video segments). Phase 1 will use
 * this to render the decoder timeline for `/admin/segments/<match>`.
 */
export async function getMatchSegments(matchId: number) {
  return db
    .select()
    .from(ocrSegments)
    .where(eq(ocrSegments.matchId, matchId))
    .orderBy(sql`${ocrSegments.tStartSec} ASC NULLS LAST`, asc(ocrSegments.id))
}

export type MatchSegmentRow = Awaited<ReturnType<typeof getMatchSegments>>[number]

/**
 * Segments grouped by state, with per-state counts + total frames. Useful for
 * the `match-quality` CLI and the future `/admin/triage` dashboard.
 */
export async function getMatchSegmentStateCounts(matchId: number) {
  return db
    .select({
      state: ocrSegments.state,
      segmentCount: sql<number>`COUNT(*)::int`,
      totalFrames: sql<number>`COALESCE(SUM(${ocrSegments.frameCount}), 0)::int`,
      avgConfidence: sql<number | null>`AVG(${ocrSegments.segmentConfidence})::float`,
    })
    .from(ocrSegments)
    .where(eq(ocrSegments.matchId, matchId))
    .groupBy(ocrSegments.state)
    .orderBy(ocrSegments.state)
}

export type MatchSegmentStateCountRow = Awaited<
  ReturnType<typeof getMatchSegmentStateCounts>
>[number]

/**
 * Segments grouped by decoder_version, with per-version counts. Used by the
 * `ocr-segments-report` CLI to surface the HMM vs legacy passthrough split
 * introduced in Phase 1.
 */
export async function getMatchSegmentDecoderVersionCounts(
  matchId: number,
): Promise<Array<{ decoderVersion: string; segmentCount: number }>> {
  const rows = await db
    .select({
      decoderVersion: ocrSegments.decoderVersion,
      segmentCount: sql<number>`count(*)::int`,
    })
    .from(ocrSegments)
    .where(eq(ocrSegments.matchId, matchId))
    .groupBy(ocrSegments.decoderVersion)
    .orderBy(ocrSegments.decoderVersion)
  return rows
}

/**
 * All field evidence for a match, optionally filtered by screen state and
 * semantic field key. Each row is one *candidate* — Phase 2's promotion gate
 * collapses these into one `ocr_promotions` row per (target_table, key).
 */
export async function listFieldEvidence(input: {
  matchId: number
  screenState?: OcrSegmentState
  fieldKey?: string
  subjectSlotKey?: string
}) {
  const conditions = [eq(ocrFieldEvidence.matchId, input.matchId)]
  if (input.screenState !== undefined) {
    conditions.push(eq(ocrFieldEvidence.screenState, input.screenState))
  }
  if (input.fieldKey !== undefined) {
    conditions.push(eq(ocrFieldEvidence.fieldKey, input.fieldKey))
  }
  if (input.subjectSlotKey !== undefined) {
    conditions.push(eq(ocrFieldEvidence.subjectSlotKey, input.subjectSlotKey))
  }
  return db
    .select()
    .from(ocrFieldEvidence)
    .where(and(...conditions))
    .orderBy(
      asc(ocrFieldEvidence.fieldKey),
      asc(ocrFieldEvidence.subjectSlotKey),
      asc(ocrFieldEvidence.candidateRank),
    )
}

export type FieldEvidenceRow = Awaited<ReturnType<typeof listFieldEvidence>>[number]

/**
 * Group evidence into candidate clusters per semantic target. One row per
 * (screen_state, field_key, subject_slot_key) with the top-N candidate values
 * + their cumulative evidence count. Drives the Phase 2 promotion gate.
 */
export async function groupFieldEvidenceForPromotion(matchId: number) {
  return db
    .select({
      screenState: ocrFieldEvidence.screenState,
      fieldKey: ocrFieldEvidence.fieldKey,
      subjectSlotKey: ocrFieldEvidence.subjectSlotKey,
      candidateValue: ocrFieldEvidence.candidateValue,
      candidateRank: ocrFieldEvidence.candidateRank,
      voteCount: sql<number>`COUNT(*)::int`,
      avgConfidence: sql<number | null>`AVG(${ocrFieldEvidence.calibratedConfidence})::float`,
      maxConfidence: sql<number | null>`MAX(${ocrFieldEvidence.calibratedConfidence})::float`,
    })
    .from(ocrFieldEvidence)
    .where(eq(ocrFieldEvidence.matchId, matchId))
    .groupBy(
      ocrFieldEvidence.screenState,
      ocrFieldEvidence.fieldKey,
      ocrFieldEvidence.subjectSlotKey,
      ocrFieldEvidence.candidateValue,
      ocrFieldEvidence.candidateRank,
    )
    .orderBy(
      asc(ocrFieldEvidence.screenState),
      asc(ocrFieldEvidence.fieldKey),
      asc(ocrFieldEvidence.subjectSlotKey),
      asc(ocrFieldEvidence.candidateRank),
    )
}

export type PromotionCandidateRow = Awaited<
  ReturnType<typeof groupFieldEvidenceForPromotion>
>[number]

/**
 * All promotion outcomes for a match, optionally filtered by status.
 * `blocked_*` statuses are the triage queue's primary input.
 */
export async function listPromotions(input: {
  matchId: number
  status?: OcrPromotionStatus | ReadonlyArray<OcrPromotionStatus>
}) {
  const conditions = [eq(ocrPromotions.matchId, input.matchId)]
  if (input.status !== undefined) {
    if (typeof input.status === 'string') {
      conditions.push(eq(ocrPromotions.promotionStatus, input.status))
    } else if (input.status.length > 0) {
      conditions.push(inArray(ocrPromotions.promotionStatus, [...input.status]))
    }
  }
  return db
    .select()
    .from(ocrPromotions)
    .where(and(...conditions))
    .orderBy(asc(ocrPromotions.targetTable), desc(ocrPromotions.decidedAt))
}

export type PromotionRow = Awaited<ReturnType<typeof listPromotions>>[number]

/**
 * Aggregate counts per promotion_status, scoped to a match. Drives the
 * top-line evidence-layer health stats in match-quality / triage tooling.
 */
export async function getPromotionStatusCounts(matchId: number) {
  return db
    .select({
      promotionStatus: ocrPromotions.promotionStatus,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(ocrPromotions)
    .where(eq(ocrPromotions.matchId, matchId))
    .groupBy(ocrPromotions.promotionStatus)
    .orderBy(ocrPromotions.promotionStatus)
}

export type PromotionStatusCountRow = Awaited<ReturnType<typeof getPromotionStatusCounts>>[number]

/**
 * Triage queue: blocked promotions ordered by recency. Phase 5's review UI
 * consumes this; Phase 0/1 callers can use it for ad-hoc inspection.
 */
export async function getBlockedPromotions(matchId: number, limit = 50) {
  return db
    .select()
    .from(ocrPromotions)
    .where(
      and(
        eq(ocrPromotions.matchId, matchId),
        inArray(ocrPromotions.promotionStatus, [
          'blocked_observability',
          'blocked_consensus',
          'blocked_invariant',
          'blocked_authority',
        ]),
      ),
    )
    .orderBy(desc(ocrPromotions.decidedAt))
    .limit(limit)
}

/**
 * All field evidence for a match scoped to the `player_loadout_view` screen
 * state, optionally filtered to a single subject slot key. Used by the loadout
 * promoter (Task 2A-17) to bulk-read all candidates for a given slot in one
 * round-trip, hitting the `ocr_field_evidence_match_screen_slot_idx` B-tree
 * index added in Phase 2A-13.
 *
 * When `slotKey` is omitted, returns all loadout-view evidence for the match
 * (useful for promoter bootstrap — read once, fan out per slot in memory).
 */
export async function getFieldEvidenceForLoadoutSlot(
  matchId: number,
  slotKey?: string,
): Promise<FieldEvidenceRow[]> {
  const conditions = [
    eq(ocrFieldEvidence.matchId, matchId),
    eq(ocrFieldEvidence.screenState, 'player_loadout_view'),
  ]
  if (slotKey !== undefined) {
    conditions.push(eq(ocrFieldEvidence.subjectSlotKey, slotKey))
  }
  return db
    .select()
    .from(ocrFieldEvidence)
    .where(and(...conditions))
    .orderBy(
      asc(ocrFieldEvidence.subjectSlotKey),
      asc(ocrFieldEvidence.fieldKey),
      asc(ocrFieldEvidence.candidateRank),
    )
}

/**
 * Phase 3b mirror of `getFieldEvidenceForLoadoutSlot` scoped to
 * `screen_state='pre_game_lobby_state_2'`. Lobby has 12 fixed subjects per
 * frame keyed by `lobby_{for|against}_{C|LW|RW|LD|RD|G}`.
 */
export async function getFieldEvidenceForLobbySlot(
  matchId: number,
  slotKey?: string,
): Promise<FieldEvidenceRow[]> {
  const conditions = [
    eq(ocrFieldEvidence.matchId, matchId),
    eq(ocrFieldEvidence.screenState, 'pre_game_lobby_state_2'),
  ]
  if (slotKey !== undefined) {
    conditions.push(eq(ocrFieldEvidence.subjectSlotKey, slotKey))
  }
  return db
    .select()
    .from(ocrFieldEvidence)
    .where(and(...conditions))
    .orderBy(
      asc(ocrFieldEvidence.subjectSlotKey),
      asc(ocrFieldEvidence.fieldKey),
      asc(ocrFieldEvidence.candidateRank),
    )
}

/**
 * All promotion outcomes for a match that targeted the `player_loadout_snapshots`
 * table, ordered by team_side + position + field_key. Used by the loadout
 * promoter (Task 2A-17) to inspect prior outcomes before writing or re-running.
 */
export async function getLoadoutPromotionsForMatch(matchId: number): Promise<PromotionRow[]> {
  return db
    .select()
    .from(ocrPromotions)
    .where(
      and(
        eq(ocrPromotions.matchId, matchId),
        eq(ocrPromotions.targetTable, 'player_loadout_snapshots'),
      ),
    )
    .orderBy(
      sql`${ocrPromotions.targetSemanticKey}->>'team_side'`,
      sql`${ocrPromotions.targetSemanticKey}->>'position'`,
      asc(ocrPromotions.fieldKey),
    )
}
