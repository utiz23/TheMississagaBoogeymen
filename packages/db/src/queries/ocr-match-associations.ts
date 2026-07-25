import { and, desc, eq } from 'drizzle-orm'
import { db, type Database } from '../client.js'
import {
  ocrCaptureBatches,
  ocrMatchAssociations,
  type NewOcrMatchAssociation,
  type OcrMatchAssociation,
} from '../schema/index.js'
import { getMatchesWithLineup } from './matches.js'
import { ensureSyntheticActiveRunForMatch } from './ocr-decoder-runs.js'

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
 *   2. ON THE run_id NON-NULL PATH ONLY, stamp `ocr_capture_batches.match_id`
 *      for the batch(es) matching this association's (video_sha256, run_id) —
 *      re-associating an already-dispatched single run. The run_id NULL (fresh
 *      reel) path does NOT stamp: `(sha, run_id=NULL)` is not reel-scoped, so a
 *      stamp there would clobber the other reels' batches. Those get their
 *      match_id from deferred dispatch instead (see the guard below).
 *   3. ensure the decoder-run ledger is consistent for the match (GAP 3).
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

    // Reel-scoping guard for the confirm-time stamp. `(video_sha256, run_id)`
    // has NO reel scoping: a multi-reel video's reels all share one
    // `(sha, run_id=NULL)` group, so a NULL-run_id stamp would touch EVERY reel's
    // batches — confirming reel A would clobber reel B's match_id. We therefore
    // stamp ONLY on the run_id NON-NULL path (re-associating an already-dispatched
    // single run, where `(sha, run_id)` scopes to exactly that one match's
    // batches). On the fresh reel flow (run_id NULL) deferred dispatch assigns
    // each reel's match_id at batch creation — the confirmed association row is
    // the source of truth (DECISION 1, 2026-07-13), not this stamp.
    let stamped: { id: number }[] = []
    if (assoc.runId != null) {
      stamped = await tx
        .update(ocrCaptureBatches)
        .set({ matchId })
        .where(
          and(
            eq(ocrCaptureBatches.videoSha256, assoc.videoSha256),
            eq(ocrCaptureBatches.runId, assoc.runId),
          ),
        )
        .returning({ id: ocrCaptureBatches.id })
    }

    // GAP (3): keep the decoder-run ledger consistent. Ensure a synthetic active
    // run exists for the match and cascade run_id onto that MATCH's batches (and
    // other match-linked rows) that still have run_id NULL. This is match-scoped,
    // not sha-scoped, so each reel's own batches link to its own run without
    // crossing reels. No-op when the match has no capture batches yet (deferred
    // dispatch) — dispatch/ingest owns run creation there.
    await ensureSyntheticActiveRunForMatch(matchId, tx as unknown as Database)

    return { association: updated, stampedBatchIds: stamped.map((s) => s.id) }
  })
}

/**
 * The confirmed reel→match map for a video: one `{reelIndex, matchId}` per
 * confirmed reel. Step (3)'s Python orchestrator reads this (via the worker
 * `resolve-match reel-map` CLI + `_psql_query`) to replace the hardcoded
 * `reel_match_ids=None` so each reel dispatches under its own match.
 *
 * Only `confirmed` rows count. `confirmAssociation` always sets an effective
 * `proposed_match_id` on confirm, so a null id is defensively dropped rather
 * than surfaced. `reelIndex` is parsed from the `${sha}:${idx}` reel_identity
 * key (sha256 is hex, so the last `:` is the separator). Rows are ordered by
 * reel_identity for a stable, deterministic map.
 */
export async function getConfirmedReelMap(
  videoSha256: string,
): Promise<{ reelIndex: number; matchId: number }[]> {
  const rows = await db
    .select({
      reelIdentity: ocrMatchAssociations.reelIdentity,
      proposedMatchId: ocrMatchAssociations.proposedMatchId,
    })
    .from(ocrMatchAssociations)
    .where(
      and(
        eq(ocrMatchAssociations.videoSha256, videoSha256),
        eq(ocrMatchAssociations.status, 'confirmed'),
      ),
    )
    .orderBy(ocrMatchAssociations.reelIdentity)

  const out: { reelIndex: number; matchId: number }[] = []
  for (const r of rows) {
    if (r.proposedMatchId == null) continue
    const reelIndex = Number(r.reelIdentity.slice(r.reelIdentity.lastIndexOf(':') + 1))
    if (!Number.isInteger(reelIndex)) continue
    out.push({ reelIndex, matchId: r.proposedMatchId })
  }
  return out
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
