/**
 * Action Tracker position reconciliation — live-ingest tail hook.
 *
 * Wraps the standalone Python post-pass
 * `tools/game_ocr/scripts/reconcile_action_tracker.py` so the worker can
 * recover missing event POSITIONS automatically at the end of each OCR batch.
 * The per-frame positioning pass can't place an event whose Action Tracker list
 * card and rink marker were never co-visible in one frame (the "operator
 * scrolled too fast" case); this post-pass unions markers across the period and
 * binds the leftovers by type/team/elimination + yellow-salvage.
 *
 * Contract split (decided in the plan): the Python tool runs in `--json` mode
 * and emits POSITION PROPOSALS; this module owns the WRITE — applying them via
 * Drizzle with the no-clobber guard. That keeps schema authority + the guard in
 * TS (and unit-testable) rather than executing opaque subprocess SQL.
 *
 * Trust/safety: every proposal is an inference, so positions are written with
 * `position_confidence='extrapolated'` and `review_status` is NEVER touched. The
 * guard mirrors the Python SQL exactly — `x IS NULL AND position_confidence
 * IS DISTINCT FROM 'manual'` — so positioned/manual rows are never clobbered.
 * A plain `ne(position_confidence, 'manual')` would silently skip NULL-
 * confidence rows (the exact unpositioned rows we target), so the raw
 * `IS DISTINCT FROM` is load-bearing.
 *
 * This module does NOT swallow errors — the caller (ingest tail) owns the single
 * try/catch so a reconcile failure never fails the batch.
 */

import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { db, matchEvents, matchPeriodSummaries, ocrExtractions } from '@eanhl/db'
import { liveRunFilter } from '@eanhl/db/queries'
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const GAME_OCR_DIR = join(REPO_ROOT, 'tools', 'game_ocr')
const RECONCILE_SCRIPT = join('scripts', 'reconcile_action_tracker.py')

/** Event types the positioning pass plots (mirrors the Python tool's filter). */
const PLOTTABLE_EVENT_TYPES = ['shot', 'hit', 'goal', 'penalty'] as const

/** One position proposal emitted by the Python tool under `--json`. */
export interface ReconcileProposal {
  event_id: number
  x: number
  y: number
  rink_zone: string
  /** Always 'extrapolated' (inferred). Written verbatim to position_confidence. */
  confidence_label: string
  method: string
}

/** The `--json` stdout shape of `reconcile_action_tracker.py`. */
export interface ReconcileToolOutput {
  match_id: number
  updates: ReconcileProposal[]
}

/** The stdin payload the Python tool consumes (one JSON object). */
export interface ReconcilePayload {
  extractions: Array<{ id: number; source_path: string; raw_result_json: unknown }>
  match_events: Array<{
    id: number
    period_number: number
    event_type: string
    team_side: string
    clock: string | null
    actor: string | null
    x: string | null
    y: string | null
    position_confidence: string | null
  }>
  period_summaries: Array<{
    period_number: number
    goals_for: number | null
    goals_against: number | null
    shots_for: number | null
    shots_against: number | null
    faceoffs_for: number | null
    faceoffs_against: number | null
  }>
}

export interface ReconcilePositionsResult {
  /** Proposals the tool produced. */
  proposed: number
  /** Rows actually updated (proposals that passed the no-clobber guard). */
  applied: number
}

/** Pluggable tool runner — overridden in tests to avoid spawning Python. */
export type ReconcileToolRunner = (
  matchId: number,
  payload: ReconcilePayload,
) => Promise<ReconcileToolOutput>

/**
 * Reconcile missing Action Tracker positions for one match.
 *
 * @param runId  the run currently being ingested. Selects the AT-extraction read
 *   scope: when provided we read THIS run's extractions (the ingest tail dispatches
 *   the AT promoter even for non-active/candidate runs, so the canonical
 *   match_events already reflect them); when NULL we fall back to the
 *   legacy/current-state `liveRunFilter` rule. This is ingest-time scope, NOT the
 *   canonical read filter.
 */
export async function reconcilePositions(
  matchId: number,
  runId: number | null,
  runTool: ReconcileToolRunner = spawnReconcileTool,
): Promise<ReconcilePositionsResult> {
  const payload = await buildPayload(matchId, runId)
  if (payload.extractions.length === 0) {
    // No Action Tracker evidence for this run/match — nothing to reconcile.
    return { proposed: 0, applied: 0 }
  }

  const output = await runTool(matchId, payload)
  const applied = await applyProposals(output.updates)
  return { proposed: output.updates.length, applied }
}

