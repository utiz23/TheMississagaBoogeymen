/**
 * Phase 1 acceptance gate: ocr_segments rows tagged by decoder_version distinguish
 * the new HMM/Viterbi path from the legacy run-length passthrough.
 *
 * The first test is "tags well-formed" — every row's decoder_version starts with
 * one of two known prefixes. Defensive against typo'd tags leaking into the table.
 *
 * The second test ("hmm rows exist") is `test.skip` until Task 14 re-ingests match
 * 250 through the HMM path. Task 14 will flip this to `test(...)` so the gate
 * becomes active.
 *
 * Skips when DATABASE_URL is unset (unit-test mode).
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { sql as postgresSql, db, ocrSegments } from '@eanhl/db'
import { eq, sql } from 'drizzle-orm'

const TEST_MATCH_ID = 250

after(async () => {
  if (process.env['DATABASE_URL']) {
    await postgresSql.end({ timeout: 1 }).catch(() => undefined)
  }
})

function skipIfNoDb(t: { skip: (msg: string) => void }): boolean {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set; skipping ocr_segments decoder_version test')
    return true
  }
  return false
}

test('ocr_segments decoder_version uses well-formed tags', async (t) => {
  if (skipIfNoDb(t)) return

  const rows = await db
    .select({
      decoderVersion: ocrSegments.decoderVersion,
      count: sql<number>`count(*)::int`,
    })
    .from(ocrSegments)
    .where(eq(ocrSegments.matchId, TEST_MATCH_ID))
    .groupBy(ocrSegments.decoderVersion)

  // No assumption about which prefix dominates — Phase 0 emitted
  // legacy-passthrough-*, Phase 1 may have HMM rows present after Task 14.
  // The test only enforces that whatever rows exist carry a recognised tag.
  const versions = rows.map((r) => r.decoderVersion)
  assert.ok(
    versions.length >= 1,
    `expected at least one ocr_segments row for match ${TEST_MATCH_ID}`,
  )
  for (const v of versions) {
    assert.ok(
      typeof v === 'string' &&
        (v.startsWith('hmm-viterbi-') || v.startsWith('legacy-passthrough-')),
      `unexpected decoder_version (${typeof v}): ${String(v)}`,
    )
  }
})

test.skip('ocr_segments distinct HMM-tagged rows exist after Phase 1 re-ingest', async (t) => {
  // Guard becomes active when Task 14 removes the `.skip`.
  if (skipIfNoDb(t)) return

  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ocrSegments)
    .where(eq(ocrSegments.decoderVersion, 'hmm-viterbi-v1'))
  assert.ok(
    (rows[0]?.count ?? 0) > 0,
    'no hmm-viterbi-v1 rows; did Phase 1 re-ingest run? (Task 14)',
  )
})
