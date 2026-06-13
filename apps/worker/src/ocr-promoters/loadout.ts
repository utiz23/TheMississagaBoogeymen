/**
 * Promote a player_loadout_view extraction into player_loadout_snapshots
 * + player_loadout_x_factors + player_loadout_attributes.
 *
 * Idempotent on ocrExtractionId: re-running an extraction deletes the prior
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
  coerceXFactorTier,
  type NewPlayerLoadoutAttribute,
  type NewPlayerLoadoutXFactor,
} from '@eanhl/db'
import { eq } from 'drizzle-orm'
import type { PromoterContext } from './index.js'
import { resolveGamertagToPlayer } from './resolve-identity.js'
import { normalizeXFactor } from '../lib/normalize-xfactor.js'
import type { OcrExtractionField } from '../ocr-cli-runner.js'

/**
 * Junk gamertags that the OCR pipeline regularly emits as false positives —
 * section headers (`AWAY`/`HOME`), the sentinel for "no gamertag field"
 * (`(unknown)`/`?`), and single-character letter-segmentation noise.
 */
const JUNK_GAMERTAG_TOKENS = new Set(['away', 'home', 'cpu', '?', '(unknown)'])

function isJunkGamertag(tag: string): boolean {
  const trimmed = tag.trim()
  if (trimmed.length <= 1) return true
  return JUNK_GAMERTAG_TOKENS.has(trimmed.toLowerCase())
}

export async function promoteLoadout(ctx: PromoterContext): Promise<void> {
  const { result, extractionId, matchId, db } = ctx

  const gameTitleId = await resolveGameTitleIdForExtraction(db, extractionId)

  const gamertagField = result.gamertag as OcrExtractionField | undefined
  const gamertagSnapshot = stringValue(gamertagField) ?? '(unknown)'

  // Junk-row gate: when the gamertag is OCR noise (AWAY/HOME/CPU/single-char)
  // AND the snapshot carries no other useful fields, the row is almost
  // certainly a false positive. Skip the insert so the section never has to
  // render it. We still allow junk-gamertag rows through when they contain
  // a real build / jersey / x-factor — the consolidator can vote a better
  // gamertag in that case.
  if (isJunkGamertag(gamertagSnapshot)) {
    const buildClassField = result.build_class as OcrExtractionField | undefined
    const playerNumberField = result.player_number as OcrExtractionField | undefined
    const xFactors = Array.isArray(result.x_factors) ? result.x_factors : []
    const hasBuild = stringValue(buildClassField) !== null
    const hasNumber = numericValue(playerNumberField) !== null
    const hasXFactors = xFactors.length > 0
    if (!hasBuild && !hasNumber && !hasXFactors) {
      console.log(
        `[promote/loadout] skip junk row: extractionId=${String(extractionId)} gamertag="${gamertagSnapshot}"`,
      )
      return
    }
  }

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
    .where(eq(playerLoadoutSnapshots.ocrExtractionId, extractionId))
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
      ocrExtractionId: extractionId,
      position: stringValue(positionField),
      buildClass: stringValue(buildClassField),
      heightText: stringValue(heightField),
      weightLbs: parseWeightLbs(weightField),
      handedness: stringValue(handField),
      playerLevelRaw: stringValue(levelField, { preferRaw: true }),
      playerLevelNumber: numericValue(levelField),
      // Platform: strict whitelist gate. Historically the OCR misaligned
      // ROI dropped gamertag strings into `player_platform`; the read-time
      // renderer also enforces this list. Any non-platform value becomes
      // NULL on the snapshot row.
      platform: whitelistPlatform(stringValue(platformField)),
    })
    .returning()
  if (!snap) throw new Error('failed to insert player_loadout_snapshots row')

  // X-factors: positional list, slot_index 0/1/2. New parser emits THREE
  // parallel lists per slot:
  //   - x_factors                  → noisy OCR text label
  //   - x_factor_tiers             → HSV-classified tier (100% accurate)
  //   - x_factor_icon_matches      → template-match canonical name
  //                                  (preferred over text-OCR + normalize)
  const xFactors = Array.isArray(result.x_factors) ? (result.x_factors as OcrExtractionField[]) : []
  const xFactorTiers = Array.isArray(result.x_factor_tiers)
    ? (result.x_factor_tiers as OcrExtractionField[])
    : []
  const xFactorIconMatches = Array.isArray(result.x_factor_icon_matches)
    ? (result.x_factor_icon_matches as OcrExtractionField[])
    : []
  const xFactorRows: NewPlayerLoadoutXFactor[] = []
  xFactors.forEach((xf, i) => {
    const name = stringValue(xf, { preferRaw: true })
    if (!name) return
    const tierField = xFactorTiers[i]
    // Only persist a valid tier enum — never a stray OCR string (or the
    // literal "null"). Anything unrecognised becomes real SQL NULL.
    const tier = coerceXFactorTier(stringValue(tierField))
    // Canonical-name precedence:
    //   1. icon template match (sub-pixel reliable for the 28 NHL 26 X-Factors)
    //   2. text-OCR + normalizeXFactor fallback (handles unmapped icon matches)
    let canonical: string | null = null
    const iconMatchField = xFactorIconMatches[i]
    if (iconMatchField !== undefined && iconMatchField.status === 'ok') {
      const v = iconMatchField.value as { name?: unknown } | null
      if (v && typeof v === 'object' && typeof v.name === 'string') {
        canonical = v.name
      }
    }
    if (canonical === null) {
      canonical = normalizeXFactor(name)
    }
    xFactorRows.push({
      loadoutSnapshotId: snap.id,
      slotIndex: i,
      xFactorName: name,
      xFactorNameCanonical: canonical,
      tier,
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
  const attrDeltas = (result.attribute_deltas ?? {}) as Record<
    string,
    OcrExtractionField | undefined
  >
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
