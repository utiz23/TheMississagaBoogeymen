/**
 * OCR ingest orchestration.
 *
 * 1. Insert one ocr_capture_batches row per CLI invocation.
 * 2. Run the Python OCR CLI as a subprocess (see ocr-cli-runner.ts).
 * 3. For each result, in its own transaction:
 *    - Upsert ocr_extractions row (idempotent on (batch_id, source_path)).
 *    - Replace ocr_extraction_fields rows for that extraction.
 *    - Dispatch to a per-screen promoter that writes domain rows.
 * 4. Return summary counts.
 *
 * One transaction per result, not one per batch. A single bad screenshot does
 * not roll back the rest of the batch.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  db,
  sql,
  ocrCaptureBatches,
  ocrExtractions,
  ocrExtractionFields,
  type NewOcrCaptureBatch,
  type NewOcrExtractionField,
  type OcrCaptureKind,
  type OcrEntityType,
  type OcrFieldStatus,
  type OcrScreenType,
} from '@eanhl/db'
import { eq } from 'drizzle-orm'
import { runOcrCli, type OcrResult, type OcrExtractionField } from './ocr-cli-runner.js'
import { getPromoter, type PromoterDb } from './ocr-promoters/index.js'

export interface IngestOcrBatchInput {
  batchDir: string
  screen: OcrScreenType
  gameTitleId: number
  matchId?: number | null
  captureKind?: OcrCaptureKind
  notes?: string | null
  dryRun?: boolean
}

export interface IngestOcrBatchResult {
  batchId: number | null
  processed: number
  succeeded: number
  failed: number
  skippedDryRun: boolean
}

export async function ingestOcrBatch(input: IngestOcrBatchInput): Promise<IngestOcrBatchResult> {
  const captureKind = input.captureKind ?? 'manual_screenshots'
  const matchId = input.matchId ?? null

  console.log(
    `[ingest-ocr] batch screen=${input.screen} dir=${input.batchDir} match=${matchId ?? 'null'}${
      input.dryRun ? ' (dry run)' : ''
    }`,
  )

  const cli = await runOcrCli({ screen: input.screen, inputPath: input.batchDir })
  console.log(`[ingest-ocr] CLI returned ${String(cli.results.length)} result(s)`)

  if (input.dryRun) {
    for (const r of cli.results) {
      console.log(
        `[ingest-ocr] (dry run) ${r.meta.source_path} success=${String(r.success)} confidence=${
          r.meta.overall_confidence ?? 'null'
        }`,
      )
    }
    return { batchId: null, processed: cli.results.length, succeeded: 0, failed: 0, skippedDryRun: true }
  }

  // Insert capture batch up front so all extractions can reference it.
  const batchValues: NewOcrCaptureBatch = {
    gameTitleId: input.gameTitleId,
    matchId,
    sourceDirectory: input.batchDir,
    captureKind,
    notes: input.notes ?? null,
  }
  const [batchRow] = await db.insert(ocrCaptureBatches).values(batchValues).returning()
  if (!batchRow) throw new Error('Failed to insert ocr_capture_batches row')
  const batchId = batchRow.id

  let succeeded = 0
  let failed = 0

  for (const result of cli.results) {
    try {
      await persistOneResult(batchId, matchId, result)
      succeeded++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[ingest-ocr] failed to persist ${result.meta.source_path}: ${msg}`)
      failed++
    }
  }

  console.log(
    `[ingest-ocr] batch ${String(batchId)} done. processed=${String(cli.results.length)} succeeded=${String(succeeded)} failed=${String(failed)}`,
  )

  return { batchId, processed: cli.results.length, succeeded, failed, skippedDryRun: false }
}

/** SHA-256 hex of a file's bytes. The schema expects SHA-256 (`source_hash`). */
async function sha256OfFile(path: string): Promise<string> {
  const data = await readFile(path)
  return createHash('sha256').update(data).digest('hex')
}

