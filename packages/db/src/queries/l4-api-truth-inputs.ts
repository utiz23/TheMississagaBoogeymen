/**
 * L4 (API-truth accuracy) input queries.
 *
 * L4 grades OCR box-score / per-player output against the EA-API truth already
 * stored in `matches` + `player_match_stats`. This module only *reads* the two
 * sides; the pure comparator lives in `apps/worker/src/lib/l4-api-truth.ts`.
 *
 * Grounding (confirmed against real rows, Milestone ③ Task 3.2):
 *   - Box-score OCR lands in `match_period_summaries` (source='ocr', one row per
 *     period, stat cols nullable). It has NO run_id — it links to a run via
 *     `ocr_extraction_id → ocr_extractions.run_id`. For team totals we sum the
 *     per-period rows directly; run scoping is handled by the caller.
 *   - Team-total truth = `matches` score/shots columns + `getMatchFaceoffTotals`
 *     (summed per-player faceoff wins), NOT summed per-player SOG. For match 250
 *     the period-summary shots (29) legitimately differ from API shots (25).
 *   - Per-player OCR is NOT promoted; it lives in the raw `ocr_extraction_fields`
 *     audit rows for `post_game_player_summary` extractions. Each extraction
 *     captures ONE player's row (scalar field keys gamertag/goals/assists/saves/
 *     save_percentage, values shaped `{"value": X}`); the same player recurs
 *     across frames, so we majority-vote per persona below.
 */
import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '../client.js'
import { matchPeriodSummaries, playerMatchStats, players } from '../schema/index.js'
import { getMatchById, getMatchFaceoffTotals } from './matches.js'

/**
 * Summed OCR box-score team totals (from `match_period_summaries` source='ocr').
 * A field is null when OCR captured NO value for it across all periods (e.g. the
 * shots tab was never OCR'd) — distinct from a captured zero. The comparator
 * treats a null field as ungradable (accuracy, not coverage), so a silent gap
 * is never scored as a wrong read.
 */
export interface OcrTeamTotals {
  goalsFor: number | null
  goalsAgainst: number | null
  shotsFor: number | null
  shotsAgainst: number | null
  faceoffsFor: number | null
  faceoffsAgainst: number | null
}

/** EA-API team totals (the box-score screen shows these API team numbers). */
export interface ApiTeamTotals {
  scoreFor: number
  scoreAgainst: number
  shotsFor: number
  shotsAgainst: number
  faceoffsFor: number
  faceoffsAgainst: number
}

/** One majority-voted OCR per-player line. Any field may be null (OCR unread). */
export interface OcrPlayerLine {
  personaRaw: string
  goals: number | null
  assists: number | null
  saves: number | null
  /** Save %, same 0-100 scale as {@link ApiPlayerLine.savePct}. NULL when unread. */
  savePct: number | null
}

/** One EA-API per-player line. `saves`/`savePct` non-null only for goalies. */
export interface ApiPlayerLine {
  playerId: number
  gamertag: string
  goals: number
  assists: number
  saves: number | null
  /** Save % as a 0-100 percentage (saves / (saves + goalsAgainst) × 100). */
  savePct: number | null
}

/**
 * Summed OCR box-score team totals for a match. Sums the per-period
 * `match_period_summaries` rows with source='ocr' and period_number >= 1
 * (skips any -1 full-game aggregate rows). Returns null when the match has no
 * OCR box-score rows at all — the L4 team layer is then unscorable.
 *
 * The per-period for/against columns were already resolved to BGM side at
 * promotion time; we read them directly, no re-resolution.
 */
export async function getOcrBoxScoreForMatch(matchId: number): Promise<OcrTeamTotals | null> {
  // Raw SUM (no COALESCE): Postgres SUM skips nulls and returns null only when
  // every row's value is null, which is exactly the "OCR never captured this
  // field" signal we want to preserve. bigint sums arrive as strings.
  const [row] = await db
    .select({
      goalsFor: sql<string | null>`SUM(${matchPeriodSummaries.goalsFor})`,
      goalsAgainst: sql<string | null>`SUM(${matchPeriodSummaries.goalsAgainst})`,
      shotsFor: sql<string | null>`SUM(${matchPeriodSummaries.shotsFor})`,
      shotsAgainst: sql<string | null>`SUM(${matchPeriodSummaries.shotsAgainst})`,
      faceoffsFor: sql<string | null>`SUM(${matchPeriodSummaries.faceoffsFor})`,
      faceoffsAgainst: sql<string | null>`SUM(${matchPeriodSummaries.faceoffsAgainst})`,
      rowCount: sql<number>`COUNT(*)`.mapWith(Number),
    })
    .from(matchPeriodSummaries)
    .where(
      and(
        eq(matchPeriodSummaries.matchId, matchId),
        eq(matchPeriodSummaries.source, 'ocr'),
        gte(matchPeriodSummaries.periodNumber, 1),
      ),
    )
  if (!row || row.rowCount === 0) return null
  const num = (v: string | number | null): number | null => (v == null ? null : Number(v))
  return {
    goalsFor: num(row.goalsFor),
    goalsAgainst: num(row.goalsAgainst),
    shotsFor: num(row.shotsFor),
    shotsAgainst: num(row.shotsAgainst),
    faceoffsFor: num(row.faceoffsFor),
    faceoffsAgainst: num(row.faceoffsAgainst),
  }
}

