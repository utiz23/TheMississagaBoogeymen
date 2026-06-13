/**
 * Phase-A test: ocr_decoder_runs synthetic backfill rules.
 *
 * The S1 migration (0048_phase_a_decoder_runs.sql) created one synthetic
 * `ocr_decoder_runs` row per match with existing OCR data. The provenance
 * rules from the plan:
 *
 *   single-source video (one distinct sha across the run's own batches,
 *   no manual mix) → run.video_sha256 = that sha
 *   multi-source / mixed video+manual / manual-only → video_sha256 = NULL
 *
 *   single distinct decoder_version across the run's own ocr_segments →
 *   use that value
 *   multiple distinct decoder_versions → 'legacy-mixed' marker
 *
 * IMPORTANT: provenance is computed PER RUN (filter by run_id), not
 * match-wide. Migration 0048's one-shot DO block aggregated match-wide
 * (GROUP BY match_id) because at backfill time exactly one synthetic run
 * owned every one of a match's segments/batches, so run-scope == match-scope.
 * Once reprocessing added later runs (each with its own run_id-scoped
 * segments), the two scopes diverged: a match can now hold v1 segments owned
 * by the synthetic run AND v2 segments owned by a reprocess run. The synthetic
 * run's decoder_version must honestly describe ITS OWN segments — marking it
 * 'legacy-mixed' just because some other run later produced a different
 * decoder version would record provenance the run never had.
 *
 * This test verifies the current DB state matches the rules. It does NOT
 * re-run the backfill SQL (that's a one-shot in migration 0048's DO block);
 * it catches accidental future drift — e.g., a manual UPDATE to a synthetic
 * run row, or a re-applied migration that misrebuilds the active run.
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/ocr-decoder-runs-backfill.test.js
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { db, sql as rawSql, ocrCaptureBatches, ocrDecoderRuns, ocrSegments } from '@eanhl/db'
import { and, eq, isNotNull, sql } from 'drizzle-orm'

before(async () => {
  if (!process.env['DATABASE_URL']) return
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  await rawSql.end({ timeout: 5 })
})

void test('every match-linked batch has run_id; unmatched batches keep run_id NULL', async () => {
  if (!process.env['DATABASE_URL']) return

  // Match-linked batches must all have run_id set.
  const matchLinkedWithoutRun = await db
    .select({ id: ocrCaptureBatches.id })
    .from(ocrCaptureBatches)
    .where(and(isNotNull(ocrCaptureBatches.matchId), sql`${ocrCaptureBatches.runId} IS NULL`))
  assert.equal(
    matchLinkedWithoutRun.length,
    0,
    `expected 0 match-linked batches without run_id; got ${matchLinkedWithoutRun.length}`,
  )

  // Unmatched batches MUST keep run_id NULL — they fall under the legacy
  // scope and shouldn't have been touched by the backfill.
  const unmatchedWithRun = await db
    .select({ id: ocrCaptureBatches.id })
    .from(ocrCaptureBatches)
    .where(and(sql`${ocrCaptureBatches.matchId} IS NULL`, isNotNull(ocrCaptureBatches.runId)))
  assert.equal(
    unmatchedWithRun.length,
    0,
    `expected 0 unmatched batches with run_id; got ${unmatchedWithRun.length}`,
  )
})

void test('every match with batches has exactly one active synthetic run', async () => {
  if (!process.env['DATABASE_URL']) return

  // Count distinct matches with at least one match-linked batch.
  const matchesWithBatches = await db
    .select({ matchId: ocrCaptureBatches.matchId })
    .from(ocrCaptureBatches)
    .where(isNotNull(ocrCaptureBatches.matchId))
    .groupBy(ocrCaptureBatches.matchId)
  const matchIdsWithBatches = matchesWithBatches
    .map((r) => r.matchId)
    .filter((m): m is number => m !== null)

  // Each such match must have exactly one active run row.
  for (const matchId of matchIdsWithBatches) {
    const activeRuns = await db
      .select({ id: ocrDecoderRuns.id })
      .from(ocrDecoderRuns)
      .where(and(eq(ocrDecoderRuns.matchId, matchId), eq(ocrDecoderRuns.isActive, true)))
    assert.equal(
      activeRuns.length,
      1,
      `match ${matchId} should have exactly 1 active run, got ${activeRuns.length}`,
    )
  }
})

void test('backfill provenance: single-source matches have non-NULL video_sha256; multi-source have NULL', async () => {
  if (!process.env['DATABASE_URL']) return

  // For each active synthetic backfill run, compute what its provenance SHOULD
  // be from the underlying ocr_capture_batches + ocr_segments, then assert the
  // recorded run row matches.
  //
  // (Only check runs whose notes start with "synthetic backfill" — new runs
  // produced by the reprocess CLI will have different notes and don't follow
  // these rules.)
  const synthRuns = await db
    .select()
    .from(ocrDecoderRuns)
    .where(sql`${ocrDecoderRuns.notes} LIKE 'synthetic backfill%'`)

  for (const run of synthRuns) {
    // Compute expected provenance from the run's OWN batches (run_id scope),
    // not match-wide — later reprocess runs own their own batches.
    const batches = await db
      .select({
        videoSha256: ocrCaptureBatches.videoSha256,
      })
      .from(ocrCaptureBatches)
      .where(eq(ocrCaptureBatches.runId, run.id))
    const distinctShas = new Set(
      batches.map((b) => b.videoSha256).filter((s): s is string => s !== null),
    )
    const hasManual = batches.some((b) => b.videoSha256 === null)

    const expectedShaSet = distinctShas.size === 1 && !hasManual
    const expectedSha = expectedShaSet ? Array.from(distinctShas)[0]! : null

    assert.equal(
      run.videoSha256,
      expectedSha,
      `run ${run.id} (match ${run.matchId}): video_sha256 expected ${expectedSha === null ? 'NULL' : expectedSha.slice(0, 12) + '…'}, got ${
        run.videoSha256 === null ? 'NULL' : run.videoSha256.slice(0, 12) + '…'
      } (distinctShas=${distinctShas.size}, hasManual=${hasManual})`,
    )
  }
})

void test('backfill decoder provenance: single-decoder matches keep value; multi-decoder gets legacy-mixed', async () => {
  if (!process.env['DATABASE_URL']) return

  const synthRuns = await db
    .select()
    .from(ocrDecoderRuns)
    .where(sql`${ocrDecoderRuns.notes} LIKE 'synthetic backfill%'`)

  for (const run of synthRuns) {
    // Run-scoped: a synthetic run's decoder_version describes the segments it
    // owns (run_id), not every segment the match accumulated across later runs.
    const segDecoders = await db
      .select({ decoderVersion: ocrSegments.decoderVersion })
      .from(ocrSegments)
      .where(eq(ocrSegments.runId, run.id))
      .groupBy(ocrSegments.decoderVersion)
    const distinctDecoders = new Set(segDecoders.map((r) => r.decoderVersion))
    distinctDecoders.delete(null as unknown as string)

    if (distinctDecoders.size === 0) {
      // Match has no segments at all — backfill should have used 'unknown'.
      assert.equal(
        run.decoderVersion,
        'unknown',
        `run ${run.id}: no segments → decoder_version should be 'unknown', got ${run.decoderVersion}`,
      )
    } else if (distinctDecoders.size === 1) {
      const expected = Array.from(distinctDecoders)[0]!
      assert.equal(
        run.decoderVersion,
        expected,
        `run ${run.id} (match ${run.matchId}): single decoder ${expected} → run.decoder_version should match, got ${run.decoderVersion}`,
      )
    } else {
      assert.equal(
        run.decoderVersion,
        'legacy-mixed',
        `run ${run.id} (match ${run.matchId}): multiple decoders [${Array.from(distinctDecoders).join(', ')}] → run.decoder_version should be 'legacy-mixed', got ${run.decoderVersion}`,
      )
    }
  }
})

void test('multi-source provenance is honestly disclosed in notes (not silently collapsed)', async () => {
  if (!process.env['DATABASE_URL']) return

  // For runs where video_sha256 IS NULL OR decoder_version='legacy-mixed', the
  // notes must include a marker that says provenance is multi-source — not
  // silently hide it behind an arbitrary sha.
  const multiSourceRuns = await db
    .select()
    .from(ocrDecoderRuns)
    .where(
      and(
        sql`${ocrDecoderRuns.notes} LIKE 'synthetic backfill%'`,
        sql`(${ocrDecoderRuns.videoSha256} IS NULL OR ${ocrDecoderRuns.decoderVersion} = 'legacy-mixed')`,
      ),
    )

  for (const run of multiSourceRuns) {
    const notes = run.notes ?? ''
    // The notes should reference videos= and decoders= explicitly so an
    // operator inspecting a NULL-sha or legacy-mixed run can see WHY.
    assert.match(
      notes,
      /videos=\[/,
      `run ${run.id} (match ${run.matchId}): notes should include videos=[…], got: ${notes}`,
    )
    assert.match(
      notes,
      /decoders=\[/,
      `run ${run.id} (match ${run.matchId}): notes should include decoders=[…], got: ${notes}`,
    )
  }
})
