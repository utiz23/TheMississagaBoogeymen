/**
 * Promote a pre_game_lobby_state_1 / _state_2 extraction into player_loadout_snapshots.
 *
 * Lobby UI exposes per-player position, build class, level, gamertag — but not
 * the full attribute breakdown (that's only on the player_loadout_view screen).
 * So we write thin snapshot rows with no x_factors / attributes children.
 *
 * One snapshot per detected roster slot (typically 6 BGM + 6 opponent = up to 12).
 * CPU/empty slots are skipped.
 *
 * Idempotent on sourceExtractionId: re-running deletes prior snapshot rows from
 * this extraction before reinserting.
 */

import {
  ocrCaptureBatches,
  ocrExtractions,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
} from '@eanhl/db'
import { eq } from 'drizzle-orm'
import type { PromoterContext } from './index.js'
import { resolveGamertagToPlayer } from './resolve-identity.js'
import type { OcrExtractionField } from '../ocr-cli-runner.js'

interface PlayerSlot {
  slot_index?: number
  fields?: Record<string, OcrExtractionField>
}

interface TeamSummary {
  roster?: PlayerSlot[]
}

export async function promotePreGameLobby(ctx: PromoterContext): Promise<void> {
  const { result, extractionId, matchId, db } = ctx

  const gameTitleId = await resolveGameTitleIdForExtraction(db, extractionId)

  // Drop any prior snapshots from this extraction (idempotent re-runs).
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

  // Walk both teams' rosters. The opponent panel often has thinner data
  // (just position + build), but the row still belongs in the snapshot table.
  const teams: Array<['our_team' | 'opponent_team', TeamSummary | undefined]> = [
    ['our_team', result.our_team as TeamSummary | undefined],
    ['opponent_team', result.opponent_team as TeamSummary | undefined],
  ]

  for (const [, team] of teams) {
    const roster = Array.isArray(team?.roster) ? team.roster : []
    for (const slot of roster) {
      const fields = slot.fields ?? {}
      const gamertagField = fields.gamertag
      const gamertagSnapshot = stringValue(gamertagField)
      // Skip empty slots / CPU placeholders. The Python parser already sets
      // empty_or_cpu, but we play it safe and require a gamertag to persist.
      if (!gamertagSnapshot) continue
      // Also skip rows the parser explicitly marked CPU.
      const cpuField = fields.empty_or_cpu
      const cpuValue = stringValue(cpuField)?.toUpperCase()
      if (cpuValue === 'CPU') continue

      const positionField = fields.position
      const buildField = fields.build
      const levelField = fields.level
      // State-2 captures expose player_number + persona name. State-1 captures
      // expose build class. Promoter writes whichever this capture has; later
      // cross-frame consensus merges per (match, position) across captures.
      const playerNameField = fields.player_name
      const playerNumberField = fields.player_number
      const isCaptainField = fields.is_captain
      const measurementsField = fields.raw_measurements

      const { height, weight } = parseMeasurements(measurementsField)

      const { playerId } = await resolveGamertagToPlayer(gamertagSnapshot, gameTitleId, db)

      await db.insert(playerLoadoutSnapshots).values({
        playerId,
        gamertagSnapshot,
        // Lobby state-2 emits short personas ("E. Wanhg"); the full name
        // ("Evgeni Wanhg") only appears in the loadout view's left strip.
        playerNameSnapshot: null,
        playerNamePersona: stringValue(playerNameField),
        playerNumber: numericValue(playerNumberField),
        isCaptain: booleanValue(isCaptainField),
        gameTitleId,
        matchId,
        sourceExtractionId: extractionId,
        position: stringValue(positionField),
        buildClass: stringValue(buildField, { preferRaw: true }),
        heightText: height,
        weightLbs: weight,
        handedness: null,
        playerLevelRaw: stringValue(levelField, { preferRaw: true }),
        playerLevelNumber: numericValue(levelField),
        platform: null,
      })
    }
  }
}

interface OcrFieldShape {
  raw_text?: string | null
  value?: unknown
  confidence?: number | null
}

function parseMeasurements(
  f: OcrFieldShape | undefined,
): { height: string | null; weight: number | null } {
  if (!f) return { height: null, weight: null }
  const raw = (f.value as string | undefined) ?? f.raw_text ?? ''
  if (!raw) return { height: null, weight: null }
  // Lobby measurement strings look like `6'0"|160lbs` or `5'10"|175lbs` with
  // OCR noise (`lhs` instead of `lbs`, `°` instead of `'`, etc.).
  const heightMatch = raw.match(/(\d)['°′]\s*(\d{1,2})["″]?/)
  const height = heightMatch ? `${heightMatch[1]}'${heightMatch[2]}"` : null
  const weightMatch = raw.match(/(\d{2,3})\s*(?:lbs|lhs|bs|Ibs)/i)
  const weight = weightMatch ? Number.parseInt(weightMatch[1]!, 10) : null
  return { height, weight }
}

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
