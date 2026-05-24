/**
 * Task 2A-20: Smoke tests for the fixture loader + DB seeder.
 *
 * The loader tests are pure file-system (no DB needed).
 * The seeder tests require DATABASE_URL and are skipped gracefully when absent.
 *
 * Run via:
 *   pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/fixtures/fixture-loader.test.js 2>&1 | tail -20
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { loadFixture, SENTINEL_MATCH_IDS } from './loadout-fixture-loader.js'
import { seedFixtureDb, cleanupSentinelMatches, sql } from './seed-fixture-db.js'

// ── loadFixture ───────────────────────────────────────────────────────────────

describe('loadFixture', () => {
  test('loads match250 fixture with 2 segments (305 + 305 records)', () => {
    const fixture = loadFixture('fixture_match250_full_lobby')
    assert.equal(fixture.segments.length, 2, '2 segments: seg_bgm and seg_opp')
    assert.equal(fixture.segments[0]?.expectedEvidence.length, 305, 'seg_bgm has 305 records')
    assert.equal(fixture.segments[1]?.expectedEvidence.length, 305, 'seg_opp has 305 records')
    assert.equal(fixture.sentinelMatchId, 9001, 'sentinel match ID is 9001')
    assert.equal(SENTINEL_MATCH_IDS['fixture_match250_full_lobby'], 9001)
    // Segment keys
    assert.equal(fixture.segments[0]?.segmentKey, 'fixture-seg-bgm')
    assert.equal(fixture.segments[1]?.segmentKey, 'fixture-seg-opp')
    // canonical SQL path exists
    assert.ok(fixture.expectedCanonicalSqlPath.endsWith('expected_canonical.sql'))
    // No roster seed for match250
    assert.equal(fixture.expectedRosterSeedSqlPath, undefined)
  })

  test('loads match463 fixture with 1 segment (61 records)', () => {
    const fixture = loadFixture('fixture_match463_single_slot')
    assert.equal(fixture.segments.length, 1, '1 segment at fixture root')
    assert.equal(fixture.segments[0]?.expectedEvidence.length, 61, '61 records')
    assert.equal(fixture.sentinelMatchId, 9002, 'sentinel match ID is 9002')
    assert.equal(SENTINEL_MATCH_IDS['fixture_match463_single_slot'], 9002)
    assert.equal(fixture.segments[0]?.segmentKey, 'fixture-seg-1')
    // match463 has expected_roster_seed.sql
    assert.ok(
      typeof fixture.expectedRosterSeedSqlPath === 'string',
      'expectedRosterSeedSqlPath is present for match463',
    )
    // match463 has expected_observability_blocks.sql
    assert.ok(
      typeof fixture.expectedObservabilityBlocksSqlPath === 'string',
      'expectedObservabilityBlocksSqlPath is present for match463',
    )
  })

  test('loads synthetic_degraded fixture with 1 segment (85 records)', () => {
    const fixture = loadFixture('fixture_synthetic_degraded')
    assert.equal(fixture.segments.length, 1, '1 pseudo-segment')
    assert.equal(
      fixture.segments[0]?.expectedEvidence.length,
      85,
      '85 records in degraded_evidence.json',
    )
    assert.equal(fixture.sentinelMatchId, 9003, 'sentinel match ID is 9003')
    assert.equal(SENTINEL_MATCH_IDS['fixture_synthetic_degraded'], 9003)
    assert.equal(fixture.segments[0]?.segmentKey, 'fixture-seg-degraded')
    // canonical file is degraded_canonical.sql
    assert.ok(fixture.expectedCanonicalSqlPath.endsWith('degraded_canonical.sql'))
  })

  test('evidence records have expected shape', () => {
    const fixture = loadFixture('fixture_match463_single_slot')
    const rec = fixture.segments[0]?.expectedEvidence[0]
    assert.ok(rec, 'first record exists')
    assert.equal(typeof rec.screen_state, 'string')
    assert.equal(typeof rec.field_key, 'string')
    assert.equal(typeof rec.field_family, 'string')
    assert.equal(typeof rec.candidate_rank, 'number')
    assert.equal(typeof rec.raw_confidence, 'number')
    assert.equal(typeof rec.calibrated_confidence, 'number')
    assert.ok(Array.isArray(rec.support_frame_ids))
  })

  test('throws for unknown fixture name', () => {
    assert.throws(
      // @ts-expect-error intentionally wrong name
      () => loadFixture('fixture_does_not_exist'),
      /Fixture directory not found/,
    )
  })
})

// ── seedFixtureDb ─────────────────────────────────────────────────────────────

describe('seedFixtureDb', () => {
  // Track inserted sentinel IDs for cleanup in after().
  const seededMatchIds: number[] = []

  before(async () => {
    if (!process.env['DATABASE_URL']) return
    // Pre-clean any stale rows from prior interrupted runs.
    await cleanupSentinelMatches([9001, 9002, 9003])
  })

  after(async () => {
    if (!process.env['DATABASE_URL']) return
    await cleanupSentinelMatches(seededMatchIds)
    await sql.end()
  })

  test('seeds a sentinel match for synthetic_degraded without errors', async () => {
    if (!process.env['DATABASE_URL']) return

    const fixture = loadFixture('fixture_synthetic_degraded')
    const result = await seedFixtureDb(fixture)

    seededMatchIds.push(result.matchId)

    assert.equal(result.matchId, 9003, 'matchId is 9003')
    assert.equal(result.segmentIds.length, 1, '1 segment seeded')
    assert.equal(result.batchIds.length, 1, '1 batch seeded')
    assert.equal(result.extractionIds.length, 1, '1 extraction seeded')
    assert.ok(typeof result.segmentIds[0] === 'number' && result.segmentIds[0] > 0)
  })

  test('seeds a sentinel match for match463 without errors', async () => {
    if (!process.env['DATABASE_URL']) return

    const fixture = loadFixture('fixture_match463_single_slot')
    const result = await seedFixtureDb(fixture)

    seededMatchIds.push(result.matchId)

    assert.equal(result.matchId, 9002, 'matchId is 9002')
    assert.equal(result.segmentIds.length, 1, '1 segment')
    assert.ok(typeof result.segmentIds[0] === 'number' && result.segmentIds[0] > 0)
  })

  test('seeds a sentinel match for match250 without errors', async () => {
    if (!process.env['DATABASE_URL']) return

    const fixture = loadFixture('fixture_match250_full_lobby')
    const result = await seedFixtureDb(fixture)

    seededMatchIds.push(result.matchId)

    assert.equal(result.matchId, 9001, 'matchId is 9001')
    assert.equal(result.segmentIds.length, 2, '2 segments')
    assert.equal(result.batchIds.length, 2, '2 batches')
    assert.equal(result.extractionIds.length, 2, '2 extractions')
  })

  test('re-running seedFixtureDb cleans prior sentinel rows (idempotent)', async () => {
    if (!process.env['DATABASE_URL']) return

    const fixture = loadFixture('fixture_synthetic_degraded')
    await seedFixtureDb(fixture)
    // Second call should not throw from duplicate-key violations.
    const result = await seedFixtureDb(fixture)

    assert.equal(result.matchId, 9003)
    assert.equal(result.segmentIds.length, 1)
  })
})
