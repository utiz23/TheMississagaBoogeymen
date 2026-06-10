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
import {
  db,
  matchEvents,
  matchGoalEvents,
  matchPenaltyEvents,
  matchPeriodSummaries,
  matches,
  ocrExtractions,
  type NewMatchEvent,
} from '@eanhl/db'
import { liveRunFilter } from '@eanhl/db/queries'
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import type { DbOrTx, PromoterDb } from './ocr-promoters/index.js'
import {
  findExistingMatchEvent,
  findExistingMatchEventClockless,
} from './ocr-promoters/match-events-dedup.js'
import {
  deriveTeamSide,
  normalizeSnapshot,
  resolveActorForMatch,
} from './ocr-promoters/resolve-identity.js'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const GAME_OCR_DIR = join(REPO_ROOT, 'tools', 'game_ocr')
const RECONCILE_SCRIPT = join('scripts', 'reconcile_action_tracker.py')

/** Event types the positioning pass plots (mirrors the Python tool's filter). */
const PLOTTABLE_EVENT_TYPES = ['shot', 'hit', 'goal', 'penalty'] as const

/**
 * WS4 Stage 3: a recovered clock is trusted enough to take the EXACT dedup key
 * (and to be persisted) only at/above this confidence. Below it, the clock is
 * never written and dedup stays on the clock-independent key — a low-confidence
 * guess must never enter canonical-adjacent data nor route an exact-key hit.
 * 0.66 admits the producer's 1.0 (clean) and 0.8 (single-transform) tiers while
 * excluding 0.6 (two-transform / glued-digit) reads.
 */
const OCR_RECOVERED_CLOCK_CONFIDENCE_FLOOR = 0.66

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

/**
 * One identity-recovery INSERT proposal (post-resolution). An orphan card whose
 * event row was never promoted (the live promoter drops garbled-clock cards).
 * WS4 Stage 3: `clock` carries the clock RECOVERED from event_detail (or null
 * when unrecoverable), with `clock_confidence` (0-1). A confident clock
 * (>= floor) lets `applyIdentityProposals` dedup via the EXACT key first; below
 * floor or null falls back to the clock-independent key (Stage 1/2 behavior).
 * `target_*` and `ocr_extraction_id` are consumed both by the INSERT and by the
 * dedup-hit refresh (which mirrors the live promoter's hit branch). Built in TS
 * from a `RawOrphanCard` via `resolveOrphanCard` (player ids + team_side resolved
 * here, not in Python — raw AT data carries no team signal).
 */
export interface IdentityProposal {
  period_number: number
  period_label: string
  event_type: 'shot' | 'hit' | 'goal' | 'penalty' | 'faceoff'
  team_side: 'for' | 'against'
  actor_snapshot: string
  actor_player_id: number | null
  target_snapshot: string | null
  target_player_id: number | null
  event_detail: string | null
  ocr_extraction_id: number
  /** Clock recovered from event_detail (WS4 Stage 3), or null when unrecoverable. */
  clock: string | null
  /** Confidence (0-1) of `clock`; >= floor admits it to the exact dedup key. */
  clock_confidence: number
  /**
   * Recovered rink position (WS4 Stage 2b), or null when the producer could not
   * bind the orphan to a marker cluster. When set, the INSERT lands the row
   * positioned with `position_confidence='extrapolated'`; when null it inserts
   * unpositioned, exactly as Stage 2a did.
   */
  x: number | null
  y: number | null
  rink_zone: string | null
}

/**
 * One RAW orphan card emitted by `reconcile_action_tracker.py --json`
 * (WS4 Stage 2a). The live promoter dropped this event because its OCR clock
 * was garbled/null (action-tracker.ts:105). Identity (player ids) + team_side
 * are NOT here — raw AT data has no team signal; the worker resolves them via
 * `resolveOrphanCard`. `event_type` is restricted to the plottable types so the
 * position-reconcile pass can later place the recovered row.
 */
