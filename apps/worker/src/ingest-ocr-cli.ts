/**
 * One-shot CLI wrapper around ingestOcrBatch.
 *
 * Usage:
 *   pnpm --filter worker ingest-ocr \
 *     --batch-dir <path> \
 *     --screen <screen-type> \
 *     --game-title-id <id> \
 *     [--match-id <id>] \
 *     [--capture-kind manual_screenshots|video_frames|post_game_bundle] \
 *     [--video-sha256 <hex>] \
 *     [--notes "..."] \
 *     [--dry-run]
 *
 * Required: --batch-dir, --screen, --game-title-id.
 * --match-id is recommended but optional. Without it, batch.match_id stays null
 * and promoters that depend on a match (events, box score) will fail loudly —
 * loadout/lobby promoters tolerate null match_id.
 */

import { resolve } from 'node:path'
import { sql, type OcrCaptureKind, type OcrScreenType } from '@eanhl/db'
import { ingestOcrBatch } from './ingest-ocr.js'

interface CliArgs {
  batchDir: string
  screen: OcrScreenType
  gameTitleId: number
  matchId: number | null
  captureKind: OcrCaptureKind
  notes: string | null
  dryRun: boolean
  videoSha256: string | null
  /** Pass-1 segment index when called from the video pipeline orchestrator.
   *  Forms part of the ocr_segments.segment_key for stable, idempotent rows. */
  videoSegmentIndex: number | null
  videoSegmentStartSec: number | null
  videoSegmentEndSec: number | null
  /** Game version label (e.g. "nhl26") for ocr_segments.ui_version. */
  uiVersion: string | null
  /** Pass-1 decoder version tag; lands in ocr_segments.decoder_version. */
  decoderVersion: string | null
  /** Pass-2 loadout extraction engine: 'typed_v1' | 'legacy'. Default 'legacy'.
   *  Task 2A-14 will act on this; for now it is accepted and threaded through. */
  loadoutEngine: string
  /** Path to loadout_evidence.json written by the typed_v1 extractor.
   *  Only present when loadout_engine='typed_v1' AND the file exists.
   *  Task 2A-14 will read and ingest this file. */
  loadoutEvidenceJsonPath: string | null
  /** Pass-2 lobby extraction engine: 'typed_v1' | 'legacy'. Default 'legacy'.
   *  Phase 3b — only affects pre_game_lobby_state_2 segments. */
  lobbyEngine: string
  /** Path to lobby_evidence.json written by the typed_v1 extractor.
   *  Only present when lobby_engine='typed_v1' AND the file exists. */
  lobbyEvidenceJsonPath: string | null
  /** Phase-A: the `ocr_decoder_runs.id` this ingest belongs to. When
   *  provided, every row written by this call is tagged with this run.
   *  Reprocess CLI sets this; legacy / one-shot calls leave it null. */
  runId: number | null
}

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

