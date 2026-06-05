/**
 * Promote a post_game_faceoff_map extraction into:
 *   - match_faceoff_dots                 (9 rows per processed period)
 *   - match_faceoff_zone_summaries       (2 rows per processed period: home + away)
 *
 * Storage keeps the EA UI's H/A orientation as-captured. BGM↔home/away
 * resolution happens on the frontend via matches.bgmWasHome — mirrors how
 * ActionTrackerMap handles team_side.
 *
 * Idempotent on re-runs via the unique indexes on each table.
 */

import {
  matchFaceoffDots,
  matchFaceoffZoneSummaries,
  type NewMatchFaceoffDot,
  type NewMatchFaceoffZoneSummary,
} from '@eanhl/db'
import { sql } from 'drizzle-orm'
import type { PromoterContext } from './index.js'
import { PERIOD_LABEL_UNRECOGNIZED } from '../lib/validate-candidate-run.js'
import type { OcrExtractionField } from '../ocr-cli-runner.js'

const DOT_IDS = [
  'lz_top',
  'lz_bot',
  'lnz_top',
  'lnz_bot',
  'center',
  'rnz_top',
  'rnz_bot',
  'rz_top',
  'rz_bot',
] as const

type DotId = (typeof DOT_IDS)[number]

interface FaceoffSide {
  overall_win_pct?: OcrExtractionField
  offensive_zone?: OcrExtractionField
  defensive_zone?: OcrExtractionField
  offensive_zone_wins?: OcrExtractionField
  offensive_zone_total?: OcrExtractionField
  defensive_zone_wins?: OcrExtractionField
  defensive_zone_total?: OcrExtractionField
}

interface FaceoffDotJson {
  dot_id?: string
  away_wins?: OcrExtractionField
  home_wins?: OcrExtractionField
}

