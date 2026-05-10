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
  const matchId =
    matchIdStr && matchIdStr !== 'null' ? Number.parseInt(matchIdStr, 10) : null
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

  return {
    batchDir: resolve(batchDir),
    screen,
    gameTitleId,
    matchId,
    captureKind,
    notes,
    dryRun,
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
