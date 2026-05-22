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
  matches,
} from '@eanhl/db'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getFieldEvidenceForLobbySlot } from '@eanhl/db/queries'
import type { Database } from '@eanhl/db'
import type { GateCandidate, PromotionDecision } from '../lib/promotion-gate.js'
import { runPromotionGate } from '../lib/promotion-gate.js'
import { resolveGamertagToPlayer } from './resolve-identity.js'
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

async function resolveGameTitleIdForMatch(db: Database, matchId: number): Promise<number> {
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
  db?: Database
}): Promise<PromoteLobbyFromEvidenceResult> {
  const db = input.db ?? defaultDb
  const { matchId } = input

  const allEvidence = await getFieldEvidenceForLobbySlot(matchId)

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
        calibratedConfidence:
          r.calibratedConfidence !== null ? Number(r.calibratedConfidence) : 0,
        evidenceId: r.id,
      }))
      const decision = runPromotionGate({ candidates })
      fieldDecisions.set(fieldKey, decision)
    }

    const gamertagRows = fieldMap.get('gamertag') ?? []
    let ocrExtractionId = 0
    for (const row of gamertagRows) {
      if (row.supportFrameIds && row.supportFrameIds.length > 0) {
        ocrExtractionId = row.supportFrameIds[0]!
        break
      }
    }
    if (ocrExtractionId === 0) {
      outer: for (const rows of fieldMap.values()) {
        for (const row of rows) {
          if (row.supportFrameIds && row.supportFrameIds.length > 0) {
            ocrExtractionId = row.supportFrameIds[0]!
            break outer
          }
        }
      }
    }

    let resolvedPlayerId: number | null = null
    if (parsed.teamSide === 'for') {
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
      snapshotBlockReason: null,
    })
  }

  // Idempotency: drop prior lobby-sourced snapshots for this match before insert.
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
    await db
      .delete(playerLoadoutSnapshots)
      .where(
        and(
          eq(playerLoadoutSnapshots.matchId, matchId),
          inArray(playerLoadoutSnapshots.ocrExtractionId, priorLobbyExtractionIds),
        ),
      )
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

    if (gamertagVal === null || positionVal === null) {
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
    await db.insert(playerLoadoutSnapshots).values({
      playerId: sd.resolvedPlayerId,
      gamertagSnapshot: gamertagVal,
      playerNameSnapshot: null,
      playerNamePersona: personaRaw,
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
    })

    const snapshotSemanticKey = {
      match_id: matchId,
      team_side: sd.teamSide,
      position: positionVal,
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
    await db
      .delete(ocrPromotions)
      .where(
        and(
          eq(ocrPromotions.matchId, matchId),
          eq(ocrPromotions.targetTable, 'player_loadout_snapshots'),
          sql`${ocrPromotions.targetSemanticKey}->>'slot_key' LIKE 'lobby\\_%' ESCAPE '\\'`,
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
