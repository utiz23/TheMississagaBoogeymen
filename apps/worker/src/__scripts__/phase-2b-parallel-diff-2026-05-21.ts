/**
 * Phase 2B-7: Evidence seeder for parallel-diff inspection.
 *
 * Reads loadout_evidence.json from the typed_v1 pipeline output for matches
 * 250 and 463, inserts ocr_field_evidence rows referencing the existing
 * ocr_segments rows (segment_key = 'vsha-*:seg0002'), and prints a summary.
 *
 * This is a READ-ONLY operation with respect to canonical tables —
 * player_loadout_snapshots is NEVER written by this script.
 *
 * After running this script, use:
 *   pnpm --filter worker repromote-loadout -- --match 250 --dry-run
 *   pnpm --filter worker repromote-loadout -- --match 463 --dry-run
 *
 * Idempotent: clears any existing ocr_field_evidence rows for the two
 * matches before inserting (safe to re-run).
 *
 * Match-specific constants (found by querying DB):
 *   Match 250: segment_id=96, extraction_id_base=1879 (frame N → ID 1879+N)
 *   Match 463: segment_id=165, extraction_id_base=4446 (frame N → ID 4446+N)
 */

import fs from 'node:fs'
import { eq, sql as drizzleSql, and } from 'drizzle-orm'
import { db, sql as pgSql, ocrFieldEvidence, type NewOcrFieldEvidence } from '@eanhl/db'

// ── match-specific constants ────────────────────────────────────────────────

const MATCH_250_EVIDENCE_PATH =
  '/tmp/typed-v1-match250/a55b2ebfd01fc51e5ab825b779357b1367ed904c081558e79bc2903cb49f6088/pass2/seg-002-player_loadout_view/loadout_evidence.json'
const MATCH_463_EVIDENCE_PATH =
  '/tmp/typed-v1-match463/3ceb8d37da1ac80561058b7138fafb85b2d950d1b79b00dab5f45347a15d32fd/pass2/seg-002-player_loadout_view/loadout_evidence.json'

interface MatchConfig {
  matchId: number
  segmentId: number
  /** extraction_id = extractionIdBase + frameIndex (1-based frame number) */
  extractionIdBase: number
  evidencePath: string
}

const MATCH_CONFIGS: MatchConfig[] = [
  {
    matchId: 250,
    segmentId: 96, // ocr_segments.id for vsha-a55b2ebfd01f:seg0002
    extractionIdBase: 1879, // frame 1 → 1880, frame 2 → 1881, …
    evidencePath: MATCH_250_EVIDENCE_PATH,
  },
  {
    matchId: 463,
    segmentId: 165, // ocr_segments.id for vsha-3ceb8d37da1a:seg0002
    extractionIdBase: 4446, // frame 1 → 4447, frame 2 → 4448, …
    evidencePath: MATCH_463_EVIDENCE_PATH,
  },
]

// ── typed_v1 evidence record shape ──────────────────────────────────────────

interface EvidenceRecord {
  screen_state: string
  field_key: string
  field_family: string
  candidate_value: unknown
  candidate_rank: number
  raw_confidence: number
  calibrated_confidence: number
  extractor_family: string
  extractor_version: string
  observability_status: string
  normalization_status: string
  screen_instance_key?: string | null
  subject_slot_key?: string | null
  support_frame_ids: number[]
  roi_bbox?: { x: number; y: number; w: number; h: number } | null
  template_version?: string | null
  row_key?: string | null
  column_key?: string | null
  x_norm?: number | null
  y_norm?: number | null
  shape_or_icon_class?: string | null
}

// ── helpers ─────────────────────────────────────────────────────────────────

function clamp54(v: number): string {
  // numeric(5,4) max is 9.9999; clamp to 1.0000 for confidence = 1.0
  const clamped = Math.min(v, 9.9999)
  return clamped.toFixed(4)
}

function clamp64(v: number | null | undefined): string | null {
  if (v == null) return null
  return Math.min(v, 9.9999).toFixed(4)
}

