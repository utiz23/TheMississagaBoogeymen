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
    .innerJoin(ocrExtractions, eq(ocrExtractionFields.extractionId, ocrExtractions.id))
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
  let resolvedViaAbbr = false

  if (homeAbbr !== null || awayAbbr !== null) {
    try {
      const sides = await resolveBgmSide(matchId, awayAbbr, homeAbbr, dbConn as PromoterDb)
      bgmWasHome = sides.homeIs === 'for' // BGM is on the home side
      bgmTeamAbbr = sides.homeIs === 'for' ? homeAbbr : awayAbbr
      oppTeamAbbr = sides.homeIs === 'for' ? awayAbbr : homeAbbr
      bgmColorHex = sides.homeIs === 'for' ? homeColor : awayColor
      oppColorHex = sides.homeIs === 'for' ? awayColor : homeColor
      resolvedViaAbbr = true
    } catch {
      // Resolution failed — fall through to the bgm_was_home fallback below.
    }
  }

  // Fallback: when team-abbr OCR didn't fire (no net_chart / faceoff_map
  // segments) OR resolveBgmSide threw, but we still have colour samples,
  // bind colours using the authoritative matches.bgm_was_home flag the
  // EA-ingest path wrote. Abbreviations stay null because nothing OCR'd
  // them, but the colour rail still renders.
  if (!resolvedViaAbbr && (homeColor !== null || awayColor !== null)) {
    const [matchRow] = await dbConn
      .select({ bgmWasHome: matches.bgmWasHome })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1)
    if (matchRow && matchRow.bgmWasHome !== null) {
      bgmWasHome = matchRow.bgmWasHome
      bgmColorHex = matchRow.bgmWasHome ? homeColor : awayColor
      oppColorHex = matchRow.bgmWasHome ? awayColor : homeColor
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
  // For color samples, the trapezoid colour extractor returns LOTS of
  // low-confidence samples (the goal light lamps tint both trapezoids red
  // during scored-on plays) and a SMALL number of high-confidence samples
  // (clean captures of the actual team-tint UI). Total-weight aggregation
  // lets the contamination win — so for color fields we score by each
  // colour's MAXIMUM single-sample confidence, with count as a tiebreak.
  // Sum-weighted mode is fine for non-color fields (kept as legacy path).
  if (key.endsWith('_color_hex')) {
    return pickByMaxConfidence(rows, key)
  }
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

function pickByMaxConfidence(rows: FieldRow[], key: string): string | null {
  // For each colour, accumulate (count, sum-of-confidence). Two rules:
  //
  //   1. Only TRUE-BLACK grayscales (V ≤ 10, e.g. #000000) count as team
  //      brand colours. Mid-gray samples (#181818, #1c1c1c) come from
  //      occluded-trapezoid rink shadow, NOT a team's brand colour — when
  //      a team genuinely uses black they produce LOTS of #000000 samples
  //      and only sporadic #181818.
  //
  //   2. Score by total weighted confidence (count × max-conf bias). A
  //      colour that shows up many times across many extractions, even at
  //      modest per-sample confidence, beats a colour that shows up in a
  //      handful of bright captures.
  const stats = new Map<string, { totalConf: number; count: number; maxConf: number }>()
  for (const r of rows) {
    if (r.fieldKey !== key) continue
    const v = valueFromRow(r)
    if (v === null) continue
    if (isAmbiguousGray(v)) continue
    const conf = r.confidence !== null ? parseFloat(r.confidence) : 0.0
    const cur = stats.get(v) ?? { totalConf: 0, count: 0, maxConf: -Infinity }
    cur.totalConf += conf
    cur.count += 1
    cur.maxConf = Math.max(cur.maxConf, conf)
    stats.set(v, cur)
  }
  if (stats.size === 0) return null
  let best: string | null = null
  let bestScore = -Infinity
  for (const [v, s] of stats) {
    const score = s.totalConf
    if (score > bestScore) {
      best = v
      bestScore = score
    }
  }
  return best
}

/**
 * Reject a hex when it's a mid-gray "occluded trapezoid" artefact rather
 * than a genuine team colour. The trapezoid sampler returns conf=1.0 for
 * uniform dark-gray captures (e.g. #181818, #1c1c1c) when the trapezoid
 * is occluded or transparent, exposing the dark rink background. Those
 * are NOT team colours; they're noise.
 *
 * Pass-through cases:
 *  - True black (V ≤ 10, e.g. #000000) is a legitimate team brand for
 *    clubs whose in-game tint is black. Keep.
 *  - Any color with visible saturation (max-min ≥ 20). Keep.
 *
 * Reject only the in-between band: low-saturation pixels with max channel
 * 11–60 — the rink-shadow band the sampler should have rejected upstream
 * but doesn't.
 */
function isAmbiguousGray(hex: string): boolean {
  if (!hex.startsWith('#') || hex.length !== 7) return false
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  if ([r, g, b].some((n) => Number.isNaN(n))) return false
  const maxC = Math.max(r, g, b)
  const minC = Math.min(r, g, b)
  const saturated = maxC - minC >= 20
  if (saturated) return false
  // Grayscale: keep only true blacks (uniform-dark trapezoid is a real
  // team-brand-black signal); reject the mid-gray band.
  return maxC > 10 && maxC <= 60
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
