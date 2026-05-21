/**
 * Task 2A-20: Fixture loader for loadout OCR acceptance tests.
 *
 * Parses the Phase 2A-19 fixture directories into typed shapes:
 *   - fixture_match250_full_lobby  → 2 segments (seg_bgm + seg_opp)
 *   - fixture_match463_single_slot → 1 segment (root-level evidence JSON)
 *   - fixture_synthetic_degraded   → 1 pseudo-segment (degraded_evidence.json)
 *
 * Used by Task 2A-21 through 2A-24 acceptance tests.
 */

import fs from 'node:fs'
import path from 'node:path'

// Resolved at module load time. In compiled ESM, import.meta.dirname points to
// apps/worker/dist/__tests__/fixtures/. The fixture root lives at
// tools/game_ocr/calibration/extras/loadout/fixtures/ from the repo root.
// From dist/__tests__/fixtures/ we go up 5 levels to the repo root.
const FIXTURE_ROOT = path.resolve(
  import.meta.dirname ?? '.',
  '../../../../../tools/game_ocr/calibration/extras/loadout/fixtures',
)

export type FixtureName =
  | 'fixture_match250_full_lobby'
  | 'fixture_match463_single_slot'
  | 'fixture_synthetic_degraded'

export type SentinelMatchId = 9001 | 9002 | 9003

export const SENTINEL_MATCH_IDS: Record<FixtureName, SentinelMatchId> = {
  fixture_match250_full_lobby: 9001,
  fixture_match463_single_slot: 9002,
  fixture_synthetic_degraded: 9003,
}

/** Matches the LoadoutEvidenceRecord interface from apps/worker/src/ingest-ocr.ts */
export interface LoadoutEvidenceRecord {
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

export interface FixtureSegment {
  /** Synthetic segment_key for the fixture row in ocr_segments. */
  segmentKey: string
  /** Absolute path to the fixture segment directory. */
  dir: string
  /** Parsed evidence records from the JSON file in this segment. */
  expectedEvidence: LoadoutEvidenceRecord[]
}

export interface LoadedFixture {
  name: FixtureName
  sentinelMatchId: SentinelMatchId
  segments: FixtureSegment[]
  /** Absolute path to the expected_canonical.sql (or degraded_canonical.sql). */
  expectedCanonicalSqlPath: string
  /** Absolute path to expected_observability_blocks.sql (match463 only). */
  expectedObservabilityBlocksSqlPath?: string
  /** Absolute path to expected_roster_seed.sql (match463 only). */
  expectedRosterSeedSqlPath?: string
}

// ── helpers ──────────────────────────────────────────────────────────────────

function readEvidenceJson(filePath: string): LoadoutEvidenceRecord[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Evidence JSON not found: ${filePath}`)
  }
  const raw = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(raw) as LoadoutEvidenceRecord[]
}

function optionalPath(filePath: string): string | undefined {
  return fs.existsSync(filePath) ? filePath : undefined
}

// ── loader ────────────────────────────────────────────────────────────────────

/**
 * Load a named fixture from disk.
 *
 * Handles the three structural variants:
 * - match250: TWO segments at seg_bgm/ + seg_opp/
 * - match463: ONE segment (evidence JSON at fixture root)
 * - synthetic_degraded: ONE pseudo-segment (degraded_evidence.json at fixture root)
 */
export function loadFixture(name: FixtureName): LoadedFixture {
  const fixtureDir = path.join(FIXTURE_ROOT, name)
  if (!fs.existsSync(fixtureDir)) {
    throw new Error(`Fixture directory not found: ${fixtureDir}`)
  }

  const sentinelMatchId = SENTINEL_MATCH_IDS[name]

  switch (name) {
    case 'fixture_match250_full_lobby': {
      const segBgmDir = path.join(fixtureDir, 'seg_bgm')
      const segOppDir = path.join(fixtureDir, 'seg_opp')
      const segments: FixtureSegment[] = [
        {
          segmentKey: 'fixture-seg-bgm',
          dir: segBgmDir,
          expectedEvidence: readEvidenceJson(
            path.join(segBgmDir, 'expected_loadout_evidence.json'),
          ),
        },
        {
          segmentKey: 'fixture-seg-opp',
          dir: segOppDir,
          expectedEvidence: readEvidenceJson(
            path.join(segOppDir, 'expected_loadout_evidence.json'),
          ),
        },
      ]
      const result250: LoadedFixture = {
        name,
        sentinelMatchId,
        segments,
        expectedCanonicalSqlPath: path.join(fixtureDir, 'expected_canonical.sql'),
      }
      const obsBlocks250 = optionalPath(path.join(fixtureDir, 'expected_observability_blocks.sql'))
      if (obsBlocks250) result250.expectedObservabilityBlocksSqlPath = obsBlocks250
      const rosterSeed250 = optionalPath(path.join(fixtureDir, 'expected_roster_seed.sql'))
      if (rosterSeed250) result250.expectedRosterSeedSqlPath = rosterSeed250
      return result250
    }

    case 'fixture_match463_single_slot': {
      const segments: FixtureSegment[] = [
        {
          segmentKey: 'fixture-seg-1',
          dir: fixtureDir,
          expectedEvidence: readEvidenceJson(
            path.join(fixtureDir, 'expected_loadout_evidence.json'),
          ),
        },
      ]
      const result463: LoadedFixture = {
        name,
        sentinelMatchId,
        segments,
        expectedCanonicalSqlPath: path.join(fixtureDir, 'expected_canonical.sql'),
      }
      const obsBlocks463 = optionalPath(path.join(fixtureDir, 'expected_observability_blocks.sql'))
      if (obsBlocks463) result463.expectedObservabilityBlocksSqlPath = obsBlocks463
      const rosterSeed463 = optionalPath(path.join(fixtureDir, 'expected_roster_seed.sql'))
      if (rosterSeed463) result463.expectedRosterSeedSqlPath = rosterSeed463
      return result463
    }

    case 'fixture_synthetic_degraded': {
      const segments: FixtureSegment[] = [
        {
          segmentKey: 'fixture-seg-degraded',
          dir: fixtureDir,
          expectedEvidence: readEvidenceJson(
            path.join(fixtureDir, 'degraded_evidence.json'),
          ),
        },
      ]
      // degraded_canonical.sql, not expected_canonical.sql
      const resultDegraded: LoadedFixture = {
        name,
        sentinelMatchId,
        segments,
        expectedCanonicalSqlPath: path.join(fixtureDir, 'degraded_canonical.sql'),
      }
      const obsBlocksDeg = optionalPath(
        path.join(fixtureDir, 'expected_observability_blocks.sql'),
      )
      if (obsBlocksDeg) resultDegraded.expectedObservabilityBlocksSqlPath = obsBlocksDeg
      const rosterSeedDeg = optionalPath(path.join(fixtureDir, 'expected_roster_seed.sql'))
      if (rosterSeedDeg) resultDegraded.expectedRosterSeedSqlPath = rosterSeedDeg
      return resultDegraded
    }
  }
}