export interface RawOrphanCard {
  period_number: number
  period_label: string
  event_type: 'shot' | 'hit' | 'goal' | 'penalty'
  actor_snapshot: string
  target_snapshot: string | null
  event_detail: string | null
  ocr_extraction_id: number
  /**
   * Position bound by the Stage-2b producer via cross-frame marker consensus,
   * or null when no cluster bound. OPTIONAL on the wire so a pre-2b producer
   * (which omits them) still parses; `resolveOrphanCard` defaults them to null.
   */
  x?: number | null
  y?: number | null
  rink_zone?: string | null
  /**
   * Clock recovered from event_detail by the Stage-3 producer (per child, after
   * the multiplicity split), or null when unrecoverable. OPTIONAL on the wire so
   * a pre-Stage-3 producer (which omits it) still parses; `resolveOrphanCard`
   * defaults it to null.
   */
  recovered_clock?: string | null
  /** Confidence (0-1) of `recovered_clock`; defaults to 0 when absent. */
  recovered_clock_confidence?: number
  /** 'co_occurrence' when a cluster bound, else 'none'. Diagnostic only. */
  bind_method?: string
  /**
   * The bound cluster's color-derived side ('for'/'against'/'unknown'), a HINT
   * only. Roster-derived team_side is authoritative; a disagreement is logged
   * but never flips team_side or drops the position.
   */
  cluster_color_side?: 'for' | 'against' | 'unknown' | null
}

/** The `--json` stdout shape of `reconcile_action_tracker.py`. */
export interface ReconcileToolOutput {
  match_id: number
  updates: ReconcileProposal[]
  /**
   * Raw orphan cards (garbled-clock events the live promoter dropped).
   * OPTIONAL — absent until the Stage-2a producer ships. Resolved into
   * IdentityProposals + applied by `reconcilePositions` (see `resolveOrphanCard`
   * → `applyIdentityProposals`), gated by `OCR_IDENTITY_RECOVERY_ENABLED`.
   */
  orphan_cards?: RawOrphanCard[]
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
  /** Identity orphans inserted as new pending_review rows (WS4). 0 live in Stage 1. */
  identity_inserted: number
  /** Of `identity_inserted`, how many landed with a recovered position (WS4 Stage 2b). */
  identity_inserted_positioned: number
  /** Identity proposals that dedup-hit an existing row and refreshed it (WS4). */
  identity_dedup_refreshed: number
  /** Identity proposals skipped because >1 candidate matched — ambiguous (WS4). */
  identity_ambiguous: number
  /** Identity proposals rejected up-front for a blank/whitespace actor (WS4). */
  identity_skipped_invalid: number
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
    return {
      proposed: 0,
      applied: 0,
      identity_inserted: 0,
      identity_inserted_positioned: 0,
      identity_dedup_refreshed: 0,
      identity_ambiguous: 0,
      identity_skipped_invalid: 0,
    }
  }

  const output = await runTool(matchId, payload)
  const applied = await applyProposals(output.updates)

  // WS4 Stage 2a: resolve the producer's raw orphan cards into IdentityProposals
  // (player ids + team_side resolved here, reusing the live promoter's resolver),
  // then apply them. Gated by OCR_IDENTITY_RECOVERY_ENABLED (default ON). Reads
  // run OUTSIDE applyIdentityProposals' transaction.
  let identity: ApplyIdentityResult = {
    inserted: 0,
    insertedPositioned: 0,
    dedupRefreshed: 0,
    ambiguous: 0,
    skippedInvalid: 0,
  }
  const orphanCards = output.orphan_cards ?? []
  if (orphanCards.length > 0 && process.env.OCR_IDENTITY_RECOVERY_ENABLED !== 'false') {
    const gameTitleId = await resolveGameTitleId(matchId)
    const proposals: IdentityProposal[] = []
    for (const card of orphanCards) {
      proposals.push(await resolveOrphanCard(card, matchId, gameTitleId, db))
    }
    identity = await applyIdentityProposals(proposals, matchId)
  }

  return {
    proposed: output.updates.length,
    applied,
    identity_inserted: identity.inserted,
    identity_inserted_positioned: identity.insertedPositioned,
    identity_dedup_refreshed: identity.dedupRefreshed,
    identity_ambiguous: identity.ambiguous,
    identity_skipped_invalid: identity.skippedInvalid,
  }
}

export interface ApplyIdentityResult {
  inserted: number
  /** Of `inserted`, how many landed with a recovered position (WS4 Stage 2b). */
  insertedPositioned: number
  dedupRefreshed: number
  ambiguous: number
  skippedInvalid: number
}

/** Look up a match's game title (one match = one game title). Keeps
 *  reconcilePositions self-contained rather than threading gameTitleId from the
 *  ingest caller. */
async function resolveGameTitleId(matchId: number): Promise<number> {
  const [row] = await db
    .select({ gameTitleId: matches.gameTitleId })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1)
  if (!row) throw new Error(`Match ${String(matchId)} not found for game-title lookup`)
  return row.gameTitleId
}

