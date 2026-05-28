/**
 * Task 3 — A3 reprocess CLI: decoder-runs-cli `create-candidate` subcommand.
 *
 * The CLI is a thin wrapper around DB-atomic ops on `ocr_decoder_runs`.
 * Phase-A ships `create-candidate` only — `validate`, `activate`, and
 * `undo` are stubbed out with informative errors so partial integration
 * fails loudly (Tasks 4 + 5 land the rest).
 *
 * Contract for create-candidate:
 *   - Required flags: --match-id, --decoder-version, --weights-hash, --config-hash
 *   - Optional flag : --video-sha256 (NULL when omitted)
 *   - On success    : exit 0, JSON `{"run_id": N, "is_active": false}` on stdout
 *   - On failure    : exit 1, error text on stderr
 *
 * This test spawns the CLI via `spawnSync` against the built JS so it
 * exercises the real shell-out path that the Python `video_ingest reprocess`
 * orchestrator (Task 9) will use.
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/decoder-runs-cli.test.js
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import {
  db,
  sql as rawSql,
  matches,
  ocrDecoderRuns,
} from '@eanhl/db'
import { eq, like } from 'drizzle-orm'

const GAME_TITLE_ID = 1 // NHL 26
const SENTINEL_TAG = 'A3-T3-decoder-runs-cli'

// Repo root = three levels up from apps/worker/dist/__tests__/<this file>.
// Resolve from a stable on-disk location so the test works whether
// it's invoked from the repo root or from inside apps/worker.
const REPO_ROOT = path.resolve(
  process.cwd(),
  // We rely on the canonical project root (`pnpm --filter` is invoked from there).
  // If cwd is the repo root, this is a no-op; otherwise the test should be
  // run from the repo root anyway (see header).
)

// The compiled CLI lives at apps/worker/dist/decoder-runs-cli.js. We
// invoke it via `node` directly (faster + sidesteps pnpm overhead) but
// still rely on `node_modules` resolution from repo root.
const CLI_PATH = path.resolve(REPO_ROOT, 'apps/worker/dist/decoder-runs-cli.js')

const sentinelMatchIds: Set<number> = new Set()
const sentinelRunIds: Set<number> = new Set()

async function cleanupMatch(matchId: number): Promise<void> {
  await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.matchId, matchId))
  await db.delete(matches).where(eq(matches.id, matchId))
}

async function cleanupAllSentinels(): Promise<void> {
  const staleMatches = await db
    .select({ id: matches.id })
    .from(matches)
    .where(like(matches.eaMatchId, `${SENTINEL_TAG}%`))
  for (const m of staleMatches) {
    await cleanupMatch(m.id)
  }
  sentinelMatchIds.clear()
  sentinelRunIds.clear()
}

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanupAllSentinels()
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  for (const runId of Array.from(sentinelRunIds)) {
    try {
      await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.id, runId))
    } catch {
      // ignore — match cleanup will sweep
    }
  }
  for (const matchId of Array.from(sentinelMatchIds)) {
    try {
      await cleanupMatch(matchId)
    } catch {
      // ignore — sweep will retry
    }
  }
  await cleanupAllSentinels()
  await rawSql.end()
})

interface FixtureMatch {
  matchId: number
}

async function insertFixtureMatch(eaMatchSuffix: string): Promise<FixtureMatch> {
  const [m] = await db
    .insert(matches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      eaMatchId: `${SENTINEL_TAG}-${eaMatchSuffix}`,
      matchType: 'gameType5',
      opponentClubId: '99999',
      opponentName: 'A3-T3 Sentinel Opp',
      playedAt: new Date('2026-01-01T00:00:00Z'),
      result: 'WIN',
      scoreFor: 1,
      scoreAgainst: 0,
      shotsFor: 1,
      shotsAgainst: 0,
      hitsFor: 0,
      hitsAgainst: 0,
    })
    .returning({ id: matches.id })
  assert.ok(m)
  sentinelMatchIds.add(m.id)
  return { matchId: m.id }
}

interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

function runCli(args: string[]): CliResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env },
    encoding: 'utf8',
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

void test('decoder-runs-cli create-candidate inserts a row with is_active=false and prints JSON', async () => {
  if (!process.env['DATABASE_URL']) return

  const fx = await insertFixtureMatch('create-happy-path')

  const result = runCli([
    'create-candidate',
    '--match-id', String(fx.matchId),
    '--video-sha256', 'deadbeef',
    '--decoder-version', 'hmm-viterbi-v2',
    '--weights-hash', 'wh-test',
    '--config-hash', 'ch-test',
  ])

  assert.equal(
    result.status,
    0,
    `expected exit 0, got ${result.status}; stderr: ${result.stderr}`,
  )
  const lastJsonLine = result.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop()
  assert.ok(lastJsonLine, `expected JSON on stdout, got: ${result.stdout}`)
  const payload = JSON.parse(lastJsonLine)
  assert.equal(typeof payload.run_id, 'number')
  assert.ok(payload.run_id > 0, `expected positive run_id, got ${payload.run_id}`)
  assert.equal(payload.is_active, false)
  sentinelRunIds.add(payload.run_id)

  // Verify the row exists in the DB with the expected fields.
  const [row] = await db
    .select()
    .from(ocrDecoderRuns)
    .where(eq(ocrDecoderRuns.id, payload.run_id))
  assert.ok(row, 'expected ocr_decoder_runs row to exist')
  assert.equal(row.matchId, fx.matchId)
  assert.equal(row.isActive, false)
  assert.equal(row.videoSha256, 'deadbeef')
  assert.equal(row.decoderVersion, 'hmm-viterbi-v2')
  assert.equal(row.weightsHash, 'wh-test')
  assert.equal(row.configHash, 'ch-test')
})

void test('decoder-runs-cli create-candidate exits non-zero when --match-id is missing', async () => {
  if (!process.env['DATABASE_URL']) return

  const result = runCli([
    'create-candidate',
    '--video-sha256', 'deadbeef',
    '--decoder-version', 'hmm-viterbi-v2',
    '--weights-hash', 'wh-test',
    '--config-hash', 'ch-test',
  ])

  assert.notEqual(result.status, 0, `expected non-zero exit when --match-id missing; stdout: ${result.stdout} stderr: ${result.stderr}`)
  assert.match(result.stderr, /match-id/i, `expected stderr to mention match-id; got: ${result.stderr}`)
})

void test('decoder-runs-cli create-candidate exits non-zero when --match-id is non-numeric', async () => {
  if (!process.env['DATABASE_URL']) return

  const result = runCli([
    'create-candidate',
    '--match-id', 'not-a-number',
    '--video-sha256', 'deadbeef',
    '--decoder-version', 'hmm-viterbi-v2',
    '--weights-hash', 'wh-test',
    '--config-hash', 'ch-test',
  ])

  assert.notEqual(result.status, 0, `expected non-zero exit when --match-id non-numeric; stdout: ${result.stdout} stderr: ${result.stderr}`)
  assert.match(result.stderr, /match-id/i, `expected stderr to mention match-id; got: ${result.stderr}`)
})

void test('decoder-runs-cli stubs validate/activate/undo with informative errors', async () => {
  if (!process.env['DATABASE_URL']) return

  for (const sub of ['validate', 'activate', 'undo']) {
    const result = runCli([sub, '--run-id', '1'])
    assert.notEqual(result.status, 0, `expected non-zero exit for stubbed '${sub}'`)
    assert.match(
      result.stderr,
      /not yet implemented|Task 4|Task 5/i,
      `expected stub error for '${sub}'; got: ${result.stderr}`,
    )
  }
})

void test('decoder-runs-cli errors on unknown subcommand', async () => {
  if (!process.env['DATABASE_URL']) return

  const result = runCli(['frobnicate'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /unknown subcommand/i, `got: ${result.stderr}`)
})