async function persistOneResult(
  batchId: number,
  matchId: number | null,
  result: OcrResult,
): Promise<void> {
  const sourcePath = result.meta.source_path
  const sourceHash = await sha256OfFile(sourcePath).catch(() => null)

  await db.transaction(async (tx) => {
    const [ext] = await tx
      .insert(ocrExtractions)
      .values({
        batchId,
        matchId,
        screenType: result.meta.screen_type,
        sourcePath,
        sourceHash,
        ocrBackend: result.meta.ocr_backend,
        overallConfidence:
          result.meta.overall_confidence !== null
            ? result.meta.overall_confidence.toFixed(4)
            : null,
        rawResultJson: result as unknown as object,
        transformStatus: 'pending',
        transformError: null,
      })
      .onConflictDoUpdate({
        target: [ocrExtractions.batchId, ocrExtractions.sourcePath],
        set: {
          screenType: result.meta.screen_type,
          sourceHash,
          ocrBackend: result.meta.ocr_backend,
          overallConfidence:
            result.meta.overall_confidence !== null
              ? result.meta.overall_confidence.toFixed(4)
              : null,
          rawResultJson: result as unknown as object,
          transformStatus: 'pending',
          transformError: null,
        },
      })
      .returning()

    if (!ext) throw new Error(`Failed to upsert ocr_extractions for ${sourcePath}`)

    // Idempotent re-runs: clear and re-insert fields for this extraction.
    await tx.delete(ocrExtractionFields).where(eq(ocrExtractionFields.extractionId, ext.id))
    const fieldRows = walkExtractionFields(result, ext.id)
    if (fieldRows.length > 0) {
      await tx.insert(ocrExtractionFields).values(fieldRows)
    }

    if (!result.success) {
      // Failed extractions still get a row in ocr_extractions for audit.
      // No promoter dispatch.
      await tx
        .update(ocrExtractions)
        .set({
          transformStatus: 'error',
          transformError: result.errors.join('; ') || 'parser failed',
        })
        .where(eq(ocrExtractions.id, ext.id))
      return
    }

    // Dispatch to per-screen promoter. Promoter sets transform_status itself.
    const promoter = getPromoter(result.meta.screen_type)
    if (!promoter) {
      // Unknown screen type — record as success but no promotion.
      await tx
        .update(ocrExtractions)
        .set({ transformStatus: 'success', transformError: null })
        .where(eq(ocrExtractions.id, ext.id))
      return
    }

    try {
      await promoter({ result, extractionId: ext.id, matchId, db: tx as PromoterDb })
      await tx
        .update(ocrExtractions)
        .set({ transformStatus: 'success', transformError: null })
        .where(eq(ocrExtractions.id, ext.id))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await tx
        .update(ocrExtractions)
        .set({ transformStatus: 'error', transformError: msg })
        .where(eq(ocrExtractions.id, ext.id))
      // Do not rethrow — promoter failures should not abort the per-result transaction
      // for the extraction row itself, which has already been persisted.
    }
  })
}

// ─── Field walkers ────────────────────────────────────────────────────────────

/**
 * Heuristic check: an object with raw_text/value/confidence/status keys is an
 * ExtractionField. Mirrors the Pydantic shape from tools/game_ocr/game_ocr/models.py.
 */
function isExtractionField(v: unknown): v is OcrExtractionField {
  if (typeof v !== 'object' || v === null) return false
  const keys = Object.keys(v as Record<string, unknown>)
  return keys.includes('status') && keys.includes('confidence')
}

function fieldRow(
  extractionId: number,
  entityType: OcrEntityType,
  entityKey: string | null,
  fieldKey: string,
  field: OcrExtractionField,
): NewOcrExtractionField {
  return {
    extractionId,
    entityType,
    entityKey,
    fieldKey,
    rawText: field.raw_text ?? null,
    parsedValueJson: { value: field.value },
    confidence: field.confidence !== null ? field.confidence.toFixed(4) : null,
    status: (field.status ?? 'missing') as OcrFieldStatus,
  }
}

/**
 * Top-level dispatcher. Per-screen walker functions handle each result shape.
 * Always emits at least the 4 standard meta fields if present.
 */
export function walkExtractionFields(
  result: OcrResult,
  extractionId: number,
): NewOcrExtractionField[] {
  const rows: NewOcrExtractionField[] = []
  switch (result.meta.screen_type) {
    case 'pre_game_lobby_state_1':
    case 'pre_game_lobby_state_2':
      walkPreGameLobby(result, extractionId, rows)
      break
    case 'player_loadout_view':
      walkPlayerLoadout(result, extractionId, rows)
      break
    case 'post_game_player_summary':
      walkPostGamePlayerSummary(result, extractionId, rows)
      break
    case 'post_game_box_score_goals':
    case 'post_game_box_score_shots':
    case 'post_game_box_score_faceoffs':
      walkPostGameBoxScore(result, extractionId, rows)
      break
    case 'post_game_net_chart':
      walkPostGameNetChart(result, extractionId, rows)
      break
    case 'post_game_faceoff_map':
      walkPostGameNetChart(result, extractionId, rows)
      break
    case 'post_game_events':
      walkPostGameEvents(result, extractionId, rows)
      break
    case 'post_game_action_tracker':
      walkPostGameActionTracker(result, extractionId, rows)
      break
    default:
      walkGenericTopLevel(result, extractionId, rows)
      break
  }
  return rows
}

