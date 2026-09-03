import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { db, type Database } from '../client.js'
import {
  ocrCaptureBatches,
  ocrDecoderRuns,
  ocrExtractions,
  ocrFieldEvidence,
  ocrPromotions,
  ocrSegments,
} from '../schema/index.js'

/**
 * GAP (3): keep the decoder-run ledger consistent for association-flow matches.
 *
 * Migration 0048_phase_a_decoder_runs.sql backfilled one synthetic active
 * `ocr_decoder_runs` row per match that had OCR data at migration time, and
 * cascaded its `run_id` onto every match-linked row across five tables. Matches
 * confirmed through the reel→match association flow AFTER that migration never
 * got a run: `confirmAssociation` stamped `ocr_capture_batches.match_id` but
 * created no run and set no `run_id`. The result — run-less batches/segments and
 * zero active runs — violates the invariants 0048 established.
 *
 * `ensureSyntheticActiveRunForMatch` reproduces 0048's synthetic-backfill
 * semantics for a single match so the association flow (and a one-time backfill)
 * produce the exact ledger shape 0048 would have. It is idempotent: an existing
 * active run is reused, and only NULL-`run_id` rows are cascaded.
 */

const SYNTHETIC_WEIGHTS_HASH = 'synthetic-backfill-no-weights-hash'
const SYNTHETIC_CONFIG_HASH = 'synthetic-backfill-no-config-hash'

export interface EnsureRunResult {
  /** The active run id for the match, or null when the match has no capture batches yet. */
  runId: number | null
  /** True when this call created the run (false when an active run already existed). */
  created: boolean
  /** Count of rows whose run_id was cascaded, per table. */
  cascaded: {
    batches: number
    segments: number
    fieldEvidence: number
    extractions: number
    promotions: number
  }
}

/**
 * Ensure a synthetic active decoder run exists for `matchId` and cascade its
 * `run_id` onto every match-linked row (batches, segments, field evidence,
 * extractions, promotions) that still has `run_id IS NULL`.
 *
 * Provenance is computed from the match's own match-linked rows, mirroring 0048:
 *   - `video_sha256`: one distinct non-null sha across the match's batches AND
 *     no manual (NULL-sha) batch → that sha; otherwise NULL.
 *   - `decoder_version`: one distinct non-null decoder across the match's
 *     segments → that value; multiple → `'legacy-mixed'`; none → `'unknown'`.
 *   - `notes` start with `'synthetic backfill'` and disclose `videos=[…]` /
 *     `decoders=[…]`, so the ocr-decoder-runs-backfill provenance tests validate
 *     these runs identically to migration-0048 runs.
 *
 * No-op guard: a match with zero capture batches gets no run (a returned
 * `runId: null`). 0048 only created a run for a match with ≥1 match-linked
 * batch, and its orphan-run invariant forbids an active run that owns none.
 *
 * MUST run inside a transaction — pass the transaction as `conn` (the create +
 * five cascades must be atomic). Callers follow the repo idiom of
 * `tx as unknown as Database`.
 */
