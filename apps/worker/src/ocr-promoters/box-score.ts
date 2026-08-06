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
 *
 * ⚠️ Rows are written WITHOUT a `review_status`, so they take the schema default
 * `pending_review` — invisible to the frontend until reviewed. That quarantine is
 * load-bearing and MUST NOT be short-circuited here: EA publishes no per-period
 * truth, so per-period reads are auto-unverifiable, and a match's PASS verdict
 * grades only its box-score FINAL (match 2675 is a correct PASS whose P3
 * goals-against reads 7 in a 5-goal game). Promotion to `reviewed` happens only
 * via `reconcile-periods` (full self-consistency against the API final) or manual
 * review. See docs/calibration/l4-per-period-review-gating-2026-07-16.md.
 */

import { matchPeriodSummaries, type NewMatchPeriodSummary } from '@eanhl/db'
import { and, eq, sql, type SQL } from 'drizzle-orm'
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
  if (periods.length === 0) {
    // The "produced zero period cells" phrase is matched by the validate gate
    // (validate-candidate-run.ts BOX_SCORE_ZERO_CELLS_PHRASE) to treat this
    // secondary-extractor miss as a NON-blocking warning on a redundant/transition
    // frame. Keep the phrase in sync.
    throw new Error(
      `Box Score ${statKind} extraction produced zero period cells — ` +
        `likely an ROI miss or non-box-score screen. Review extraction ${extractionId}.`,
    )
  }
  for (const cell of periods) {
    // Skip synthetic TOT row — it's an aggregate, not a real period.
    if (cell.period_number < 1) continue

    const awayValue = numericValue(cell.away_value)
    const homeValue = numericValue(cell.home_value)
    const forValue = sides.awayIs === 'for' ? awayValue : homeValue
    const againstValue = sides.awayIs === 'for' ? homeValue : awayValue

    // Preserve-non-null merge: a later frame only fills columns still null on
    // the existing row. `ocrExtractionId` deliberately keeps the FIRST
    // contributor, mirroring net-chart.ts/faceoff-map.ts's onConflictDoUpdate
    // COALESCE pattern — this promoter can't use onConflictDoUpdate itself
    // since a genuinely new period row still needs the plain-insert fallback
    // below, but the same "existing wins, incoming only fills null" semantics
    // apply here via the update's `.set()`.
    const updates: Partial<Record<keyof NewMatchPeriodSummary, SQL>> = {
      ocrExtractionId: sql`COALESCE(${matchPeriodSummaries.ocrExtractionId}, ${extractionId})`,
    }
    if (statKind === 'goals') {
      updates.goalsFor = sql`COALESCE(${matchPeriodSummaries.goalsFor}, ${forValue})`
      updates.goalsAgainst = sql`COALESCE(${matchPeriodSummaries.goalsAgainst}, ${againstValue})`
    } else if (statKind === 'shots') {
      updates.shotsFor = sql`COALESCE(${matchPeriodSummaries.shotsFor}, ${forValue})`
      updates.shotsAgainst = sql`COALESCE(${matchPeriodSummaries.shotsAgainst}, ${againstValue})`
    } else {
      updates.faceoffsFor = sql`COALESCE(${matchPeriodSummaries.faceoffsFor}, ${forValue})`
      updates.faceoffsAgainst = sql`COALESCE(${matchPeriodSummaries.faceoffsAgainst}, ${againstValue})`
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
