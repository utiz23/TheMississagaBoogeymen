/**
 * Roll up per-frame OCR fields into the per-match team-color + home/away
 * columns on `matches`.
 *
 * Per-frame inputs (from ocr_extraction_fields where entity_type='match'):
 *   - home_team_abbr / away_team_abbr — from net_chart + faceoff_map screens.
 *     The parser strips the "(H)" / "(A)" suffix into a clean abbreviation.
 *   - home_color_hex / away_color_hex — from action_tracker frames, sampled
 *     from the trapezoid ROIs behind each goal.
 *
 * Output (matches columns):
 *   - bgm_team_abbr / opp_team_abbr — which abbreviation belongs to BGM
 *     and which to the opponent, resolved by `resolveBgmSide`.
 *   - bgm_color_hex / opp_color_hex — the colour the in-game broadcast
 *     used for each club in this match.
 *   - bgm_was_home — overridden when OCR has a confident signal; otherwise
 *     left at the EA-payload-derived value.
 *
 * Strategy: per field_key, take the mode across all rows with status='ok'
 * weighted by confidence. The home/away mapping comes from
 * resolveBgmSide(awayAbbr, homeAbbr), which already handles the BGM-alias
 * matching used elsewhere in the worker.
 */

import { db, matches, ocrExtractionFields, ocrExtractions } from '@eanhl/db'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type { PromoterDb } from '../ocr-promoters/index.js'
import { resolveBgmSide } from '../ocr-promoters/resolve-bgm-side.js'

const ABBR_KEYS = ['home_team_abbr', 'away_team_abbr'] as const
const COLOR_KEYS = ['home_color_hex', 'away_color_hex'] as const

export interface AggregatedMatchColors {
  bgmTeamAbbr: string | null
  oppTeamAbbr: string | null
  bgmWasHome: boolean | null
  bgmColorHex: string | null
  oppColorHex: string | null
  /** How many extraction rows backed the consensus (for diagnostics). */
  sampleCount: number
}

export async function aggregateMatchColors(
  matchId: number,
  dbConn: PromoterDb | typeof db = db,
): Promise<AggregatedMatchColors> {
  // Pull all per-match field rows for this match in one go.
  const rows = await dbConn
    .select({
      fieldKey: ocrExtractionFields.fieldKey,
      rawText: ocrExtractionFields.rawText,
      parsedValueJson: ocrExtractionFields.parsedValueJson,
      confidence: ocrExtractionFields.confidence,
      status: ocrExtractionFields.status,
    })
    .from(ocrExtractionFields)
    .innerJoin(
      ocrExtractions,
      eq(ocrExtractionFields.extractionId, ocrExtractions.id),
    )
    .where(
      and(
        eq(ocrExtractions.matchId, matchId),
        eq(ocrExtractionFields.entityType, 'match'),
        inArray(ocrExtractionFields.fieldKey, [...ABBR_KEYS, ...COLOR_KEYS]),
        eq(ocrExtractionFields.status, 'ok'),
        isNotNull(ocrExtractionFields.rawText),
      ),
    )

  const homeAbbr = pickMode(rows, 'home_team_abbr')
  const awayAbbr = pickMode(rows, 'away_team_abbr')
  const homeColor = pickWeightedMode(rows, 'home_color_hex')
  const awayColor = pickWeightedMode(rows, 'away_color_hex')

  let bgmWasHome: boolean | null = null
  let bgmTeamAbbr: string | null = null
  let oppTeamAbbr: string | null = null
  let bgmColorHex: string | null = null
  let oppColorHex: string | null = null

  if (homeAbbr !== null || awayAbbr !== null) {
    try {
      const sides = await resolveBgmSide(matchId, awayAbbr, homeAbbr, dbConn as PromoterDb)
      bgmWasHome = sides.homeIs === 'for' // BGM is on the home side
      bgmTeamAbbr = sides.homeIs === 'for' ? homeAbbr : awayAbbr
      oppTeamAbbr = sides.homeIs === 'for' ? awayAbbr : homeAbbr
      bgmColorHex = sides.homeIs === 'for' ? homeColor : awayColor
      oppColorHex = sides.homeIs === 'for' ? awayColor : homeColor
    } catch {
      // Resolution failed — leave BGM-perspective fields null; the page
      // falls back to the design palette in that case.
    }
  }

  return {
    bgmTeamAbbr,
    oppTeamAbbr,
    bgmWasHome,
    bgmColorHex,
    oppColorHex,
    sampleCount: rows.length,
  }
}

/**
 * Aggregate + write back to the matches row in one call. Designed to run
 * after the per-screen promoters complete for a match. Idempotent — re-runs
 * overwrite the fields, so reprocessing the same captures is safe.
 */
export async function applyMatchColors(
  matchId: number,
  dbConn: PromoterDb | typeof db = db,
): Promise<AggregatedMatchColors> {
  const agg = await aggregateMatchColors(matchId, dbConn)
  // Only override bgm_was_home when OCR has a confident answer; otherwise
  // keep the EA-payload-derived value already on the row.
  const update: Record<string, string | boolean | null> = {
    bgmTeamAbbr: agg.bgmTeamAbbr,
    oppTeamAbbr: agg.oppTeamAbbr,
    bgmColorHex: agg.bgmColorHex,
    oppColorHex: agg.oppColorHex,
  }
  if (agg.bgmWasHome !== null) update.bgmWasHome = agg.bgmWasHome
  await dbConn.update(matches).set(update).where(eq(matches.id, matchId))
  return agg
}

// ─── internals ───────────────────────────────────────────────────────────

interface FieldRow {
  fieldKey: string
  rawText: string | null
  parsedValueJson: unknown
  confidence: string | null
  status: string
}

function valueFromRow(row: FieldRow): string | null {
  // parsedValueJson is `{ value: <T> }`; fall back to raw_text when value is
  // null (some parsers don't populate value when the OCR string is the same).
  const payload = row.parsedValueJson as { value?: unknown } | null
  const v = payload?.value
  if (typeof v === 'string' && v.length > 0) return v
  if (typeof row.rawText === 'string' && row.rawText.length > 0) return row.rawText
  return null
}

function pickMode(rows: FieldRow[], key: string): string | null {
  const counts = new Map<string, number>()
  for (const r of rows) {
    if (r.fieldKey !== key) continue
    const v = valueFromRow(r)
    if (v === null) continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return topByCount(counts)
}

function pickWeightedMode(rows: FieldRow[], key: string): string | null {
  const weights = new Map<string, number>()
  for (const r of rows) {
    if (r.fieldKey !== key) continue
    const v = valueFromRow(r)
    if (v === null) continue
    const w = r.confidence !== null ? parseFloat(r.confidence) : 0.5
    weights.set(v, (weights.get(v) ?? 0) + w)
  }
  return topByCount(weights)
}

function topByCount(counts: Map<string, number>): string | null {
  let best: string | null = null
  let bestCount = -Infinity
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v
      bestCount = n
    }
  }
  return best
}