/**
 * Resolve one raw orphan card into an IdentityProposal: resolve actor + target
 * against the match roster, derive team_side, carry snapshots/detail/ext id.
 * Mirrors the live promoter's resolution (action-tracker.ts:124-130) so a
 * recovered orphan resolves to exactly the identity the live path would have
 * produced had the clock been legible. An unresolved actor (opponent not on the
 * BGM roster) yields actor_player_id null — allowed, mirroring the promoter.
 */
export async function resolveOrphanCard(
  card: RawOrphanCard,
  matchId: number,
  gameTitleId: number,
  dbConn: DbOrTx,
): Promise<IdentityProposal> {
  // resolveActorForMatch is typed against PromoterDb; the global db is accepted
  // at runtime (read-only selects) — cast at the boundary, as the resolver's
  // other non-promoter callers do (ingest-ocr-resolve-cli, the resolver tests).
  const conn = dbConn as PromoterDb
  const { playerId: actorPlayerId } = await resolveActorForMatch(
    card.actor_snapshot,
    matchId,
    gameTitleId,
    conn,
  )
  const { playerId: targetPlayerId } = card.target_snapshot
    ? await resolveActorForMatch(card.target_snapshot, matchId, gameTitleId, conn)
    : { playerId: null }
  const teamSide = deriveTeamSide(actorPlayerId, targetPlayerId)

  // The producer's marker color is a position-derived HINT; the roster-derived
  // team_side is authoritative (color detection is less reliable than the
  // roster check). Surface a disagreement for observability but trust the
  // roster — never flip team_side, never drop the spatial fact.
  if (
    card.cluster_color_side &&
    card.cluster_color_side !== 'unknown' &&
    card.cluster_color_side !== teamSide
  ) {
    console.warn(
      `[reconcile][identity] cluster color side '${card.cluster_color_side}' disagrees with roster team_side '${teamSide}' — trusting roster (match=${String(matchId)} period=${String(card.period_number)} type=${card.event_type} actor=${card.actor_snapshot})`,
    )
  }

  return {
    period_number: card.period_number,
    period_label: card.period_label,
    event_type: card.event_type,
    team_side: teamSide,
    actor_snapshot: card.actor_snapshot,
    actor_player_id: actorPlayerId,
    target_snapshot: card.target_snapshot,
    target_player_id: targetPlayerId,
    event_detail: card.event_detail,
    ocr_extraction_id: card.ocr_extraction_id,
    clock: card.recovered_clock ?? null,
    clock_confidence: card.recovered_clock_confidence ?? 0,
    x: card.x ?? null,
    y: card.y ?? null,
    rink_zone: card.rink_zone ?? null,
  }
}

/**
 * Apply identity-recovery INSERT proposals (WS4 Stage 1). For each proposal:
 *   1. reject a blank/whitespace actor (no identity anchor; notNull ext cols);
 *   2. clock-independent dedup via `findExistingMatchEventClockless`;
 *   3. `hit` → refresh ocr_extraction_id + target_* (mirror the promoter's hit
 *      branch); `ambiguous` → skip + warn (no write); `insert` → mint a
 *      pending_review row + goal/penalty extension row.
 * Runs in its own transaction (base + extension row are atomic together); kept
 * independent of applyProposals so an identity failure never reverts good
 * position fixes (both halves are idempotent self-healing recoveries).
 */
