/**
 * Serialize a match's REVIEWED consolidated loadout/lobby surface into the
 * benchmark record shape that `score_field_benchmark.py` consumes.
 *
 * This is the DB→record bridge for the Phase G pre-flip gate: it reads the
 * per-`(team_side, position)` anchor snapshot that `consolidateLoadouts` marked
 * `review_status = 'reviewed'` (plus its X-Factor + attribute child rows) and
 * emits a flat list of `FieldEvidenceRecord`-shaped dicts. The scorer's
 * `records_to_subjects` groups by `subject_slot_key`, and `align_by_gamertag`
 * matches subjects by their `gamertag` field — so the emitted `field_key`
 * vocabulary MUST match `benchmark/report.py`'s `SCALAR_FIELDS` evidence keys
 * (`gamertag`, `persona_raw`, `jersey_number`, `player_level_raw`, `position`,
 * `build_class`, `handedness`), the `is_captain` bool, the per-slot
 * `x_factor_name_{i}` / `x_factor_tier_{i}` keys, and the per-attribute
 * `attribute_{key}_value` / `attribute_{key}_delta` keys, or fields silently
 * score as missing.
 *
 * BYTE-IDENTICAL CONTRACT (the whole gate rests on this): the same serializer
 * runs on both the `validate-consolidated` dry-run (rebuild+consolidate inside a
 * rolled-back tx) AND the committed `--active` surface. For the two dumps to be
 * byte-identical, the output must depend ONLY on canonical CONTENT, never on
 * row-level state that a rebuild re-mints:
 *   - `subject_slot_key` is SYNTHESIZED as `${team_side}_${position}` (one
 *     reviewed anchor per group ⇒ unique + stable), NOT read from the snapshot's
 *     nullable `subject_slot_key` column (a committed pre-Phase-F row carries
 *     null there while a fresh rebuild writes a real key — that would diverge).
 *   - snapshot ids / captured_at are never emitted.
 *   - `raw_confidence` is a constant (a consolidated surface holds exactly one
 *     winning value per field — there is no per-candidate confidence to report).
 *   - records are emitted in a deterministic content order (anchors by
 *     (team_side, position); X-Factors by slot; attributes by key).
 */

import { and, eq, inArray } from 'drizzle-orm'
import { playerLoadoutSnapshots, playerLoadoutXFactors, playerLoadoutAttributes } from '@eanhl/db'
import type { DbOrTx } from '../ocr-promoters/index.js'

/** One field observation, mirroring the `FieldEvidenceRecord` JSON the scorer reads. */
export interface ConsolidatedSurfaceRecord {
  field_key: string
  candidate_value: string | number | boolean | null
  team_side: 'for' | 'against' | null
  position: string | null
  candidate_rank: 0
  raw_confidence: number
  subject_slot_key: string
}

/**
 * The canonical surface is a single consolidated value per field — there is no
 * candidate ranking to serialize, so every record is rank 0 at a fixed
 * confidence. (`records_to_subjects` only uses (rank, -confidence) to break ties
 * between multiple records for one (slot, field); we emit exactly one.)
 */
const CANONICAL_RANK = 0 as const
const CANONICAL_CONFIDENCE = 1

