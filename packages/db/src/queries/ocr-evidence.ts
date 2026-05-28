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

import { and, asc, desc, eq, inArray, sql, type AnyColumn } from 'drizzle-orm'
import { db, type Database } from '../client.js'
import { ocrDecoderRuns } from '../schema/ocr-decoder-runs.js'
import {
  ocrFieldEvidence,
  ocrPromotions,
  ocrSegments,
  type OcrPromotionStatus,
  type OcrSegmentState,
} from '../schema/ocr-evidence.js'

/**
 * Phase-A: SQL fragment that filters to the "current state" for canonical
 * metric reads. A row counts as live if either:
 *   - run_id IS NULL (legacy / unmatched scope — pre-Phase-A rows kept
 *     visible so non-reprocess ingests keep working), OR
 *   - run_id points at an `ocr_decoder_runs` row with `is_active = true`
 *     (the canonical "winner" run for that match).
 *
 * Use in WHERE clauses on tables with a `run_id` column:
 *   ocr_segments, ocr_field_evidence, ocr_extractions, ocr_promotions,
 *   ocr_capture_batches.
 *
 * Audit / debug / history queries (e.g. "everything ever said about this
 * match", reviewer history reads) must NOT use this helper — they want
 * the full multi-run picture.
 *
 * Implementation note: uses a subquery against `ocr_decoder_runs`. That
 * table is small (one row per match per ingest run) and the active-run
 * subquery is highly selective; cost is negligible compared to the parent
 * scan. A LEFT JOIN form would be slightly faster on very large
 * candidate sets but harder to compose with the existing `and(...conditions)`
 * pattern — revisit if EXPLAIN shows it mattering.
 */
export function liveRunFilter(runIdColumn: AnyColumn) {
  return sql`(${runIdColumn} IS NULL OR ${runIdColumn} IN (SELECT id FROM ${ocrDecoderRuns} WHERE is_active = true))`
}

/**
 * Phase-A: return the active `ocr_decoder_runs.id` for a match, or `null`
 * if no active run exists yet (e.g., a freshly-imported match that hasn't
 * been ingested through the new pipeline, or a test fixture).
 *
 * The promoters use this to resolve "which run am I writing under?" when
 * called without an explicit runId argument.
 *
 * Accepts an optional db override (Database OR PgTransaction-compatible)
 * so callers that are mid-transaction can read the run's *committed-or-
 * pending* activation state from within the same tx. The cli-driven
 * `decoder-runs activate` flow flips `is_active` inside a tx and then
 * calls into the promoters via `rebuildCanonicalsFromActiveRun`; that
 * chain needs to see the in-flight flip, which only the same tx
 * connection can. Default is the shared module-level db.
 */
export async function getActiveRunIdForMatch(
  matchId: number,
  dbOverride?: Database,
): Promise<number | null> {
  const conn = dbOverride ?? db
  const rows = await conn
    .select({ id: ocrDecoderRuns.id })
    .from(ocrDecoderRuns)
    .where(and(eq(ocrDecoderRuns.matchId, matchId), eq(ocrDecoderRuns.isActive, true)))
    .limit(1)
  return rows[0]?.id ?? null
}

/**
 * All segments for a match, ordered by t_start_sec (NULLs last so manual
 * screenshot batches appear after timed video segments). Phase 1 will use
 * this to render the decoder timeline for `/admin/segments/<match>`.
 */
export async function getMatchSegments(matchId: number) {
  return db
    .select()
    .from(ocrSegments)
    .where(and(eq(ocrSegments.matchId, matchId), liveRunFilter(ocrSegments.runId)))
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
    .where(and(eq(ocrSegments.matchId, matchId), liveRunFilter(ocrSegments.runId)))
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
    .where(and(eq(ocrSegments.matchId, matchId), liveRunFilter(ocrSegments.runId)))
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
  /**
   * Phase-A: include rows from non-active (superseded) runs as well. Defaults
   * to false — typical "current state" reads only see the active run + legacy
   * NULL-run rows. Set true for audit/history dumps that need full provenance.
   */
  includeAllRuns?: boolean
}) {
  const conditions = [eq(ocrFieldEvidence.matchId, input.matchId)]
  if (input.includeAllRuns !== true) {
    conditions.push(liveRunFilter(ocrFieldEvidence.runId))
  }
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
    .where(and(eq(ocrFieldEvidence.matchId, matchId), liveRunFilter(ocrFieldEvidence.runId)))
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
  /**
   * Phase-A: include promotions from non-active (superseded) runs as well.
   * Defaults to false; set true for audit/history reads.
   */
  includeAllRuns?: boolean
}) {
  const conditions = [eq(ocrPromotions.matchId, input.matchId)]
  if (input.includeAllRuns !== true) {
    conditions.push(liveRunFilter(ocrPromotions.runId))
  }
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
    .where(and(eq(ocrPromotions.matchId, matchId), liveRunFilter(ocrPromotions.runId)))
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
        liveRunFilter(ocrPromotions.runId),
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
  /**
   * Phase-A: when supplied, scope evidence reads to this specific run_id
   * (used by the reprocess CLI to promote against a candidate run that's
   * not yet active). When omitted, falls back to the live-run filter
   * (active-run + NULL-leg).
   */
  runId?: number | null,
): Promise<FieldEvidenceRow[]> {
  const conditions = [
    eq(ocrFieldEvidence.matchId, matchId),
    eq(ocrFieldEvidence.screenState, 'player_loadout_view'),
  ]
  if (runId === undefined) {
    conditions.push(liveRunFilter(ocrFieldEvidence.runId))
  } else if (runId === null) {
    conditions.push(sql`${ocrFieldEvidence.runId} IS NULL`)
  } else {
    conditions.push(eq(ocrFieldEvidence.runId, runId))
  }
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
  /** Phase-A: see `getFieldEvidenceForLoadoutSlot` runId semantics. */
  runId?: number | null,
): Promise<FieldEvidenceRow[]> {
  const conditions = [
    eq(ocrFieldEvidence.matchId, matchId),
    eq(ocrFieldEvidence.screenState, 'pre_game_lobby_state_2'),
  ]
  if (runId === undefined) {
    conditions.push(liveRunFilter(ocrFieldEvidence.runId))
  } else if (runId === null) {
    conditions.push(sql`${ocrFieldEvidence.runId} IS NULL`)
  } else {
    conditions.push(eq(ocrFieldEvidence.runId, runId))
  }
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
        liveRunFilter(ocrPromotions.runId),
      ),
    )
    .orderBy(
      sql`${ocrPromotions.targetSemanticKey}->>'team_side'`,
      sql`${ocrPromotions.targetSemanticKey}->>'position'`,
      asc(ocrPromotions.fieldKey),
    )
}