function parseArgs(): CliArgs {
  const batchDir = getFlag('batch-dir')
  if (!batchDir) throw new Error('Missing required --batch-dir <path>')

  const screen = getFlag('screen') as OcrScreenType | undefined
  if (!screen) throw new Error('Missing required --screen <screen-type>')

  const gameTitleIdStr = getFlag('game-title-id')
  if (!gameTitleIdStr) throw new Error('Missing required --game-title-id <id>')
  const gameTitleId = Number.parseInt(gameTitleIdStr, 10)
  if (!Number.isFinite(gameTitleId)) throw new Error(`Invalid --game-title-id: ${gameTitleIdStr}`)

  const matchIdStr = getFlag('match-id')
  const matchId = matchIdStr && matchIdStr !== 'null' ? Number.parseInt(matchIdStr, 10) : null
  if (matchId !== null && !Number.isFinite(matchId)) {
    throw new Error(`Invalid --match-id: ${String(matchIdStr)}`)
  }

  const captureKindStr = getFlag('capture-kind') ?? 'manual_screenshots'
  if (!['manual_screenshots', 'video_frames', 'post_game_bundle'].includes(captureKindStr)) {
    throw new Error(`Invalid --capture-kind: ${captureKindStr}`)
  }
  const captureKind = captureKindStr as OcrCaptureKind

  const notes = getFlag('notes') ?? null
  const dryRun = process.argv.includes('--dry-run')

  const videoSha256Raw = getFlag('video-sha256') ?? null
  if (videoSha256Raw !== null && !/^[0-9a-fA-F]{64}$/.test(videoSha256Raw)) {
    throw new Error(`Invalid --video-sha256 (must be 64 hex chars): ${videoSha256Raw}`)
  }
  const videoSha256 = videoSha256Raw ? videoSha256Raw.toLowerCase() : null

  const parseOptionalNumber = (name: string): number | null => {
    const raw = getFlag(name)
    if (raw === undefined) return null
    const n = Number.parseFloat(raw)
    if (!Number.isFinite(n)) throw new Error(`Invalid --${name}: ${raw}`)
    return n
  }

  const videoSegmentIndex = (() => {
    const n = parseOptionalNumber('video-segment-index')
    if (n === null) return null
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`--video-segment-index must be a non-negative integer; got ${n}`)
    }
    return n
  })()
  const videoSegmentStartSec = parseOptionalNumber('video-segment-start-sec')
  const videoSegmentEndSec = parseOptionalNumber('video-segment-end-sec')
  const uiVersion = getFlag('ui-version') ?? null
  const decoderVersion = getFlag('decoder-version') ?? null

  const loadoutEngineRaw = getFlag('loadout-engine') ?? 'legacy'
  if (!['typed_v1', 'legacy'].includes(loadoutEngineRaw)) {
    throw new Error(
      `Invalid --loadout-engine: ${loadoutEngineRaw}; expected 'typed_v1' or 'legacy'`,
    )
  }
  const loadoutEngine = loadoutEngineRaw
  const loadoutEvidenceJsonPath = getFlag('loadout-evidence-json') ?? null

  const lobbyEngineRaw = getFlag('lobby-engine') ?? 'legacy'
  if (!['typed_v1', 'legacy'].includes(lobbyEngineRaw)) {
    throw new Error(`Invalid --lobby-engine: ${lobbyEngineRaw}; expected 'typed_v1' or 'legacy'`)
  }
  const lobbyEngine = lobbyEngineRaw
  const lobbyEvidenceJsonPath = getFlag('lobby-evidence-json') ?? null

  const runIdRaw = getFlag('run-id')
  const runId = runIdRaw && runIdRaw !== 'null' ? Number.parseInt(runIdRaw, 10) : null
  if (runId !== null && !Number.isFinite(runId)) {
    throw new Error(`Invalid --run-id: ${String(runIdRaw)}`)
  }

  return {
    batchDir: resolve(batchDir),
    screen,
    gameTitleId,
    matchId,
    captureKind,
    notes,
    dryRun,
    videoSha256,
    videoSegmentIndex,
    videoSegmentStartSec,
    videoSegmentEndSec,
    uiVersion,
    decoderVersion,
    loadoutEngine,
    loadoutEvidenceJsonPath,
    lobbyEngine,
    lobbyEvidenceJsonPath,
    runId,
  }
}

async function main(): Promise<void> {
  const args = parseArgs()

  console.log(
    `[ingest-ocr] starting: screen=${args.screen} dir=${args.batchDir} game=${String(args.gameTitleId)} match=${args.matchId ?? 'null'}${args.dryRun ? ' (dry run)' : ''}`,
  )

  const summary = await ingestOcrBatch({
    batchDir: args.batchDir,
    screen: args.screen,
    gameTitleId: args.gameTitleId,
    matchId: args.matchId,
    captureKind: args.captureKind,
    notes: args.notes,
    dryRun: args.dryRun,
    videoSha256: args.videoSha256,
    videoSegmentIndex: args.videoSegmentIndex,
    videoSegmentStartSec: args.videoSegmentStartSec,
    videoSegmentEndSec: args.videoSegmentEndSec,
    uiVersion: args.uiVersion,
    decoderVersion: args.decoderVersion,
    loadoutEngine: args.loadoutEngine,
    loadoutEvidenceJsonPath: args.loadoutEvidenceJsonPath,
    lobbyEngine: args.lobbyEngine,
    lobbyEvidenceJsonPath: args.lobbyEvidenceJsonPath,
    runId: args.runId,
  })

  console.log(
    `[ingest-ocr] summary: batchId=${summary.batchId ?? 'null'} processed=${String(summary.processed)} succeeded=${String(summary.succeeded)} failed=${String(summary.failed)}`,
  )
}

main()
  .catch((err: unknown) => {
    console.error('[ingest-ocr] Fatal error:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void sql.end()
  })