export async function promoteFaceoffMap(ctx: PromoterContext): Promise<void> {
  const { result, extractionId, matchId, db } = ctx
  if (matchId === null) {
    throw new Error('Faceoff Map promoter requires --match-id at batch ingest time')
  }

  // period_number=0 is the parser's "unrecognized label" sentinel. Refusing
  // to write that row keeps it from silently overwriting the legitimate -1
  // ALL PERIODS slot in either match_faceoff_zone_summaries or
  // match_faceoff_dots' unique indexes.
  const rawPeriodNumber = result.period_number
  const periodLabelText = stringValue(result.period_label as OcrExtractionField | undefined)
  // The PERIOD_LABEL_UNRECOGNIZED: prefix is a stable machine token the validate
  // gate (validate-candidate-run.ts classifyExtractorError) matches to treat this
  // secondary-extractor miss as a NON-blocking warning. Keep the prefix in sync.
  if (typeof rawPeriodNumber !== 'number' || rawPeriodNumber === 0) {
    throw new Error(
      `${PERIOD_LABEL_UNRECOGNIZED} Faceoff Map period_label OCR unrecognized: '${periodLabelText ?? '(null)'}' — refusing to write into ALL PERIODS slot`,
    )
  }
  const periodNumber = rawPeriodNumber

  const away = result.away as FaceoffSide | undefined
  const home = result.home as FaceoffSide | undefined

  // ── zone summaries: one row per side ──
  for (const [block, sideKey] of [
    [away, 'away' as const] as const,
    [home, 'home' as const] as const,
  ]) {
    if (!block) continue
    const values: NewMatchFaceoffZoneSummary = {
      matchId,
      periodNumber,
      periodLabel: periodLabelText,
      teamSide: sideKey,
      overallWinPct: numericString(block.overall_win_pct, 2),
      offensiveZoneWins: numericValue(block.offensive_zone_wins),
      offensiveZoneTotal: numericValue(block.offensive_zone_total),
      defensiveZoneWins: numericValue(block.defensive_zone_wins),
      defensiveZoneTotal: numericValue(block.defensive_zone_total),
      source: 'ocr',
      ocrExtractionId: extractionId,
    }
    // Preserve-non-null merge: see net-chart.ts for rationale. `ocrExtractionId`
    // keeps the first contributor; `reviewStatus` is omitted from `set:` so
    // human review state survives re-runs.
    await db
      .insert(matchFaceoffZoneSummaries)
      .values(values)
      .onConflictDoUpdate({
        target: [
          matchFaceoffZoneSummaries.matchId,
          matchFaceoffZoneSummaries.periodNumber,
          matchFaceoffZoneSummaries.teamSide,
          matchFaceoffZoneSummaries.source,
        ],
        set: {
          // periodLabel always overwrites — see net-chart.ts for rationale.
          periodLabel: sql`EXCLUDED.period_label`,
          overallWinPct: sql`COALESCE(${matchFaceoffZoneSummaries.overallWinPct}, EXCLUDED.overall_win_pct)`,
          offensiveZoneWins: sql`COALESCE(${matchFaceoffZoneSummaries.offensiveZoneWins}, EXCLUDED.offensive_zone_wins)`,
          offensiveZoneTotal: sql`COALESCE(${matchFaceoffZoneSummaries.offensiveZoneTotal}, EXCLUDED.offensive_zone_total)`,
          defensiveZoneWins: sql`COALESCE(${matchFaceoffZoneSummaries.defensiveZoneWins}, EXCLUDED.defensive_zone_wins)`,
          defensiveZoneTotal: sql`COALESCE(${matchFaceoffZoneSummaries.defensiveZoneTotal}, EXCLUDED.defensive_zone_total)`,
          ocrExtractionId: sql`COALESCE(${matchFaceoffZoneSummaries.ocrExtractionId}, EXCLUDED.ocr_extraction_id)`,
        },
      })
  }

  // ── dots: always insert all 9, even when wins are null ──
  const dots = (result.dots ?? {}) as Record<string, FaceoffDotJson | undefined>
  for (const dotId of DOT_IDS) {
    const dot = dots[dotId]
    const values: NewMatchFaceoffDot = {
      matchId,
      periodNumber,
      periodLabel: periodLabelText,
      dotId: dotId as DotId,
      awayWins: dot ? numericValue(dot.away_wins) : null,
      homeWins: dot ? numericValue(dot.home_wins) : null,
      source: 'ocr',
      ocrExtractionId: extractionId,
    }
    // Preserve-non-null merge: when multiple frames produce the same dot,
    // each frame can contribute the away/home counts it could read without
    // clobbering a value another frame already established.
    await db
      .insert(matchFaceoffDots)
      .values(values)
      .onConflictDoUpdate({
        target: [
          matchFaceoffDots.matchId,
          matchFaceoffDots.periodNumber,
          matchFaceoffDots.dotId,
          matchFaceoffDots.source,
        ],
        set: {
          // periodLabel always overwrites — see net-chart.ts for rationale.
          periodLabel: sql`EXCLUDED.period_label`,
          awayWins: sql`COALESCE(${matchFaceoffDots.awayWins}, EXCLUDED.away_wins)`,
          homeWins: sql`COALESCE(${matchFaceoffDots.homeWins}, EXCLUDED.home_wins)`,
          ocrExtractionId: sql`COALESCE(${matchFaceoffDots.ocrExtractionId}, EXCLUDED.ocr_extraction_id)`,
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
  if (f.status !== 'ok') return null
  if (typeof f.value === 'number' && Number.isFinite(f.value)) return Math.round(f.value)
  if (typeof f.value === 'string') {
    const n = Number.parseInt(f.value, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

function numericString(f: OcrExtractionField | undefined, decimals: number): string | null {
  if (!f) return null
  if (typeof f.value === 'number' && Number.isFinite(f.value)) return f.value.toFixed(decimals)
  if (typeof f.value === 'string') {
    const n = Number.parseFloat(f.value)
    if (Number.isFinite(n)) return n.toFixed(decimals)
  }
  return null
}