export async function serializeConsolidatedSurface(
  matchId: number,
  db: DbOrTx,
): Promise<ConsolidatedSurfaceRecord[]> {
  // Reviewed anchors = the consolidated per-(team_side, position) surface.
  // `reviewed` already implies non-CPU (consolidation never marks CPU rows), but
  // filter is_cpu defensively so a CPU row can never leak into the score.
  const anchors = await db
    .select({
      id: playerLoadoutSnapshots.id,
      teamSide: playerLoadoutSnapshots.teamSide,
      position: playerLoadoutSnapshots.position,
      gamertagSnapshot: playerLoadoutSnapshots.gamertagSnapshot,
      playerNamePersona: playerLoadoutSnapshots.playerNamePersona,
      playerNamePersonaRaw: playerLoadoutSnapshots.playerNamePersonaRaw,
      playerNumber: playerLoadoutSnapshots.playerNumber,
      playerLevelRaw: playerLoadoutSnapshots.playerLevelRaw,
      buildClass: playerLoadoutSnapshots.buildClass,
      buildClassCanonical: playerLoadoutSnapshots.buildClassCanonical,
      handedness: playerLoadoutSnapshots.handedness,
      isCaptain: playerLoadoutSnapshots.isCaptain,
    })
    .from(playerLoadoutSnapshots)
    .where(
      and(
        eq(playerLoadoutSnapshots.matchId, matchId),
        eq(playerLoadoutSnapshots.reviewStatus, 'reviewed'),
        eq(playerLoadoutSnapshots.isCpu, false),
      ),
    )

  if (anchors.length === 0) return []

  const anchorIds = anchors.map((a) => a.id)

  const xFactors = await db
    .select({
      loadoutSnapshotId: playerLoadoutXFactors.loadoutSnapshotId,
      slotIndex: playerLoadoutXFactors.slotIndex,
      xFactorName: playerLoadoutXFactors.xFactorName,
      xFactorNameCanonical: playerLoadoutXFactors.xFactorNameCanonical,
      tier: playerLoadoutXFactors.tier,
    })
    .from(playerLoadoutXFactors)
    .where(inArray(playerLoadoutXFactors.loadoutSnapshotId, anchorIds))

  const attributes = await db
    .select({
      loadoutSnapshotId: playerLoadoutAttributes.loadoutSnapshotId,
      attributeKey: playerLoadoutAttributes.attributeKey,
      value: playerLoadoutAttributes.value,
      deltaValue: playerLoadoutAttributes.deltaValue,
    })
    .from(playerLoadoutAttributes)
    .where(inArray(playerLoadoutAttributes.loadoutSnapshotId, anchorIds))

  const xfBySnapshot = new Map<number, typeof xFactors>()
  for (const xf of xFactors) {
    const arr = xfBySnapshot.get(xf.loadoutSnapshotId) ?? []
    arr.push(xf)
    xfBySnapshot.set(xf.loadoutSnapshotId, arr)
  }
  const attrBySnapshot = new Map<number, typeof attributes>()
  for (const a of attributes) {
    const arr = attrBySnapshot.get(a.loadoutSnapshotId) ?? []
    arr.push(a)
    attrBySnapshot.set(a.loadoutSnapshotId, arr)
  }

  // Deterministic content ordering — anchors by (team_side, position). One
  // reviewed anchor per group, so this is a total, stable order independent of
  // insertion / row id.
  const orderedAnchors = [...anchors].sort((a, b) => {
    const sa = a.teamSide ?? ''
    const sb = b.teamSide ?? ''
    if (sa !== sb) return sa < sb ? -1 : 1
    const pa = a.position ?? ''
    const pb = b.position ?? ''
    if (pa !== pb) return pa < pb ? -1 : 1
    return 0
  })

  const records: ConsolidatedSurfaceRecord[] = []
  for (const anchor of orderedAnchors) {
    const teamSide = anchor.teamSide
    const position = anchor.position
    // Synthetic, content-stable subject key (see BYTE-IDENTICAL CONTRACT above).
    const subjectSlotKey = `${teamSide ?? ''}_${position ?? ''}`
    const push = (fieldKey: string, value: ConsolidatedSurfaceRecord['candidate_value']): void => {
      records.push({
        field_key: fieldKey,
        candidate_value: value,
        team_side: teamSide,
        position,
        candidate_rank: CANONICAL_RANK,
        raw_confidence: CANONICAL_CONFIDENCE,
        subject_slot_key: subjectSlotKey,
      })
    }

    // Scalars — field_key vocabulary matches report.py SCALAR_FIELDS + is_captain.
    push('gamertag', anchor.gamertagSnapshot)
    push('persona_raw', anchor.playerNamePersona ?? anchor.playerNamePersonaRaw)
    push('jersey_number', anchor.playerNumber)
    push('player_level_raw', anchor.playerLevelRaw)
    push('position', position)
    push('build_class', anchor.buildClassCanonical ?? anchor.buildClass)
    push('handedness', anchor.handedness)
    push('is_captain', anchor.isCaptain)

    // X-Factors (0..2), ordered by slot. Canonical name preferred (matches the
    // golden's `x_factor_name_{i}` convention); the scorer canonicalizes anyway.
    const xfs = [...(xfBySnapshot.get(anchor.id) ?? [])].sort((a, b) => a.slotIndex - b.slotIndex)
    for (const xf of xfs) {
      push(`x_factor_name_${xf.slotIndex}`, xf.xFactorNameCanonical ?? xf.xFactorName)
      push(`x_factor_tier_${xf.slotIndex}`, xf.tier)
    }

    // Attributes, ordered by key. value = displayed (post-buff) rating,
    // delta = signed buff chip (may be null).
    const attrs = [...(attrBySnapshot.get(anchor.id) ?? [])].sort((a, b) =>
      a.attributeKey < b.attributeKey ? -1 : a.attributeKey > b.attributeKey ? 1 : 0,
    )
    for (const attr of attrs) {
      push(`attribute_${attr.attributeKey}_value`, attr.value)
      push(`attribute_${attr.attributeKey}_delta`, attr.deltaValue)
    }
  }

  return records
}
