/**
 * G0.2 — serializeConsolidatedSurface shape test.
 *
 * Reads the committed REVIEWED canonical surface for the pilot match 250 (the
 * test-DB clone carries it) and asserts the emitted records match the benchmark
 * record shape the Python scorer consumes. Read-only — no rows are written, so
 * this is safe against the live dev DB as well as the clone.
 *
 * Run via the full suite (`node scripts/with-test-db.mjs`) or standalone:
 *   pnpm --filter @eanhl/worker build && set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/serialize-consolidated-surface.test.js
 */

import { describe, test, after } from 'node:test'
import assert from 'node:assert/strict'
import { db, sql } from '@eanhl/db'
import { serializeConsolidatedSurface } from '../lib/serialize-consolidated-surface.js'

const MATCH_ID = 250

// The exact scalar field_keys the scorer reads (report.py SCALAR_FIELDS evidence
// keys) plus the is_captain bool. Every subject must carry exactly one of each.
const SCALAR_KEYS = [
  'gamertag',
  'persona_raw',
  'jersey_number',
  'player_level_raw',
  'position',
  'build_class',
  'handedness',
  'is_captain',
] as const

const VALID_TIERS = new Set(['Elite', 'All Star', 'Specialist'])

function isKnownFieldKey(fieldKey: string): boolean {
  if ((SCALAR_KEYS as readonly string[]).includes(fieldKey)) return true
  if (/^x_factor_name_\d+$/.test(fieldKey)) return true
  if (/^x_factor_tier_\d+$/.test(fieldKey)) return true
  if (/^attribute_.+_value$/.test(fieldKey)) return true
  if (/^attribute_.+_delta$/.test(fieldKey)) return true
  return false
}

after(async () => {
  if (!process.env['DATABASE_URL']) return
  await sql.end({ timeout: 5 })
})

describe('serializeConsolidatedSurface — benchmark record shape (match 250)', () => {
  test('emits records for the reviewed canonical surface', async () => {
    if (!process.env['DATABASE_URL']) return
    const records = await serializeConsolidatedSurface(MATCH_ID, db)

    assert.ok(records.length > 0, 'expected a non-empty surface for match 250')

    // Group by synthetic subject key.
    const bySubject = new Map<string, typeof records>()
    for (const r of records) {
      const arr = bySubject.get(r.subject_slot_key) ?? []
      arr.push(r)
      bySubject.set(r.subject_slot_key, arr)
    }

    // Match 250 has 5 BGM + 5 OPP human skaters (goalies are CPU → excluded).
    assert.equal(bySubject.size, 10, `expected 10 reviewed subjects, got ${bySubject.size}`)
  })

  test('every record carries the full benchmark shape with correct types', async () => {
    if (!process.env['DATABASE_URL']) return
    const records = await serializeConsolidatedSurface(MATCH_ID, db)

    for (const r of records) {
      assert.equal(r.candidate_rank, 0, `candidate_rank must be 0, got ${r.candidate_rank}`)
      assert.equal(r.raw_confidence, 1, `raw_confidence must be 1, got ${r.raw_confidence}`)
      assert.equal(typeof r.field_key, 'string')
      assert.ok(isKnownFieldKey(r.field_key), `unknown field_key: ${r.field_key}`)
      assert.equal(
        r.subject_slot_key,
        `${r.team_side}_${r.position}`,
        'subject_slot_key must be `${team_side}_${position}` (content-stable, no row id)',
      )
      assert.ok(
        r.team_side === 'for' || r.team_side === 'against',
        `team_side must be for/against, got ${r.team_side}`,
      )
      const v = r.candidate_value
      assert.ok(
        v === null || ['string', 'number', 'boolean'].includes(typeof v),
        `candidate_value must be scalar|null, got ${typeof v} for ${r.field_key}`,
      )
    }
  })

  test('each subject has exactly one of every scalar field + a non-empty gamertag', async () => {
    if (!process.env['DATABASE_URL']) return
    const records = await serializeConsolidatedSurface(MATCH_ID, db)

    const bySubject = new Map<string, typeof records>()
    for (const r of records) {
      const arr = bySubject.get(r.subject_slot_key) ?? []
      arr.push(r)
      bySubject.set(r.subject_slot_key, arr)
    }

    for (const [slot, subjectRecords] of bySubject) {
      for (const key of SCALAR_KEYS) {
        const hits = subjectRecords.filter((r) => r.field_key === key)
        assert.equal(hits.length, 1, `subject ${slot} must have exactly one '${key}' record`)
      }
      const gamertag = subjectRecords.find((r) => r.field_key === 'gamertag')!.candidate_value
      assert.equal(typeof gamertag, 'string', `subject ${slot} gamertag must be a string`)
      assert.ok((gamertag as string).length > 0, `subject ${slot} gamertag must be non-empty`)
    }
  })

  test('x_factor tiers are valid enums and at most one captain per team_side', async () => {
    if (!process.env['DATABASE_URL']) return
    const records = await serializeConsolidatedSurface(MATCH_ID, db)

    for (const r of records) {
      if (/^x_factor_tier_\d+$/.test(r.field_key) && r.candidate_value !== null) {
        assert.ok(
          VALID_TIERS.has(r.candidate_value as string),
          `invalid x_factor tier: ${r.candidate_value}`,
        )
      }
    }

    // Domain invariant that survives the G2 re-ingest: one room-leader per side.
    for (const side of ['for', 'against'] as const) {
      const captains = records.filter(
        (r) => r.team_side === side && r.field_key === 'is_captain' && r.candidate_value === true,
      )
      assert.ok(
        captains.length <= 1,
        `at most one captain on the ${side} side, got ${captains.length}`,
      )
    }
  })

  test('child tables are joined — at least one X-Factor and one attribute value present', async () => {
    if (!process.env['DATABASE_URL']) return
    const records = await serializeConsolidatedSurface(MATCH_ID, db)

    assert.ok(
      records.some((r) => r.field_key === 'x_factor_name_0'),
      'expected at least one x_factor_name_0 record (X-Factor child join)',
    )
    assert.ok(
      records.some((r) => /^attribute_.+_value$/.test(r.field_key)),
      'expected at least one attribute value record (attribute child join)',
    )
  })
})