export async function ensureSyntheticActiveRunForMatch(
  matchId: number,
  conn: Database,
): Promise<EnsureRunResult> {
  const emptyCascade = {
    batches: 0,
    segments: 0,
    fieldEvidence: 0,
    extractions: 0,
    promotions: 0,
  }

  const [existing] = await conn
    .select({ id: ocrDecoderRuns.id })
    .from(ocrDecoderRuns)
    .where(and(eq(ocrDecoderRuns.matchId, matchId), eq(ocrDecoderRuns.isActive, true)))
    .limit(1)

  let runId: number
  let created: boolean

  if (existing) {
    runId = existing.id
    created = false
  } else {
    const batches = await conn
      .select({ videoSha256: ocrCaptureBatches.videoSha256 })
      .from(ocrCaptureBatches)
      .where(eq(ocrCaptureBatches.matchId, matchId))

    // No batches → no run (mirrors 0048; avoids an orphan active run).
    if (batches.length === 0) {
      return { runId: null, created: false, cascaded: emptyCascade }
    }

    const distinctShas = Array.from(
      new Set(batches.map((b) => b.videoSha256).filter((s): s is string => s !== null)),
    )
    const hasManual = batches.some((b) => b.videoSha256 === null)
    const chosenSha = distinctShas.length === 1 && !hasManual ? distinctShas[0]! : null

    const segs = await conn
      .select({ decoderVersion: ocrSegments.decoderVersion })
      .from(ocrSegments)
      .where(eq(ocrSegments.matchId, matchId))
    const distinctDecoders = Array.from(
      new Set(segs.map((s) => s.decoderVersion).filter((d): d is string => d != null)),
    )
    const chosenDecoder =
      distinctDecoders.length === 0
        ? 'unknown'
        : distinctDecoders.length === 1
          ? distinctDecoders[0]!
          : 'legacy-mixed'

    const notes =
      `synthetic backfill (association-confirm): ` +
      `videos=[${distinctShas.join(', ') || 'none'}] ` +
      `decoders=[${distinctDecoders.join(', ') || 'none'}] ` +
      `has_manual=${hasManual}`

    const [inserted] = await conn
      .insert(ocrDecoderRuns)
      .values({
        matchId,
        videoSha256: chosenSha,
        decoderVersion: chosenDecoder,
        weightsHash: SYNTHETIC_WEIGHTS_HASH,
        configHash: SYNTHETIC_CONFIG_HASH,
        isActive: true,
        notes,
      })
      .returning({ id: ocrDecoderRuns.id })
    if (!inserted) {
      throw new Error(
        `ensureSyntheticActiveRunForMatch: insert returned no row for match ${matchId}`,
      )
    }
    runId = inserted.id
    created = true
  }

  // Cascade run_id onto NULL-run_id match-linked rows across the five tables.
  const batchesN = (
    await conn
      .update(ocrCaptureBatches)
      .set({ runId })
      .where(and(eq(ocrCaptureBatches.matchId, matchId), isNull(ocrCaptureBatches.runId)))
      .returning({ id: ocrCaptureBatches.id })
  ).length
  const segmentsN = (
    await conn
      .update(ocrSegments)
      .set({ runId })
      .where(and(eq(ocrSegments.matchId, matchId), isNull(ocrSegments.runId)))
      .returning({ id: ocrSegments.id })
  ).length
  const fieldEvidenceN = (
    await conn
      .update(ocrFieldEvidence)
      .set({ runId })
      .where(and(eq(ocrFieldEvidence.matchId, matchId), isNull(ocrFieldEvidence.runId)))
      .returning({ id: ocrFieldEvidence.id })
  ).length
  const extractionsN = (
    await conn
      .update(ocrExtractions)
      .set({ runId })
      .where(and(eq(ocrExtractions.matchId, matchId), isNull(ocrExtractions.runId)))
      .returning({ id: ocrExtractions.id })
  ).length
  const promotionsN = (
    await conn
      .update(ocrPromotions)
      .set({ runId })
      .where(and(eq(ocrPromotions.matchId, matchId), isNull(ocrPromotions.runId)))
      .returning({ id: ocrPromotions.id })
  ).length

  return {
    runId,
    created,
    cascaded: {
      batches: batchesN,
      segments: segmentsN,
      fieldEvidence: fieldEvidenceN,
      extractions: extractionsN,
      promotions: promotionsN,
    },
  }
}

/**
 * Take the run-scoped serialization lock that every writer attaching a child
 * segment under `runId` must hold.
 *
 * LOCK ORDERING (parent before child — the whole point of this helper):
 *   1. begin transaction
 *   2. `lockDecoderRunForProvenance(runId, tx)`  <- exclusive lock on the ONE
 *      parent row, taken while the transaction holds no child-row locks at all
 *   3. insert/upsert the child `ocr_segments` row
 *   4. `refreshDecoderRunProvenance(runId, tx)`
 *   5. commit
 *
 * Why it must come BEFORE the child write: inserting a segment that references
 * `run_id` makes Postgres take a `FOR KEY SHARE` lock on the parent run row for
 * the referential-integrity check. `FOR KEY SHARE` is compatible with itself, so
 * two cooperating writers for the same run would both sail through their inserts
 * and only then each try to escalate to `FOR UPDATE` past the other's held
 * `FOR KEY SHARE` — a textbook lock-upgrade deadlock that Postgres resolves by
 * aborting one side (SQLSTATE 40P01). Taking `FOR UPDATE` first makes the second
 * writer wait at step 2 instead, before it holds anything the first writer could
 * ever need, so the two writers serialize cleanly and BOTH commit.
 *
 * Scope is exactly one row (`WHERE id = runId`) — never match-wide, so writers
 * for sibling runs of the same match never contend.
 *
 * Throws when the run does not exist: a segment must not be attached to a run
 * that isn't there (the FK would reject it a statement later anyway).
 */