export async function applyIdentityProposals(
  proposals: IdentityProposal[],
  matchId: number,
): Promise<ApplyIdentityResult> {
  if (proposals.length === 0) {
    return {
      inserted: 0,
      insertedPositioned: 0,
      dedupRefreshed: 0,
      ambiguous: 0,
      skippedInvalid: 0,
    }
  }

  return db.transaction(async (tx) => {
    let inserted = 0
    let insertedPositioned = 0
    let dedupRefreshed = 0
    let ambiguous = 0
    let skippedInvalid = 0

    for (const p of proposals) {
      // 1. Blank-actor guard. A whitespace/empty actor has no identity anchor
      // and the goal/penalty extension snapshot columns are NOT NULL — inserting
      // it produces unrecoverable junk. Mirrors the promoter's own `if (!actor)`
      // skip. Actor-less cards are out of WS4 scope by design.
      if (normalizeSnapshot(p.actor_snapshot).length === 0) {
        console.warn(
          `[reconcile][identity] skipping proposal with blank actor — match=${String(matchId)} period=${String(p.period_number)} type=${p.event_type} side=${p.team_side}`,
        )
        skippedInvalid++
        continue
      }

      // WS4 Stage 3: a confidently-recovered clock is the live promoter's own
      // identity signal, so try the EXACT key first (matchId, period, type, clock,
      // actor). This turns today's clock-null ambiguous-skips into clean hits when
      // a same-clock row already exists. A miss falls through to the clock-
      // independent key (unchanged Stage 1/2 safety); below-floor/null clocks skip
      // the exact key entirely.
      // The recovered clock, narrowed to non-null only when it clears the floor;
      // below-floor/null collapses to null so it is neither keyed nor persisted.
      const recoveredClock =
        p.clock !== null && p.clock_confidence >= OCR_RECOVERED_CLOCK_CONFIDENCE_FLOOR
          ? p.clock
          : null
      let hitId: number | null = null
      if (recoveredClock !== null) {
        hitId = await findExistingMatchEvent(tx, {
          matchId,
          periodNumber: p.period_number,
          eventType: p.event_type,
          clock: recoveredClock,
          actorPlayerId: p.actor_player_id,
          actorSnapshot: p.actor_snapshot,
        })
      }

      if (hitId === null) {
        const res = await findExistingMatchEventClockless(tx, {
          matchId,
          periodNumber: p.period_number,
          eventType: p.event_type,
          teamSide: p.team_side,
          actorPlayerId: p.actor_player_id,
          actorSnapshot: p.actor_snapshot,
          // WS4 Stage 2b: position is part of the effective identity when present,
          // so two distinct same-identity orphans at different spots both insert.
          x: p.x,
          y: p.y,
        })
        // Ambiguous → never guess. Report only, no write.
        if (res.kind === 'ambiguous') {
          console.warn(
            `[reconcile][identity] ambiguous — ${String(res.candidateIds.length)} candidates, skipping (no write) match=${String(matchId)} period=${String(p.period_number)} type=${p.event_type} side=${p.team_side} actor=${p.actor_snapshot} candidates=[${res.candidateIds.join(',')}]`,
          )
          ambiguous++
          continue
        }
        if (res.kind === 'hit') hitId = res.id
      }

      // 2a. Dedup hit → REFRESH, mirroring the promoter's hit branch
      // (action-tracker.ts:161-176): backfill ocr_extraction_id + target_* and
      // nothing else. team_side / spatial / position_confidence are owned by
      // other passes and are never touched here.
      if (hitId !== null) {
        await tx
          .update(matchEvents)
          .set({
            ocrExtractionId: p.ocr_extraction_id,
            ...(p.target_player_id !== null ? { targetPlayerId: p.target_player_id } : {}),
            ...(p.target_snapshot !== null ? { targetGamertagSnapshot: p.target_snapshot } : {}),
          })
          .where(eq(matchEvents.id, hitId))
        // WS4 Stage 2b: if this positioned card hit an UNPOSITIONED existing row,
        // backfill the recovered position (self-heals a pre-2b orphan recovered
        // without one). Separate guarded UPDATE so a positioned/manual row is
        // never clobbered — mirrors applyProposals' no-clobber guard exactly.
        if (p.x !== null && p.y !== null) {
          await tx
            .update(matchEvents)
            .set({
              x: String(p.x),
              y: String(p.y),
              rinkZone: p.rink_zone,
              positionConfidence: 'extrapolated',
            })
            .where(
              and(
                eq(matchEvents.id, hitId),
                isNull(matchEvents.x),
                sql`${matchEvents.positionConfidence} IS DISTINCT FROM 'manual'`,
              ),
            )
        }
        // WS4 Stage 3: backfill a confident recovered clock onto a CLOCK-NULL row
        // (self-heals a prior Stage-1/2 orphan inserted clock-null). No-clobber
        // guard mirrors the position backfill; on an exact-key hit the row already
        // has this clock so the guard makes it a no-op. Below-floor clocks never
        // reach here (confidentClock gate), so no low-confidence guess is written.
        if (recoveredClock !== null) {
          await tx
            .update(matchEvents)
            .set({ clock: recoveredClock })
            .where(and(eq(matchEvents.id, hitId), isNull(matchEvents.clock)))
        }
        dedupRefreshed++
        continue
      }

      // 2c. Zero match → mint a pending_review row, mirroring the promoter's
      // insert (action-tracker.ts:179-234). clock is the confident recovered clock
      // or null (WS4 Stage 3 — see below). WS4 Stage 2b:
      // when the producer bound a marker cluster, land the row positioned with
      // position_confidence='extrapolated' (every binding is an inference);
      // otherwise insert unpositioned exactly as Stage 2a did. Goal/penalty
      // extension row in the SAME transaction so a base row can never be left
      // without its extension.
      const positioned = p.x !== null && p.y !== null
      const newEvent: NewMatchEvent = {
        matchId,
        periodNumber: p.period_number,
        periodLabel: p.period_label || String(p.period_number),
        // WS4 Stage 3: persist the recovered clock only when confident; a
        // below-floor guess stays clock-null (its garbled value lives in
        // event_detail for a reviewer).
        clock: recoveredClock,
        eventType: p.event_type,
        teamSide: p.team_side,
        teamAbbreviation: null,
        actorPlayerId: p.actor_player_id,
        actorGamertagSnapshot: p.actor_snapshot,
        targetPlayerId: p.target_player_id,
        targetGamertagSnapshot: p.target_snapshot,
        eventDetail: p.event_detail,
        x: positioned ? String(p.x) : null,
        y: positioned ? String(p.y) : null,
        rinkZone: positioned ? p.rink_zone : null,
        positionConfidence: positioned ? 'extrapolated' : null,
        source: 'ocr',
        ocrExtractionId: p.ocr_extraction_id,
        reviewStatus: 'pending_review',
      }
      const [row] = await tx.insert(matchEvents).values(newEvent).returning({ id: matchEvents.id })
      if (!row) throw new Error('Failed to insert recovered match_events row')

      if (p.event_type === 'goal') {
        await tx.insert(matchGoalEvents).values({
          eventId: row.id,
          scorerPlayerId: p.actor_player_id,
          scorerSnapshot: p.actor_snapshot,
          goalNumberInGame: null,
          primaryAssistPlayerId: null,
          primaryAssistSnapshot: null,
          secondaryAssistPlayerId: null,
          secondaryAssistSnapshot: null,
        })
      } else if (p.event_type === 'penalty') {
        await tx.insert(matchPenaltyEvents).values({
          eventId: row.id,
          culpritPlayerId: p.actor_player_id,
          culpritSnapshot: p.actor_snapshot,
          infraction: '(unknown)',
          penaltyType: 'Minor',
          minutes: 2,
        })
      }
      inserted++
      if (positioned) insertedPositioned++
    }

    return { inserted, insertedPositioned, dedupRefreshed, ambiguous, skippedInvalid }
  })
}

