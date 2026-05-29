/**
 * Run-level quality reporting helpers (Phase 2 of the Run-Level Quality
 * Reporting workstream — plan-file ok-plan-this-run-level-nifty-comet.md).
 *
 * Unlike the match-quality CLI helpers in `apps/worker/src/match-quality-cli.ts`
 * — which group everything by `match_id` — these queries are scoped to a
 * specific `ocr_decoder_runs.id`. The reports they feed are observability
 * artifacts attributed to one ingest run, so they must be able to report on
 * any run (active or superseded), not just the live one.
 *
 * No `liveRunFilter` used here on purpose: callers pass the exact run_id they
 * want to inspect.
 */

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, type Database } from '../client.js'
import { ocrFieldEvidence, ocrPromotions, ocrSegments } from '../schema/ocr-evidence.js'
import { ocrExtractions } from '../schema/ocr-pipeline.js'
import { ocrRunQualityReports } from '../schema/ocr-run-quality-reports.js'
import { playerLoadoutSnapshots } from '../schema/player-loadout.js'
import { matchEvents } from '../schema/match-events.js'

// ── 1. Screen-table-by-run ───────────────────────────────────────────────────

export interface ScreenRowByRun {
  screenType: string
  frames: number
  ok: number
  err: number
  reviewed: number
  avgConf: number | null
  minConf: number | null
  maxConf: number | null
}

/**
 * Run-scoped analog of `buildScreenTable` in `apps/worker/src/match-quality-cli.ts`.
 *
 * Same row shape; same aggregations; but grouped by `ocr_extractions.run_id`
 * rather than `match_id`. `ocr_extractions` carries its own `run_id` column
 * (Phase-A), so no join through `ocr_capture_batches` is needed.
 */
export async function buildScreenTableByRun(
  runId: number,
  conn?: Database,
): Promise<ScreenRowByRun[]> {
  const c = conn ?? db
  const rows = await c
    .select({
      screenType: ocrExtractions.screenType,
      frames: sql<string>`COUNT(*)::text`,
      ok: sql<string>`COUNT(*) FILTER (WHERE ${ocrExtractions.transformStatus} = 'success')::text`,
      err: sql<string>`COUNT(*) FILTER (WHERE ${ocrExtractions.transformStatus} = 'error')::text`,
      reviewed: sql<string>`COUNT(*) FILTER (WHERE ${ocrExtractions.reviewStatus} = 'reviewed')::text`,
      avgConf: sql<
        string | null
      >`ROUND(AVG(${ocrExtractions.overallConfidence})::numeric, 3)::text`,
      minConf: sql<
        string | null
      >`ROUND(MIN(${ocrExtractions.overallConfidence})::numeric, 3)::text`,
      maxConf: sql<
        string | null
      >`ROUND(MAX(${ocrExtractions.overallConfidence})::numeric, 3)::text`,
    })
    .from(ocrExtractions)
    .where(eq(ocrExtractions.runId, runId))
    .groupBy(ocrExtractions.screenType)
    .orderBy(ocrExtractions.screenType)
  return rows.map((r) => ({
    screenType: r.screenType,
    frames: Number(r.frames),
    ok: Number(r.ok),
    err: Number(r.err),
    reviewed: Number(r.reviewed),
    avgConf: r.avgConf !== null ? Number(r.avgConf) : null,
    minConf: r.minConf !== null ? Number(r.minConf) : null,
    maxConf: r.maxConf !== null ? Number(r.maxConf) : null,
  }))
}

// ── 2. Promotion distribution ────────────────────────────────────────────────

export interface PromotionDistribution {
  by_status: Record<string, number>
  by_blocking_reason: Record<string, number>
  by_field_key: Record<string, { promoted: number; blocked: number }>
  totals: { promoted: number; blocked: number; rows: number }
}

/**
 * 3-axis breakdown of `ocr_promotions` rows scoped to a single run.
 *
 * Returned shape:
 *   - by_status         — Record<promotion_status, count>
 *   - by_blocking_reason — Record<reason | 'none', count>  ('none' = NULL)
 *   - by_field_key      — Record<field_key, {promoted, blocked}>
 *   - totals            — {promoted, blocked, rows}
 *
 * `promoted` counts `promotion_status = 'promoted'`; `blocked` counts any
 * status starting with `'blocked_'`. The four reader queries run in parallel.
 */
