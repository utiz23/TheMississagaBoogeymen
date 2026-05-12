/**
 * Re-run OCR promoters from stored raw_result_json.
 *
 * When player_loadout_snapshots (or other domain rows) are missing despite
 * ocr_extractions having transform_status='success', this CLI re-dispatches
 * the promoter for each matching extraction using the stored raw_result_json.
 * No re-OCR needed — the result is already in the DB.
 *
 * The promoter's idempotent delete-before-reinsert logic ensures clean state.
 *
 * Usage:
 *   # Re-promote all loadout captures for a match
 *   pnpm --filter worker repromote-ocr --match 250 --screen player_loadout_view
 *
 *   # Re-promote all captures in a batch (any screen)
 *   pnpm --filter worker repromote-ocr --batch 18
 *
 *   # Re-promote a single extraction by ID
 *   pnpm --filter worker repromote-ocr --extraction 125
 */

import { db, sql, ocrExtractions, type OcrScreenType } from '@eanhl/db'
import { and, eq } from 'drizzle-orm'
import { getPromoter, type PromoterDb } from './ocr-promoters/index.js'
import type { OcrResult } from './ocr-cli-runner.js'

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

async function main(): Promise<void> {
  const matchIdStr = getFlag('match')
  const batchIdStr = getFlag('batch')
  const extractionIdStr = getFlag('extraction')
  const screenStr = getFlag('screen') as OcrScreenType | undefined

  let query = db
    .select({
      id: ocrExtractions.id,
      matchId: ocrExtractions.matchId,
      screenType: ocrExtractions.screenType,
      rawResultJson: ocrExtractions.rawResultJson,
    })
    .from(ocrExtractions)
    .$dynamic()

  if (extractionIdStr) {
    const id = Number.parseInt(extractionIdStr, 10)
    if (!Number.isFinite(id)) throw new Error(`Invalid --extraction: ${extractionIdStr}`)
    query = query.where(eq(ocrExtractions.id, id))
  } else if (matchIdStr && screenStr) {
    const matchId = Number.parseInt(matchIdStr, 10)
    if (!Number.isFinite(matchId)) throw new Error(`Invalid --match: ${matchIdStr}`)
    query = query.where(
      and(eq(ocrExtractions.matchId, matchId), eq(ocrExtractions.screenType, screenStr)),
    )
  } else if (batchIdStr) {
    const batchId = Number.parseInt(batchIdStr, 10)
    if (!Number.isFinite(batchId)) throw new Error(`Invalid --batch: ${batchIdStr}`)
    const clause = screenStr
      ? and(eq(ocrExtractions.batchId, batchId), eq(ocrExtractions.screenType, screenStr))
      : eq(ocrExtractions.batchId, batchId)
    query = query.where(clause)
  } else {
    console.error(
      'Usage:\n' +
        '  pnpm --filter worker repromote-ocr --match <id> --screen <type>\n' +
        '  pnpm --filter worker repromote-ocr --batch <id> [--screen <type>]\n' +
        '  pnpm --filter worker repromote-ocr --extraction <id>',
    )
    process.exitCode = 1
    return
  }

  const extractions = await query

  console.log(`[repromote] found ${String(extractions.length)} extraction(s) to re-promote`)

  let succeeded = 0
  let failed = 0

  for (const ext of extractions) {
    const promoter = getPromoter(ext.screenType as OcrScreenType)
    if (!promoter) {
      console.log(
        `[repromote] ${String(ext.id)}: no promoter for screen_type=${ext.screenType}, skipping`,
      )
      continue
    }

    try {
      await db.transaction(async (tx) => {
        await promoter({
          result: ext.rawResultJson as unknown as OcrResult,
          extractionId: ext.id,
          matchId: ext.matchId,
          db: tx as PromoterDb,
        })
        await tx
          .update(ocrExtractions)
          .set({ transformStatus: 'success', transformError: null })
          .where(eq(ocrExtractions.id, ext.id))
      })
      console.log(`[repromote] ${String(ext.id)}: ✓ success (screen=${ext.screenType})`)
      succeeded++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await db
        .update(ocrExtractions)
        .set({ transformStatus: 'error', transformError: msg })
        .where(eq(ocrExtractions.id, ext.id))
      console.error(`[repromote] ${String(ext.id)}: ✗ error — ${msg}`)
      failed++
    }
  }

  console.log(`[repromote] done: succeeded=${String(succeeded)} failed=${String(failed)}`)
}

main()
  .catch((err: unknown) => {
    console.error('[repromote] Fatal:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void sql.end()
  })
