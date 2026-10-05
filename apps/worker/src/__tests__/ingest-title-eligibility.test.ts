/**
 * Worker polling consults ingestion eligibility (`game_titles.is_active`) only.
 *
 * Asserts the WHERE predicate of the poll query, compiled without a
 * connection — the frontend default (`is_default`) and chronology
 * (`release_order`) must never decide what the worker polls.
 *
 * `../ingest.js` reaches the db client, which throws at import time without
 * DATABASE_URL; a closed-port placeholder is set unconditionally and never
 * dialled (`toSQL()` does not connect).
 *
 * Run:
 *   pnpm --filter @eanhl/worker build && \
 *   node --test apps/worker/dist/__tests__/ingest-title-eligibility.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL = 'postgresql://ingest-title-eligibility-test:unused@127.0.0.1:1/unused'

const { selectIngestionEligibleTitles } = await import('../ingest.js')

void test('the poll filter is exactly is_active = true', () => {
  const { sql, params } = selectIngestionEligibleTitles().toSQL()
  const where = /\swhere\s(.+)$/is.exec(sql)?.[1]
  assert.equal(where, '"game_titles"."is_active" = $1')
  assert.deepEqual(params, [true])
})
