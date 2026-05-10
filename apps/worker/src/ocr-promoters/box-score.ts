/**
 * Promote a post_game_box_score_{goals,shots,faceoffs} extraction into
 * match_period_summaries.
 *
 * Three sub-tabs share one promoter; the result.stat_kind field discriminates
 * which numeric columns this run populates:
 *   - 'goals'    → goals_for, goals_against
 *   - 'shots'    → shots_for, shots_against
 *   - 'faceoffs' → faceoffs_for, faceoffs_against
 *
 * Each row upserts on (match_id, period_number, source='ocr'). Re-running with
 * a different stat_kind merges into the same row, preserving prior columns.
 *
 * Skips the synthetic TOT/FINAL row (period_number = -1).
 */

import {
  matchPeriodSummaries,
  type NewMatchPeriodSummary,
} from '@eanhl/db'
import { and, eq } from 'drizzle-orm'
import type { PromoterContext } from './index.js'
import { resolveBgmSide } from './resolve-bgm-side.js'
import type { OcrExtractionField } from '../ocr-cli-runner.js'

interface BoxScorePeriodCell {
  period_label: string
  period_number: number
  away_value: OcrExtractionField
  home_value: OcrExtractionField
}

export async function promoteBoxScore(ctx: PromoterContext): Promise<void> {
  const { result, extractionId, matchId, db } = ctx
  if (matchId === null) {
    throw new Error('Box Score promoter requires --match-id at batch ingest time')
  }

  const statKind = result.stat_kind
  if (statKind !== 'goals' && statKind !== 'shots' && statKind !== 'faceoffs') {
    throw new Error(`Unexpected stat_kind: ${String(statKind)}`)
  }

  const awayTeamName = stringValue(result.away_team as OcrExtractionField | undefined)
  const homeTeamName = stringValue(result.home_team as OcrExtractionField | undefined)
  const sides = await resolveBgmSide(matchId, awayTeamName, homeTeamName, db)

  const periods = Array.isArray(result.periods) ? (result.periods as BoxScorePeriodCell[]) : []
  for (const cell of periods) {
    // Skip synthetic TOT row — it's an aggregate, not a real period.
    if (cell.period_number < 1) continue

    const awayValue = numericValue(cell.away_value)
    const homeValue = numericValue(cell.home_value)
    const forValue = sides.awayIs === 'for' ? awayValue : homeValue
    const againstValue = sides.awayIs === 'for' ? homeValue : awayValue

    const updates: Partial<NewMatchPeriodSummary> = { ocrExtractionId: extractionId }
    if (statKind === 'goals') {
      updates.goalsFor = forValue
      updates.goalsAgainst = againstValue
    } else if (statKind === 'shots') {
      updates.shotsFor = forValue
      updates.shotsAgainst = againstValue
    } else {
      updates.faceoffsFor = forValue
      updates.faceoffsAgainst = againstValue
    }

    // Try update-first to avoid clobbering columns set by other tabs. If no row
    // exists yet, fall through to insert.
    const updated = await db
      .update(matchPeriodSummaries)
      .set(updates)
      .where(
        and(
          eq(matchPeriodSummaries.matchId, matchId),
          eq(matchPeriodSummaries.periodNumber, cell.period_number),
          eq(matchPeriodSummaries.source, 'ocr'),
        ),
      )
      .returning({ id: matchPeriodSummaries.id })

    if (updated.length === 0) {
      const insertValues: NewMatchPeriodSummary = {
        matchId,
        periodNumber: cell.period_number,
        periodLabel: cell.period_label,
        source: 'ocr',
        ocrExtractionId: extractionId,
        goalsFor: statKind === 'goals' ? forValue : null,
        goalsAgainst: statKind === 'goals' ? againstValue : null,
        shotsFor: statKind === 'shots' ? forValue : null,
        shotsAgainst: statKind === 'shots' ? againstValue : null,
        faceoffsFor: statKind === 'faceoffs' ? forValue : null,
        faceoffsAgainst: statKind === 'faceoffs' ? againstValue : null,
      }
      await db.insert(matchPeriodSummaries).values(insertValues)
    }
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