function walkPostGameActionTracker(
  result: OcrResult,
  extractionId: number,
  rows: NewOcrExtractionField[],
): void {
  for (const key of ['filter_label', 'period_label']) {
    const v = result[key]
    if (isExtractionField(v)) rows.push(fieldRow(extractionId, 'match', null, key, v))
  }
  const events = result.events
  if (!Array.isArray(events)) return
  events.forEach((ev, i) => {
    if (typeof ev !== 'object' || ev === null) return
    const e = ev as Record<string, unknown>
    const idxKey = String(i)
    for (const fk of ['raw_text', 'actor_snapshot', 'target_snapshot', 'relation', 'clock']) {
      if (isExtractionField(e[fk])) {
        rows.push(fieldRow(extractionId, 'event', idxKey, fk, e[fk]))
      }
    }
  })
}

function walkPostGameEvents(
  result: OcrResult,
  extractionId: number,
  rows: NewOcrExtractionField[],
): void {
  if (isExtractionField(result.filter_label)) {
    rows.push(fieldRow(extractionId, 'match', null, 'filter_label', result.filter_label))
  }
  const events = result.events
  if (!Array.isArray(events)) return
  events.forEach((ev, i) => {
    if (typeof ev !== 'object' || ev === null) return
    const e = ev as Record<string, unknown>
    const idxKey = String(i)
    for (const fk of [
      'raw_text',
      'team_abbreviation',
      'clock',
      'actor_snapshot',
      'goal_number_in_game',
      'infraction',
      'penalty_type',
    ]) {
      if (isExtractionField(e[fk])) {
        rows.push(fieldRow(extractionId, 'event', idxKey, fk, e[fk]))
      }
    }
    const assists = e.assists_snapshot
    if (Array.isArray(assists)) {
      assists.forEach((a, ai) => {
        if (isExtractionField(a)) {
          rows.push(fieldRow(extractionId, 'event', idxKey, `assist.${String(ai)}`, a))
        }
      })
    }
  })
}

function walkPostGameNetChart(
  result: OcrResult,
  extractionId: number,
  rows: NewOcrExtractionField[],
): void {
  for (const key of ['period_label', 'away_label', 'home_label']) {
    const v = result[key]
    if (isExtractionField(v)) rows.push(fieldRow(extractionId, 'match', null, key, v))
  }
  for (const sideKey of ['away', 'home'] as const) {
    const block = result[sideKey] as Record<string, unknown> | undefined
    if (!block || typeof block !== 'object') continue
    for (const [statKey, statField] of Object.entries(block)) {
      if (isExtractionField(statField)) {
        rows.push(fieldRow(extractionId, 'team', sideKey, statKey, statField))
      }
    }
  }
}

function walkPostGameBoxScore(
  result: OcrResult,
  extractionId: number,
  rows: NewOcrExtractionField[],
): void {
  // Top-level scalars.
  for (const key of ['tab_label', 'away_team', 'home_team']) {
    const v = result[key]
    if (isExtractionField(v)) rows.push(fieldRow(extractionId, 'match', null, key, v))
  }
  // Period header columns (audit/debug — not strictly needed but useful for review).
  const headers = result.period_headers
  if (Array.isArray(headers)) {
    headers.forEach((h, i) => {
      if (isExtractionField(h)) {
        rows.push(fieldRow(extractionId, 'team', null, `period_headers.${String(i)}`, h))
      }
    })
  }
  // Period cells: emit one row per (period, side) numeric value.
  const periods = result.periods
  if (!Array.isArray(periods)) return
  periods.forEach((p, _i) => {
    if (typeof p !== 'object' || p === null) return
    const cell = p as {
      period_label?: string
      period_number?: number
      away_value?: unknown
      home_value?: unknown
    }
    const label = cell.period_label ?? '?'
    if (isExtractionField(cell.away_value)) {
      rows.push(fieldRow(extractionId, 'team', 'away', `period.${label}`, cell.away_value))
    }
    if (isExtractionField(cell.home_value)) {
      rows.push(fieldRow(extractionId, 'team', 'home', `period.${label}`, cell.home_value))
    }
  })
}

/** Generic fallback: walk top-level ExtractionField properties only. */
function walkGenericTopLevel(
  result: OcrResult,
  extractionId: number,
  rows: NewOcrExtractionField[],
): void {
  for (const [key, value] of Object.entries(result)) {
    if (key === 'meta' || key === 'success' || key === 'errors' || key === 'warnings') continue
    if (isExtractionField(value)) {
      rows.push(fieldRow(extractionId, 'match', null, key, value))
    }
  }
}