/**
 * EA-API team totals for a match (the truth L4 grades OCR against). Combines
 * `getMatchById` (score/shots) with `getMatchFaceoffTotals` (faceoff wins,
 * summed per-player). Returns null when the match row is absent — L4 then
 * reports ungradable ("OCR sole source").
 */
export async function getApiTeamTotals(matchId: number): Promise<ApiTeamTotals | null> {
  const match = await getMatchById(matchId)
  if (!match) return null
  const fo = await getMatchFaceoffTotals(matchId)
  return {
    scoreFor: match.scoreFor,
    scoreAgainst: match.scoreAgainst,
    shotsFor: match.shotsFor,
    shotsAgainst: match.shotsAgainst,
    faceoffsFor: fo.ourWins,
    faceoffsAgainst: fo.oppWins,
  }
}

/**
 * EA-API per-player stat lines for a match (BGM roster only), joined to the
 * canonical gamertag. `savePct` is derived for goalies as
 * saves / (saves + goalsAgainst) × 100; null for skaters or when goalie fields
 * are absent.
 */
export async function getApiPlayerStats(matchId: number): Promise<ApiPlayerLine[]> {
  const rows = await db
    .select({
      playerId: playerMatchStats.playerId,
      gamertag: players.gamertag,
      goals: playerMatchStats.goals,
      assists: playerMatchStats.assists,
      saves: playerMatchStats.saves,
      goalsAgainst: playerMatchStats.goalsAgainst,
      isGoalie: playerMatchStats.isGoalie,
    })
    .from(playerMatchStats)
    .innerJoin(players, eq(players.id, playerMatchStats.playerId))
    .where(eq(playerMatchStats.matchId, matchId))

  return rows.map((r) => {
    const saves = r.saves ?? null
    const goalsAgainst = r.goalsAgainst ?? null
    const denom = (saves ?? 0) + (goalsAgainst ?? 0)
    const savePct =
      r.isGoalie && saves != null && goalsAgainst != null && denom > 0
        ? Number(((saves / denom) * 100).toFixed(2))
        : null
    return {
      playerId: r.playerId,
      gamertag: r.gamertag,
      goals: r.goals,
      assists: r.assists,
      saves,
      savePct,
    }
  })
}

interface RawPlayerRow {
  persona_raw: string | null
  goals: string | null
  assists: string | null
  saves: string | null
  save_pct: string | null
}

function toIntOrNull(v: string | null): number | null {
  if (v == null) return null
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

function toFloatOrNull(v: string | null): number | null {
  if (v == null) return null
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : null
}

/** Most frequent non-null value; ties resolve to first-seen. Null when all null. */
function vote<T>(values: (T | null)[]): T | null {
  const counts = new Map<T, number>()
  const order: T[] = []
  for (const v of values) {
    if (v == null) continue
    if (!counts.has(v)) order.push(v)
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  let best: T | null = null
  let bestCount = 0
  for (const v of order) {
    const c = counts.get(v) ?? 0
    if (c > bestCount) {
      best = v
      bestCount = c
    }
  }
  return best
}

/**
 * Majority-voted OCR per-player lines from the raw `ocr_extraction_fields`
 * audit rows of `post_game_player_summary` extractions for a match.
 *
 * Each extraction is one player row; the same persona recurs across frames.
 * We pivot the scalar field keys per extraction, drop frames with no gamertag,
 * then group by normalized persona and majority-vote each numeric field so one
 * garbled frame can't skew the graded value. Returns [] when the match has no
 * usable player-summary extractions (e.g. match 2582).
 */
export async function getOcrPlayerSummaryFields(matchId: number): Promise<OcrPlayerLine[]> {
  const rows = (await db.execute(sql`
    SELECT
      max(f.parsed_value_json->>'value') FILTER (WHERE f.field_key = 'gamertag')        AS persona_raw,
      max(f.parsed_value_json->>'value') FILTER (WHERE f.field_key = 'goals')           AS goals,
      max(f.parsed_value_json->>'value') FILTER (WHERE f.field_key = 'assists')         AS assists,
      max(f.parsed_value_json->>'value') FILTER (WHERE f.field_key = 'saves')           AS saves,
      max(f.parsed_value_json->>'value') FILTER (WHERE f.field_key = 'save_percentage') AS save_pct
    FROM ocr_extractions e
    JOIN ocr_extraction_fields f ON f.extraction_id = e.id
    WHERE e.match_id = ${matchId}
      AND e.screen_type = 'post_game_player_summary'
    GROUP BY e.id
    HAVING max(f.parsed_value_json->>'value') FILTER (WHERE f.field_key = 'gamertag') IS NOT NULL
  `)) as unknown as RawPlayerRow[]

  const groups = new Map<string, RawPlayerRow[]>()
  for (const r of rows) {
    const key = (r.persona_raw ?? '').trim().toLowerCase()
    if (!key) continue
    const bucket = groups.get(key)
    if (bucket) bucket.push(r)
    else groups.set(key, [r])
  }

  const lines: OcrPlayerLine[] = []
  for (const bucket of groups.values()) {
    const personaRaw = vote(bucket.map((r) => r.persona_raw)) ?? ''
    lines.push({
      personaRaw,
      goals: vote(bucket.map((r) => toIntOrNull(r.goals))),
      assists: vote(bucket.map((r) => toIntOrNull(r.assists))),
      saves: vote(bucket.map((r) => toIntOrNull(r.saves))),
      savePct: vote(bucket.map((r) => toFloatOrNull(r.save_pct))),
    })
  }
  return lines
}