/** Build the tool's stdin payload via Drizzle (replaces the manual json_agg). */
async function buildPayload(matchId: number, runId: number | null): Promise<ReconcilePayload> {
  // Run-scope predicate: this run's rows when ingesting under a run, else the
  // legacy/current-state rule. See the @param note above.
  const runScope: SQL = runId !== null ? eq(ocrExtractions.runId, runId) : liveRunFilter(ocrExtractions.runId)

  const extractions = await db
    .select({
      id: ocrExtractions.id,
      source_path: ocrExtractions.sourcePath,
      raw_result_json: ocrExtractions.rawResultJson,
    })
    .from(ocrExtractions)
    .where(
      and(
        eq(ocrExtractions.matchId, matchId),
        eq(ocrExtractions.screenType, 'post_game_action_tracker'),
        runScope,
      ),
    )

  // Canonical roll-ups (no run_id) — read as-is.
  const events = await db
    .select({
      id: matchEvents.id,
      period_number: matchEvents.periodNumber,
      event_type: matchEvents.eventType,
      team_side: matchEvents.teamSide,
      clock: matchEvents.clock,
      actor: matchEvents.actorGamertagSnapshot,
      x: matchEvents.x,
      y: matchEvents.y,
      position_confidence: matchEvents.positionConfidence,
    })
    .from(matchEvents)
    .where(
      and(
        eq(matchEvents.matchId, matchId),
        eq(matchEvents.source, 'ocr'),
        inArray(matchEvents.eventType, [...PLOTTABLE_EVENT_TYPES]),
      ),
    )

  const summaries = await db
    .select({
      period_number: matchPeriodSummaries.periodNumber,
      goals_for: matchPeriodSummaries.goalsFor,
      goals_against: matchPeriodSummaries.goalsAgainst,
      shots_for: matchPeriodSummaries.shotsFor,
      shots_against: matchPeriodSummaries.shotsAgainst,
      faceoffs_for: matchPeriodSummaries.faceoffsFor,
      faceoffs_against: matchPeriodSummaries.faceoffsAgainst,
    })
    .from(matchPeriodSummaries)
    .where(
      and(
        eq(matchPeriodSummaries.matchId, matchId),
        eq(matchPeriodSummaries.source, 'ocr'),
        eq(matchPeriodSummaries.reviewStatus, 'reviewed'),
      ),
    )

  return { extractions, match_events: events, period_summaries: summaries }
}

/**
 * Apply position proposals with the no-clobber guard. Returns the count of rows
 * actually changed. `review_status` is never written.
 */
async function applyProposals(proposals: ReconcileProposal[]): Promise<number> {
  if (proposals.length === 0) return 0

  return db.transaction(async (tx) => {
    let applied = 0
    for (const p of proposals) {
      const changed = await tx
        .update(matchEvents)
        .set({
          x: String(p.x),
          y: String(p.y),
          rinkZone: p.rink_zone,
          positionConfidence: p.confidence_label as 'interpolated' | 'extrapolated' | 'manual',
        })
        .where(
          and(
            eq(matchEvents.id, p.event_id),
            isNull(matchEvents.x),
            // Mirror the Python guard exactly. A plain ne() drops NULL rows.
            sql`${matchEvents.positionConfidence} IS DISTINCT FROM 'manual'`,
          ),
        )
        .returning({ id: matchEvents.id })
      applied += changed.length
    }
    return applied
  })
}

/**
 * Spawn the Python tool in `--json` mode, feeding `payload` on stdin and
 * parsing the proposals from stdout. Throws on nonzero exit or unparseable
 * output — the caller owns the swallow.
 */
async function spawnReconcileTool(
  matchId: number,
  payload: ReconcilePayload,
): Promise<ReconcileToolOutput> {
  const pythonBin = process.env.OCR_PYTHON ?? 'python3'

  const { stdout } = await new Promise<{ stdout: string }>((resolveRun, reject) => {
    const child = spawn(pythonBin, [RECONCILE_SCRIPT, String(matchId), '--json'], {
      cwd: GAME_OCR_DIR,
      env: {
        ...process.env,
        PYTHONPATH: [GAME_OCR_DIR, process.env.PYTHONPATH].filter(Boolean).join(':'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let out = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      out += chunk
    })
    // The human-readable report goes to stderr — surface it like ocr-cli does.
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line) console.error(`[reconcile] ${line}`)
      }
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`reconcile_action_tracker.py exited ${String(code)} for match ${String(matchId)}`))
        return
      }
      resolveRun({ stdout: out })
    })

    child.stdin.on('error', reject)
    child.stdin.end(JSON.stringify(payload))
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to parse reconcile_action_tracker.py output: ${msg}`)
  }
  return parsed as ReconcileToolOutput
}