function mapFrameIdsToExtractionIds(
  frameIds: number[],
  extractionIdBase: number,
): number[] {
  return frameIds.map((fid) => extractionIdBase + fid)
}

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Phase 2B-7: Evidence seeder for parallel-diff inspection')
  console.log('=========================================================')

  for (const cfg of MATCH_CONFIGS) {
    console.log(`\n── Match ${String(cfg.matchId)} ─────────────────────────────────────────`)

    // Read evidence JSON
    if (!fs.existsSync(cfg.evidencePath)) {
      console.error(`ERROR: Evidence file not found: ${cfg.evidencePath}`)
      process.exit(1)
    }
    const raw = fs.readFileSync(cfg.evidencePath, 'utf-8')
    const records = JSON.parse(raw) as EvidenceRecord[]
    console.log(`Loaded ${String(records.length)} evidence records from disk`)

    // Clear existing ocr_field_evidence for this match (idempotency)
    const deleted = await db
      .delete(ocrFieldEvidence)
      .where(eq(ocrFieldEvidence.matchId, cfg.matchId))
      .returning({ id: ocrFieldEvidence.id })
    console.log(`Cleared ${String(deleted.length)} existing ocr_field_evidence rows for match ${String(cfg.matchId)}`)

    // Build insert rows
    const rows: NewOcrFieldEvidence[] = records.map((rec): NewOcrFieldEvidence => {
      const mappedFrameIds = mapFrameIdsToExtractionIds(
        rec.support_frame_ids ?? [],
        cfg.extractionIdBase,
      )

      return {
        matchId: cfg.matchId,
        segmentId: cfg.segmentId,
        screenState: rec.screen_state as NewOcrFieldEvidence['screenState'],
        screenInstanceKey: rec.screen_instance_key ?? null,
        subjectSlotKey: rec.subject_slot_key ?? null,
        fieldKey: rec.field_key,
        fieldFamily: rec.field_family as NewOcrFieldEvidence['fieldFamily'],
        candidateValue: rec.candidate_value as NewOcrFieldEvidence['candidateValue'],
        candidateRank: rec.candidate_rank,
        rawConfidence: clamp54(rec.raw_confidence),
        calibratedConfidence: clamp54(rec.calibrated_confidence),
        supportFrameIds: mappedFrameIds,
        roiBbox: (rec.roi_bbox ?? null) as NewOcrFieldEvidence['roiBbox'],
        templateVersion: rec.template_version ?? null,
        extractorFamily: rec.extractor_family as NewOcrFieldEvidence['extractorFamily'],
        extractorVersion: rec.extractor_version,
        observabilityStatus: rec.observability_status as NewOcrFieldEvidence['observabilityStatus'],
        normalizationStatus: rec.normalization_status as NewOcrFieldEvidence['normalizationStatus'],
        rowKey: rec.row_key ?? null,
        columnKey: rec.column_key ?? null,
        xNorm: clamp64(rec.x_norm),
        yNorm: clamp64(rec.y_norm),
        shapeOrIconClass: rec.shape_or_icon_class ?? null,
      }
    })

    // Batch insert (split into chunks of 200 to avoid parameter limits)
    const CHUNK_SIZE = 200
    let inserted = 0
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE)
      await db.insert(ocrFieldEvidence).values(chunk)
      inserted += chunk.length
    }
    console.log(`Inserted ${String(inserted)} ocr_field_evidence rows for match ${String(cfg.matchId)}`)

    // Verify
    const verifyResult = await db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(ocrFieldEvidence)
      .where(and(
        eq(ocrFieldEvidence.matchId, cfg.matchId),
        eq(ocrFieldEvidence.screenState, 'player_loadout_view'),
      ))
    const count = verifyResult[0]?.count ?? 0
    console.log(`Verified: ${String(count)} player_loadout_view rows in DB for match ${String(cfg.matchId)}`)
  }

  console.log('\n=========================================================')
  console.log('Seeding complete. Next steps:')
  console.log('  pnpm --filter worker repromote-loadout -- --match 250 --dry-run')
  console.log('  pnpm --filter worker repromote-loadout -- --match 463 --dry-run')
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
  .finally(() => {
    void pgSql.end()
  })