export async function buildPromotionDistribution(
  runId: number,
  conn?: Database,
): Promise<PromotionDistribution> {
  const c = conn ?? db
  const blockedExpr = sql<boolean>`${ocrPromotions.promotionStatus} LIKE 'blocked_%'`

  const [statusRows, reasonRows, fieldRows, totalsRow] = await Promise.all([
    c
      .select({
        status: ocrPromotions.promotionStatus,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(ocrPromotions)
      .where(eq(ocrPromotions.runId, runId))
      .groupBy(ocrPromotions.promotionStatus),
    c
      .select({
        reason: sql<
          string | null
        >`COALESCE(${ocrPromotions.blockingReason}, 'none')`,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(ocrPromotions)
      .where(eq(ocrPromotions.runId, runId))
      .groupBy(sql`COALESCE(${ocrPromotions.blockingReason}, 'none')`),
    c
      .select({
        fieldKey: sql<string | null>`COALESCE(${ocrPromotions.fieldKey}, '<row>')`,
        promoted: sql<string>`COUNT(*) FILTER (WHERE ${ocrPromotions.promotionStatus} = 'promoted')::text`,
        blocked: sql<string>`COUNT(*) FILTER (WHERE ${blockedExpr})::text`,
      })
      .from(ocrPromotions)
      .where(eq(ocrPromotions.runId, runId))
      .groupBy(sql`COALESCE(${ocrPromotions.fieldKey}, '<row>')`),
    c
      .select({
        promoted: sql<string>`COUNT(*) FILTER (WHERE ${ocrPromotions.promotionStatus} = 'promoted')::text`,
        blocked: sql<string>`COUNT(*) FILTER (WHERE ${blockedExpr})::text`,
        rows: sql<string>`COUNT(*)::text`,
      })
      .from(ocrPromotions)
      .where(eq(ocrPromotions.runId, runId))
      .then((rows) => rows[0] ?? { promoted: '0', blocked: '0', rows: '0' }),
  ])

  const by_status: Record<string, number> = {}
  for (const r of statusRows) by_status[r.status] = Number(r.count)

  const by_blocking_reason: Record<string, number> = {}
  for (const r of reasonRows) by_blocking_reason[r.reason ?? 'none'] = Number(r.count)

  const by_field_key: Record<string, { promoted: number; blocked: number }> = {}
  for (const r of fieldRows) {
    by_field_key[r.fieldKey ?? '<row>'] = {
      promoted: Number(r.promoted),
      blocked: Number(r.blocked),
    }
  }

  return {
    by_status,
    by_blocking_reason,
    by_field_key,
    totals: {
      promoted: Number(totalsRow.promoted),
      blocked: Number(totalsRow.blocked),
      rows: Number(totalsRow.rows),
    },
  }
}

// ── 3. Multi-layer defense counters ──────────────────────────────────────────

export interface DefenseLayerCounters {
  is_cpu_demotions: number
  /**
   * v1 limitation: cross-team-dupe demotions leave no marker today, so this
   * is the same value as `is_cpu_demotions`. Reserved for a future schema
   * change that records cross-team-dupe demotions explicitly.
   */
  is_cpu_or_demoted_combined: number
  /**
   * Segment-level heuristic — may overcount vs Python's frame-level
   * `_demote_cross_team_duplicates` (slot_identity.py). Python operates on a
   * single frame's `subjects` list; lobby evidence picks the best frame per
   * slot across the whole segment (lobby_evidence.py), so grouping by
   * segment_id can flag cross-team pairs that never coexisted in one frame.
   * The frame-level counter requires per-frame evidence provenance not
   * stored in v1. May also double-count CPU rows that share normalized tags.
   * NULL when the in-SQL inference is not safe (currently never).
   */
  cross_team_dupes_segment_level_heuristic: number | null
  or_fold_inferences: number
  hard_field_blocks: number
  junk_gamertag_blocks_ts: number
  /** v1 limitation: silent at extractor today. */
  junk_gamertag_blocks_python: number | null
  notes: string[]
}

/**
 * Multi-layer defense visibility for a single run.
 *
 * Each counter answers "how many times did defense layer X fire?". The CPU
 * demotion / cross-team dedup counters are derived from `ocr_field_evidence`
 * rows where `field_key = 'is_cpu'` and the candidate value is true; both
 * the JSONB `true` and the string `"true"` shapes are accepted.
 */
export async function buildDefenseLayerCounters(
  runId: number,
  conn?: Database,
): Promise<DefenseLayerCounters> {
  const c = conn ?? db

  // is_cpu = true (JSONB true OR string "true"). The detector writes the
  // JSONB boolean, but historical / synthetic rows occasionally carry the
  // string form. Accept both.
  const isCpuTruePredicate = sql`(
    ${ocrFieldEvidence.candidateValue}::text = 'true'
    OR ${ocrFieldEvidence.candidateValue}::text = '"true"'
  )`

  const [cpuCountRow, orFoldRow, hardBlockRow, junkTsRow, lobbyEvidenceRows] = await Promise.all([
    c
      .select({ count: sql<string>`COUNT(*)::text` })
      .from(ocrFieldEvidence)
      .where(
        and(
          eq(ocrFieldEvidence.runId, runId),
          eq(ocrFieldEvidence.fieldKey, 'is_cpu'),
          isCpuTruePredicate,
        ),
      )
      .then((rs) => rs[0] ?? { count: '0' }),
    // or_fold_inferences — count promotions whose evidence_ids array
    // intersects with the set of is_cpu=true field-evidence ids for this run.
    c
      .select({ count: sql<string>`COUNT(*)::text` })
      .from(ocrPromotions)
      .where(
        and(
          eq(ocrPromotions.runId, runId),
          sql`EXISTS (
            SELECT 1 FROM ${ocrFieldEvidence}
            WHERE ${ocrFieldEvidence.runId} = ${runId}
              AND ${ocrFieldEvidence.fieldKey} = 'is_cpu'
              AND (
                ${ocrFieldEvidence.candidateValue}::text = 'true'
                OR ${ocrFieldEvidence.candidateValue}::text = '"true"'
              )
              AND ${ocrFieldEvidence.id} = ANY(${ocrPromotions.evidenceIds})
          )`,
        ),
      )
      .then((rs) => rs[0] ?? { count: '0' }),
    c
      .select({ count: sql<string>`COUNT(*)::text` })
      .from(ocrPromotions)
      .where(
        and(
          eq(ocrPromotions.runId, runId),
          eq(ocrPromotions.blockingReason, 'hard_fields_not_promoted'),
        ),
      )
      .then((rs) => rs[0] ?? { count: '0' }),
    c
      .select({ count: sql<string>`COUNT(*)::text` })
      .from(ocrPromotions)
      .where(
        and(
          eq(ocrPromotions.runId, runId),
          eq(ocrPromotions.blockingReason, 'junk_gamertag_without_supporting_evidence'),
        ),
      )
      .then((rs) => rs[0] ?? { count: '0' }),
    // Lobby gamertag evidence per (batch, slot) — used for cross-team-dupes-
    // inferred heuristic. We fetch all lobby gamertag candidates for this
    // run and do the normalization/uniqueness check in JS.
    c
      .select({
        subjectSlotKey: ocrFieldEvidence.subjectSlotKey,
        candidateValue: ocrFieldEvidence.candidateValue,
        segmentId: ocrFieldEvidence.segmentId,
      })
      .from(ocrFieldEvidence)
      .where(
        and(
          eq(ocrFieldEvidence.runId, runId),
          eq(ocrFieldEvidence.fieldKey, 'gamertag'),
          inArray(ocrFieldEvidence.screenState, [
            'pre_game_lobby_state_2',
            'pre_game_lobby_state_1',
          ]),
        ),
      ),
  ])

  const isCpuDemotions = Number(cpuCountRow.count)

  // Cross-team-dupes — segment-level heuristic per Phase-3 detector logic:
  // normalize gamertag via lowercase + strip non-alphanumeric, then count
  // unique normalized strings that appear on >1 team_side within the same
  // segment. team_side is encoded in the slot key like `lobby_for_C` /
  // `lobby_against_G`.
  //
  // P2-2: this is a SEGMENT-level grouping (proxy), NOT a frame-level
  // grouping. Python's _demote_cross_team_duplicates operates on a single
  // frame's subjects list; lobby evidence picks the best frame per slot
  // across the whole segment, so this counter can flag pairs that never
  // coexisted in one frame. The frame-level counter requires per-frame
  // provenance not stored in v1.
  const normalize = (raw: unknown): string | null => {
    const s = typeof raw === 'string' ? raw : raw == null ? '' : String(raw)
    const stripped = s.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
    return stripped.length >= 3 ? stripped : null
  }
  const sideOf = (slotKey: string | null): 'for' | 'against' | null => {
    if (!slotKey) return null
    if (slotKey.includes('_for_')) return 'for'
    if (slotKey.includes('_against_')) return 'against'
    return null
  }
  const seenByGroup = new Map<string, Map<string, Set<'for' | 'against'>>>()
  for (const ev of lobbyEvidenceRows) {
    const groupKey = ev.segmentId == null ? 'null' : String(ev.segmentId)
    const norm = normalize(ev.candidateValue)
    const side = sideOf(ev.subjectSlotKey)
    if (norm === null || side === null) continue
    let inner = seenByGroup.get(groupKey)
    if (!inner) {
      inner = new Map()
      seenByGroup.set(groupKey, inner)
    }
    let sides = inner.get(norm)
    if (!sides) {
      sides = new Set()
      inner.set(norm, sides)
    }
    sides.add(side)
  }
  const dupeSet = new Set<string>()
  for (const inner of seenByGroup.values()) {
    for (const [norm, sides] of inner.entries()) {
      if (sides.size > 1) dupeSet.add(norm)
    }
  }
  const crossTeamDupesSegmentLevelHeuristic = dupeSet.size

  return {
    is_cpu_demotions: isCpuDemotions,
    // v1: cross-team-dupe demotions are silent at the detector, so this
    // collapses to the same number as is_cpu_demotions for now.
    is_cpu_or_demoted_combined: isCpuDemotions,
    cross_team_dupes_segment_level_heuristic: crossTeamDupesSegmentLevelHeuristic,
    or_fold_inferences: Number(orFoldRow.count),
    hard_field_blocks: Number(hardBlockRow.count),
    junk_gamertag_blocks_ts: Number(junkTsRow.count),
    // v1 limitation — Python-side junk-gamertag drops do not write to the
    // evidence layer. See Phase 4 plan for the marker design.
    junk_gamertag_blocks_python: null,
    notes: [
      'cross-team-dupe demotions are silent in v1; is_cpu_or_demoted_combined currently equals is_cpu_demotions',
      'cross_team_dupes_segment_level_heuristic is a segment-level heuristic — may overcount vs Python\'s frame-level cross-team dedup; frame provenance not stored in v1',
      'junk_gamertag_blocks_python is null in v1 — Python extractor drops are silent and do not reach the evidence layer',
    ],
  }
}

// ── 4. Unresolved counts ─────────────────────────────────────────────────────

export interface UnresolvedCounts {
  gamertags: number
  personas: number
  actor_bindings_for_side: number
  totals: { all: number }
}

/**
 * Three independent "did not resolve" counts for a single run, plus their
 * sum. Drives the `total_unresolved` derived column on
 * `ocr_run_quality_reports`.
 *
 *   - gamertags: blocked gamertag promotions for this run
 *   - personas:  player_loadout_snapshots rows whose source extraction belongs
 *                to this run where player_name_persona is still null (post-gate
 *                resolution miss). Scoped via ocr_extractions.run_id so other
 *                runs on the same match do not leak into this run's count.
 *   - actor_bindings_for_side: BGM-side match_events with no actor_player_id
 *                              whose source extraction belongs to this run
 */
export async function buildUnresolvedCounts(
  runId: number,
  conn?: Database,
): Promise<UnresolvedCounts> {
  const c = conn ?? db

  const [gamertagRow, personaRow, actorRow] = await Promise.all([
    c
      .select({ count: sql<string>`COUNT(*)::text` })
      .from(ocrPromotions)
      .where(
        and(
          eq(ocrPromotions.runId, runId),
          eq(ocrPromotions.fieldKey, 'gamertag'),
          sql`${ocrPromotions.promotionStatus} LIKE 'blocked_%'`,
        ),
      )
      .then((rs) => rs[0] ?? { count: '0' }),
    // P2-1: scope by run via the snapshot's source extraction. Filtering by
    // match_id only leaks stale snapshots from other runs on the same match
    // (e.g. a superseded prior run with persona=NULL) into this run's count.
    c
      .select({ count: sql<string>`COUNT(*)::text` })
      .from(playerLoadoutSnapshots)
      .innerJoin(ocrExtractions, eq(playerLoadoutSnapshots.ocrExtractionId, ocrExtractions.id))
      .where(
        and(
          eq(ocrExtractions.runId, runId),
          sql`${playerLoadoutSnapshots.playerNamePersona} IS NULL`,
        ),
      )
      .then((rs) => rs[0] ?? { count: '0' }),
    c
      .select({ count: sql<string>`COUNT(*)::text` })
      .from(matchEvents)
      .where(
        and(
          eq(matchEvents.teamSide, 'for'),
          sql`${matchEvents.actorPlayerId} IS NULL`,
          sql`${matchEvents.ocrExtractionId} IN (
            SELECT ${ocrExtractions.id} FROM ${ocrExtractions} WHERE ${ocrExtractions.runId} = ${runId}
          )`,
        ),
      )
      .then((rs) => rs[0] ?? { count: '0' }),
  ])

  const gamertags = Number(gamertagRow.count)
  const personas = Number(personaRow.count)
  const actor_bindings_for_side = Number(actorRow.count)
  return {
    gamertags,
    personas,
    actor_bindings_for_side,
    totals: { all: gamertags + personas + actor_bindings_for_side },
  }
}

// ── 5. segment count (run-scoped) ────────────────────────────────────────────

/**
 * Count of `ocr_segments` rows attributed to a single run.
 *
 * Phase-3 originally projected `body.screens.totals.frames` (per-extraction
 * count) into the `total_segments` hot column on `ocr_run_quality_reports`.
 * That column name implies the segment layer; frames live on the extraction
 * layer. This helper gives the report body a real per-run segment count so
 * the hot column lines up with its name. See Codex P3.
 */
export async function countSegmentsByRun(runId: number, conn?: Database): Promise<number> {
  const c = conn ?? db
  const [row] = await c
    .select({ count: sql<string>`COUNT(*)::text` })
    .from(ocrSegments)
    .where(eq(ocrSegments.runId, runId))
  return Number(row?.count ?? '0')
}

// ── 6. upsert writer ─────────────────────────────────────────────────────────

export interface RunQualityReportDerivedColumns {
  matchId: number
  schemaVersion: number
  overallPass: boolean
  l1Score: number | null
  l2Score: number
  l2LineupScore: number
  l3Score: number
  totalWallMs: number | null
  totalSegments: number
  totalDemoted: number
  totalUnresolved: number
}

export interface UpsertRunQualityReportOpts {
  /** If true, conflict on (run_id) updates existing row in a single statement. */
  force?: boolean
  /** Optional connection (e.g. inside a transaction). Defaults to module `db`. */
  conn?: Database
}

/**
 * Write a quality-report row. The body JSONB blob is preserved verbatim; the
 * derived columns are the indexed/queryable projections used by trend dashboards.
 *
 *   - `force = true`: single-statement ON CONFLICT (run_id) DO UPDATE.
 *     Updates score columns + body + generated_at + total_* counters.
 *   - `force = false / undefined`: plain INSERT. On conflict, Postgres throws
 *     a unique-violation; the caller decides whether to retry with force.
 *
 * Returns the inserted/updated row id.
 */
export async function upsertRunQualityReport(
  runId: number,
  body: Record<string, unknown>,
  derivedColumns: RunQualityReportDerivedColumns,
  opts?: UpsertRunQualityReportOpts,
): Promise<number> {
  const { force = false, conn } = opts ?? {}
  const c = conn ?? db
  // Numeric columns on this table are NUMERIC(5,4). Drizzle's pg driver
  // accepts strings for numeric fields; pass them as strings so the precision
  // is preserved and there's no float-rounding surprise.
  const toNumericString = (n: number | null): string | null =>
    n === null ? null : n.toString()

  const values = {
    runId,
    matchId: derivedColumns.matchId,
    schemaVersion: derivedColumns.schemaVersion,
    overallPass: derivedColumns.overallPass,
    l1Score: toNumericString(derivedColumns.l1Score),
    l2Score: toNumericString(derivedColumns.l2Score) as string,
    l2LineupScore: toNumericString(derivedColumns.l2LineupScore) as string,
    l3Score: toNumericString(derivedColumns.l3Score) as string,
    totalWallMs: derivedColumns.totalWallMs,
    totalSegments: derivedColumns.totalSegments,
    totalDemoted: derivedColumns.totalDemoted,
    totalUnresolved: derivedColumns.totalUnresolved,
    report: body,
  }

  if (force) {
    const [row] = await c
      .insert(ocrRunQualityReports)
      .values(values)
      .onConflictDoUpdate({
        target: ocrRunQualityReports.runId,
        set: {
          matchId: values.matchId,
          schemaVersion: values.schemaVersion,
          overallPass: values.overallPass,
          l1Score: values.l1Score,
          l2Score: values.l2Score,
          l2LineupScore: values.l2LineupScore,
          l3Score: values.l3Score,
          totalWallMs: values.totalWallMs,
          totalSegments: values.totalSegments,
          totalDemoted: values.totalDemoted,
          totalUnresolved: values.totalUnresolved,
          report: values.report,
          generatedAt: sql`now()`,
        },
      })
      .returning({ id: ocrRunQualityReports.id })
    if (!row) throw new Error(`upsertRunQualityReport: no row returned for runId=${runId}`)
    return row.id
  }

  const [row] = await c
    .insert(ocrRunQualityReports)
    .values(values)
    .returning({ id: ocrRunQualityReports.id })
  if (!row) throw new Error(`upsertRunQualityReport: no row returned for runId=${runId}`)
  return row.id
}