export async function lockDecoderRunForProvenance(runId: number, conn: Database): Promise<void> {
  const [run] = await conn
    .select({ id: ocrDecoderRuns.id })
    .from(ocrDecoderRuns)
    .where(eq(ocrDecoderRuns.id, runId))
    .limit(1)
    .for('update')
  if (!run) {
    throw new Error(`lockDecoderRunForProvenance: run ${String(runId)} not found`)
  }
}

/**
 * Recompute a decoder run's own provenance from its OWN child `ocr_segments`
 * rows (scoped by `run_id`, never match-wide) and write it back when it has
 * drifted.
 *
 * Fixes the recurrence documented in
 * docs/operations/decoder-provenance-repair-main-sync-2026-08-16.md: a
 * rescue-like operation can attach a new-decoder segment under an existing
 * SYNTHETIC run's `run_id` without touching the parent row. Call this INSIDE
 * the same transaction as the segment write that touches a non-null `run_id`,
 * immediately after it, so the attachment and the provenance refresh commit
 * atomically — a synthetic run can never be committed while its parent's
 * `decoder_version` lies about which decoders it owns. That transaction MUST
 * have already called `lockDecoderRunForProvenance(runId, conn)` before its
 * child write; see that helper for the ordering and why it cannot be skipped.
 *
 * ELIGIBILITY (do not widen without re-reading
 * docs/operations/decoder-provenance-repair-main-sync-2026-08-16.md first):
 * only runs whose `notes` mark them as synthetic/backfill provenance (starts
 * with `'synthetic backfill'` — the migration-0048 / `ensureSyntheticActive-
 * RunForMatch` marker) are eligible for this derive-from-children rule. Every
 * other run — most importantly a `decoder-runs-cli create-candidate` /
 * reprocess run (tools/video_ingest/video_ingest/reprocess.py `DECODER_VERSION`)
 * — carries an intentionally MORE SPECIFIC, operator-chosen `decoder_version`
 * that IS the run's own provenance/uniqueness lever
 * (`ocr_decoder_runs_provenance_uniq` on `(match_id, video_sha256,
 * decoder_version, weights_hash)`). Its child segments legitimately carry a
 * coarser, generic decoder tag (e.g. run `decoder_version`
 * `hmm-viterbi-v2-pregame-cdef-wsb-toggle-lobby3fps-fuzzymerge` over segments
 * tagged plain `hmm-viterbi-v2` — the segment-level classifier identifier from
 * game_ocr's `screen_classifier.py`, not the run-level feature/candidate tag).
 * Deriving such a run's `decoder_version` from its children would silently
 * erase that intentional distinction and can collide on the uniqueness index
 * the moment two sibling candidate runs both reduce to the same generic child
 * decoder. Ineligible runs are left completely untouched — no `decoder_version`
 * write, no `notes` rewrite.
 *
 * Rule for ELIGIBLE (synthetic) runs only:
 *   - zero distinct non-null child decoder versions -> 'unknown'
 *   - exactly one distinct value -> that value
 *   - more than one distinct value -> 'legacy-mixed'
 *
 * For an eligible run, the `decoders=[...]` disclosure in `notes` is
 * rewritten to the current distinct set (sorted, for a stable string across
 * repeated idempotent calls) — all other note text is preserved verbatim. A
 * synthetic note that is missing the disclosure entirely (so the replace
 * would be a silent no-op) gets one appended instead, so the invariant
 * "synthetic notes never omit a child decoder" holds even for a malformed
 * starting note.
 *
 * A no-op write is skipped entirely (both `decoder_version` and `notes`
 * already match) so idempotent re-attachment of the same segment never
 * touches the row.
 */
