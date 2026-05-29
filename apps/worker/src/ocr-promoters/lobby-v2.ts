/**
 * lobby-v2 promoter - evidence-gate to canonical lobby snapshot write (Phase 3b).
 *
 * promoteLobbyFromEvidence reads ocr_field_evidence rows for a match scoped
 * to screen_state='pre_game_lobby_state_2', runs the generic promotion gate
 * per (slot_key, field_key), and writes:
 *   - player_loadout_snapshots (one per promoted slot - NO x_factors/attributes
 *     children; the lobby UI doesn't expose those)
 *   - ocr_promotions (one row per per-field gate decision + slot-level outcomes)
 *
 * Differences vs loadout-v2:
 *   - team_side comes from the slot_key prefix (lobby_for_ / lobby_against_) -
 *     no need for resolveGamertagToPlayer-based binding because the
 *     extractor already encodes team_side in the subject key.
 *   - Hard fields are gamertag + position. build_class is soft because
 *     state_2 frames don't expose it (state_1 does, but Phase 3a confirmed
 *     state_1 frames don't appear in operator recordings).
 *   - No x_factors / no attributes child blocks.
 *   - Idempotent on (matchId, source=lobby): prior lobby-sourced snapshots for
 *     the match are deleted before re-insert, so re-runs don't accumulate.
 *
 * Per the Phase 3b spec, this promoter writes its own snapshots; the existing
 * consolidate-loadouts-cli is responsible for picking canonical rows when
 * both lobby AND loadout-view produce data for the same (team_side, position).
 */

import {
  db as defaultDb,
  ocrExtractions,
  ocrPromotions,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
  matches,
  type Database,
} from '@eanhl/db'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getFieldEvidenceForLobbySlot, getActiveRunIdForMatch } from '@eanhl/db/queries'
import type { DbOrTx } from './index.js'
import type { GateCandidate, PromotionDecision } from '../lib/promotion-gate.js'
import { runPromotionGate } from '../lib/promotion-gate.js'
import { resolveGamertagToPlayer } from './resolve-identity.js'
import { resolvePersona } from '../lib/normalize-persona.js'
import type { PromoterDb } from './index.js'

export interface PromoteLobbyFromEvidenceResult {
  promotedSnapshotCount: number
  blockedSnapshotCount: number
  promotionRowsWritten: number
}

interface LobbySlotDecision {
  slotKey: string
  fieldDecisions: Map<string, PromotionDecision>
  teamSide: 'for' | 'against'
  position: string
  ocrExtractionId: number
  resolvedPlayerId: number | null
  /**
   * True when the lobby OCR identified this slot as CPU/empty (no human
   * player). Sourced from the `is_cpu` field evidence promoted by the gate.
   * CPU rows still get a snapshot — with a synthetic gamertag='CPU' — so
   * downstream queries can see the slot exists, but identity resolution and
   * the hard-fields gamertag check are skipped for them.
   */
  isCpu: boolean
  snapshotBlockReason: string | null
}

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

const HARD_FIELD_KEYS = new Set(['gamertag', 'position'])
const VALID_POSITIONS = new Set(['C', 'LW', 'RW', 'LD', 'RD', 'G'])
const SLOT_KEY_RE = /^lobby_(for|against)_(C|LW|RW|LD|RD|G)$/

const PLATFORM_WHITELIST: ReadonlySet<string> = new Set([
  'xbox',
  'playstation',
  'ps5',
  'ps4',
  'pc',
  'switch',
])

function whitelistPlatform(raw: string | null): string | null {
  if (raw === null) return null
  const lower = raw.toLowerCase()
  return PLATFORM_WHITELIST.has(lower) ? lower : null
}

async function resolveGameTitleIdForMatch(db: DbOrTx, matchId: number): Promise<number> {
  const [row] = await db
    .select({ gameTitleId: matches.gameTitleId })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1)
  if (!row) return 1
  return row.gameTitleId
}

function parseSlotKey(slotKey: string): { teamSide: 'for' | 'against'; position: string } | null {
  const m = SLOT_KEY_RE.exec(slotKey)
  if (!m) return null
  return { teamSide: m[1] as 'for' | 'against', position: m[2]! }
}

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

function promotedString(decision: PromotionDecision | undefined): string | null {
  if (!decision || decision.status !== 'promoted') return null
  const v = decision.winningValue
  return typeof v === 'string' ? v : null
}

function promotedNumber(decision: PromotionDecision | undefined): number | null {
  if (!decision || decision.status !== 'promoted') return null
  const v = decision.winningValue
  return typeof v === 'number' ? v : null
}

function promotedBool(decision: PromotionDecision | undefined): boolean | null {
  if (!decision || decision.status !== 'promoted') return null
  const v = decision.winningValue
  return typeof v === 'boolean' ? v : null
}

