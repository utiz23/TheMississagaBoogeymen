/**
 * Task 6 — A3 reprocess CLI: --run-id wired into repromote-{loadout,lobby}-cli.
 *
 * Both CLIs accept an optional --run-id <N>. When supplied, the value is
 * forwarded to the underlying v2 promoter via its `runId` parameter, so:
 *   1. Evidence is read scoped to that run.
 *   2. ocr_promotions rows are written tagged with that runId.
 *   3. Canonical snapshot writes (player_loadout_snapshots) are gated on
 *      the promoter's `writeSnapshots` check — which is FALSE when the
 *      requested runId is NOT the active run for the match. So a CLI
 *      invocation against a candidate run produces ocr_promotions but
 *      leaves canonicals untouched.
 *
 * Tests covered:
 *   - repromote-loadout --match N --run-id <v2>: candidate run v2 is not
 *     active; ocr_promotions tagged runId=v2 are produced (with the v2
 *     evidence content) but no canonical snapshot is written.
 *   - repromote-lobby --match N --run-id <v2>: same shape for the lobby
 *     promoter.
 *   - repromote-loadout --match N (legacy, no --run-id): promotes against
 *     the live (active) run; canonical snapshots ARE written.
 *   - repromote-loadout --match N --run-id banana: exits non-zero.
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/repromote-cli-run-id.test.js
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
import { and, eq, inArray, like } from 'drizzle-orm'

const GAME_TITLE_ID = 1 // NHL 26
const SENTINEL_TAG = 'A3-T6-repromote-cli'
const HIGH_CONF = '0.95'

const REPO_ROOT = path.resolve(process.cwd())
const LOADOUT_CLI = path.resolve(REPO_ROOT, 'apps/worker/dist/repromote-loadout-cli.js')
const LOBBY_CLI = path.resolve(REPO_ROOT, 'apps/worker/dist/repromote-lobby-cli.js')

const sentinelMatchIds: Set<number> = new Set()
const sentinelRunIds: Set<number> = new Set()

async function cleanupMatch(matchId: number): Promise<void> {
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
      opponentName: 'A3-T6 Sentinel Opp',
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

function runCli(cliPath: string, args: string[]): CliResult {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
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

// ─── fixture: two decoder runs (v1 active, v2 inactive candidate) with
//             distinct LOADOUT evidence per run.
interface LoadoutFixtureResult {
  matchId: number
  v1RunId: number
  v2RunId: number
  v1Gamertag: string
  v2Gamertag: string
}

async function insertLoadoutTwoRunFixture(suffix: string): Promise<LoadoutFixtureResult> {
  const existingPlayers = await db.select({ gamertag: players.gamertag }).from(players).limit(2)
  assert.ok(
    existingPlayers[0] && existingPlayers[1],
    'DB must have at least two players for the loadout fixture',
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
      isActive: true,
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
      subjectSlotKey: 'loadout_slot_T6_repromote',
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

// ─── fixture: two decoder runs (v1 active, v2 inactive candidate) with
//             distinct LOBBY evidence per run.
interface LobbyFixtureResult {
  matchId: number
  v1RunId: number
  v2RunId: number
  v1Gamertag: string
  v2Gamertag: string
}

async function insertLobbyTwoRunFixture(suffix: string): Promise<LobbyFixtureResult> {
  const existingPlayers = await db.select({ gamertag: players.gamertag }).from(players).limit(2)
  assert.ok(
    existingPlayers[0] && existingPlayers[1],
    'DB must have at least two players for the lobby fixture',
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
      isActive: true,
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
        screenType: 'pre_game_lobby_state_2',
        sourcePath: `/tmp/${SENTINEL_TAG}/${suffix}/${label}/lobby001.png`,
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

  // Lobby slot keys follow `lobby_(for|against)_(C|LW|RW|LD|RD|G)`.
  // Use distinct positions per run to verify evidence scope: runV1 → C, runV2 → LW.
  async function seed(
    runId: number,
    extractionId: number,
    slotKey: string,
    fieldKey: string,
    value: unknown,
  ): Promise<void> {
    await db.insert(ocrFieldEvidence).values({
      matchId,
      screenState: 'pre_game_lobby_state_2',
      subjectSlotKey: slotKey,
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
  await seed(runV1.id, v1ExtractionId, 'lobby_for_C', 'gamertag', v1Gamertag)
  await seed(runV1.id, v1ExtractionId, 'lobby_for_C', 'position', 'C')
  await seed(runV2.id, v2ExtractionId, 'lobby_for_LW', 'gamertag', v2Gamertag)
  await seed(runV2.id, v2ExtractionId, 'lobby_for_LW', 'position', 'LW')

  return {
    matchId,
    v1RunId: runV1.id,
    v2RunId: runV2.id,
    v1Gamertag,
    v2Gamertag,
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

void test('repromote-loadout --run-id <candidate>: tags ocr_promotions with the candidate runId and does NOT write canonical snapshots', async () => {
  if (!process.env['DATABASE_URL']) return

  const fx = await insertLoadoutTwoRunFixture('loadout-candidate')

  const result = runCli(LOADOUT_CLI, [
    '--match',
    String(fx.matchId),
    '--run-id',
    String(fx.v2RunId),
  ])

  assert.equal(
    result.status,
    0,
    `expected exit 0; stderr: ${result.stderr}; stdout: ${result.stdout}`,
  )

  // Promotion rows for the candidate run (v2) should be present and carry
  // the v2 evidence content (position=LW from v2's evidence, not C from v1's).
  const v2Promotions = await db
    .select()
    .from(ocrPromotions)
    .where(and(eq(ocrPromotions.matchId, fx.matchId), eq(ocrPromotions.runId, fx.v2RunId)))
  assert.ok(
    v2Promotions.length > 0,
    `expected ocr_promotions tagged with v2 runId, got ${v2Promotions.length}`,
  )
  const positionPromotion = v2Promotions.find((p) => p.fieldKey === 'position')
  assert.equal(
    positionPromotion?.winningValue,
    'LW',
    `candidate-scoped promote should read v2 evidence (LW); got ${String(positionPromotion?.winningValue)}`,
  )

  // No v1-tagged promotions should appear — the CLI never touched the v1 run.
  const v1Promotions = await db
    .select()
    .from(ocrPromotions)
    .where(and(eq(ocrPromotions.matchId, fx.matchId), eq(ocrPromotions.runId, fx.v1RunId)))
  assert.equal(
    v1Promotions.length,
    0,
    `expected no v1 promotions from candidate-scoped CLI; got ${v1Promotions.length}`,
  )

  // CRITICAL: canonical snapshots must NOT be written for a non-active
  // candidate run (writeSnapshots gate in loadout-v2.ts).
  const snaps = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, fx.matchId))
  assert.equal(
    snaps.length,
    0,
    `candidate-run CLI must not write canonical snapshots; got ${snaps.length}`,
  )
})

void test('repromote-lobby --run-id <candidate>: tags ocr_promotions with the candidate runId and does NOT write canonical snapshots', async () => {
  if (!process.env['DATABASE_URL']) return

  const fx = await insertLobbyTwoRunFixture('lobby-candidate')

  const result = runCli(LOBBY_CLI, ['--match', String(fx.matchId), '--run-id', String(fx.v2RunId)])

  assert.equal(
    result.status,
    0,
    `expected exit 0; stderr: ${result.stderr}; stdout: ${result.stdout}`,
  )

  // Promotion rows for the candidate run (v2) should be present.
  const v2Promotions = await db
    .select()
    .from(ocrPromotions)
    .where(and(eq(ocrPromotions.matchId, fx.matchId), eq(ocrPromotions.runId, fx.v2RunId)))
  assert.ok(
    v2Promotions.length > 0,
    `expected ocr_promotions tagged with v2 runId, got ${v2Promotions.length}; stdout: ${result.stdout}`,
  )

  // No v1-tagged promotions should appear — the CLI never touched the v1 run.
  const v1Promotions = await db
    .select()
    .from(ocrPromotions)
    .where(and(eq(ocrPromotions.matchId, fx.matchId), eq(ocrPromotions.runId, fx.v1RunId)))
  assert.equal(
    v1Promotions.length,
    0,
    `expected no v1 promotions from candidate-scoped CLI; got ${v1Promotions.length}`,
  )

  // CRITICAL: canonical snapshots must NOT be written for a non-active
  // candidate run (writeSnapshots gate in lobby-v2.ts).
  const snaps = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, fx.matchId))
  assert.equal(
    snaps.length,
    0,
    `candidate-run CLI must not write canonical snapshots; got ${snaps.length}`,
  )
})

void test('repromote-loadout without --run-id: legacy live-run path writes canonical snapshots', async () => {
  if (!process.env['DATABASE_URL']) return

  // Single active run with seeded loadout evidence.
  const existingPlayers = await db.select({ gamertag: players.gamertag }).from(players).limit(1)
  assert.ok(existingPlayers[0], 'DB must have at least one player')
  const gamertag = existingPlayers[0]!.gamertag

  const { matchId } = await insertFixtureMatch('loadout-legacy')

  const [run] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: null,
      decoderVersion: 'hmm-viterbi-v2',
      weightsHash: 'wh-legacy',
      configHash: 'ch-legacy',
      isActive: true,
      notes: `${SENTINEL_TAG}-legacy`,
    })
    .returning({ id: ocrDecoderRuns.id })
  assert.ok(run)
  sentinelRunIds.add(run.id)

  const [batch] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      matchId,
      sourceDirectory: `/tmp/${SENTINEL_TAG}/legacy`,
      captureKind: 'manual_screenshots',
      notes: `${SENTINEL_TAG}-legacy`,
      runId: run.id,
    })
    .returning({ id: ocrCaptureBatches.id })
  if (!batch) throw new Error('batch insert failed')
  const [extraction] = await db
    .insert(ocrExtractions)
    .values({
      batchId: batch.id,
      matchId,
      screenType: 'player_loadout_view',
      sourcePath: `/tmp/${SENTINEL_TAG}/legacy/frame001.png`,
      rawResultJson: {},
      transformStatus: 'success',
      runId: run.id,
    })
    .returning({ id: ocrExtractions.id })
  if (!extraction) throw new Error('extraction insert failed')

  const extractionId = extraction.id
  const runIdForSeed = run.id

  async function seed(fieldKey: string, value: unknown): Promise<void> {
    await db.insert(ocrFieldEvidence).values({
      matchId,
      screenState: 'player_loadout_view',
      subjectSlotKey: 'loadout_slot_T6_legacy',
      fieldKey,
      fieldFamily: 'closed_vocab',
      candidateValue: value,
      candidateRank: 0,
      rawConfidence: HIGH_CONF,
      calibratedConfidence: HIGH_CONF,
      supportFrameIds: [extractionId],
      extractorFamily: 'closed_vocab',
      extractorVersion: `${SENTINEL_TAG}-v1`,
      runId: runIdForSeed,
    })
  }
  await seed('gamertag', gamertag)
  await seed('position', 'C')

  const result = runCli(LOADOUT_CLI, ['--match', String(matchId)])
  assert.equal(
    result.status,
    0,
    `expected exit 0 on legacy invocation; stderr: ${result.stderr}; stdout: ${result.stdout}`,
  )

  // Default call resolves to the live (active) run → writeSnapshots gate true.
  const snaps = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, matchId))
  assert.ok(
    snaps.length >= 1,
    `legacy CLI invocation (live run) should write at least 1 canonical snapshot; got ${snaps.length}; stdout: ${result.stdout}`,
  )

  // ocr_promotions should be tagged with the active runId.
  const promotions = await db
    .select()
    .from(ocrPromotions)
    .where(and(eq(ocrPromotions.matchId, matchId), eq(ocrPromotions.runId, run.id)))
  assert.ok(
    promotions.length > 0,
    `expected promotions tagged with active runId; got ${promotions.length}`,
  )
})

void test('repromote-loadout --run-id non-numeric: exits non-zero', async () => {
  if (!process.env['DATABASE_URL']) return

  // We don't even need a real match — argv parsing fails before any DB read.
  const result = runCli(LOADOUT_CLI, ['--match', '1', '--run-id', 'banana'])

  assert.notEqual(
    result.status,
    0,
    `expected non-zero exit on --run-id banana; stdout: ${result.stdout}; stderr: ${result.stderr}`,
  )
  assert.match(result.stderr, /run-id/i, `expected stderr to mention run-id; got: ${result.stderr}`)
})

void test('repromote-lobby --run-id non-numeric: exits non-zero', async () => {
  if (!process.env['DATABASE_URL']) return

  const result = runCli(LOBBY_CLI, ['--match', '1', '--run-id', 'banana'])

  assert.notEqual(
    result.status,
    0,
    `expected non-zero exit on --run-id banana; stdout: ${result.stdout}; stderr: ${result.stderr}`,
  )
  assert.match(result.stderr, /run-id/i, `expected stderr to mention run-id; got: ${result.stderr}`)
})
