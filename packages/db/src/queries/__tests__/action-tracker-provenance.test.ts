/**
 * Read-only assertions for getMatchActionTrackerProvenance against the canonical
 * match 250 (the only OCR-ingested match) and a guaranteed-empty match id.
 * No writes, no cleanup.
 *
 * Build + run:
 *   pnpm --filter @eanhl/db build
 *   set -a && source .env && set +a
 *   node --test packages/db/dist/queries/__tests__/action-tracker-provenance.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { getMatchActionTrackerProvenance } from '../match-events.js'

void test('match 250 has an extracted-at range and action-tracker sources', async () => {
  const p = await getMatchActionTrackerProvenance(250)
  assert.notEqual(p.extractedAt, null)
  assert.ok(p.extractedAt!.earliest instanceof Date)
  assert.ok(p.extractedAt!.latest.getTime() >= p.extractedAt!.earliest.getTime())
  assert.ok(p.sources.length > 0)
  assert.ok(p.sources.some((s) => s.screenType === 'post_game_action_tracker'))
  assert.ok(p.sources.every((s) => s.eventCount > 0))
})

void test('a match with no OCR events returns nulls', async () => {
  const p = await getMatchActionTrackerProvenance(0)
  assert.equal(p.extractedAt, null)
  assert.deepEqual(p.sources, [])
})