export async function promoteLobbyFromEvidence(input: {
  matchId: number
  /**
   * Phase-A: when supplied, promote against this specific decoder run rather
   * than the currently-active one. See loadout-v2.ts for full semantics.
   * Canonical snapshot writes are skipped when this resolves to a non-active
   * run; rebuildCanonicalsFromActiveRun handles them at activation time.
   */
  runId?: number | null
  /**
   * Accepts either the top-level `Database` connection or an outer
   * `PromoterDb` (PgTransaction) so callers (e.g. decoder-runs-cli
   * activate) can keep the whole promote+rebuild flow atomic.
   */
  db?: DbOrTx
}): Promise<PromoteLobbyFromEvidenceResult> {
  const db = input.db ?? defaultDb
  const { matchId } = input

  // Resolve effective run + activation gate (Phase-A). See loadout-v2.ts for
  // the full reasoning behind the two-name split.
  // Pass `db` so a caller mid-transaction (e.g. decoder-runs-cli activate)
  // sees the in-flight `is_active` flip from the same tx.
  const activeRunId = await getActiveRunIdForMatch(matchId, db as unknown as Database)
  const effectiveRunIdForWrites = input.runId !== undefined ? input.runId : activeRunId
  const writeSnapshots = effectiveRunIdForWrites === activeRunId

  const allEvidence = await getFieldEvidenceForLobbySlot(matchId, undefined, input.runId)

  const evidenceBySlot = new Map<string, Map<string, typeof allEvidence>>()
  for (const row of allEvidence) {
    const slotKey = row.subjectSlotKey ?? '__no_slot__'
    if (!evidenceBySlot.has(slotKey)) {
      evidenceBySlot.set(slotKey, new Map())
    }
    const slotMap = evidenceBySlot.get(slotKey)!
    if (!slotMap.has(row.fieldKey)) {
      slotMap.set(row.fieldKey, [])
    }
    slotMap.get(row.fieldKey)!.push(row)
  }

  const gameTitleId = await resolveGameTitleIdForMatch(db, matchId)

  // Resolve a valid ocr_extractions.id for this match's lobby segments.
  // Phase 2B's typed extractors write `support_frame_ids` as raw frame
  // INDICES (0, 1, 2, 3) — not DB primary keys. We need a real
  // ocr_extractions.id for the snapshot's FK. Take the first lobby
  // extraction for the match; the snapshot row's exact extraction_id
  // is provenance metadata and any lobby extraction in the same match
  // is semantically equivalent.
  const lobbyExtractionRows = await db
    .select({ id: ocrExtractions.id })
    .from(ocrExtractions)
    .where(
      and(
        eq(ocrExtractions.matchId, matchId),
        eq(ocrExtractions.screenType, 'pre_game_lobby_state_2'),
      ),
    )
    .limit(1)
  const lobbyExtractionId = lobbyExtractionRows[0]?.id ?? null
  if (lobbyExtractionId === null) {
    // No lobby extraction exists for this match — nothing to promote.
    return { promotedSnapshotCount: 0, blockedSnapshotCount: 0, promotionRowsWritten: 0 }
  }

  const slotDecisions: LobbySlotDecision[] = []

  for (const [slotKey, fieldMap] of evidenceBySlot.entries()) {
    const parsed = parseSlotKey(slotKey)
    if (!parsed) {
      slotDecisions.push({
        slotKey,
        fieldDecisions: new Map(),
        teamSide: 'for',
        position: '',
        ocrExtractionId: 0,
        resolvedPlayerId: null,
        isCpu: false,
        snapshotBlockReason: 'invalid_slot_key',
      })
      continue
    }

    const fieldDecisions = new Map<string, PromotionDecision>()
    for (const [fieldKey, rows] of fieldMap.entries()) {
      const candidates: GateCandidate[] = rows.map((r) => ({
        candidateRank: r.candidateRank,
        value: r.candidateValue,
        rawConfidence: r.rawConfidence !== null ? Number(r.rawConfidence) : 0,
        calibratedConfidence: r.calibratedConfidence !== null ? Number(r.calibratedConfidence) : 0,
        evidenceId: r.id,
      }))
      // Lobby evidence collects one candidate per (slot, field) per lobby
      // SEGMENT. When a match has 2+ lobby segments (e.g. one before
      // loadout navigation, one after), each contributes its own candidate
      // with a similar OCR confidence - they're multi-frame observations
      // of the SAME field, not competing readings. The default 1.5x
      // dominance ratio interprets two close-confidence rows as
      // 'blocked_consensus'; for lobby we want the highest-confidence
      // candidate to win regardless of dominance. Set dominanceRatio: 1.0
      // so any non-tie wins.
      const decision = runPromotionGate({ candidates, dominanceRatio: 1.0 })
      fieldDecisions.set(fieldKey, decision)
    }

    // All snapshots for this match's lobby get tied to the same real
    // lobby ocr_extractions.id (resolved above) so the FK is valid. The
    // `support_frame_ids` in evidence rows are frame INDICES from the
    // typed extractor and can't be used as DB IDs.
    const ocrExtractionId = lobbyExtractionId

    // OR-fold semantics for is_cpu: any frame voting true wins, bypassing
    // the democratic vote in runPromotionGate. is_cpu has asymmetric failure
    // cost (false-negative leaves a CPU row inflating metrics + risking
    // render leaks; false-positive merely removes one row, recoverable via
    // operator review). The Python detector emits raw_confidence=1.0 only on
    // positive identification, so any 'true' vote is structurally meaningful
    // and not OCR noise. The democratic vote loses to 'false' when one frame
    // correctly detects CPU and another mis-reads EA's placeholder gamertag
    // (e.g. 'XZ4RKY' for match 250, 'bad' for match 968) as a real human.
    // TODO Phase-3: harden the detector itself via cross-team duplicate
    // detection in slot_identity.py — a real gamertag can't appear on both
    // rosters of the same lobby simultaneously.
    const isCpuRows = fieldMap.get('is_cpu') ?? []
    const isCpu = isCpuRows.some(
      (r) => r.candidateValue === true || r.candidateValue === 'true',
    )

    let resolvedPlayerId: number | null = null
    // Skip identity resolution for CPU rows — there's no human to bind to,
    // and the synthetic 'CPU' gamertag (written below) is in the junk
    // denylist so a stray resolveGamertagToPlayer call would always
    // return null anyway.
    if (parsed.teamSide === 'for' && !isCpu) {
      const gamertagDecision = fieldDecisions.get('gamertag')
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
      }
    }

    slotDecisions.push({
      slotKey,
      fieldDecisions,
      teamSide: parsed.teamSide,
      position: parsed.position,
      ocrExtractionId,
      resolvedPlayerId,
      isCpu,
      snapshotBlockReason: null,
    })
  }

  // Idempotency: drop prior lobby-sourced snapshots for this match before insert.
  // Cascade through child tables (x_factors + attributes may have been
  // populated by the post-promotion consolidator, even though THIS promoter
  // never writes them directly).
  //
  // Phase-A: skip snapshot delete/rebuild when promoting against a non-active
  // candidate run — snapshots are reserved for the active run and rebuilt at
  // activation time by the reprocess CLI.
  if (writeSnapshots) {
    const priorLobbyExtractionIds = (
      await db
        .select({ id: ocrExtractions.id })
        .from(ocrExtractions)
        .where(
          and(
            eq(ocrExtractions.matchId, matchId),
            eq(ocrExtractions.screenType, 'pre_game_lobby_state_2'),
          ),
        )
    ).map((r) => r.id)
    if (priorLobbyExtractionIds.length > 0) {
      const priorSnapshotIds = (
        await db
          .select({ id: playerLoadoutSnapshots.id })
          .from(playerLoadoutSnapshots)
          .where(
            and(
              eq(playerLoadoutSnapshots.matchId, matchId),
              inArray(playerLoadoutSnapshots.ocrExtractionId, priorLobbyExtractionIds),
            ),
          )
      ).map((r) => r.id)
      if (priorSnapshotIds.length > 0) {
        await db
          .delete(playerLoadoutXFactors)
          .where(inArray(playerLoadoutXFactors.loadoutSnapshotId, priorSnapshotIds))
        await db
          .delete(playerLoadoutAttributes)
          .where(inArray(playerLoadoutAttributes.loadoutSnapshotId, priorSnapshotIds))
        await db
          .delete(playerLoadoutSnapshots)
          .where(inArray(playerLoadoutSnapshots.id, priorSnapshotIds))
      }
    }
  }

  const pendingPromotions: PendingPromotion[] = []
  let promotedSnapshotCount = 0
  let blockedSnapshotCount = 0

  for (const sd of slotDecisions) {
    const semanticKey: Record<string, unknown> = {
      match_id: matchId,
      slot_key: sd.slotKey,
      team_side: sd.teamSide,
      position: sd.position,
    }

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

    const gamertagDec = sd.fieldDecisions.get('gamertag')
    const positionDec = sd.fieldDecisions.get('position')
    const gamertagVal = promotedString(gamertagDec)
    const positionRaw = promotedString(positionDec)
    const positionVal =
      positionRaw !== null && VALID_POSITIONS.has(positionRaw) ? positionRaw : null

    // Hard-fields gate: position is always required (we need to know which
    // slot this snapshot belongs to). Gamertag is required EXCEPT for CPU
    // rows — the CPU slot is identified by its is_cpu flag, not by a human
    // gamertag, and we write a synthetic 'CPU' string below for defense in
    // depth (the value is in the junk-gamertag denylist anyway).
    if ((!sd.isCpu && gamertagVal === null) || positionVal === null) {
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

    const personaRaw = promotedString(sd.fieldDecisions.get('player_name_persona'))
    // Resolve OCR persona snapshot against player_persona_aliases. Falls back to
    // the ornament-stripped raw value when no alias matches. Mirrors what the
    // consolidator does, but at promote time so the benchmark (which reads
    // player_loadout_snapshots.player_name_persona directly) sees canonicals.
    const personaResolved = personaRaw ? await resolvePersona(personaRaw, db) : null
    const personaCanonical = personaResolved?.canonical ?? personaRaw
    const playerNumber = promotedNumber(sd.fieldDecisions.get('player_number'))
    const isCaptain = promotedBool(sd.fieldDecisions.get('is_captain'))
    const buildClass = promotedString(sd.fieldDecisions.get('build_class'))
    const heightText = promotedString(sd.fieldDecisions.get('height_text'))
    const weightLbs = promotedNumber(sd.fieldDecisions.get('weight_lbs'))
    const handedness = promotedString(sd.fieldDecisions.get('handedness'))
    const platformRaw = promotedString(sd.fieldDecisions.get('platform'))
    const platform = whitelistPlatform(platformRaw)
    const playerLevelRaw = promotedString(sd.fieldDecisions.get('player_level_raw'))
    const playerLevelNumber = promotedNumber(sd.fieldDecisions.get('player_level_number'))

    promotedSnapshotCount++
    if (writeSnapshots) {
      await db.insert(playerLoadoutSnapshots).values({
        playerId: sd.resolvedPlayerId,
        // CPU rows get a synthetic 'CPU' gamertag so the column is non-null
        // for downstream code that assumes a value. The string is on the
        // junk-gamertag denylist in match-lineups.ts so it never surfaces
        // in lineup outputs even if the is_cpu filter is ever bypassed.
        // The non-null assertion on gamertagVal is sound: the hard-fields
        // gate above only continues here when (isCpu || gamertagVal!==null).
        gamertagSnapshot: sd.isCpu ? 'CPU' : gamertagVal!,
        playerNameSnapshot: null,
        playerNamePersona: personaCanonical,
        playerNamePersonaRaw: personaRaw,
        playerNumber,
        isCaptain,
        teamSide: sd.teamSide,
        gameTitleId,
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
        isCpu: sd.isCpu,
      })
    }

    // Include source_screen + slot_key so the (target_table,
    // target_semantic_key, field_key) unique index doesn't clash with
    // loadout-v2's promotions, which use the SAME (team_side, position)
    // pair but a different source (player_loadout_view).
    const snapshotSemanticKey = {
      match_id: matchId,
      team_side: sd.teamSide,
      position: positionVal,
      slot_key: sd.slotKey,
      source_screen: 'pre_game_lobby_state_2',
    }

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

    const allSlotEvidenceIds = Array.from(
      new Set(Array.from(sd.fieldDecisions.values()).flatMap((d) => d.evidenceIds)),
    )
    pendingPromotions.push({
      matchId,
      targetTable: 'player_loadout_snapshots',
      targetSemanticKey: snapshotSemanticKey,
      fieldKey: null,
      winningValue: {
        gamertag: gamertagVal,
        position: positionVal,
        team_side: sd.teamSide,
        source_screen: 'pre_game_lobby_state_2',
      },
      winningConfidence: null,
      evidenceCount: allSlotEvidenceIds.length,
      conflictCount: 0,
      evidenceIds: allSlotEvidenceIds,
      promotionStatus: 'promoted',
      blockingReason: null,
      authoritySource: 'ocr_evidence',
    })
  }

  let promotionRowsWritten = 0
  if (pendingPromotions.length > 0) {
    // Phase-A: scope prior-row delete to (matchId, run_id) — leaves other
    // runs' lobby promotions intact for audit/rollback. Still scoped to the
    // lobby slot_key pattern so loadout-v2's promotions stay untouched.
    await db
      .delete(ocrPromotions)
      .where(
        and(
          eq(ocrPromotions.matchId, matchId),
          eq(ocrPromotions.targetTable, 'player_loadout_snapshots'),
          sql`${ocrPromotions.targetSemanticKey}->>'slot_key' LIKE 'lobby\\_%' ESCAPE '\\'`,
          effectiveRunIdForWrites === null
            ? sql`${ocrPromotions.runId} IS NULL`
            : eq(ocrPromotions.runId, effectiveRunIdForWrites),
        ),
      )

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
