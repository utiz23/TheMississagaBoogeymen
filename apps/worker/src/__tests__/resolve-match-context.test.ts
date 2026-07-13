/**
 * Pure arg→context resolution for `resolve-match propose` (Milestone ② step (2), A1).
 *
 * No DB: verifies the two propose modes and their required-flag errors without a
 * live decoder-run row (the whole point of extracting resolveProposeContext out
 * of the CLI entrypoint, which invokes main() on import).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveProposeContext } from '../lib/resolve-match-context.js'

void test('resolveProposeContext: run mode carries runId + optional overrides', () => {
  const ctx = resolveProposeContext([
    '--run-id',
    '42',
    '--identities',
    '/tmp/reels',
    '--video-sha256',
    'abc',
    '--game-title-id',
    '1',
  ])
  assert.equal(ctx.mode, 'run')
  if (ctx.mode !== 'run') return
  assert.equal(ctx.runId, 42)
  assert.equal(ctx.identitiesPath, '/tmp/reels')
  assert.equal(ctx.videoSha256Override, 'abc')
  assert.equal(ctx.gameTitleIdOverride, 1)
})

void test('resolveProposeContext: run mode with no overrides leaves them undefined', () => {
  const ctx = resolveProposeContext(['--run-id', '7', '--identities', '/x'])
  assert.equal(ctx.mode, 'run')
  if (ctx.mode !== 'run') return
  assert.equal(ctx.runId, 7)
  assert.equal(ctx.videoSha256Override, undefined)
  assert.equal(ctx.gameTitleIdOverride, undefined)
})

void test('resolveProposeContext: direct mode from sha + game-title, runId null', () => {
  const ctx = resolveProposeContext([
    '--identities',
    '/tmp/reels',
    '--video-sha256',
    'f0e57173',
    '--game-title-id',
    '1',
  ])
  assert.equal(ctx.mode, 'direct')
  if (ctx.mode !== 'direct') return
  assert.equal(ctx.runId, null)
  assert.equal(ctx.videoSha256, 'f0e57173')
  assert.equal(ctx.gameTitleId, 1)
  assert.equal(ctx.identitiesPath, '/tmp/reels')
})

void test('resolveProposeContext: --identities is always required', () => {
  assert.throws(() => resolveProposeContext(['--run-id', '1']), /requires --identities/)
})

void test('resolveProposeContext: direct mode requires --video-sha256', () => {
  assert.throws(
    () => resolveProposeContext(['--identities', '/x', '--game-title-id', '1']),
    /requires --video-sha256/,
  )
})

void test('resolveProposeContext: direct mode requires --game-title-id', () => {
  assert.throws(
    () => resolveProposeContext(['--identities', '/x', '--video-sha256', 'abc']),
    /requires --game-title-id/,
  )
})

void test('resolveProposeContext: rejects non-positive-integer run-id / game-title-id', () => {
  assert.throws(
    () => resolveProposeContext(['--run-id', 'nope', '--identities', '/x']),
    /--run-id must be a positive integer/,
  )
  assert.throws(
    () =>
      resolveProposeContext([
        '--identities',
        '/x',
        '--video-sha256',
        'abc',
        '--game-title-id',
        '0',
      ]),
    /--game-title-id must be a positive integer/,
  )
})
