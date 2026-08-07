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

/**
 * Majority-voted TOT-row final from the raw box-score-goals frames, in the
 * screen's neutral away/home perspective (NOT yet resolved to BGM for/against —
 * the caller applies {@link resolveSidesFromNames}). Null when no frame yielded
 * a usable TOT cell. This is the strongest correctness signal (Task 4.G): the
 * promoter discards the `period.TOT` row, so it is read here straight from raw.
 */
export interface OcrBoxScoreFinal {
  awayGoals: number | null
  homeGoals: number | null
  awayTeam: string | null
  homeTeam: string | null
}

/**
 * One promoted OCR per-period row (source='ocr', period_number >= 1).
 *
 * The faceoff pair is OPTIONAL on the type, not on the query:
 * {@link getOcrBoxScorePeriodsForMatch} always populates it. `undefined` marks a
 * caller that supplies goals only, and the comparator treats it exactly like a
 * null read — unread, never as a zero.
 */
export interface OcrBoxScorePeriod {
  periodNumber: number
  goalsFor: number | null
  goalsAgainst: number | null
  faceoffsFor?: number | null
  faceoffsAgainst?: number | null
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
 * Longest `player_match_stats.toi_seconds` for a match — EA-API truth about how
 * long the game actually ran. L4 turns it into `periodsPlayed`, which
 * de-confounds the vacuous per-period-sum shape (a game that ended after P1
 * looks identical to a TOT-cell leak until you know only one period was played).
 *
 * MAX, not AVG: the longest-playing skater measures the game's duration, while
 * a player who joined late or left early would understate it. BGM rows only —
 * both teams skate the same clock, so the opponent table adds nothing.
 *
 * `null` when the match has no player rows, or every row's TOI is null.
 */
export async function getMaxToiSecondsForMatch(matchId: number): Promise<number | null> {
  const [row] = await db
    .select({ maxToi: sql<number | null>`max(${playerMatchStats.toiSeconds})` })
    .from(playerMatchStats)
    .where(eq(playerMatchStats.matchId, matchId))
  return row?.maxToi == null ? null : Number(row.maxToi)
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
  // Sort by persona for a stable, DB-row-order-independent result (SQL GROUP BY
  // has no guaranteed order). Codepoint compare, not localeCompare, so the order
  // is identical across environments — the L4 diff/mismatch arrays are baked into
  // regression-floor JSONs and must reproduce exactly.
  lines.sort((a, b) => (a.personaRaw < b.personaRaw ? -1 : a.personaRaw > b.personaRaw ? 1 : 0))
  return lines
}

interface RawBoxFinalRow {
  away_tot: string | null
  home_tot: string | null
  away_team: string | null
  home_team: string | null
}

/** Blank/whitespace-only strings collapse to null so they never win a vote. */
function nonBlankOrNull(v: string | null): string | null {
  if (v == null) return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

/**
 * Majority-voted TOT-row (`period.TOT`) final goals + team names, from the raw
 * `ocr_extraction_fields` of a match's `post_game_box_score_goals` extractions.
 *
 * The promoter drops the synthetic TOT row (`box-score.ts` skips period < 1), so
 * the final is read here straight from raw — one frame per extraction, then each
 * cell majority-voted across frames so a single garbled frame can't skew it
 * (mirrors {@link getOcrPlayerSummaryFields}). Returns the neutral away/home
 * values; the caller resolves which side is BGM. Null when NO frame yielded a
 * TOT goals cell (both sides voted null) — nothing to grade the final against.
 */
export async function getOcrBoxScoreFinalForMatch(
  matchId: number,
): Promise<OcrBoxScoreFinal | null> {
  const rows = (await db.execute(sql`
    SELECT
      max(f.parsed_value_json->>'value') FILTER (
        WHERE f.entity_type = 'team' AND f.entity_key = 'away' AND f.field_key = 'period.TOT') AS away_tot,
      max(f.parsed_value_json->>'value') FILTER (
        WHERE f.entity_type = 'team' AND f.entity_key = 'home' AND f.field_key = 'period.TOT') AS home_tot,
      max(f.parsed_value_json->>'value') FILTER (WHERE f.field_key = 'away_team') AS away_team,
      max(f.parsed_value_json->>'value') FILTER (WHERE f.field_key = 'home_team') AS home_team
    FROM ocr_extractions e
    JOIN ocr_extraction_fields f ON f.extraction_id = e.id
    WHERE e.match_id = ${matchId}
      AND e.screen_type = 'post_game_box_score_goals'
    GROUP BY e.id
  `)) as unknown as RawBoxFinalRow[]
  if (rows.length === 0) return null

  const awayGoals = vote(rows.map((r) => toIntOrNull(r.away_tot)))
  const homeGoals = vote(rows.map((r) => toIntOrNull(r.home_tot)))
  if (awayGoals == null && homeGoals == null) return null

  return {
    awayGoals,
    homeGoals,
    awayTeam: vote(rows.map((r) => nonBlankOrNull(r.away_team))),
    homeTeam: vote(rows.map((r) => nonBlankOrNull(r.home_team))),
  }
}

/**
 * Promoted OCR per-period rows (source='ocr', period_number >= 1), ordered by
 * period. For/against are already BGM-resolved at promotion time. Feeds L4's
 * bounded per-family sub-metrics: a period row present but with a null side is
 * an unread period for that family — it never counts toward that family's
 * coverage, so a family's sum is graded only once every EXPECTED period (the
 * periods EA TOI proves the game reached) has both sides.
 *
 * Reads the raw columns deliberately — this is the reconciliation input, which
 * has to see values BEFORE review authorizes them. It must never be pointed at
 * `getMatchPeriodSummaries`, whose family masking exists for the read boundary.
 *
 * Goals and faceoffs both come back because both can be graded against EA truth
 * (final score / summed per-player faceoff wins). Shots deliberately do not: the
 * box-score per-period shot counts legitimately differ from `matches.shots_*`
 * (match 250 reads 29 vs API 25), so EA supplies nothing that can grade them.
 */
export async function getOcrBoxScorePeriodsForMatch(matchId: number): Promise<OcrBoxScorePeriod[]> {
  const rows = await db
    .select({
      periodNumber: matchPeriodSummaries.periodNumber,
      goalsFor: matchPeriodSummaries.goalsFor,
      goalsAgainst: matchPeriodSummaries.goalsAgainst,
      faceoffsFor: matchPeriodSummaries.faceoffsFor,
      faceoffsAgainst: matchPeriodSummaries.faceoffsAgainst,
    })
    .from(matchPeriodSummaries)
    .where(
      and(
        eq(matchPeriodSummaries.matchId, matchId),
        eq(matchPeriodSummaries.source, 'ocr'),
        gte(matchPeriodSummaries.periodNumber, 1),
      ),
    )
    .orderBy(matchPeriodSummaries.periodNumber)
  return rows.map((r) => ({
    periodNumber: r.periodNumber,
    goalsFor: r.goalsFor ?? null,
    goalsAgainst: r.goalsAgainst ?? null,
    faceoffsFor: r.faceoffsFor ?? null,
    faceoffsAgainst: r.faceoffsAgainst ?? null,
  }))
}
