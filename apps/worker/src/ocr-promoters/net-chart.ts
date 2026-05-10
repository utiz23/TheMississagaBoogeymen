/**
 * Promote a post_game_net_chart extraction into match_shot_type_summaries.
 *
 * Two rows per extraction (away + home), keyed on
 *   (match_id, team_side, period_number, source='ocr').
 *
 * period_number = -1 when the OCR'd period_label is "ALL PERIODS" or
 * unrecognized; otherwise 1/2/3/4/5/6 derived from the label.
 *
 * Idempotent on re-runs: upsert via existing unique index.
 */

import {
  matchShotTypeSummaries,
  type NewMatchShotTypeSummary,
} from '@eanhl/db'
import type { PromoterContext } from './index.js'
import { resolveBgmSide } from './resolve-bgm-side.js'
import type { OcrExtractionField } from '../ocr-cli-runner.js'

interface NetChartSide {
  total_shots: OcrExtractionField
  wrist_shots: OcrExtractionField
  slap_shots: OcrExtractionField
  backhand_shots: OcrExtractionField
  snap_shots: OcrExtractionField
  deflections: OcrExtractionField
  power_play_shots: OcrExtractionField
}

export async function promoteNetChart(ctx: PromoterContext): Promise<void> {
  const { result, extractionId, matchId, db } = ctx
  if (matchId === null) {
    throw new Error('Net Chart promoter requires --match-id at batch ingest time')
  }

  const periodNumber = typeof result.period_number === 'number' ? result.period_number : -1
  const periodLabelText = stringValue(result.period_label as OcrExtractionField | undefined)

  const awayLabel = stringValue(result.away_label as OcrExtractionField | undefined)
  const homeLabel = stringValue(result.home_label as OcrExtractionField | undefined)
  const sides = await resolveBgmSide(matchId, awayLabel, homeLabel, db)

  const away = result.away as NetChartSide | undefined
  const home = result.home as NetChartSide | undefined

  if (!away || !home) {
    throw new Error('Net Chart result missing away/home stat blocks')
  }

  for (const [block, blockSide] of [
    [away, sides.awayIs] as const,
    [home, sides.homeIs] as const,
  ]) {
    const values: NewMatchShotTypeSummary = {
      matchId,
      teamSide: blockSide,
      periodNumber,
      periodLabel: periodLabelText,
      totalShots: numericValue(block.total_shots),
      wristShots: numericValue(block.wrist_shots),
      slapShots: numericValue(block.slap_shots),
      backhandShots: numericValue(block.backhand_shots),
      snapShots: numericValue(block.snap_shots),
      deflections: numericValue(block.deflections),
      powerPlayShots: numericValue(block.power_play_shots),
      source: 'ocr',
      ocrExtractionId: extractionId,
    }

    await db
      .insert(matchShotTypeSummaries)
      .values(values)
      .onConflictDoUpdate({
        target: [
          matchShotTypeSummaries.matchId,
          matchShotTypeSummaries.teamSide,
          matchShotTypeSummaries.periodNumber,
          matchShotTypeSummaries.source,
        ],
        set: {
          periodLabel: values.periodLabel,
          totalShots: values.totalShots,
          wristShots: values.wristShots,
          slapShots: values.slapShots,
          backhandShots: values.backhandShots,
          snapShots: values.snapShots,
          deflections: values.deflections,
          powerPlayShots: values.powerPlayShots,
          ocrExtractionId: extractionId,
        },
      })
  }
}

function stringValue(f: OcrExtractionField | undefined): string | null {
  if (!f) return null
  if (typeof f.value === 'string' && f.value) return f.value
  if (f.raw_text) return f.raw_text
  return null
}

function numericValue(f: OcrExtractionField | undefined): number | null {
  if (!f) return null
  if (typeof f.value === 'number' && Number.isFinite(f.value)) return Math.round(f.value)
  if (typeof f.value === 'string') {
    const n = Number.parseInt(f.value, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}
