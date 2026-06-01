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
  players,
  ocrCaptureBatches,
  ocrDecoderRuns,
  ocrExtractions,
  ocrFieldEvidence,
  ocrPromotions,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
} from '@eanhl/db'
import { eq, inArray, like } from 'drizzle-orm'

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
  // Order respects FK direction. player_loadout_x_factors + _attributes
  // hang off player_loadout_snapshots — collect the snap ids first.
  const snapIds = (
    await db
      .select({ id: playerLoadoutSnapshots.id })
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, matchId))
  ).map((r) => r.id)
  if (snapIds.length > 0) {
    await db
      .delete(playerLoadoutXFactors)
      .where(inArray(playerLoadoutXFactors.loadoutSnapshotId, snapIds))
    await db
      .delete(playerLoadoutAttributes)
      .where(inArray(playerLoadoutAttributes.loadoutSnapshotId, snapIds))
  }
  await db.delete(playerLoadoutSnapshots).where(eq(playerLoadoutSnapshots.matchId, matchId))
  await db.delete(ocrPromotions).where(eq(ocrPromotions.matchId, matchId))
  await db.delete(ocrFieldEvidence).where(eq(ocrFieldEvidence.matchId, matchId))
  await db.delete(ocrExtractions).where(eq(ocrExtractions.matchId, matchId))
  await db.delete(ocrCaptureBatches).where(eq(ocrCaptureBatches.matchId, matchId))
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
  await rawSql.end({ timeout: 5 })
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
    '--match-id',
    String(fx.matchId),
    '--video-sha256',
    'deadbeef',
    '--decoder-version',
    'hmm-viterbi-v2',
    '--weights-hash',
    'wh-test',
    '--config-hash',
    'ch-test',
  ])

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}; stderr: ${result.stderr}`)
  const lastJsonLine = result.stdout
    .trim()
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .pop()
  assert.ok(lastJsonLine, `expected JSON on stdout, got: ${result.stdout}`)
  const payload = JSON.parse(lastJsonLine)
  assert.equal(typeof payload.run_id, 'number')
  assert.ok(payload.run_id > 0, `expected positive run_id, got ${payload.run_id}`)
  assert.equal(payload.is_active, false)
  sentinelRunIds.add(payload.run_id)

  // Verify the row exists in the DB with the expected fields.
  const [row] = await db.select().from(ocrDecoderRuns).where(eq(ocrDecoderRuns.id, payload.run_id))
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
    '--video-sha256',
    'deadbeef',
    '--decoder-version',
    'hmm-viterbi-v2',
    '--weights-hash',
    'wh-test',
    '--config-hash',
    'ch-test',
  ])

  assert.notEqual(
    result.status,
    0,
    `expected non-zero exit when --match-id missing; stdout: ${result.stdout} stderr: ${result.stderr}`,
  )
  assert.match(
    result.stderr,
    /match-id/i,
    `expected stderr to mention match-id; got: ${result.stderr}`,
  )
})

void test('decoder-runs-cli create-candidate exits non-zero when --match-id is non-numeric', async () => {
  if (!process.env['DATABASE_URL']) return

  const result = runCli([
    'create-candidate',
    '--match-id',
    'not-a-number',
    '--video-sha256',
    'deadbeef',
    '--decoder-version',
    'hmm-viterbi-v2',
    '--weights-hash',
    'wh-test',
    '--config-hash',
    'ch-test',
  ])

  assert.notEqual(
    result.status,
    0,
    `expected non-zero exit when --match-id non-numeric; stdout: ${result.stdout} stderr: ${result.stderr}`,
  )
  assert.match(
    result.stderr,
    /match-id/i,
    `expected stderr to mention match-id; got: ${result.stderr}`,
  )
})

void test('decoder-runs-cli errors on unknown subcommand', async () => {
  if (!process.env['DATABASE_URL']) return

  const result = runCli(['frobnicate'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /unknown subcommand/i, `got: ${result.stderr}`)
})

// ────────────────────────────────────────────────────────────────────────
// Task 4 — validate + activate
//
// The validate tests reuse the same promotion-shape fixture as the
// validateCandidateRun unit tests: whole-row promoted ocr_promotions rows
// with target_table='player_loadout_snapshots'. Loadout rows omit
// source_screen; lobby rows tag source_screen='pre_game_lobby_state_2'.
//
// The activate tests reuse the rebuild-canonicals fixture shape: real
// player rows (so gamertag resolution succeeds), two decoder runs (v1
// inactive / v2 inactive candidate), and distinct loadout evidence per
// run. After `activate --run-id <v2>`, the v2 evidence projects into
// player_loadout_snapshots and v2 is marked is_active=true.
// ────────────────────────────────────────────────────────────────────────

const HIGH_CONF = '0.95'

interface ValidateFixtureOptions {
  loadoutPromotionCount: number
  lobbyPromotionCount: number
  extractorErrorCount?: number
}

interface ValidateFixtureResult {
  matchId: number
  runId: number
}

async function insertValidateFixture(
  suffix: string,
  opts: ValidateFixtureOptions,
): Promise<ValidateFixtureResult> {
  const { matchId } = await insertFixtureMatch(suffix)
  const errorCount = opts.extractorErrorCount ?? 0

  const [run] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: null,
      decoderVersion: 'hmm-viterbi-v2',
      weightsHash: `wh-${suffix}`,
      configHash: `ch-${suffix}`,
      isActive: false,
      notes: `${SENTINEL_TAG}-${suffix}`,
    })
    .returning({ id: ocrDecoderRuns.id })
  assert.ok(run)
  const runId = run.id
  sentinelRunIds.add(runId)

  const [batch] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      matchId,
      sourceDirectory: `/tmp/${SENTINEL_TAG}/${suffix}`,
      captureKind: 'manual_screenshots',
      notes: `${SENTINEL_TAG}-${suffix}`,
      runId,
    })
    .returning({ id: ocrCaptureBatches.id })
  if (!batch) throw new Error('batch insert failed')

  const positions = ['C', 'LW', 'RW', 'LD', 'RD']
  for (let i = 0; i < opts.loadoutPromotionCount; i++) {
    const position = positions[i % positions.length]!
    await db.insert(ocrPromotions).values({
      matchId,
      targetTable: 'player_loadout_snapshots',
      targetSemanticKey: {
        match_id: matchId,
        team_side: 'home',
        position,
        slot_idx: i,
      },
      fieldKey: null,
      winningValue: {
        gamertag: `LOADOUT_PLAYER_${i}`,
        position,
        team_side: 'home',
      },
      winningConfidence: '0.9500',
      evidenceCount: 1,
      conflictCount: 0,
      evidenceIds: [],
      promotionStatus: 'promoted',
      blockingReason: null,
      authoritySource: 'ocr_evidence',
      runId,
    })
  }
  for (let i = 0; i < opts.lobbyPromotionCount; i++) {
    const position = positions[i % positions.length]!
    await db.insert(ocrPromotions).values({
      matchId,
      targetTable: 'player_loadout_snapshots',
      targetSemanticKey: {
        match_id: matchId,
        team_side: 'home',
        position,
        slot_key: `lobby_${i}`,
        source_screen: 'pre_game_lobby_state_2',
      },
      fieldKey: null,
      winningValue: {
        gamertag: `LOBBY_PLAYER_${i}`,
        position,
        team_side: 'home',
        source_screen: 'pre_game_lobby_state_2',
      },
      winningConfidence: '0.9500',
      evidenceCount: 1,
      conflictCount: 0,
      evidenceIds: [],
      promotionStatus: 'promoted',
      blockingReason: null,
      authoritySource: 'ocr_evidence',
      runId,
    })
  }
  for (let i = 0; i < errorCount; i++) {
    await db.insert(ocrExtractions).values({
      batchId: batch.id,
      matchId,
      screenType: 'player_loadout_view',
      sourcePath: `/tmp/${SENTINEL_TAG}/${suffix}/err${i}.png`,
      rawResultJson: {},
      transformStatus: 'error',
      transformError: 'extractor_blew_up',
      runId,
    })
  }

  return { matchId, runId }
}

void test('decoder-runs-cli validate exits 0 and prints ok=true when validation passes', async () => {
  if (!process.env['DATABASE_URL']) return

  const fx = await insertValidateFixture('validate-ok', {
    loadoutPromotionCount: 5,
    lobbyPromotionCount: 1,
  })

  const result = runCli(['validate', '--run-id', String(fx.runId)])
  assert.equal(
    result.status,
    0,
    `expected exit 0; stderr: ${result.stderr}; stdout: ${result.stdout}`,
  )
  const lastJson = result.stdout
    .trim()
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .pop()
  assert.ok(lastJson, `expected JSON stdout; got: ${result.stdout}`)
  const payload = JSON.parse(lastJson) as {
    ok: boolean
    details: { loadoutPromotionCount: number; lobbyPromotionCount: number }
  }
  assert.equal(payload.ok, true)
  assert.equal(payload.details.loadoutPromotionCount, 5)
  assert.equal(payload.details.lobbyPromotionCount, 1)
})

void test('decoder-runs-cli validate exits 2 when validation fails (loadout floor not met)', async () => {
  if (!process.env['DATABASE_URL']) return

  const fx = await insertValidateFixture('validate-fail', {
    loadoutPromotionCount: 2,
    lobbyPromotionCount: 0,
  })

  const result = runCli(['validate', '--run-id', String(fx.runId)])
  assert.equal(
    result.status,
    2,
    `expected exit 2 on validation failure; stderr: ${result.stderr}; stdout: ${result.stdout}`,
  )
  const lastJson = result.stdout
    .trim()
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .pop()
  assert.ok(lastJson, `expected JSON stdout on fail-soft; got: ${result.stdout}`)
  const payload = JSON.parse(lastJson) as {
    ok: boolean
    details: { failureReasons: string[] }
  }
  assert.equal(payload.ok, false)
  assert.ok(payload.details.failureReasons.length > 0, 'expected at least one failure reason')
})

void test('decoder-runs-cli validate exits 1 when --run-id is missing', async () => {
  if (!process.env['DATABASE_URL']) return
  const result = runCli(['validate'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /run-id/i, `got: ${result.stderr}`)
})

void test('decoder-runs-cli validate exits 1 when --run-id is non-numeric', async () => {
  if (!process.env['DATABASE_URL']) return
  const result = runCli(['validate', '--run-id', 'banana'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /run-id/i, `got: ${result.stderr}`)
})

// ─── activate fixtures ────────────────────────────────────────────────

interface ActivateFixtureResult {
  matchId: number
  v1RunId: number
  v2RunId: number
  v1Gamertag: string
  v2Gamertag: string
}

/**
 * Insert a match with two decoder runs (v1 active, v2 inactive candidate).
 * Each run has its own loadout evidence (distinct gamertag + position) so
 * the post-activate canonical snapshot can be unambiguously traced to v2.
 */
async function insertActivateFixture(
  suffix: string,
  options: { v1IsActive: boolean } = { v1IsActive: true },
): Promise<ActivateFixtureResult> {
  const existingPlayers = await db.select({ gamertag: players.gamertag }).from(players).limit(2)
  assert.ok(
    existingPlayers[0] && existingPlayers[1],
    'DB must have at least two players for the activate fixture',
  )
  const v1Gamertag = existingPlayers[0]!.gamertag
  const v2Gamertag = existingPlayers[1]!.gamertag

  const { matchId } = await insertFixtureMatch(suffix)

  const [runV1] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: null,
      decoderVersion: 'hmm-viterbi-v1',
      weightsHash: `wh-v1-${suffix}`,
      configHash: `ch-v1-${suffix}`,
      isActive: options.v1IsActive,
      notes: `${SENTINEL_TAG}-runV1`,
    })
    .returning({ id: ocrDecoderRuns.id })
  const [runV2] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: null,
      decoderVersion: 'hmm-viterbi-v2',
      weightsHash: `wh-v2-${suffix}`,
      configHash: `ch-v2-${suffix}`,
      isActive: false,
      notes: `${SENTINEL_TAG}-runV2`,
    })
    .returning({ id: ocrDecoderRuns.id })
  assert.ok(runV1 && runV2)
  sentinelRunIds.add(runV1.id)
  sentinelRunIds.add(runV2.id)

  async function makeBatchAndExtraction(runId: number, label: string): Promise<number> {
    const [b] = await db
      .insert(ocrCaptureBatches)
      .values({
        gameTitleId: GAME_TITLE_ID,
        matchId,
        sourceDirectory: `/tmp/${SENTINEL_TAG}/${suffix}/${label}`,
        captureKind: 'manual_screenshots',
        notes: `${SENTINEL_TAG}-${label}`,
        runId,
      })
      .returning({ id: ocrCaptureBatches.id })
    if (!b) throw new Error('batch insert failed')
    const [x] = await db
      .insert(ocrExtractions)
      .values({
        batchId: b.id,
        matchId,
        screenType: 'player_loadout_view',
        sourcePath: `/tmp/${SENTINEL_TAG}/${suffix}/${label}/frame001.png`,
        rawResultJson: {},
        transformStatus: 'success',
        runId,
      })
      .returning({ id: ocrExtractions.id })
    if (!x) throw new Error('extraction insert failed')
    return x.id
  }

  const v1ExtractionId = await makeBatchAndExtraction(runV1.id, 'runV1')
  const v2ExtractionId = await makeBatchAndExtraction(runV2.id, 'runV2')

  async function seed(
    runId: number,
    extractionId: number,
    fieldKey: string,
    value: unknown,
  ): Promise<void> {
    await db.insert(ocrFieldEvidence).values({
      matchId,
      screenState: 'player_loadout_view',
      subjectSlotKey: 'loadout_slot_T4_activate',
      fieldKey,
      fieldFamily: 'closed_vocab',
      candidateValue: value,
      candidateRank: 0,
      rawConfidence: HIGH_CONF,
      calibratedConfidence: HIGH_CONF,
      supportFrameIds: [extractionId],
      extractorFamily: 'closed_vocab',
      extractorVersion: `${SENTINEL_TAG}-v1`,
      runId,
    })
  }
  await seed(runV1.id, v1ExtractionId, 'gamertag', v1Gamertag)
  await seed(runV1.id, v1ExtractionId, 'position', 'C')
  await seed(runV2.id, v2ExtractionId, 'gamertag', v2Gamertag)
  await seed(runV2.id, v2ExtractionId, 'position', 'LW')

  return {
    matchId,
    v1RunId: runV1.id,
    v2RunId: runV2.id,
    v1Gamertag,
    v2Gamertag,
  }
}

void test('decoder-runs-cli activate flips activation atomically and rebuilds canonicals from the new active run', async () => {
  if (!process.env['DATABASE_URL']) return

  const fx = await insertActivateFixture('activate-happy', { v1IsActive: true })

  const result = runCli(['activate', '--run-id', String(fx.v2RunId)])
  assert.equal(
    result.status,
    0,
    `expected exit 0; stderr: ${result.stderr}; stdout: ${result.stdout}`,
  )
  const lastJson = result.stdout
    .trim()
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .pop()
  assert.ok(lastJson, `expected JSON stdout; got: ${result.stdout}`)
  const payload = JSON.parse(lastJson) as {
    activated_run_id: number
    match_id: number
    loadout_snapshots_written: number
  }
  assert.equal(payload.activated_run_id, fx.v2RunId)
  assert.equal(payload.match_id, fx.matchId)

  // v1 should now be inactive, v2 should be active with completedAt set.
  const [v1] = await db.select().from(ocrDecoderRuns).where(eq(ocrDecoderRuns.id, fx.v1RunId))
  const [v2] = await db.select().from(ocrDecoderRuns).where(eq(ocrDecoderRuns.id, fx.v2RunId))
  assert.equal(v1?.isActive, false, 'expected v1 to be deactivated')
  assert.equal(v2?.isActive, true, 'expected v2 to be active')
  assert.ok(v2?.completedAt, 'expected v2.completedAt to be stamped')

  // Canonical snapshots should reflect v2 evidence only.
  const snaps = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, fx.matchId))
  assert.equal(snaps.length, 1, `expected 1 canonical snapshot; got ${snaps.length}`)
  assert.equal(
    snaps[0]!.gamertagSnapshot,
    fx.v2Gamertag,
    'canonical snapshot should carry the v2 gamertag (not v1)',
  )
  assert.equal(snaps[0]!.position, 'LW')
})

void test('decoder-runs-cli activate succeeds when no prior active run exists', async () => {
  if (!process.env['DATABASE_URL']) return

  const fx = await insertActivateFixture('activate-first-ever', {
    v1IsActive: false,
  })

  const result = runCli(['activate', '--run-id', String(fx.v2RunId)])
  assert.equal(
    result.status,
    0,
    `expected exit 0 even with no prior active run; stderr: ${result.stderr}`,
  )

  const [v2] = await db.select().from(ocrDecoderRuns).where(eq(ocrDecoderRuns.id, fx.v2RunId))
  assert.equal(v2?.isActive, true)
})

void test('decoder-runs-cli activate --dry-run does not modify the DB', async () => {
  if (!process.env['DATABASE_URL']) return

  const fx = await insertActivateFixture('activate-dryrun', { v1IsActive: true })

  // Pre-state snapshot
  const beforeRuns = await db
    .select({ id: ocrDecoderRuns.id, isActive: ocrDecoderRuns.isActive })
    .from(ocrDecoderRuns)
    .where(eq(ocrDecoderRuns.matchId, fx.matchId))
  const beforeSnaps = await db
    .select({ id: playerLoadoutSnapshots.id })
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, fx.matchId))

  const result = runCli(['activate', '--run-id', String(fx.v2RunId), '--dry-run'])
  assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  const lastJson = result.stdout
    .trim()
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .pop()
  assert.ok(lastJson)
  const payload = JSON.parse(lastJson) as {
    would_deactivate_run_id: number | null
    would_activate_run_id: number
    would_rebuild_canonicals_for_match: number
    dry_run: boolean
  }
  assert.equal(payload.would_deactivate_run_id, fx.v1RunId)
  assert.equal(payload.would_activate_run_id, fx.v2RunId)
  assert.equal(payload.would_rebuild_canonicals_for_match, fx.matchId)
  assert.equal(payload.dry_run, true)

  // Post-state must equal pre-state.
  const afterRuns = await db
    .select({ id: ocrDecoderRuns.id, isActive: ocrDecoderRuns.isActive })
    .from(ocrDecoderRuns)
    .where(eq(ocrDecoderRuns.matchId, fx.matchId))
  const afterSnaps = await db
    .select({ id: playerLoadoutSnapshots.id })
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, fx.matchId))
  assert.deepEqual(
    afterRuns.sort((a, b) => a.id - b.id),
    beforeRuns.sort((a, b) => a.id - b.id),
    'dry-run must not modify ocr_decoder_runs',
  )
  assert.equal(afterSnaps.length, beforeSnaps.length, 'dry-run must not write canonical snapshots')
})

void test('decoder-runs-cli activate fails when target run is already active', async () => {
  if (!process.env['DATABASE_URL']) return

  // Setup: insert a match with one already-active run.
  const { matchId } = await insertFixtureMatch('activate-already-active')
  const [run] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: null,
      decoderVersion: 'hmm-viterbi-v2',
      weightsHash: 'wh-already-active',
      configHash: 'ch-already-active',
      isActive: true,
      notes: `${SENTINEL_TAG}-already-active`,
    })
    .returning({ id: ocrDecoderRuns.id })
  assert.ok(run)
  sentinelRunIds.add(run.id)

  const result = runCli(['activate', '--run-id', String(run.id)])
  assert.equal(result.status, 1)
  assert.match(
    result.stderr,
    /already active/i,
    `expected stderr to mention "already active"; got: ${result.stderr}`,
  )
})

void test('decoder-runs-cli activate fails when target run does not exist', async () => {
  if (!process.env['DATABASE_URL']) return

  const result = runCli(['activate', '--run-id', '999999999'])
  assert.equal(result.status, 1)
  assert.match(
    result.stderr,
    /not found/i,
    `expected stderr to mention "not found"; got: ${result.stderr}`,
  )
})

void test('decoder-runs-cli activate exits 1 when --run-id is missing', async () => {
  if (!process.env['DATABASE_URL']) return
  const result = runCli(['activate'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /run-id/i, `got: ${result.stderr}`)
})

// ────────────────────────────────────────────────────────────────────────
// Task 5 — undo
//
// `undo` finds the prior inactive run (latest completed_at) and delegates
// to the same atomic activation flow as `activate`. The fixture matches
// the shape from `insertActivateFixture` but lets us stamp completedAt
// on the runs so the "latest completed_at" picker has something to choose
// from.
// ────────────────────────────────────────────────────────────────────────

interface UndoFixtureResult {
  matchId: number
  v1RunId: number
  v2RunId: number
  v1Gamertag: string
  v2Gamertag: string
}

/**
 * Insert a match with v1 (currently inactive, completedAt stamped — i.e.
 * was-active) and v2 (currently active). Each run has distinct loadout
 * evidence so the post-undo canonical snapshot can be unambiguously
 * traced to v1.
 */
async function insertUndoFixture(suffix: string): Promise<UndoFixtureResult> {
  const existingPlayers = await db.select({ gamertag: players.gamertag }).from(players).limit(2)
  assert.ok(
    existingPlayers[0] && existingPlayers[1],
    'DB must have at least two players for the undo fixture',
  )
  const v1Gamertag = existingPlayers[0]!.gamertag
  const v2Gamertag = existingPlayers[1]!.gamertag

  const { matchId } = await insertFixtureMatch(suffix)

  // v1: currently inactive but was-active (completedAt stamped earlier).
  const [runV1] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: null,
      decoderVersion: 'hmm-viterbi-v1',
      weightsHash: `wh-v1-${suffix}`,
      configHash: `ch-v1-${suffix}`,
      isActive: false,
      completedAt: new Date('2026-01-01T00:00:00Z'),
      notes: `${SENTINEL_TAG}-runV1`,
    })
    .returning({ id: ocrDecoderRuns.id })
  // v2: currently active (latest activation).
  const [runV2] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: null,
      decoderVersion: 'hmm-viterbi-v2',
      weightsHash: `wh-v2-${suffix}`,
      configHash: `ch-v2-${suffix}`,
      isActive: true,
      completedAt: new Date('2026-01-02T00:00:00Z'),
      notes: `${SENTINEL_TAG}-runV2`,
    })
    .returning({ id: ocrDecoderRuns.id })
  assert.ok(runV1 && runV2)
  sentinelRunIds.add(runV1.id)
  sentinelRunIds.add(runV2.id)

  async function makeBatchAndExtraction(runId: number, label: string): Promise<number> {
    const [b] = await db
      .insert(ocrCaptureBatches)
      .values({
        gameTitleId: GAME_TITLE_ID,
        matchId,
        sourceDirectory: `/tmp/${SENTINEL_TAG}/${suffix}/${label}`,
        captureKind: 'manual_screenshots',
        notes: `${SENTINEL_TAG}-${label}`,
        runId,
      })
      .returning({ id: ocrCaptureBatches.id })
    if (!b) throw new Error('batch insert failed')
    const [x] = await db
      .insert(ocrExtractions)
      .values({
        batchId: b.id,
        matchId,
        screenType: 'player_loadout_view',
        sourcePath: `/tmp/${SENTINEL_TAG}/${suffix}/${label}/frame001.png`,
        rawResultJson: {},
        transformStatus: 'success',
        runId,
      })
      .returning({ id: ocrExtractions.id })
    if (!x) throw new Error('extraction insert failed')
    return x.id
  }

  const v1ExtractionId = await makeBatchAndExtraction(runV1.id, 'runV1')
  const v2ExtractionId = await makeBatchAndExtraction(runV2.id, 'runV2')

  async function seed(
    runId: number,
    extractionId: number,
    fieldKey: string,
    value: unknown,
  ): Promise<void> {
    await db.insert(ocrFieldEvidence).values({
      matchId,
      screenState: 'player_loadout_view',
      subjectSlotKey: 'loadout_slot_T5_undo',
      fieldKey,
      fieldFamily: 'closed_vocab',
      candidateValue: value,
      candidateRank: 0,
      rawConfidence: HIGH_CONF,
      calibratedConfidence: HIGH_CONF,
      supportFrameIds: [extractionId],
      extractorFamily: 'closed_vocab',
      extractorVersion: `${SENTINEL_TAG}-v1`,
      runId,
    })
  }
  await seed(runV1.id, v1ExtractionId, 'gamertag', v1Gamertag)
  await seed(runV1.id, v1ExtractionId, 'position', 'C')
  await seed(runV2.id, v2ExtractionId, 'gamertag', v2Gamertag)
  await seed(runV2.id, v2ExtractionId, 'position', 'LW')

  return {
    matchId,
    v1RunId: runV1.id,
    v2RunId: runV2.id,
    v1Gamertag,
    v2Gamertag,
  }
}

void test('decoder-runs-cli undo flips activation back to the prior inactive run and rebuilds canonicals', async () => {
  if (!process.env['DATABASE_URL']) return

  const fx = await insertUndoFixture('undo-happy')

  const result = runCli(['undo', '--match-id', String(fx.matchId)])
  assert.equal(
    result.status,
    0,
    `expected exit 0; stderr: ${result.stderr}; stdout: ${result.stdout}`,
  )
  const lastJson = result.stdout
    .trim()
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .pop()
  assert.ok(lastJson, `expected JSON stdout; got: ${result.stdout}`)
  const payload = JSON.parse(lastJson) as {
    activated_run_id: number
    match_id: number
  }
  assert.equal(payload.activated_run_id, fx.v1RunId)
  assert.equal(payload.match_id, fx.matchId)

  // v1 should now be active, v2 should be inactive.
  const [v1] = await db.select().from(ocrDecoderRuns).where(eq(ocrDecoderRuns.id, fx.v1RunId))
  const [v2] = await db.select().from(ocrDecoderRuns).where(eq(ocrDecoderRuns.id, fx.v2RunId))
  assert.equal(v1?.isActive, true, 'expected v1 to be re-activated')
  assert.equal(v2?.isActive, false, 'expected v2 to be deactivated')

  // Canonical snapshots should reflect v1 evidence only.
  const snaps = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, fx.matchId))
  assert.equal(snaps.length, 1, `expected 1 canonical snapshot; got ${snaps.length}`)
  assert.equal(
    snaps[0]!.gamertagSnapshot,
    fx.v1Gamertag,
    'canonical snapshot should carry the v1 gamertag (not v2) after undo',
  )
  assert.equal(snaps[0]!.position, 'C')
})

void test('decoder-runs-cli undo exits non-zero when no prior inactive run exists', async () => {
  if (!process.env['DATABASE_URL']) return

  // Match has only one active run; no prior inactive run to revert to.
  const { matchId } = await insertFixtureMatch('undo-no-prior')
  const [run] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: null,
      decoderVersion: 'hmm-viterbi-v2',
      weightsHash: 'wh-no-prior',
      configHash: 'ch-no-prior',
      isActive: true,
      completedAt: new Date('2026-01-02T00:00:00Z'),
      notes: `${SENTINEL_TAG}-undo-no-prior`,
    })
    .returning({ id: ocrDecoderRuns.id })
  assert.ok(run)
  sentinelRunIds.add(run.id)

  const result = runCli(['undo', '--match-id', String(matchId)])
  assert.notEqual(result.status, 0, `expected non-zero exit; stdout: ${result.stdout}`)
  assert.match(
    result.stderr,
    /no prior/i,
    `expected stderr to mention "no prior"; got: ${result.stderr}`,
  )
})

void test('decoder-runs-cli undo picks the inactive run with the latest completed_at', async () => {
  if (!process.env['DATABASE_URL']) return

  // Three runs: v1 (older inactive), v2 (newer inactive), v3 (currently active).
  // undo should pick v2 (latest completed_at among inactive runs).
  const existingPlayers = await db.select({ gamertag: players.gamertag }).from(players).limit(2)
  assert.ok(
    existingPlayers[0] && existingPlayers[1],
    'DB must have at least two players for the undo fixture',
  )
  const v1Gamertag = existingPlayers[0]!.gamertag
  const v2Gamertag = existingPlayers[1]!.gamertag

  const { matchId } = await insertFixtureMatch('undo-pick-latest')

  const [runV1] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: null,
      decoderVersion: 'hmm-viterbi-v1',
      weightsHash: 'wh-v1-pick-latest',
      configHash: 'ch-v1-pick-latest',
      isActive: false,
      completedAt: new Date('2025-12-01T00:00:00Z'), // oldest
      notes: `${SENTINEL_TAG}-runV1-pick-latest`,
    })
    .returning({ id: ocrDecoderRuns.id })
  const [runV2] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: null,
      decoderVersion: 'hmm-viterbi-v2',
      weightsHash: 'wh-v2-pick-latest',
      configHash: 'ch-v2-pick-latest',
      isActive: false,
      completedAt: new Date('2026-01-15T00:00:00Z'), // most recent inactive
      notes: `${SENTINEL_TAG}-runV2-pick-latest`,
    })
    .returning({ id: ocrDecoderRuns.id })
  const [runV3] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: null,
      decoderVersion: 'hmm-viterbi-v3',
      weightsHash: 'wh-v3-pick-latest',
      configHash: 'ch-v3-pick-latest',
      isActive: true,
      completedAt: new Date('2026-02-01T00:00:00Z'), // currently active
      notes: `${SENTINEL_TAG}-runV3-pick-latest`,
    })
    .returning({ id: ocrDecoderRuns.id })
  assert.ok(runV1 && runV2 && runV3)
  sentinelRunIds.add(runV1.id)
  sentinelRunIds.add(runV2.id)
  sentinelRunIds.add(runV3.id)

  // Seed evidence for v2 (which undo should pick) so rebuild has something
  // to project. We need a batch + extraction + evidence row, mirroring the
  // pattern in insertUndoFixture.
  const [batch] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      matchId,
      sourceDirectory: `/tmp/${SENTINEL_TAG}/undo-pick-latest/runV2`,
      captureKind: 'manual_screenshots',
      notes: `${SENTINEL_TAG}-runV2-pick-latest`,
      runId: runV2.id,
    })
    .returning({ id: ocrCaptureBatches.id })
  if (!batch) throw new Error('batch insert failed')
  const [extraction] = await db
    .insert(ocrExtractions)
    .values({
      batchId: batch.id,
      matchId,
      screenType: 'player_loadout_view',
      sourcePath: `/tmp/${SENTINEL_TAG}/undo-pick-latest/runV2/frame001.png`,
      rawResultJson: {},
      transformStatus: 'success',
      runId: runV2.id,
    })
    .returning({ id: ocrExtractions.id })
  if (!extraction) throw new Error('extraction insert failed')

  async function seed(
    runId: number,
    extractionId: number,
    fieldKey: string,
    value: unknown,
  ): Promise<void> {
    await db.insert(ocrFieldEvidence).values({
      matchId,
      screenState: 'player_loadout_view',
      subjectSlotKey: 'loadout_slot_T5_undo_pick',
      fieldKey,
      fieldFamily: 'closed_vocab',
      candidateValue: value,
      candidateRank: 0,
      rawConfidence: HIGH_CONF,
      calibratedConfidence: HIGH_CONF,
      supportFrameIds: [extractionId],
      extractorFamily: 'closed_vocab',
      extractorVersion: `${SENTINEL_TAG}-v1`,
      runId,
    })
  }
  // Use v1Gamertag for v2's evidence so we can verify it picked v2 (not v3).
  // (v3 has no evidence — would result in 0 snapshots.)
  await seed(runV2.id, extraction.id, 'gamertag', v1Gamertag)
  await seed(runV2.id, extraction.id, 'position', 'RW')
  // Reference v2Gamertag so the unused-var lint doesn't fire on it. The
  // assertion below confirms v2's gamertag ended up in the snapshot.
  assert.ok(v2Gamertag, 'sanity: v2Gamertag is defined')

  const result = runCli(['undo', '--match-id', String(matchId)])
  assert.equal(
    result.status,
    0,
    `expected exit 0; stderr: ${result.stderr}; stdout: ${result.stdout}`,
  )
  const lastJson = result.stdout
    .trim()
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .pop()
  assert.ok(lastJson)
  const payload = JSON.parse(lastJson) as { activated_run_id: number }
  assert.equal(
    payload.activated_run_id,
    runV2.id,
    `undo should pick runV2 (latest completed_at among inactive); got ${payload.activated_run_id}`,
  )

  // v2 active, v1 + v3 inactive.
  const [v1After] = await db.select().from(ocrDecoderRuns).where(eq(ocrDecoderRuns.id, runV1.id))
  const [v2After] = await db.select().from(ocrDecoderRuns).where(eq(ocrDecoderRuns.id, runV2.id))
  const [v3After] = await db.select().from(ocrDecoderRuns).where(eq(ocrDecoderRuns.id, runV3.id))
  assert.equal(v1After?.isActive, false)
  assert.equal(v2After?.isActive, true)
  assert.equal(v3After?.isActive, false)
})

void test('decoder-runs-cli undo --dry-run does not modify the DB', async () => {
  if (!process.env['DATABASE_URL']) return

  const fx = await insertUndoFixture('undo-dryrun')

  // Pre-state snapshot
  const beforeRuns = await db
    .select({ id: ocrDecoderRuns.id, isActive: ocrDecoderRuns.isActive })
    .from(ocrDecoderRuns)
    .where(eq(ocrDecoderRuns.matchId, fx.matchId))
  const beforeSnaps = await db
    .select({ id: playerLoadoutSnapshots.id })
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, fx.matchId))

  const result = runCli(['undo', '--match-id', String(fx.matchId), '--dry-run'])
  assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  const lastJson = result.stdout
    .trim()
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .pop()
  assert.ok(lastJson)
  const payload = JSON.parse(lastJson) as {
    would_deactivate_run_id: number | null
    would_activate_run_id: number
    would_rebuild_canonicals_for_match: number
    dry_run: boolean
  }
  assert.equal(payload.would_deactivate_run_id, fx.v2RunId)
  assert.equal(payload.would_activate_run_id, fx.v1RunId)
  assert.equal(payload.would_rebuild_canonicals_for_match, fx.matchId)
  assert.equal(payload.dry_run, true)

  // Post-state must equal pre-state.
  const afterRuns = await db
    .select({ id: ocrDecoderRuns.id, isActive: ocrDecoderRuns.isActive })
    .from(ocrDecoderRuns)
    .where(eq(ocrDecoderRuns.matchId, fx.matchId))
  const afterSnaps = await db
    .select({ id: playerLoadoutSnapshots.id })
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, fx.matchId))
  assert.deepEqual(
    afterRuns.sort((a, b) => a.id - b.id),
    beforeRuns.sort((a, b) => a.id - b.id),
    'dry-run must not modify ocr_decoder_runs',
  )
  assert.equal(afterSnaps.length, beforeSnaps.length, 'dry-run must not write canonical snapshots')
})

void test('decoder-runs-cli undo exits 1 when --match-id is missing', async () => {
  if (!process.env['DATABASE_URL']) return
  const result = runCli(['undo'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /match-id/i, `got: ${result.stderr}`)
})

void test('decoder-runs-cli undo exits 1 when --match-id is non-numeric', async () => {
  if (!process.env['DATABASE_URL']) return
  const result = runCli(['undo', '--match-id', 'banana'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /match-id/i, `got: ${result.stderr}`)
})
