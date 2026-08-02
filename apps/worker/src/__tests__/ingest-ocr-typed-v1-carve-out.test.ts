/**
 * Workstream W1 unit tests: the typed-v1 carve-out helpers in
 * `ingest-ocr.ts`.
 *
 * `isTypedV1CarveOut` decides whether `ingestOcrBatch` skips the legacy
 * `runOcrCli` subprocess. `synthesizeTypedV1Stub` produces the single
 * stub `OcrResult` that flows through the rest of the persist pipeline
 * for those segments. Both are pure functions; no DB connection needed.
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build && \
 *   node --test apps/worker/dist/__tests__/ingest-ocr-typed-v1-carve-out.test.js
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { isTypedV1CarveOut, synthesizeTypedV1Stub } from '../ingest-ocr.js'

describe('isTypedV1CarveOut', () => {
  test('typed_v1 loadout segment with frameCount → true', () => {
    const out = isTypedV1CarveOut('player_loadout_view', 'typed_v1', 'legacy', 15)
    assert.equal(out, true)
  })

  test('typed_v1 lobby segment with frameCount → true', () => {
    const out = isTypedV1CarveOut('pre_game_lobby_state_2', 'legacy', 'typed_v1', 8)
    assert.equal(out, true)
  })

  test('typed_v1 loadout segment WITHOUT frameCount → false (cannot carve out without a count)', () => {
    assert.equal(isTypedV1CarveOut('player_loadout_view', 'typed_v1', 'legacy', null), false)
    assert.equal(isTypedV1CarveOut('player_loadout_view', 'typed_v1', 'legacy', undefined), false)
  })

  test('legacy loadout engine → false even with frameCount', () => {
    assert.equal(isTypedV1CarveOut('player_loadout_view', 'legacy', 'legacy', 15), false)
  })

  test('typed_v1 loadout engine on a non-loadout screen type → false', () => {
    // The flag is global but the carve-out only fires when the screen
    // type and engine match the same modality. A post_game_box_score_goals
    // segment with loadoutEngine=typed_v1 (a no-op flag for that screen)
    // must still run the legacy CLI.
    assert.equal(isTypedV1CarveOut('post_game_box_score_goals', 'typed_v1', 'legacy', 15), false)
  })

  test('typed_v1 lobby engine on a non-lobby screen type → false', () => {
    assert.equal(isTypedV1CarveOut('post_game_action_tracker', 'legacy', 'typed_v1', 15), false)
  })

  test('frameCount=0 still triggers carve-out (zero is a valid count, not "missing")', () => {
    // 0 frames is unusual but legitimate (e.g., a pathological segment).
    // The carve-out should still fire; the downstream segment row will
    // have frameCount=0 and `observabilityStatus='not_observable_from_source'`,
    // which is the correct observability signal.
    assert.equal(isTypedV1CarveOut('player_loadout_view', 'typed_v1', 'legacy', 0), true)
  })
})

describe('synthesizeTypedV1Stub', () => {
  test('produces a well-formed stub OcrResult with the documented contract', () => {
    const stub = synthesizeTypedV1Stub('player_loadout_view', 'a'.repeat(64), 7, 15)
    assert.equal(stub.meta.screen_type, 'player_loadout_view')
    assert.equal(stub.meta.ocr_backend, 'typed_v1_summary')
    assert.equal(stub.meta.overall_confidence, null)
    assert.equal(stub.meta.duplicate_of, null)
    assert.equal(stub.success, true)
    assert.deepEqual(stub.errors, [])
    assert.deepEqual(stub.warnings, [])
    // Schema NOT NULL: source_path must be a non-empty string.
    assert.equal(typeof stub.meta.source_path, 'string')
    assert.ok(stub.meta.source_path.length > 0)
  })

  test('source_path embeds video-sha prefix + zero-padded segment index when both present', () => {
    const stub = synthesizeTypedV1Stub('player_loadout_view', 'a'.repeat(64), 7, 15)
    assert.match(stub.meta.source_path, /^<typed_v1:summary:vsha-a{12}:seg0007>$/)
  })

  test('source_path falls back to batch tag when video metadata is absent', () => {
    const stub = synthesizeTypedV1Stub('pre_game_lobby_state_2', null, null, 8)
    assert.match(stub.meta.source_path, /^<typed_v1:summary:batch:pre_game_lobby_state_2>$/)
  })

  test('typed_v1_summary blob records the frame count', () => {
    const stub = synthesizeTypedV1Stub('player_loadout_view', 'b'.repeat(64), 3, 22)
    assert.deepEqual(stub.typed_v1_summary, { frame_count: 22 })
  })

  test('processed_at is a parseable ISO timestamp', () => {
    const stub = synthesizeTypedV1Stub('player_loadout_view', null, null, 1)
    const parsed = new Date(stub.meta.processed_at)
    assert.equal(Number.isFinite(parsed.getTime()), true)
  })
})
