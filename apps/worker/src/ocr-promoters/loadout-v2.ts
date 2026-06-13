/**
 * loadout-v2 promoter — evidence-gate → canonical write
 *
 * `promoteLoadoutFromEvidence` is the Task 2A-17 orchestrator.  It reads
 * ocr_field_evidence rows for a match, runs the generic promotion gate per
 * (slot_key, field_key), enforces the Promotable Slot Field Matrix, and
 * writes:
 *   - player_loadout_snapshots (one per promoted slot)
 *   - player_loadout_x_factors (child block; all-or-nothing 3/3)
 *   - player_loadout_attributes (child block; floor ≥20/23)
 *   - ocr_promotions (one row per per-field gate decision + observability gaps)
 *
 * Idempotent on matchId: previous ocr_promotions rows for the same match are
 * deleted before re-running (upsert semantics via the unique index).
 *
 * Architecture:
 *   Stage A — evidence grouping + gate calls + in-memory decision aggregation
 *   Stage B — canonical writes + ocr_promotions writes inside a transaction
 */

import {
  db as defaultDb,
  ocrExtractions,
  ocrPromotions,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
  playerPersonaAliases,
  opponentPlayerMatchStats,
  matches,
  coerceXFactorTier,
  type NewPlayerLoadoutXFactor,
  type NewPlayerLoadoutAttribute,
} from '@eanhl/db'
import { and, eq, sql } from 'drizzle-orm'
import {
  getFieldEvidenceForLoadoutSlot,
  getExpectedSlotsForMatch,
  getActiveRunIdForMatch,
} from '@eanhl/db/queries'
import type { ExpectedSlot } from '@eanhl/db/queries'
import type { Database } from '@eanhl/db'
import type { GateCandidate, PromotionDecision } from '../lib/promotion-gate.js'
import { runPromotionGate } from '../lib/promotion-gate.js'
import { resolveGamertagToPlayer, normalizeSnapshot } from './resolve-identity.js'
import { normalizeXFactor } from '../lib/normalize-xfactor.js'
import type { DbOrTx, PromoterDb } from './index.js'

// ─── types ─────────────────────────────────────────────────────────────────────

export interface PromoteLoadoutFromEvidenceResult {
  promotedSnapshotCount: number
  blockedSnapshotCount: number
  promotionRowsWritten: number
}

/**
 * Per-slot decision aggregated from gate runs + team-side binding.
 * Carries everything needed to decide canonical writes + ocr_promotions rows.
 */
interface SlotDecision {
  slotKey: string
  /** Gate decision per field_key. */
  fieldDecisions: Map<string, PromotionDecision>
  /**
   * Post-binding team_side. Null means binding failed (unresolved gamertag).
   * Used as the target_semantic_key dimension for ocr_promotions rows.
   */
  resolvedTeamSide: 'for' | 'against' | null
  /** Promoted position value (string) or null. */
  resolvedPosition: string | null
  /** playerId from resolveGamertagToPlayer; null if unresolved. */
  resolvedPlayerId: number | null
  /** gameTitleId derived from the gamertag evidence's support_frame_ids batch. */
  gameTitleId: number
  /** ocrExtractionId: first support_frame_id from the winning gamertag evidence. */
  ocrExtractionId: number
  /**
   * Why the snapshot was blocked at the slot level (not a field-level block).
   * null means the slot may promote if all HARD fields pass.
   */
  snapshotBlockReason: string | null
}

/** Shape of one ocr_promotions row to insert (before DB write). */
interface PendingPromotion {
  matchId: number
  targetTable: string
  targetSemanticKey: Record<string, unknown>
  fieldKey: string | null
  winningValue: unknown
  winningConfidence: number | null
  evidenceCount: number
  conflictCount: number
  evidenceIds: number[]
  promotionStatus:
    | 'promoted'
    | 'blocked_consensus'
    | 'blocked_observability'
    | 'blocked_invariant'
    | 'blocked_authority'
  blockingReason: string | null
  authoritySource: 'manual_truth' | 'ea_api' | 'ocr_evidence' | null
}

// ─── constants ─────────────────────────────────────────────────────────────────

/** Loadout HARD fields that must all promote for a snapshot to be written. */
const HARD_FIELD_KEYS = new Set(['gamertag', 'position'])

/**
 * X-Factor field keys for slot indices 0, 1, 2.
 * The child block requires all 3 to promote.
 */
const XFACTOR_FIELD_KEYS = ['x_factor_name_0', 'x_factor_name_1', 'x_factor_name_2'] as const

/**
 * The 23 canonical attribute names (without any prefix).
 * Used for both the extractor's `attribute_{name}_{value|delta}` format and the
 * legacy test-fixture `attr_{name}` format.
 */
const CANONICAL_ATTRIBUTE_NAMES = new Set([
  'wrist_shot_accuracy',
  'slap_shot_accuracy',
  'speed',
  'balance',
  'agility',
  'wrist_shot_power',
  'slap_shot_power',
  'acceleration',
  'puck_control',
  'endurance',
  'passing',
  'offensive_awareness',
  'body_checking',
  'stick_checking',
  'defensive_awareness',
  'hand_eye',
  'strength',
  'durability',
  'shot_blocking',
  'deking',
  'faceoffs',
  'discipline',
  'fighting_skill',
])

/**
 * Attribute field keys in the LEGACY format (test fixtures authored before
 * Phase 2A typed_v1 extractor).  At least 20 must promote for the child block
 * to write.
 *
 * The typed_v1 extractor emits `attribute_{name}_value` and
 * `attribute_{name}_delta` instead.  Both formats are accepted by the promoter.
 */
