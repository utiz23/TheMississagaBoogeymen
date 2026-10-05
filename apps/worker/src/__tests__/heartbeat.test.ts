/**
 * heartbeat.ts — the pure decision. `../heartbeat.js` reaches the db client,
 * which throws at import time without DATABASE_URL; a closed-port placeholder
 * is set and nothing here queries.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL = 'postgresql://heartbeat-test:unused@127.0.0.1:1/unused'

const { heartbeatDecision } = await import('../heartbeat.js')

void test('healthy worker with no transform errors pings success', () => {
  assert.deepEqual(heartbeatDecision({ healthStatus: 'ok', transformErrors: 0 }), {
    fail: false,
    message: 'ok',
  })
})

void test('stale or degraded health reports a failure with the health message', () => {
  const stale = heartbeatDecision({
    healthStatus: 'stale',
    healthMessage: 'No successful ingest in 30 minutes',
    transformErrors: 0,
  })
  assert.equal(stale.fail, true)
  assert.equal(stale.message, 'No successful ingest in 30 minutes')
  assert.equal(heartbeatDecision({ healthStatus: 'degraded', transformErrors: 0 }).fail, true)
})

void test('stuck transform errors report a failure even when ingestion is healthy', () => {
  const result = heartbeatDecision({ healthStatus: 'ok', transformErrors: 3 })
  assert.equal(result.fail, true)
  assert.match(result.message, /3 raw payload\(s\) failed to transform/)
})

void test('both problems are reported together', () => {
  const result = heartbeatDecision({ healthStatus: 'stale', transformErrors: 1 })
  assert.equal(result.message.split('\n').length, 2)
})