const SYNTHETIC_NOTES_PREFIX = 'synthetic backfill'
const DECODERS_DISCLOSURE_PATTERN = /decoders=\[[^\]]*\]/

function refreshedSyntheticNotes(
  notes: string | null,
  distinctDecoders: readonly string[],
): string | null {
  if (notes?.startsWith(SYNTHETIC_NOTES_PREFIX) !== true) {
    return notes
  }
  const disclosure = `decoders=[${distinctDecoders.join(', ')}]`
  return DECODERS_DISCLOSURE_PATTERN.test(notes)
    ? notes.replace(DECODERS_DISCLOSURE_PATTERN, disclosure)
    : `${notes.trimEnd()} ${disclosure}`
}

export async function refreshDecoderRunProvenance(runId: number, conn: Database): Promise<void> {
  // Re-assert the run-scoped lock the caller already took in
  // `lockDecoderRunForProvenance` BEFORE its child write. Re-acquiring
  // `FOR UPDATE` on a row this same transaction already holds `FOR UPDATE` is a
  // no-op in Postgres, so this is an idempotent assertion rather than a second
  // acquisition: it guarantees that a caller which forgot step 2 of the ordering
  // still cannot derive provenance from a stale sibling snapshot (it just risks
  // the lock-upgrade deadlock that step 2 exists to prevent). Scoped to this one
  // row (WHERE id = runId) — never match-wide.
  const [run] = await conn
    .select({ decoderVersion: ocrDecoderRuns.decoderVersion, notes: ocrDecoderRuns.notes })
    .from(ocrDecoderRuns)
    .where(eq(ocrDecoderRuns.id, runId))
    .limit(1)
    .for('update')
  if (!run) {
    throw new Error(`refreshDecoderRunProvenance: run ${String(runId)} not found`)
  }

  // Only synthetic/backfill runs derive decoder_version from their children —
  // see the ELIGIBILITY section of this function's doc comment. A non-synthetic
  // (e.g. candidate/reprocess) run's decoder_version is intentional, operator-
  // chosen provenance, not something to overwrite from a coarser child tag.
  if (run.notes?.startsWith(SYNTHETIC_NOTES_PREFIX) !== true) {
    return
  }

  const segs = await conn
    .select({ decoderVersion: ocrSegments.decoderVersion })
    .from(ocrSegments)
    .where(eq(ocrSegments.runId, runId))
  const distinctDecoders = Array.from(new Set(segs.map((s) => s.decoderVersion))).sort()

  const nextDecoderVersion =
    distinctDecoders.length === 0
      ? 'unknown'
      : distinctDecoders.length === 1
        ? (distinctDecoders[0] ?? 'unknown')
        : 'legacy-mixed'

  const nextNotes = refreshedSyntheticNotes(run.notes, distinctDecoders)

  if (nextDecoderVersion === run.decoderVersion && nextNotes === run.notes) {
    return
  }

  await conn
    .update(ocrDecoderRuns)
    .set({ decoderVersion: nextDecoderVersion, notes: nextNotes })
    .where(eq(ocrDecoderRuns.id, runId))
}

/**
 * One-time / maintenance wrapper: run `ensureSyntheticActiveRunForMatch` for a
 * single match inside its own transaction (atomic create + cascade). Safe to
 * re-run — idempotent once the match is linked.
 */
export async function backfillRunLinkageForMatch(matchId: number): Promise<EnsureRunResult> {
  return db.transaction(async (tx) =>
    ensureSyntheticActiveRunForMatch(matchId, tx as unknown as Database),
  )
}

/**
 * Discover every match that has ≥1 match-linked capture batch whose `run_id`
 * is still NULL — i.e. the matches the association-confirm bug left run-less.
 * Ordered ascending for stable, reproducible backfill runs.
 */
export async function findMatchesNeedingRunLinkage(): Promise<number[]> {
  const rows = await db
    .selectDistinct({ matchId: ocrCaptureBatches.matchId })
    .from(ocrCaptureBatches)
    .where(and(isNotNull(ocrCaptureBatches.matchId), isNull(ocrCaptureBatches.runId)))
  return rows
    .map((r) => r.matchId)
    .filter((m): m is number => m != null)
    .sort((a, b) => a - b)
}
