/**
 * Task 2 — A3 reprocess CLI: validateCandidateRun helper.
 *
 * The helper is a read-only check over a candidate ocr_decoder_runs row:
 *   - counts loadout-snapshot promotions (whole-row promoted rows whose
 *     target_table = 'player_loadout_snapshots' and whose
 *     target_semantic_key has NO 'source_screen' marker — these come
 *     from the player_loadout_view promoter, loadout-v2.ts)
 *   - counts lobby-snapshot promotions (whole-row promoted rows whose
 *     target_table = 'player_loadout_snapshots' and whose
 *     target_semantic_key carries source_screen='pre_game_lobby_state_2' —
 *     these come from the pre_game_lobby_state_2 promoter, lobby-v2.ts)
 *   - counts extractor errors (ocr_extractions rows with run_id = N and
 *     transform_status = 'error'), bucketed by transform_error text
 *
 * Phase-A defaults: minLoadoutSnapshots=5, minLobbySnapshots=1,
 * zero extractor errors. Returns ok=false + reasons rather than throwing
 * so callers (decoder-runs-cli validate, Task 4) can decide fail-soft vs
 * fail-hard.
 *
 * Three behaviors covered here:
 *   1. ok=true when a candidate run has >=5 loadout + >=1 lobby whole-row
 *      promotion + zero extractor errors.
 *   2. ok=false when ocr_extractions rows tagged to the run have
 *      transform_status='error'; failureReasons mentions "extractor errors".
 *   3. ok=false when the loadout promotion count is below the floor (2 < 5);
 *      failureReasons mentions the actual count + the floor.
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/validate-candidate-run.test.js
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  db,
  sql as rawSql,
  matches,
  ocrCaptureBatches,
  ocrDecoderRuns,
  ocrExtractions,
  ocrPromotions,
} from '@eanhl/db'
import { eq, like } from 'drizzle-orm'
import { validateCandidateRun } from '../lib/validate-candidate-run.js'

const GAME_TITLE_ID = 1 // NHL 26
const SENTINEL_TAG = 'A3-T2-validate-candidate'

const sentinelMatchIds: Set<number> = new Set()

async function cleanupMatch(matchId: number): Promise<void> {
  await db.delete(ocrPromotions).where(eq(ocrPromotions.matchId, matchId))
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
}

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanupAllSentinels()
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
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

interface FixtureSetupOptions {
  loadoutPromotionCount: number
  lobbyPromotionCount: number
  extractorErrorCount?: number
}

interface FixtureSetupResult {
  matchId: number
  runId: number
  batchId: number
}

async function setupFixture(
  eaMatchSuffix: string,
  opts: FixtureSetupOptions,
): Promise<FixtureSetupResult> {
  const errorCount = opts.extractorErrorCount ?? 0
  const [m] = await db
    .insert(matches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      eaMatchId: `${SENTINEL_TAG}-${eaMatchSuffix}`,
      matchType: 'gameType5',
      opponentClubId: '99999',
      opponentName: 'A3-T2 Sentinel Opp',
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
  const matchId: number = m.id
  sentinelMatchIds.add(matchId)

  const [run] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: null,
      decoderVersion: 'hmm-viterbi-v2',
      weightsHash: `wh-${eaMatchSuffix}`,
      configHash: `ch-${eaMatchSuffix}`,
      isActive: false,
      notes: `${SENTINEL_TAG}-${eaMatchSuffix}`,
    })
    .returning()
  assert.ok(run)
  const runId: number = run.id

  const [batch] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      matchId,
      sourceDirectory: `/tmp/${SENTINEL_TAG}/${eaMatchSuffix}`,
      captureKind: 'manual_screenshots',
      notes: `${SENTINEL_TAG}-${eaMatchSuffix}`,
      runId,
    })
    .returning({ id: ocrCaptureBatches.id })
  if (!batch) throw new Error('batch insert failed')
  const batchId: number = batch.id

  // Loadout promotions — whole-row, target_semantic_key WITHOUT source_screen.
  // Five distinct slots so the unique index doesn't collide.
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
        // intentionally NO source_screen — this marks a loadout-view promotion
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

  // Lobby promotions — whole-row, target_semantic_key WITH source_screen.
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

  // Extractor errors — ocr_extractions rows tagged to this run with
  // transform_status='error' and a transform_error message.
  for (let i = 0; i < errorCount; i++) {
    await db.insert(ocrExtractions).values({
      batchId,
      matchId,
      screenType: 'player_loadout_view',
      sourcePath: `/tmp/${SENTINEL_TAG}/${eaMatchSuffix}/err${i}.png`,
      rawResultJson: {},
      transformStatus: 'error',
      transformError: 'extractor_blew_up',
      runId,
    })
  }

  return { matchId, runId, batchId }
}

void test('validateCandidateRun returns ok=true with floor-satisfying promotions and zero errors', async () => {
  if (!process.env['DATABASE_URL']) return

  const fx = await setupFixture('ok-true', {
    loadoutPromotionCount: 5,
    lobbyPromotionCount: 1,
    extractorErrorCount: 0,
  })

  const result = await validateCandidateRun(fx.runId)

  assert.equal(
    result.ok,
    true,
    `expected ok=true, got reasons: ${result.details.failureReasons.join(', ')}`,
  )
  assert.equal(result.details.runId, fx.runId)
  assert.equal(result.details.matchId, fx.matchId)
  assert.equal(result.details.loadoutPromotionCount, 5)
  assert.equal(result.details.lobbyPromotionCount, 1)
  assert.deepEqual(result.details.extractorErrors, [])
  assert.deepEqual(result.details.failureReasons, [])
})

void test('validateCandidateRun returns ok=false when extractor errors are present', async () => {
  if (!process.env['DATABASE_URL']) return

  const fx = await setupFixture('err-present', {
    loadoutPromotionCount: 5,
    lobbyPromotionCount: 1,
    extractorErrorCount: 3,
  })

  const result = await validateCandidateRun(fx.runId)

  assert.equal(result.ok, false, 'expected ok=false when extractor errors are non-zero')
  assert.equal(
    result.details.extractorErrors.length,
    1,
    'expected one bucket for the single error kind',
  )
  assert.equal(result.details.extractorErrors[0]!.count, 3)
  const reasonsJoined = result.details.failureReasons.join(' | ')
  assert.match(
    reasonsJoined,
    /extractor errors/i,
    `expected reasons to mention extractor errors; got: ${reasonsJoined}`,
  )
})

void test('validateCandidateRun returns ok=false when loadout promotion count is below floor', async () => {
  if (!process.env['DATABASE_URL']) return

  const fx = await setupFixture('low-loadout', {
    loadoutPromotionCount: 2,
    lobbyPromotionCount: 1,
    extractorErrorCount: 0,
  })

  const result = await validateCandidateRun(fx.runId)

  assert.equal(result.ok, false, 'expected ok=false when loadout count < 5')
  assert.equal(result.details.loadoutPromotionCount, 2)
  const reasonsJoined = result.details.failureReasons.join(' | ')
  // Must mention the actual count (2) and the floor (5).
  assert.match(reasonsJoined, /2/, `expected reasons to mention the count 2; got: ${reasonsJoined}`)
  assert.match(reasonsJoined, /5/, `expected reasons to mention the floor 5; got: ${reasonsJoined}`)
  assert.match(
    reasonsJoined,
    /loadout/i,
    `expected reasons to mention "loadout"; got: ${reasonsJoined}`,
  )
})

void test('validateCandidateRun throws when the run does not exist', async () => {
  if (!process.env['DATABASE_URL']) return

  await assert.rejects(
    () => validateCandidateRun(-12345),
    /not found/i,
    'should throw an error containing "not found" when run id is unknown',
  )
})
