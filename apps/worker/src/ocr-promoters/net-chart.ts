/**
 * Promote a post_game_net_chart extraction into match_shot_type_summaries.
 *
 * Per per-period frame: two rows (away + home) keyed on
 *   (match_id, team_side, period_number, source='ocr'),
 * plus a derived ALL PERIODS (period_number=-1) row per side recomputed from
 * every existing per-period row in the transaction. The score-strip header
 * (`29 SHOTS` / `16 SHOTS`) gives the game total even when the per-period
 * breakdown is incomplete — used as the total_shots fallback.
 *
 * period_number coming in:
 *   1..6  → per-period write + ALL PERIODS recompute.
 *   -1    → direct ALL PERIODS write from a real ALL PERIODS frame; no
 *           recompute (avoids overwriting authoritative data with sums of
 *           potentially-imperfect per-period reads).
 *   0     → parser couldn't read the period_label; promoter throws.
 *
 * Idempotent on re-runs via unique-index upsert.
 */

import { matchShotTypeSummaries, type NewMatchShotTypeSummary } from '@eanhl/db'
import { and, eq, sql } from 'drizzle-orm'
import type { PromoterContext, PromoterDb } from './index.js'
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

  // period_number=0 is the parser's "unrecognized label" sentinel. Refusing to
  // write that row keeps it from silently overwriting the legitimate -1
  // ALL PERIODS slot in the unique index.
  const rawPeriodNumber = result.period_number
  const periodLabelText = stringValue(result.period_label as OcrExtractionField | undefined)
  if (typeof rawPeriodNumber !== 'number' || rawPeriodNumber === 0) {
    throw new Error(
      `Net Chart period_label OCR unrecognized: '${periodLabelText ?? '(null)'}' — refusing to write into ALL PERIODS slot`,
    )
  }
  const periodNumber = rawPeriodNumber

  const awayLabel = stringValue(result.away_label as OcrExtractionField | undefined)
  const homeLabel = stringValue(result.home_label as OcrExtractionField | undefined)
  const sides = await resolveBgmSide(matchId, awayLabel, homeLabel, db)

  const away = result.away as NetChartSide | undefined
  const home = result.home as NetChartSide | undefined

  if (!away || !home) {
    throw new Error('Net Chart result missing away/home stat blocks')
  }

  // Score-strip header totals — same across every per-period frame in a match.
  // Mapped to BGM-perspective sides via the same away/home assignment as the
  // per-period blocks so the recompute step can fall back to them when the
  // per-period sum is incomplete.
  const awayHeaderTotal = numericValue(
    result.away_header_total_shots as OcrExtractionField | undefined,
  )
  const homeHeaderTotal = numericValue(
    result.home_header_total_shots as OcrExtractionField | undefined,
  )
  const headerTotalBySide: Record<'for' | 'against', number | null> = {
    for: null,
    against: null,
  }
  headerTotalBySide[sides.awayIs] = awayHeaderTotal
  headerTotalBySide[sides.homeIs] = homeHeaderTotal

  for (const [block, blockSide] of [[away, sides.awayIs] as const, [home, sides.homeIs] as const]) {
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

    // Preserve-non-null merge: when a later frame hits the same
    // (match, side, period) slot, only fill columns that are still null. This
    // lets each partial-frame contribute the cells it could read without
    // clobbering values another frame already established.
    // `ocrExtractionId` deliberately keeps the FIRST contributor so the audit
    // link survives subsequent re-promotions; `reviewStatus` is intentionally
    // omitted from `set:` so human review state survives re-runs too.
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
          // periodLabel always overwrites: the parser's cleaned label is
          // strictly better than stale noisy text like "1ST PERIOD RT".
          periodLabel: sql`EXCLUDED.period_label`,
          totalShots: sql`COALESCE(${matchShotTypeSummaries.totalShots}, EXCLUDED.total_shots)`,
          wristShots: sql`COALESCE(${matchShotTypeSummaries.wristShots}, EXCLUDED.wrist_shots)`,
          slapShots: sql`COALESCE(${matchShotTypeSummaries.slapShots}, EXCLUDED.slap_shots)`,
          backhandShots: sql`COALESCE(${matchShotTypeSummaries.backhandShots}, EXCLUDED.backhand_shots)`,
          snapShots: sql`COALESCE(${matchShotTypeSummaries.snapShots}, EXCLUDED.snap_shots)`,
          deflections: sql`COALESCE(${matchShotTypeSummaries.deflections}, EXCLUDED.deflections)`,
          powerPlayShots: sql`COALESCE(${matchShotTypeSummaries.powerPlayShots}, EXCLUDED.power_play_shots)`,
          ocrExtractionId: sql`COALESCE(${matchShotTypeSummaries.ocrExtractionId}, EXCLUDED.ocr_extraction_id)`,
        },
      })

    // Don't recompute when this frame IS the ALL PERIODS frame — its values
    // are already authoritative for the -1 slot.
    if (periodNumber !== -1) {
      await recomputeAllPeriodsAggregate(
        db,
        matchId,
        blockSide,
        extractionId,
        headerTotalBySide[blockSide],
      )
    }
  }
}

