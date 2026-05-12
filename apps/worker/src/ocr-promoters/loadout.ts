/**
 * Promote a player_loadout_view extraction into player_loadout_snapshots
 * + player_loadout_x_factors + player_loadout_attributes.
 *
 * Idempotent on sourceExtractionId: re-running an extraction deletes the prior
 * snapshot row plus its child x_factor / attribute rows before reinserting.
 *
 * One snapshot per loadout view capture — only ever one "selected player" per
 * capture, so we don't fan out across multiple players from this screen.
 */

import {
  ocrCaptureBatches,
  ocrExtractions,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
  type NewPlayerLoadoutAttribute,
  type NewPlayerLoadoutXFactor,
} from '@eanhl/db'
import { eq } from 'drizzle-orm'
import type { PromoterContext } from './index.js'
import { resolveGamertagToPlayer } from './resolve-identity.js'
import type { OcrExtractionField } from '../ocr-cli-runner.js'

export async function promoteLoadout(ctx: PromoterContext): Promise<void> {
  const { result, extractionId, matchId, db } = ctx

  const gameTitleId = await resolveGameTitleIdForExtraction(db, extractionId)

  const gamertagField = result.gamertag as OcrExtractionField | undefined
  const gamertagSnapshot = stringValue(gamertagField) ?? '(unknown)'

  // Post-2026-05 parser shape:
  //   player_name      → short in-game persona "E. Wanhg" (MISSING on loadout view)
  //   player_name_full → full real name "Evgeni Wanhg" from the left strip
  // Legacy captures only emit player_name; fall back to it when player_name_full is absent.
  const playerNamePersonaField = result.player_name as OcrExtractionField | undefined
  const playerNameFullField =
    (result.player_name_full as OcrExtractionField | undefined) ?? playerNamePersonaField
  const playerNumberField = result.player_number as OcrExtractionField | undefined
  const isCaptainField = result.is_captain as OcrExtractionField | undefined
  const positionField = result.player_position as OcrExtractionField | undefined
  const buildClassField = result.build_class as OcrExtractionField | undefined
  const heightField = result.height as OcrExtractionField | undefined
  const weightField = result.weight as OcrExtractionField | undefined
  const handField = result.handedness as OcrExtractionField | undefined
  const platformField = result.player_platform as OcrExtractionField | undefined
  const levelField = result.player_level as OcrExtractionField | undefined

  const { playerId } = await resolveGamertagToPlayer(gamertagSnapshot, gameTitleId, db)
  // team_side heuristic: resolved → BGM ('for'), unresolved → opp ('against').
  // Known gotcha: new BGM players who haven't been rostered yet will be misclassified
  // as 'against' until their alias is added to player_display_aliases.
  const teamSide: 'for' | 'against' = playerId !== null ? 'for' : 'against'

  // Idempotent re-runs: if a snapshot already exists for this extraction, drop
  // its children + the snapshot itself before reinserting.
  const existingSnapshots = await db
    .select({ id: playerLoadoutSnapshots.id })
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.sourceExtractionId, extractionId))
  for (const s of existingSnapshots) {
    await db.delete(playerLoadoutXFactors).where(eq(playerLoadoutXFactors.loadoutSnapshotId, s.id))
    await db
      .delete(playerLoadoutAttributes)
      .where(eq(playerLoadoutAttributes.loadoutSnapshotId, s.id))
    await db.delete(playerLoadoutSnapshots).where(eq(playerLoadoutSnapshots.id, s.id))
  }

  const [snap] = await db
    .insert(playerLoadoutSnapshots)
    .values({
      playerId,
      gamertagSnapshot,
      playerNameSnapshot: stringValue(playerNameFullField),
      playerNamePersona: stringValue(playerNamePersonaField),
      playerNumber: numericValue(playerNumberField),
      isCaptain: booleanValue(isCaptainField),
      teamSide,
      gameTitleId,
      matchId,
      sourceExtractionId: extractionId,
      position: stringValue(positionField),
      buildClass: stringValue(buildClassField),
      heightText: stringValue(heightField),
      weightLbs: parseWeightLbs(weightField),
      handedness: stringValue(handField),
      playerLevelRaw: stringValue(levelField, { preferRaw: true }),
      playerLevelNumber: numericValue(levelField),
      platform: stringValue(platformField),
    })
    .returning()
  if (!snap) throw new Error('failed to insert player_loadout_snapshots row')

  // X-factors: positional list, slot_index 0/1/2. New parser also emits a
  // parallel x_factor_tiers list — match by index.
  const xFactors = Array.isArray(result.x_factors) ? (result.x_factors as OcrExtractionField[]) : []
  const xFactorTiers = Array.isArray(result.x_factor_tiers)
    ? (result.x_factor_tiers as OcrExtractionField[])
    : []
  const xFactorRows: NewPlayerLoadoutXFactor[] = []
  xFactors.forEach((xf, i) => {
    const name = stringValue(xf, { preferRaw: true })
    if (!name) return
    const tierField = xFactorTiers[i]
    const tier = stringValue(tierField) as 'Elite' | 'All Star' | 'Specialist' | null
    xFactorRows.push({
      loadoutSnapshotId: snap.id,
      slotIndex: i,
      xFactorName: name,
      tier: tier ?? null,
    })
  })
  if (xFactorRows.length > 0) {
    await db.insert(playerLoadoutXFactors).values(xFactorRows)
  }

  // Attributes: 5 groups × 4-5 keys. Flatten to per-key rows. Parser emits a
  // parallel `attribute_deltas` dict keyed by the same attribute_key.
  const attributeRows: NewPlayerLoadoutAttribute[] = []
  const attrs = result.attributes as
    | Record<string, { values?: Record<string, OcrExtractionField> }>
    | undefined
  const attrDeltas = (result.attribute_deltas ?? {}) as Record<string, OcrExtractionField | undefined>
  if (attrs && typeof attrs === 'object') {
    for (const group of Object.values(attrs)) {
      const values = group.values ?? {}
      for (const [attrKey, attrField] of Object.entries(values)) {
        const deltaField = attrDeltas[attrKey]
        attributeRows.push({
          loadoutSnapshotId: snap.id,
          attributeKey: attrKey,
          rawText: attrField.raw_text ?? null,
          value: numericValue(attrField),
          deltaValue: numericValue(deltaField),
          confidence: attrField.confidence !== null ? attrField.confidence.toFixed(4) : null,
        })
      }
    }
  }
  if (attributeRows.length > 0) {
    await db.insert(playerLoadoutAttributes).values(attributeRows)
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Look up game_title_id by chasing extraction → batch. */
async function resolveGameTitleIdForExtraction(
  db: PromoterContext['db'],
  extractionId: number,
): Promise<number> {
  const [row] = await db
    .select({ gameTitleId: ocrCaptureBatches.gameTitleId })
    .from(ocrExtractions)
    .innerJoin(ocrCaptureBatches, eq(ocrCaptureBatches.id, ocrExtractions.batchId))
    .where(eq(ocrExtractions.id, extractionId))
    .limit(1)
  if (!row) throw new Error(`Extraction ${String(extractionId)} not linked to a batch`)
  return row.gameTitleId
}

function stringValue(
  f: OcrExtractionField | undefined,
  opts: { preferRaw?: boolean } = {},
): string | null {
  if (!f) return null
  if (opts.preferRaw && f.raw_text) return f.raw_text
  if (typeof f.value === 'string' && f.value) return f.value
  if (typeof f.value === 'number') return String(f.value)
  if (f.raw_text) return f.raw_text
  return null
}

function numericValue(f: OcrExtractionField | undefined): number | null {
  if (!f) return null
  if (typeof f.value === 'number' && Number.isFinite(f.value)) return Math.round(f.value)
  if (typeof f.value === 'string') {
    const n = Number.parseInt(f.value, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

function booleanValue(f: OcrExtractionField | undefined): boolean | null {
  if (!f) return null
  if (typeof f.value === 'boolean') return f.value
  return null
}

function parseWeightLbs(f: OcrExtractionField | undefined): number | null {
  if (!f) return null
  if (typeof f.value === 'number' && Number.isFinite(f.value)) return Math.round(f.value)
  const text = typeof f.value === 'string' ? f.value : f.raw_text
  if (!text) return null
  const m = /(\d+)/.exec(text)
  if (!m?.[1]) return null
  return Number.parseInt(m[1], 10)
}