const ATTRIBUTE_FIELD_KEYS = new Set([
  'attr_wrist_shot_accuracy',
  'attr_slap_shot_accuracy',
  'attr_speed',
  'attr_balance',
  'attr_agility',
  'attr_wrist_shot_power',
  'attr_slap_shot_power',
  'attr_acceleration',
  'attr_puck_control',
  'attr_endurance',
  'attr_passing',
  'attr_offensive_awareness',
  'attr_body_checking',
  'attr_stick_checking',
  'attr_defensive_awareness',
  'attr_hand_eye',
  'attr_strength',
  'attr_durability',
  'attr_shot_blocking',
  'attr_deking',
  'attr_faceoffs',
  'attr_discipline',
  'attr_fighting_skill',
])

const ATTRIBUTE_PROMOTION_FLOOR = 20

/**
 * Parse an extractor-format attribute field_key of the form
 * `attribute_{name}_{value|delta}` into its constituent parts.
 *
 * Returns `{name, column: 'value' | 'delta'}` on match, or `null` if the key
 * does not match the extractor format.
 *
 * The extractor (loadout_evidence.py) builds field_key as:
 *   `f"attribute_{tab_ev.row_key}_{tab_ev.column_key}"`
 * where column_key is either `"value"` or `"delta"`.
 */
function parseExtractorAttributeKey(
  fieldKey: string,
): { name: string; column: 'value' | 'delta' } | null {
  if (!fieldKey.startsWith('attribute_')) return null
  const rest = fieldKey.slice('attribute_'.length) // e.g. "speed_value" or "speed_delta"
  if (rest.endsWith('_value')) {
    const name = rest.slice(0, -'_value'.length)
    if (CANONICAL_ATTRIBUTE_NAMES.has(name)) return { name, column: 'value' }
  } else if (rest.endsWith('_delta')) {
    const name = rest.slice(0, -'_delta'.length)
    if (CANONICAL_ATTRIBUTE_NAMES.has(name)) return { name, column: 'delta' }
  }
  return null
}

/**
 * Field-key aliases from typed_v1 extractor → internal canonical name.
 *
 * The typed_v1 extractor (loadout_evidence.py) emits these field_keys from
 * the subject's canonical_subject (SubjectIdentity):
 *   - `jersey_number`  → maps to `player_number`  (DB column: player_number)
 *   - `persona_raw`    → maps to `player_name_persona` (raw persona string)
 *
 * These aliases are resolved during evidence grouping so the downstream gate
 * and write logic sees the same internal key regardless of extractor version.
 */
const FIELD_KEY_ALIASES: Readonly<Record<string, string>> = {
  jersey_number: 'player_number',
  persona_raw: 'player_name_persona',
}

// Positions valid for EASHL loadout views.
const VALID_POSITIONS = new Set([
  'C',
  'LW',
  'RW',
  'LD',
  'RD',
  'G',
  'center',
  'leftWing',
  'rightWing',
  'defenseMen',
  'goalie',
])

// Map EA's long-form opponent_player_match_stats.position to the short
// codes the loadout view OCR uses.  Returns null when the long form is
// ambiguous (`defenseMen` could be LD or RD).
function opponentPositionToShortCode(p: string | null): string | null {
  if (p === null) return null
  switch (p) {
    case 'center':
      return 'C'
    case 'leftWing':
      return 'LW'
    case 'rightWing':
      return 'RW'
    case 'goalie':
      return 'G'
    // 'defenseMen' is intentionally NOT mapped — it's ambiguous between
    // LD and RD.  Snapshots with only this authority must be disambiguated
    // by another signal.
    default:
      return null
  }
}

// ─── main export ───────────────────────────────────────────────────────────────