const SHOT_BREAKDOWN_COLS = [
  'totalShots',
  'wristShots',
  'slapShots',
  'backhandShots',
  'snapShots',
  'deflections',
  'powerPlayShots',
] as const

type ShotBreakdownCol = (typeof SHOT_BREAKDOWN_COLS)[number]

/**
 * Recompute the (match, side, -1) ALL PERIODS aggregate row from every
 * existing per-period (period_number > 0) row for the same side.
 *
 * Sum semantics: if ANY contributing row has NULL for a given column, the
 * aggregate for that column is NULL (so partial-OCR-failure surfaces rather
 * than under-counting). total_shots uses the header reading as a fallback
 * when the per-period sum is incomplete — the header is identical across
 * every frame in a match, so even one good frame establishes it.
 *
 * Unlike per-period writes, this upsert OVERWRITES on conflict (no COALESCE)
 * because it's a recomputed derivation, not a partial-frame merge.
 */
async function recomputeAllPeriodsAggregate(
  db: PromoterDb,
  matchId: number,
  teamSide: 'for' | 'against',
  extractionId: number,
  headerTotalShots: number | null,
): Promise<void> {
  const perPeriodRows = await db
    .select({
      totalShots: matchShotTypeSummaries.totalShots,
      wristShots: matchShotTypeSummaries.wristShots,
      slapShots: matchShotTypeSummaries.slapShots,
      backhandShots: matchShotTypeSummaries.backhandShots,
      snapShots: matchShotTypeSummaries.snapShots,
      deflections: matchShotTypeSummaries.deflections,
      powerPlayShots: matchShotTypeSummaries.powerPlayShots,
    })
    .from(matchShotTypeSummaries)
    .where(
      and(
        eq(matchShotTypeSummaries.matchId, matchId),
        eq(matchShotTypeSummaries.teamSide, teamSide),
        sql`${matchShotTypeSummaries.periodNumber} > 0`,
        eq(matchShotTypeSummaries.source, 'ocr'),
      ),
    )

  const sums: Record<ShotBreakdownCol, number | null> = {
    totalShots: null,
    wristShots: null,
    slapShots: null,
    backhandShots: null,
    snapShots: null,
    deflections: null,
    powerPlayShots: null,
  }
  if (perPeriodRows.length > 0) {
    for (const col of SHOT_BREAKDOWN_COLS) {
      let total = 0
      let anyNull = false
      for (const row of perPeriodRows) {
        const v = row[col]
        if (v === null || v === undefined) {
          anyNull = true
          break
        }
        total += v
      }
      sums[col] = anyNull ? null : total
    }
  }
  // For total_shots, prefer the score-strip header: it's a single large
  // isolated digit that RapidOCR reads reliably (0.95+ confidence in match
  // 250), while the per-period sum compounds the error of every per-period
  // digit read. Fall back to the sum only when the header is missing.
  const totalShots = headerTotalShots ?? sums.totalShots

  const values: NewMatchShotTypeSummary = {
    matchId,
    teamSide,
    periodNumber: -1,
    periodLabel: 'ALL PERIODS',
    totalShots,
    wristShots: sums.wristShots,
    slapShots: sums.slapShots,
    backhandShots: sums.backhandShots,
    snapShots: sums.snapShots,
    deflections: sums.deflections,
    powerPlayShots: sums.powerPlayShots,
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
      // Unconditional overwrite — recomputed derivation, not a merge.
      // reviewStatus omitted on purpose so any human review of the aggregate
      // row survives subsequent recomputes.
      set: {
        periodLabel: values.periodLabel,
        totalShots: values.totalShots,
        wristShots: values.wristShots,
        slapShots: values.slapShots,
        backhandShots: values.backhandShots,
        snapShots: values.snapShots,
        deflections: values.deflections,
        powerPlayShots: values.powerPlayShots,
        ocrExtractionId: values.ocrExtractionId,
      },
    })
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