/** Build the tool's stdin payload via Drizzle (replaces the manual json_agg). */
async function buildPayload(matchId: number, runId: number | null): Promise<ReconcilePayload> {
  // Run-scope predicate: this run's rows when ingesting under a run, else the
  // legacy/current-state rule. See the @param note above.
  const runScope: SQL =
    runId !== null ? eq(ocrExtractions.runId, runId) : liveRunFilter(ocrExtractions.runId)

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
 * Position confidence labels this tool is allowed to write. The Python tool only
 * ever emits 'extrapolated' (all inferred), but `confidence_label` crosses a
 * process boundary as a plain string, so we validate it rather than blind-cast:
 * an unexpected value would trip the `match_events_position_confidence_check`
 * CHECK constraint and roll back the WHOLE batch's proposals, not just the bad
 * row. 'manual' is reserved for human entry and is never written here.
 */
const WRITABLE_CONFIDENCE = new Set<string>(['interpolated', 'extrapolated'])

/**
 * Apply position proposals with the no-clobber guard. Returns the count of rows
 * actually changed. `review_status` is never written.
 */
async function applyProposals(proposals: ReconcileProposal[]): Promise<number> {
  if (proposals.length === 0) return 0

  return db.transaction(async (tx) => {
    let applied = 0
    for (const p of proposals) {
      if (!WRITABLE_CONFIDENCE.has(p.confidence_label)) {
        console.warn(
          `[reconcile] skipping proposal for event ${String(p.event_id)}: unexpected confidence_label '${p.confidence_label}'`,
        )
        continue
      }
      const changed = await tx
        .update(matchEvents)
        .set({
          x: String(p.x),
          y: String(p.y),
          rinkZone: p.rink_zone,
          positionConfidence: p.confidence_label as 'interpolated' | 'extrapolated',
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
        reject(
          new Error(
            `reconcile_action_tracker.py exited ${String(code)} for match ${String(matchId)}`,
          ),
        )
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