export async function promoteLoadoutFromEvidence(input: {
  matchId: number
  /**
   * Phase-A: when supplied, promote against this specific decoder run rather
   * than the currently-active one. The reprocess CLI passes the candidate
   * run's id here so we can compute + persist promotions BEFORE flipping
   * activation. When omitted (the legacy/normal call path), resolves to the
   * match's currently-active run (or `null` if none — e.g. test fixtures).
   *
   * Canonical snapshot tables (player_loadout_snapshots, x_factors,
   * attributes) are only written when this resolves to the active run. When
   * promoting against a non-active candidate, snapshots are deferred — the
   * reprocess CLI calls a separate rebuild step at activation time.
   */
  runId?: number | null
  /**
   * Accepts either the top-level `Database` connection or an outer
   * `PromoterDb` (PgTransaction) so callers (e.g. decoder-runs-cli
   * activate) can keep the whole promote+rebuild flow atomic.
   */
  db?: DbOrTx
}): Promise<PromoteLoadoutFromEvidenceResult> {
  const db = input.db ?? defaultDb
  const { matchId } = input

  // Resolve effective run + activation gate (Phase-A).
  // - For evidence READS: pass input.runId as-is. undefined → liveRunFilter
  //   (active + NULL legs); a specific id → strictly that run.
  // - For ocr_promotions WRITES + the writeSnapshots gate: resolve undefined
  //   to the current active run so default callers tag their promotions with
  //   the active run id.
  // Pass `db` so a caller mid-transaction (e.g. decoder-runs-cli activate)
  // sees the in-flight `is_active` flip from the same tx.
  const activeRunId = await getActiveRunIdForMatch(matchId, db as unknown as Database)
  const effectiveRunIdForWrites = input.runId !== undefined ? input.runId : activeRunId
  const writeSnapshots = effectiveRunIdForWrites === activeRunId

  // ── Step 1: Read loadout evidence scoped to the requested run (or live) ──
  const allEvidence = await getFieldEvidenceForLoadoutSlot(matchId, undefined, input.runId)

  // ── Step 2: Group by (subject_slot_key, field_key), sort by candidate_rank ──
  // evidenceBySlot: Map<slotKey, Map<fieldKey, evidence_rows_sorted_by_rank>>
  //
  // Field-key normalisation happens here so all downstream logic sees a single
  // consistent key space regardless of which extractor version produced the row:
  //
  //   typed_v1 extractor key          → internal key used by promoter
  //   jersey_number                   → player_number
  //   persona_raw                     → player_name_persona
  //   attribute_{name}_value          → attribute_{name}_value  (kept as-is; parsed later)
  //   attribute_{name}_delta          → attribute_{name}_delta  (kept as-is; parsed later)
  //   attr_{name}   (legacy fixture)  → attr_{name}            (kept; ATTRIBUTE_FIELD_KEYS)
  //   attr_{name}_delta (legacy)      → attr_{name}_delta      (kept; not counted for floor)
  const evidenceBySlot = new Map<string, Map<string, typeof allEvidence>>()
  for (const row of allEvidence) {
    const slotKey = row.subjectSlotKey ?? '__no_slot__'
    // Resolve field-key alias (jersey_number → player_number, persona_raw → player_name_persona).
    const effectiveFieldKey = FIELD_KEY_ALIASES[row.fieldKey] ?? row.fieldKey
    if (!evidenceBySlot.has(slotKey)) {
      evidenceBySlot.set(slotKey, new Map())
    }
    const slotMap = evidenceBySlot.get(slotKey)!
    if (!slotMap.has(effectiveFieldKey)) {
      slotMap.set(effectiveFieldKey, [])
    }
    slotMap.get(effectiveFieldKey)!.push(row)
  }
  // Within each (slot, field), rows are already sorted by candidateRank ASC
  // from the query order; no secondary sort needed.

  // ── Step 3: Derive gameTitleId for this match ─────────────────────────────
  // We need gameTitleId for snapshot inserts. Derive it from the first evidence
  // row's match_id → matches.game_title_id. Cache per match.
  const gameTitleId = await resolveGameTitleIdForMatch(db, matchId)

  // Resolve a valid ocr_extractions.id for this match's loadout-view
  // segments. Phase 2B's typed extractors write evidence row
  // `support_frame_ids` as bundle-internal frame INDICES (0, 1, 2, ...)
  // — not DB primary keys. Using those as the snapshot's `ocrExtractionId`
  // either fails the FK or silently writes random extraction IDs that
  // happen to coincide with small ints. We take the first real loadout
  // extraction for the match; provenance metadata (exact extraction_id)
  // is degraded but FK is valid, and downstream consumers can still
  // recover per-segment provenance via `ocr_field_evidence.segment_id`
  // through the new evidence rows.
  //
  // Phase 3b's lobby-v2 already does this; same pattern here closes the
  // matching latent bug for loadout-view that has been silently masked
  // by ID coincidences since Phase 2B.
  const loadoutExtractionRows = await db
    .select({ id: ocrExtractions.id })
    .from(ocrExtractions)
    .where(
      and(
        eq(ocrExtractions.matchId, matchId),
        eq(ocrExtractions.screenType, 'player_loadout_view'),
      ),
    )
    .limit(1)
  const resolvedLoadoutExtractionId = loadoutExtractionRows[0]?.id ?? null
  if (resolvedLoadoutExtractionId === null) {
    // No loadout-view extraction exists for this match — nothing to
    // promote. (Tests + production both seed an extraction first via
    // ingest-ocr-cli; this branch only fires on fresh DBs.)
    return { promotedSnapshotCount: 0, blockedSnapshotCount: 0, promotionRowsWritten: 0 }
  }

  // ── Steps 3-4: Per-slot gate calls + team-side binding ────────────────────
  const slotDecisions: SlotDecision[] = []

  for (const [slotKey, fieldMap] of evidenceBySlot.entries()) {
    // Run the gate for each field in this slot.
    const fieldDecisions = new Map<string, PromotionDecision>()
    for (const [fieldKey, rows] of fieldMap.entries()) {
      const candidates: GateCandidate[] = rows.map((r) => ({
        candidateRank: r.candidateRank,
        value: r.candidateValue,
        rawConfidence: r.rawConfidence !== null ? Number(r.rawConfidence) : 0,
        calibratedConfidence: r.calibratedConfidence !== null ? Number(r.calibratedConfidence) : 0,
        evidenceId: r.id,
      }))
      const decision = runPromotionGate({ candidates })
      fieldDecisions.set(fieldKey, decision)
    }

    // Use the match-wide resolved loadout extraction ID (see top of fn).
    // Production evidence rows have bundle-internal frame INDICES in
    // support_frame_ids, NOT real ocr_extractions.id values. Test fixtures
    // happen to seed real extraction IDs in support_frame_ids — they still
    // work because the match-wide lookup returns the seeded extraction.
    const ocrExtractionId = resolvedLoadoutExtractionId

    // ── Step 4: Team-side binding ──────────────────────────────────────────
    const gamertagDecision = fieldDecisions.get('gamertag')
    const positionDecision = fieldDecisions.get('position')

    let resolvedTeamSide: 'for' | 'against' | null = null
    let resolvedPlayerId: number | null = null
    let snapshotBlockReason: string | null = null
    let resolvedPosition: string | null = null
    // Stash for authority-position fallback when the OCR position is null
    // but the opponent_player_match_stats row has a known position.
    const resolutionAuthorityPosition: { value: string | null } = { value: null }

    if (
      gamertagDecision?.status === 'promoted' &&
      typeof gamertagDecision.winningValue === 'string'
    ) {
      const gamertag = gamertagDecision.winningValue
      const resolution = await resolveGamertagToPlayer(
        gamertag,
        gameTitleId,
        db as unknown as PromoterDb,
      )
      resolvedPlayerId = resolution.playerId
      if (resolution.playerId !== null) {
        // Resolved to a known player → BGM side ('for').
        resolvedTeamSide = 'for'
      } else {
        // Unresolved. Check if the gamertag appears in opponent_player_match_stats
        // for this match. If yes, write as team_side='against' with playerId=null
        // (opponent players are not in the players table by design).
        // If not found in either table, block with 'unresolved_team_side'.
        //
        // Matching strategy, in order:
        //   1. Exact case-insensitive
        //   2. Whitespace-removed (OCR joins multi-word gamertags:
        //      "RAIDERS G7" → "RAIDERSG7")
        //   3. Levenshtein-1 on whitespace-stripped form (covers single-char
        //      OCR errors like O↔0: "DAMICO2323" → "DAMIC02323")
        const oppRows = await db
          .select({
            id: opponentPlayerMatchStats.id,
            gamertag: opponentPlayerMatchStats.gamertag,
            position: opponentPlayerMatchStats.position,
          })
          .from(opponentPlayerMatchStats)
          .where(eq(opponentPlayerMatchStats.matchId, matchId))
        const stripWS = (s: string) => s.toLowerCase().replace(/\s+/g, '')
        const normGamertag = gamertag.toLowerCase()
        const compactGamertag = stripWS(gamertag)
        let oppMatch = oppRows.find((r) => {
          if (r.gamertag === null) return false
          const lc = r.gamertag.toLowerCase()
          return lc === normGamertag || stripWS(r.gamertag) === compactGamertag
        })
        if (oppMatch === undefined) {
          // Levenshtein-1 fallback on compact form
          const oneEdit = (a: string, b: string): boolean => {
            if (Math.abs(a.length - b.length) > 1) return false
            // Try substitution / deletion / insertion
            let i = 0,
              j = 0,
              diffs = 0
            while (i < a.length && j < b.length) {
              if (a[i] !== b[j]) {
                if (++diffs > 1) return false
                if (a.length > b.length) i++
                else if (a.length < b.length) j++
                else {
                  i++
                  j++
                }
              } else {
                i++
                j++
              }
            }
            return diffs + (a.length - i) + (b.length - j) <= 1
          }
          oppMatch = oppRows.find((r) => {
            if (r.gamertag === null) return false
            return oneEdit(stripWS(r.gamertag), compactGamertag)
          })
        }
        if (oppMatch !== undefined) {
          resolvedTeamSide = 'against'
          // playerId stays null — opponents are not in the players table.
          // Stash the authority position for later use if the OCR position
          // evidence is unresolved.
          ;(resolutionAuthorityPosition as { value: string | null }).value =
            (oppMatch.position as string | null) ?? null
        } else {
          snapshotBlockReason = 'unresolved_team_side'
        }
      }
    }

    // Position: validate closed-vocab.  The gate may promote a NULL value
    // when the only candidate had candidate_value IS NULL (low-quality
    // observability marker — value=null + conf=0).  Treat null/empty as
    // unresolved_position UNLESS the opponent authority has a position for
    // this gamertag, in which case map the EA long-form to short code and
    // use that.
    {
      let useAuthFallback = true
      if (positionDecision?.status === 'promoted') {
        const raw = positionDecision.winningValue
        const pos = typeof raw === 'string' ? raw : ''
        if (pos !== '' && VALID_POSITIONS.has(pos)) {
          resolvedPosition = pos
          useAuthFallback = false
        }
      }
      if (useAuthFallback) {
        const authShort = opponentPositionToShortCode(resolutionAuthorityPosition.value)
        if (authShort !== null) {
          resolvedPosition = authShort
        } else if (!snapshotBlockReason) {
          snapshotBlockReason = 'unresolved_position'
        }
      }
    }

    slotDecisions.push({
      slotKey,
      fieldDecisions,
      resolvedTeamSide,
      resolvedPosition,
      resolvedPlayerId,
      gameTitleId,
      ocrExtractionId,
      snapshotBlockReason,
    })
  }

  // ── Step 9 (partial): Duplicate position-per-team validation ──────────────
  // Track promoted snapshots by (teamSide, position) to detect duplicates.
  const promotedPositions = new Map<string, string>() // key: `${teamSide}:${position}` → slotKey

  // Annotate duplicate slots before writing.
  const duplicateSlots = new Set<string>()
  for (const sd of slotDecisions) {
    if (sd.snapshotBlockReason) continue
    if (!sd.resolvedTeamSide || !sd.resolvedPosition) continue
    const key = `${sd.resolvedTeamSide}:${sd.resolvedPosition}`
    if (promotedPositions.has(key)) {
      // This slot is a duplicate — mark it blocked.
      duplicateSlots.add(sd.slotKey)
    } else {
      promotedPositions.set(key, sd.slotKey)
    }
  }
  // Apply duplicate blocks.
  for (const sd of slotDecisions) {
    if (duplicateSlots.has(sd.slotKey)) {
      sd.snapshotBlockReason = 'duplicate_position_per_team'
    }
  }

  // ── Step 8: Expected-roster observability ────────────────────────────────
  // getExpectedSlotsForMatch still expects the top-level Database type;
  // safe to cast because PgTransaction inherits the same query-builder
  // surface that the function uses.
  const expectedSlots = await getExpectedSlotsForMatch(matchId, db as unknown as Database)
  const coveredKeys = new Set<string>()
  for (const sd of slotDecisions) {
    if (sd.snapshotBlockReason) continue
    if (sd.resolvedTeamSide && sd.resolvedPosition) {
      coveredKeys.add(`${sd.resolvedTeamSide}:${sd.resolvedPosition}`)
    }
  }
  const absentExpectedSlots: ExpectedSlot[] = expectedSlots.filter(
    (s) => !coveredKeys.has(`${s.teamSide}:${s.position}`),
  )

  // ── Stage B: DB writes ───────────────────────────────────────────────────
  const pendingPromotions: PendingPromotion[] = []
  let promotedSnapshotCount = 0
  let blockedSnapshotCount = 0

  for (const sd of slotDecisions) {
    const semanticKey: Record<string, unknown> = {
      match_id: matchId,
      slot_key: sd.slotKey,
      team_side: sd.resolvedTeamSide,
      position: sd.resolvedPosition,
    }

    // ── If slot is blocked at snapshot level ────────────────────────────────
    if (sd.snapshotBlockReason) {
      blockedSnapshotCount++
      pendingPromotions.push({
        matchId,
        targetTable: 'player_loadout_snapshots',
        targetSemanticKey: semanticKey,
        fieldKey: null,
        winningValue: null,
        winningConfidence: null,
        evidenceCount: 0,
        conflictCount: 0,
        evidenceIds: [],
        promotionStatus: 'blocked_invariant',
        blockingReason: sd.snapshotBlockReason,
        authoritySource: null,
      })

      // Still record per-field decisions for triage.
      for (const [fieldKey, decision] of sd.fieldDecisions.entries()) {
        pendingPromotions.push(
          fieldDecisionToPromotion(
            matchId,
            'player_loadout_snapshots',
            semanticKey,
            fieldKey,
            decision,
          ),
        )
      }
      continue
    }

    // ── Check HARD fields ────────────────────────────────────────────────────
    // All HARD fields (gamertag, position) must be promoted.
    let hardFieldsOk = true
    for (const hardField of HARD_FIELD_KEYS) {
      const dec = sd.fieldDecisions.get(hardField)
      if (!dec || dec.status !== 'promoted') {
        hardFieldsOk = false
        break
      }
    }

    if (!hardFieldsOk) {
      blockedSnapshotCount++
      pendingPromotions.push({
        matchId,
        targetTable: 'player_loadout_snapshots',
        targetSemanticKey: semanticKey,
        fieldKey: null,
        winningValue: null,
        winningConfidence: null,
        evidenceCount: 0,
        conflictCount: 0,
        evidenceIds: [],
        promotionStatus: 'blocked_invariant',
        blockingReason: 'hard_fields_not_promoted',
        authoritySource: null,
      })
      for (const [fieldKey, decision] of sd.fieldDecisions.entries()) {
        pendingPromotions.push(
          fieldDecisionToPromotion(
            matchId,
            'player_loadout_snapshots',
            semanticKey,
            fieldKey,
            decision,
          ),
        )
      }
      continue
    }

    // ── Snapshot row is promotable — collect field values ────────────────────
    const gamertagVal = String(sd.fieldDecisions.get('gamertag')!.winningValue ?? '')
    const positionVal = sd.resolvedPosition!
    const teamSide = sd.resolvedTeamSide!

    // Persona alias resolution (Step 6)
    const personaRawDecision = sd.fieldDecisions.get('player_name_persona')
    const personaRaw =
      personaRawDecision?.status === 'promoted'
        ? String(personaRawDecision.winningValue ?? '')
        : null
    const personaCanonical = personaRaw ? await resolvePersonaAlias(db, personaRaw) : null

    // Optional fields
    const playerNameFullDecision = sd.fieldDecisions.get('player_name_full')
    const playerNameFull =
      playerNameFullDecision?.status === 'promoted'
        ? String(playerNameFullDecision.winningValue ?? '')
        : null
    const playerNumberDecision = sd.fieldDecisions.get('player_number')
    const playerNumber =
      playerNumberDecision?.status === 'promoted' &&
      typeof playerNumberDecision.winningValue === 'number'
        ? playerNumberDecision.winningValue
        : null
    const isCaptainDecision = sd.fieldDecisions.get('is_captain')
    const isCaptain =
      isCaptainDecision?.status === 'promoted' &&
      typeof isCaptainDecision.winningValue === 'boolean'
        ? isCaptainDecision.winningValue
        : null
    const buildClassDecision = sd.fieldDecisions.get('build_class')
    const buildClass =
      buildClassDecision?.status === 'promoted'
        ? String(buildClassDecision.winningValue ?? '')
        : null
    const heightDecision = sd.fieldDecisions.get('height')
    const heightText =
      heightDecision?.status === 'promoted' ? String(heightDecision.winningValue ?? '') : null
    const weightDecision = sd.fieldDecisions.get('weight')
    const weightLbs =
      weightDecision?.status === 'promoted' && typeof weightDecision.winningValue === 'number'
        ? weightDecision.winningValue
        : null
    const handednessDecision = sd.fieldDecisions.get('handedness')
    const handedness =
      handednessDecision?.status === 'promoted'
        ? String(handednessDecision.winningValue ?? '')
        : null
    const platformDecision = sd.fieldDecisions.get('player_platform')
    const platform =
      platformDecision?.status === 'promoted'
        ? whitelistPlatform(String(platformDecision.winningValue ?? ''))
        : null
    const levelRawDecision = sd.fieldDecisions.get('player_level_raw')
    const playerLevelRaw =
      levelRawDecision?.status === 'promoted' ? String(levelRawDecision.winningValue ?? '') : null
    const levelNumDecision = sd.fieldDecisions.get('player_level_number')
    const playerLevelNumber =
      levelNumDecision?.status === 'promoted' && typeof levelNumDecision.winningValue === 'number'
        ? levelNumDecision.winningValue
        : null

    // ── Write snapshot row (inside transaction below) ───────────────────────
    promotedSnapshotCount++

    // ── X-Factor child block check ──────────────────────────────────────────
    const xfDecisions = XFACTOR_FIELD_KEYS.map((fk) => sd.fieldDecisions.get(fk))
    const xfAllPromoted = xfDecisions.every((d) => d?.status === 'promoted')
    const writeXFactors = xfAllPromoted && xfDecisions.length === 3

    // ── Attribute child block check ─────────────────────────────────────────
    //
    // Two attribute evidence formats are accepted:
    //
    // (A) Extractor format (typed_v1):
    //     field_key = `attribute_{name}_value`  → base value (int)
    //     field_key = `attribute_{name}_delta`  → +/- chip delta (int | null)
    //     Each canonical attribute name produces TWO evidence records.
    //     They are merged into ONE player_loadout_attributes row per name with
    //     both `value` and `delta_value` columns populated.
    //     An attribute is considered "promoted" when its `_value` record promotes.
    //
    // (B) Legacy fixture format (pre-Phase-2A-typed_v1 test fixtures):
    //     field_key = `attr_{name}` → base value (int)
    //     field_key = `attr_{name}_delta` → optional delta (int) — not counted toward floor
    //     An attribute is considered "promoted" when its `attr_{name}` record promotes.
    //
    // The floor of 20 promoted attributes is applied consistently in both formats.

    // Merged attribute map: canonical name → {valueDec, deltaDec}
    interface AttrMerge {
      valueDec: PromotionDecision | null
      deltaDec: PromotionDecision | null
    }
    const mergedAttrs = new Map<string, AttrMerge>()

    for (const [fieldKey, dec] of sd.fieldDecisions.entries()) {
      // --- Format A: attribute_{name}_{value|delta} ---
      const parsed = parseExtractorAttributeKey(fieldKey)
      if (parsed !== null) {
        const existing = mergedAttrs.get(parsed.name) ?? { valueDec: null, deltaDec: null }
        if (parsed.column === 'value') {
          existing.valueDec = dec
        } else {
          existing.deltaDec = dec
        }
        mergedAttrs.set(parsed.name, existing)
        continue
      }
      // --- Format B: attr_{name} (legacy; ATTRIBUTE_FIELD_KEYS) ---
      if (ATTRIBUTE_FIELD_KEYS.has(fieldKey)) {
        const name = fieldKey.replace(/^attr_/, '')
        const existing = mergedAttrs.get(name) ?? { valueDec: null, deltaDec: null }
        existing.valueDec = dec // legacy: no separate _value key
        mergedAttrs.set(name, existing)
        continue
      }
      // --- Format B delta: attr_{name}_delta ---
      if (fieldKey.startsWith('attr_') && fieldKey.endsWith('_delta')) {
        const name = fieldKey.slice('attr_'.length, -'_delta'.length)
        if (CANONICAL_ATTRIBUTE_NAMES.has(name)) {
          const existing = mergedAttrs.get(name) ?? { valueDec: null, deltaDec: null }
          existing.deltaDec = dec
          mergedAttrs.set(name, existing)
        }
      }
    }

    // attrDecisions: one entry per canonical attribute name that has at least a valueDec
    const attrDecisions: Array<[string, AttrMerge]> = []
    for (const [name, merge] of mergedAttrs.entries()) {
      if (merge.valueDec !== null) {
        attrDecisions.push([name, merge])
      }
    }
    const promotedAttrCount = attrDecisions.filter(
      ([, m]) => m.valueDec?.status === 'promoted',
    ).length
    const writeAttributes = promotedAttrCount >= ATTRIBUTE_PROMOTION_FLOOR

    // is_cpu from the field evidence — always false in loadout view (the
    // operator can't navigate to a CPU subject's loadout screen), but read
    // here for contract symmetry with lobby-v2 so any future loadout-view
    // extractor that does start emitting is_cpu is honoured automatically.
    const isCpuDecision = sd.fieldDecisions.get('is_cpu')
    const isCpu =
      isCpuDecision?.status === 'promoted' && typeof isCpuDecision.winningValue === 'boolean'
        ? isCpuDecision.winningValue
        : false

    // ── DB writes in a transaction (skipped when promoting against a
    //     non-active candidate run; rebuildCanonicalsFromActiveRun handles
    //     snapshot rebuild at activation time). ─────────────────────────────
    if (writeSnapshots) {
      await db.transaction(async (tx) => {
        // Insert snapshot row
        const [snap] = await tx
          .insert(playerLoadoutSnapshots)
          .values({
            playerId: sd.resolvedPlayerId,
            gamertagSnapshot: gamertagVal,
            playerNameSnapshot: playerNameFull,
            playerNamePersona: personaCanonical ?? personaRaw,
            playerNamePersonaRaw: personaRaw,
            playerNumber,
            isCaptain,
            teamSide,
            gameTitleId: sd.gameTitleId,
            matchId,
            ocrExtractionId: sd.ocrExtractionId,
            position: positionVal,
            buildClass,
            heightText,
            weightLbs,
            handedness,
            platform,
            playerLevelRaw,
            playerLevelNumber,
            isCpu,
          })
          .returning({ id: playerLoadoutSnapshots.id })
        if (!snap) throw new Error(`Failed to insert snapshot for slot ${sd.slotKey}`)

        // X-Factor child rows
        if (writeXFactors) {
          const xfRows: NewPlayerLoadoutXFactor[] = XFACTOR_FIELD_KEYS.map((fk, i) => {
            const dec = sd.fieldDecisions.get(fk)!
            const name = String(dec.winningValue ?? '')
            const tierDec = sd.fieldDecisions.get(`x_factor_tier_${i}`)
            // Only persist a tier when the gate promoted a value that is a
            // valid enum. A promoted-but-NULL decision (observability marker:
            // value=null, conf=0) previously became the literal string "null"
            // via String(null) — bogus data that polluted the column and
            // inflated the lineup "Tiered" provenance. Coerce anything invalid
            // to real SQL NULL.
            const tier =
              tierDec?.status === 'promoted' ? coerceXFactorTier(tierDec.winningValue) : null
            return {
              loadoutSnapshotId: snap.id,
              slotIndex: i,
              xFactorName: name,
              xFactorNameCanonical: normalizeXFactor(name),
              tier,
            }
          })
          await tx.insert(playerLoadoutXFactors).values(xfRows)
        }

        // Attribute child rows
        if (writeAttributes) {
          const attrRows: NewPlayerLoadoutAttribute[] = attrDecisions
            .filter(([, m]) => m.valueDec?.status === 'promoted')
            .map(([name, m]) => {
              const vDec = m.valueDec!
              const dDec = m.deltaDec
              const rawValue = vDec.winningValue
              const rawDelta = dDec?.status === 'promoted' ? dDec.winningValue : null
              return {
                loadoutSnapshotId: snap.id,
                attributeKey: name,
                rawText: typeof rawValue === 'string' ? rawValue : String(rawValue ?? ''),
                value: typeof rawValue === 'number' ? rawValue : null,
                deltaValue: typeof rawDelta === 'number' ? rawDelta : null,
                confidence:
                  vDec.winningConfidence !== undefined
                    ? String(vDec.winningConfidence.toFixed(4))
                    : null,
              }
            })
          await tx.insert(playerLoadoutAttributes).values(attrRows)
        }
      })
    }

    // ── Build ocr_promotions rows for this slot ──────────────────────────────
    const snapshotSemanticKey = { match_id: matchId, team_side: teamSide, position: positionVal }

    // Per-field promotions
    for (const [fieldKey, decision] of sd.fieldDecisions.entries()) {
      pendingPromotions.push(
        fieldDecisionToPromotion(
          matchId,
          'player_loadout_snapshots',
          snapshotSemanticKey,
          fieldKey,
          decision,
        ),
      )
    }

    // Snapshot-level promoted row (whole-row).
    // Collect the union of all evidenceIds from every field decision for this
    // slot so that the snapshot-level row records which ocr_field_evidence rows
    // contributed to the promotion decision.
    const allSlotEvidenceIds = Array.from(
      new Set(Array.from(sd.fieldDecisions.values()).flatMap((d) => d.evidenceIds)),
    )
    pendingPromotions.push({
      matchId,
      targetTable: 'player_loadout_snapshots',
      targetSemanticKey: snapshotSemanticKey,
      fieldKey: null,
      winningValue: { gamertag: gamertagVal, position: positionVal, team_side: teamSide },
      winningConfidence: null,
      evidenceCount: allSlotEvidenceIds.length,
      conflictCount: 0,
      evidenceIds: allSlotEvidenceIds,
      promotionStatus: 'promoted',
      blockingReason: null,
      authoritySource: 'ocr_evidence',
    })

    // X-Factor child block: if NOT written, record blocked rows for each xf field
    if (!writeXFactors) {
      for (let i = 0; i < XFACTOR_FIELD_KEYS.length; i++) {
        const fk = XFACTOR_FIELD_KEYS[i]!
        const dec = sd.fieldDecisions.get(fk)
        if (!dec || dec.status !== 'promoted') {
          const xfSemanticKey = {
            match_id: matchId,
            team_side: teamSide,
            position: positionVal,
            slot_index: i,
          }
          pendingPromotions.push({
            matchId,
            targetTable: 'player_loadout_x_factors',
            targetSemanticKey: xfSemanticKey,
            fieldKey: fk,
            winningValue: null,
            winningConfidence: null,
            evidenceCount: dec?.evidenceIds.length ?? 0,
            conflictCount: dec?.conflictCount ?? 0,
            evidenceIds: dec?.evidenceIds ?? [],
            promotionStatus: dec?.status ?? 'blocked_observability',
            blockingReason: dec?.blockingReason ?? 'x_factor_child_block_incomplete',
            authoritySource: null,
          })
        }
      }
    }

    // Attribute child block: record blocked attribute rows if not written
    if (!writeAttributes) {
      for (const [name, merge] of attrDecisions) {
        const vDec = merge.valueDec
        if (!vDec || vDec.status !== 'promoted') {
          const attrSemanticKey = {
            match_id: matchId,
            team_side: teamSide,
            position: positionVal,
            attribute_key: name,
          }
          pendingPromotions.push({
            matchId,
            targetTable: 'player_loadout_attributes',
            targetSemanticKey: attrSemanticKey,
            fieldKey: name,
            winningValue: null,
            winningConfidence: null,
            evidenceCount: vDec?.evidenceIds.length ?? 0,
            conflictCount: vDec?.conflictCount ?? 0,
            evidenceIds: vDec?.evidenceIds ?? [],
            promotionStatus: vDec?.status ?? 'blocked_observability',
            blockingReason: vDec?.blockingReason ?? null,
            authoritySource: null,
          })
        }
      }
    }
  }

  // ── Step 8: Emit blocked_observability rows for absent expected slots ──────
  for (const absent of absentExpectedSlots) {
    pendingPromotions.push({
      matchId,
      targetTable: 'player_loadout_snapshots',
      targetSemanticKey: {
        match_id: matchId,
        team_side: absent.teamSide,
        position: absent.position,
      },
      fieldKey: null,
      winningValue: null,
      winningConfidence: null,
      evidenceCount: 0,
      conflictCount: 0,
      evidenceIds: [],
      promotionStatus: 'blocked_observability',
      blockingReason: 'not_observable_from_source',
      authoritySource: null,
    })
  }

  // ── Write all ocr_promotions rows ─────────────────────────────────────────
  // Strategy: delete prior promotion rows for this (match, run_id) tuple,
  // then batch-insert the new set. Scoping by run_id (Phase-A) means a v2
  // reprocess won't blow away v1 promotions — they stay in their own run for
  // audit/rollback.
  let promotionRowsWritten = 0
  if (pendingPromotions.length > 0) {
    await db
      .delete(ocrPromotions)
      .where(
        and(
          eq(ocrPromotions.matchId, matchId),
          effectiveRunIdForWrites === null
            ? sql`${ocrPromotions.runId} IS NULL`
            : eq(ocrPromotions.runId, effectiveRunIdForWrites),
        ),
      )

    // Batch insert all pending promotion rows, tagged with the effective runId.
    await db.insert(ocrPromotions).values(
      pendingPromotions.map((p) => ({
        matchId: p.matchId,
        targetTable: p.targetTable,
        targetSemanticKey: p.targetSemanticKey,
        fieldKey: p.fieldKey,
        winningValue: p.winningValue,
        winningConfidence:
          p.winningConfidence !== null ? String(p.winningConfidence.toFixed(4)) : null,
        evidenceCount: p.evidenceCount,
        conflictCount: p.conflictCount,
        evidenceIds: p.evidenceIds.length > 0 ? p.evidenceIds : null,
        promotionStatus: p.promotionStatus,
        blockingReason: p.blockingReason,
        authoritySource: p.authoritySource,
        runId: effectiveRunIdForWrites,
      })),
    )
    promotionRowsWritten = pendingPromotions.length
  }

  return {
    promotedSnapshotCount,
    blockedSnapshotCount,
    promotionRowsWritten,
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────────

/**
 * Resolve gameTitleId for a match by querying matches.
 * Falls back to game_title_id=1 (NHL 26) for sentinel matches in tests.
 */
async function resolveGameTitleIdForMatch(db: DbOrTx, matchId: number): Promise<number> {
  const [row] = await db
    .select({ gameTitleId: matches.gameTitleId })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1)
  if (!row) {
    // Fallback: use game_title_id=1 (NHL 26) for sentinel matches without a match row.
    return 1
  }
  return row.gameTitleId
}

/**
 * Resolve a raw persona string against the player_persona_aliases table.
 * Returns the canonical persona if found, else null (raw value is used as-is).
 */
async function resolvePersonaAlias(db: DbOrTx, personaRaw: string): Promise<string | null> {
  const normalized = normalizeSnapshot(personaRaw).toLowerCase()
  const [row] = await db
    .select({ canonicalPersona: playerPersonaAliases.canonicalPersona })
    .from(playerPersonaAliases)
    .where(eq(playerPersonaAliases.normalizedAlias, normalized))
    .limit(1)
  return row?.canonicalPersona ?? null
}

/**
 * Convert a PromotionDecision for a single field into a PendingPromotion
 * for the ocr_promotions table.
 */
function fieldDecisionToPromotion(
  matchId: number,
  targetTable: string,
  targetSemanticKey: Record<string, unknown>,
  fieldKey: string,
  decision: PromotionDecision,
): PendingPromotion {
  return {
    matchId,
    targetTable,
    targetSemanticKey,
    fieldKey,
    winningValue: decision.winningValue ?? null,
    winningConfidence: decision.winningConfidence ?? null,
    evidenceCount: decision.evidenceIds.length,
    conflictCount: decision.conflictCount,
    evidenceIds: decision.evidenceIds,
    promotionStatus: decision.status,
    blockingReason: decision.blockingReason ?? null,
    authoritySource: decision.authoritySource ?? null,
  }
}

const PLATFORM_WHITELIST: ReadonlySet<string> = new Set([
  'xbox',
  'playstation',
  'ps5',
  'ps4',
  'pc',
  'switch',
])

function whitelistPlatform(raw: string | null): string | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase()
  if (!key) return null
  return PLATFORM_WHITELIST.has(key) ? raw.trim() : null
}
