/**
 * A3 — Reprocess CLI helper.
 *
 * Reads the active `ocr_decoder_runs` row for a match and re-projects its
 * evidence into the canonical snapshot tables:
 *   - player_loadout_snapshots (loadout-view + lobby sources)
 *   - player_loadout_x_factors (child of loadout-view snapshots)
 *   - player_loadout_attributes (child of loadout-view snapshots)
 *
 * Used by the upcoming `decoder-runs-cli activate` subcommand: after the
 * candidate run is flipped to `is_active=true`, this helper rebuilds the
 * canonical snapshot tables from the now-active run's evidence.
 *
 * Strategy: re-invoke the v2 promoters (`promoteLoadoutFromEvidence`,
 * `promoteLobbyFromEvidence`) with `runId = activeRunId`. Both promoters
 * already gate canonical-snapshot writes on
 * `effectiveRunIdForWrites === activeRunId` (see loadout-v2.ts:280-293,
 * lobby-v2.ts:174-176), so re-invoking them with the active run id
 * triggers the snapshot writes.
 *
 * Idempotency: deletes existing canonical rows for the match FIRST, then
 * re-promotes. The promoters themselves additionally delete prior
 * (match, runId) `ocr_promotions` rows before insert.
 *
 * Single-transaction caveat: the underlying promoters open their own
 * inner transactions and the project's `Database` type doesn't currently
 * model a Drizzle Transaction (it's `typeof db`). Wrapping the whole
 * helper in one outer transaction would require widening every
 * promoter's `db?: Database` parameter to a union with `PgTransaction`.
 * For Task 1 the delete + re-promote are performed sequentially against
 * the default db (not atomically). The activate flow (Task 4) lives at a
 * higher layer and can decide whether it needs an outer transaction
 * around `UPDATE ocr_decoder_runs SET is_active=…` plus this helper —
 * see Task 1 report notes.
 */

import { and, eq, inArray } from 'drizzle-orm'
import {
  db as defaultDb,
  ocrDecoderRuns,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
  type Database,
} from '@eanhl/db'
import { promoteLoadoutFromEvidence } from '../ocr-promoters/loadout-v2.js'
import { promoteLobbyFromEvidence } from '../ocr-promoters/lobby-v2.js'

export interface RebuildCanonicalsResult {
  loadoutSnapshotsWritten: number
  lobbySnapshotsWritten: number
  // Future canonical tables (events, faceoffs, …) get their own counters here.
}

export async function rebuildCanonicalsFromActiveRun(
  matchId: number,
  options?: { db?: Database },
): Promise<RebuildCanonicalsResult> {
  const db = options?.db ?? defaultDb

  // Resolve the active run id.
  const activeRows = await db
    .select({ id: ocrDecoderRuns.id })
    .from(ocrDecoderRuns)
    .where(and(eq(ocrDecoderRuns.matchId, matchId), eq(ocrDecoderRuns.isActive, true)))
    .limit(1)
  if (activeRows.length === 0) {
    throw new Error(
      `rebuildCanonicalsFromActiveRun: no active run for match ${matchId}`,
    )
  }
  const activeRunId = activeRows[0]!.id

  // Delete prior canonical rows for this match. Child tables first
  // (no ON DELETE CASCADE on the FKs as of 2026-05).
  const priorSnapshotIds = (
    await db
      .select({ id: playerLoadoutSnapshots.id })
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, matchId))
  ).map((r) => r.id)
  if (priorSnapshotIds.length > 0) {
    await db
      .delete(playerLoadoutXFactors)
      .where(inArray(playerLoadoutXFactors.loadoutSnapshotId, priorSnapshotIds))
    await db
      .delete(playerLoadoutAttributes)
      .where(inArray(playerLoadoutAttributes.loadoutSnapshotId, priorSnapshotIds))
    await db
      .delete(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, matchId))
  }

  // Re-run the v2 promoters with the active run id. The promoters'
  // internal writeSnapshots gate (effectiveRunIdForWrites === activeRunId)
  // evaluates true here, so they write to player_loadout_snapshots.
  const loadoutResult = await promoteLoadoutFromEvidence({
    matchId,
    runId: activeRunId,
    db,
  })
  const lobbyResult = await promoteLobbyFromEvidence({
    matchId,
    runId: activeRunId,
    db,
  })

  return {
    loadoutSnapshotsWritten: loadoutResult.promotedSnapshotCount,
    lobbySnapshotsWritten: lobbyResult.promotedSnapshotCount,
  }
}