function walkPreGameLobby(
  result: OcrResult,
  extractionId: number,
  rows: NewOcrExtractionField[],
): void {
  // Top-level scalars.
  for (const key of ['game_mode', 'our_team_name', 'opponent_team_name']) {
    const v = result[key]
    if (isExtractionField(v)) rows.push(fieldRow(extractionId, 'match', null, key, v))
  }
  // Two team panels.
  for (const [teamKey, teamSide] of [
    ['our_team', 'for'],
    ['opponent_team', 'against'],
  ] as const) {
    const team = result[teamKey] as { roster?: Array<{ slot_index?: number; fields?: Record<string, unknown> }> } | undefined
    if (!team || !Array.isArray(team.roster)) continue
    for (const slot of team.roster) {
      const slotKey = String(slot.slot_index ?? '')
      const entityKey = `${teamSide}:${slotKey}`
      const fields = slot.fields ?? {}
      for (const [fk, fv] of Object.entries(fields)) {
        if (isExtractionField(fv)) {
          rows.push(fieldRow(extractionId, 'player', entityKey, fk, fv))
        }
      }
    }
  }
}

function walkPlayerLoadout(
  result: OcrResult,
  extractionId: number,
  rows: NewOcrExtractionField[],
): void {
  // Top-level loadout scalars. The legacy keys (selected_player, home_team) are
  // kept in the list so old extractions still flatten cleanly; new captures from
  // the post-2026-05 parser emit MISSING for those and skip the row via
  // isExtractionField().
  const scalarKeys = [
    'selected_player',
    'player_position',
    'player_name',
    'player_name_full',
    'player_number',
    'player_level',
    'player_platform',
    'gamertag',
    'home_team',
    'is_captain',
    'build_class',
    'height',
    'weight',
    'handedness',
    'ap_used',
    'ap_total',
  ]
  for (const key of scalarKeys) {
    const v = result[key]
    if (isExtractionField(v)) rows.push(fieldRow(extractionId, 'loadout', null, key, v))
  }
  // X-factors: positional list. New parser also emits a parallel x_factor_tiers list.
  const xFactors = result.x_factors
  if (Array.isArray(xFactors)) {
    xFactors.forEach((xf, i) => {
      if (isExtractionField(xf)) {
        rows.push(fieldRow(extractionId, 'loadout', null, `x_factor.${String(i)}`, xf))
      }
    })
  }
  const xFactorTiers = result.x_factor_tiers
  if (Array.isArray(xFactorTiers)) {
    xFactorTiers.forEach((xt, i) => {
      if (isExtractionField(xt)) {
        rows.push(fieldRow(extractionId, 'loadout', null, `x_factor_tier.${String(i)}`, xt))
      }
    })
  }
  // Attribute groups.
  const attrs = result.attributes
  if (attrs && typeof attrs === 'object') {
    for (const [groupKey, group] of Object.entries(attrs as Record<string, unknown>)) {
      const values = (group as { values?: Record<string, unknown> }).values ?? {}
      for (const [attrKey, attrVal] of Object.entries(values)) {
        if (isExtractionField(attrVal)) {
          rows.push(
            fieldRow(extractionId, 'loadout', null, `attributes.${groupKey}.${attrKey}`, attrVal),
          )
        }
      }
    }
  }
  // Per-attribute Δ chips. Flat dict keyed by attribute_key (no group prefix).
  const attrDeltas = result.attribute_deltas
  if (attrDeltas && typeof attrDeltas === 'object') {
    for (const [attrKey, deltaVal] of Object.entries(attrDeltas as Record<string, unknown>)) {
      if (isExtractionField(deltaVal)) {
        rows.push(fieldRow(extractionId, 'loadout', null, `attribute_delta.${attrKey}`, deltaVal))
      }
    }
  }
}

function walkPostGamePlayerSummary(
  result: OcrResult,
  extractionId: number,
  rows: NewOcrExtractionField[],
): void {
  for (const key of [
    'away_team',
    'away_team_abbreviation',
    'away_team_final_score',
    'home_team',
    'home_team_abbreviation',
    'home_team_final_score',
  ]) {
    const v = result[key]
    if (isExtractionField(v)) rows.push(fieldRow(extractionId, 'team', null, key, v))
  }
  const players = result.players
  if (!Array.isArray(players)) return
  players.forEach((p, i) => {
    if (typeof p !== 'object' || p === null) return
    const rec = p as Record<string, unknown>
    const side = typeof rec.side === 'string' ? rec.side : 'unknown'
    const gamertagField = isExtractionField(rec.gamertag) ? rec.gamertag : null
    const gamertagValue =
      gamertagField && typeof gamertagField.value === 'string' ? gamertagField.value : null
    const entityKey = gamertagValue ?? `${side}:${String(i)}`
    for (const [fk, fv] of Object.entries(rec)) {
      if (fk === 'side') continue
      if (isExtractionField(fv)) rows.push(fieldRow(extractionId, 'player', entityKey, fk, fv))
    }
  })
}

// Suppress unused import warning for sql; it's exported for downstream use.
void sql
