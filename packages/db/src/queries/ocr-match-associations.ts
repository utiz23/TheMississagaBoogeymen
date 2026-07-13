import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../client.js'
import {
  ocrCaptureBatches,
  ocrMatchAssociations,
  type NewOcrMatchAssociation,
  type OcrMatchAssociation,
} from '../schema/index.js'
import { getMatchesWithLineup } from './matches.js'

/**
 * Reel→match association review-queue queries (Milestone ② Task 2.3).
 *
 * The scorer (apps/worker/src/lib/match-association-score.ts) proposes a
 * candidate per reel; these queries persist the proposal, list the pending
 * queue for operator review, and — on confirm — flip status AND stamp
 * `ocr_capture_batches.match_id`, which is what unlocks per-reel dispatch.
 */

/**
 * API-truth match candidate for the scorer. Structurally compatible with the
 * worker's `ApiCandidate` (the CLI passes these straight into `scoreCandidates`).
 */
export interface AssociationCandidate {
  matchId: number
  playedAtEpochS: number
  scoreFor: number
  scoreAgainst: number
  opponentName: string
  roster: string[]
}

/**
 * Enumerate every match for a game title as a scorer candidate. Reuses
 * `getMatchesWithLineup(gameTitleId, [])` — the ready-made "all matches for a
 * game title" enumerator returning score / opponent / played-at.
 *
 * `roster` is left empty here: enriching each candidate via `getMatchLineups`
 * would be one heavy lineup query per match (hundreds per game title) on every
 * propose. The scorer down-weights roster (0.15) and handles an empty roster as
 * a zero signal, so timestamp + score + opponent (0.85 of the weight) drive the
 * proposal. Roster enrichment for the timestamp-shortlisted candidates is a
 * documented follow-up to add if calibration shows same-day/same-opponent
 * collisions need it.
 */
export async function enumerateApiCandidates(gameTitleId: number): Promise<AssociationCandidate[]> {
  const rows = await getMatchesWithLineup(gameTitleId, [])
  return rows.map((r) => ({
    matchId: r.id,
    playedAtEpochS: Math.floor(r.playedAt.getTime() / 1000),
    scoreFor: r.scoreFor,
    scoreAgainst: r.scoreAgainst,
    opponentName: r.opponentName,
    roster: [],
  }))
}

/** Insert one association proposal (defaults status to 'pending'). */
export async function insertAssociationProposal(
  row: NewOcrMatchAssociation,
): Promise<OcrMatchAssociation> {
  const [inserted] = await db.insert(ocrMatchAssociations).values(row).returning()
  if (!inserted) throw new Error('insertAssociationProposal: insert returned no row')
  return inserted
}

/** All pending proposals, newest first. */
export async function listPendingAssociations(): Promise<OcrMatchAssociation[]> {
  return db
    .select()
    .from(ocrMatchAssociations)
    .where(eq(ocrMatchAssociations.status, 'pending'))
    .orderBy(desc(ocrMatchAssociations.createdAt))
}

export interface ConfirmAssociationResult {
  association: OcrMatchAssociation
  /** ids of the capture batches whose match_id was stamped. */
  stampedBatchIds: number[]
}

/**
 * Confirm a pending proposal, atomically:
 *   1. status → 'confirmed', decided_at → now(), proposed_match_id → the
 *      effective match id (the operator override when supplied, else the
 *      scorer's proposal).
 *   2. stamp `ocr_capture_batches.match_id = <effective match id>` for the
 *      batch(es) matching this association's (video_sha256, run_id) — the step
 *      that unlocks per-reel dispatch.
 *
 * `overrideMatchId` is REQUIRED for a `no_api_match` proposal (proposed_match_id
 * IS NULL): the scorer found no candidate, so the operator supplies the id.
 * Throws if the proposal is missing, already decided, or resolves to no match id.
 */
export async function confirmAssociation(
  id: number,
  overrideMatchId?: number,
): Promise<ConfirmAssociationResult> {
  return db.transaction(async (tx) => {
    const [assoc] = await tx
      .select()
      .from(ocrMatchAssociations)
      .where(eq(ocrMatchAssociations.id, id))
      .limit(1)
    if (!assoc) throw new Error(`confirmAssociation: association ${id} not found`)
    if (assoc.status !== 'pending') {
      throw new Error(`confirmAssociation: association ${id} is '${assoc.status}', not pending`)
    }
    const matchId = overrideMatchId ?? assoc.proposedMatchId
    if (matchId == null) {
      throw new Error(
        `confirmAssociation: association ${id} is no_api_match (no proposed match); ` +
          `supply a match id (confirm --id ${id} --match-id <M>)`,
      )
    }

    const [updated] = await tx
      .update(ocrMatchAssociations)
      .set({ status: 'confirmed', decidedAt: new Date(), proposedMatchId: matchId })
      .where(eq(ocrMatchAssociations.id, id))
      .returning()
    if (!updated) throw new Error(`confirmAssociation: update returned no row for ${id}`)

    // Stamp the reel's capture batch(es). run_id is nullable on both sides;
    // match NULL≡NULL explicitly (eq() would never match a NULL run_id).
    const runIdPredicate =
      assoc.runId == null
        ? isNull(ocrCaptureBatches.runId)
        : eq(ocrCaptureBatches.runId, assoc.runId)
    const stamped = await tx
      .update(ocrCaptureBatches)
      .set({ matchId })
      .where(and(eq(ocrCaptureBatches.videoSha256, assoc.videoSha256), runIdPredicate))
      .returning({ id: ocrCaptureBatches.id })

    return { association: updated, stampedBatchIds: stamped.map((s) => s.id) }
  })
}

/** Reject a pending proposal: status → 'rejected', decided_at → now(). No stamp. */
export async function rejectAssociation(id: number): Promise<OcrMatchAssociation> {
  const [updated] = await db
    .update(ocrMatchAssociations)
    .set({ status: 'rejected', decidedAt: new Date() })
    .where(and(eq(ocrMatchAssociations.id, id), eq(ocrMatchAssociations.status, 'pending')))
    .returning()
  if (!updated) {
    throw new Error(`rejectAssociation: association ${id} not found or not pending`)
  }
  return updated
}
