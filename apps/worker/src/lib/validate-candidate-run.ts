/**
 * A3 — Reprocess CLI helper.
 *
 * Read-only check over a candidate `ocr_decoder_runs` row. Returns
 * `{ ok, details }` rather than throwing so the upcoming
 * `decoder-runs-cli validate` subcommand (Task 4) can decide whether to
 * fail-soft (exit 2 + print reasons) or fail-hard.
 *
 * Phase-A thresholds (configurable via options):
 *   - minLoadoutSnapshots = 5 (one per skater)
 *   - minLobbySnapshots   = 1 (one per match)
 *   - zero extractor errors (ocr_extractions.transform_status='error')
 *
 * Promotion-count derivation notes
 * --------------------------------
 * Both the loadout-view promoter (`apps/worker/src/ocr-promoters/loadout-v2.ts`)
 * and the pre-game lobby promoter (`apps/worker/src/ocr-promoters/lobby-v2.ts`)
 * write `target_table = 'player_loadout_snapshots'`. To distinguish them we
 * inspect the `target_semantic_key` JSON: the lobby promoter tags every row
 * with `source_screen = 'pre_game_lobby_state_2'` (see lobby-v2.ts:468-474),
 * while the loadout-view promoter does not (loadout-v2.ts:860 uses the
 * `{match_id, team_side, position}` shape only). We count only the
 * whole-row `promoted` rows (`field_key IS NULL` AND
 * `promotion_status = 'promoted'`) — per-field promotions are noise here.
 *
 * Extractor-error derivation
 * --------------------------
 * `ocr_extractions` does not carry a dedicated `extractor_error_kind`
 * column. The closest signal is `transform_status = 'error'` plus the
 * free-form `transform_error` message. We bucket by `transform_error`
 * text so failure reasons show the unique kinds + their counts.
 */

import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  db as defaultDb,
  ocrDecoderRuns,
  ocrExtractions,
  ocrPromotions,
  type Database,
} from '@eanhl/db'

export interface ValidateCandidateRunOptions {
  db?: Database
  minLoadoutSnapshots?: number
  minLobbySnapshots?: number
}

export interface ExtractorErrorBucket {
  kind: string
  count: number
}

export interface ValidationDetails {
  runId: number
  matchId: number
  loadoutPromotionCount: number
  lobbyPromotionCount: number
  extractorErrors: ExtractorErrorBucket[]
  /** Empty when `ok=true`. */
  failureReasons: string[]
}

export interface ValidationResult {
  ok: boolean
  details: ValidationDetails
}

export async function validateCandidateRun(
  runId: number,
  options: ValidateCandidateRunOptions = {},
): Promise<ValidationResult> {
  const db = options.db ?? defaultDb
  const minLoadout = options.minLoadoutSnapshots ?? 5
  const minLobby = options.minLobbySnapshots ?? 1

  const [runRow] = await db
    .select()
    .from(ocrDecoderRuns)
    .where(eq(ocrDecoderRuns.id, runId))
    .limit(1)
  if (!runRow) {
    throw new Error(`validateCandidateRun: run ${runId} not found`)
  }

  // Count whole-row promoted snapshot rows, split by source_screen marker.
  // Lobby rows carry source_screen='pre_game_lobby_state_2' in the semantic
  // key; loadout-view rows do not.
  const [lobbyRow] = await db
    .select({ count: sql<number>`count(*)::int`.as('count') })
    .from(ocrPromotions)
    .where(
      and(
        eq(ocrPromotions.runId, runId),
        eq(ocrPromotions.targetTable, 'player_loadout_snapshots'),
        eq(ocrPromotions.promotionStatus, 'promoted'),
        isNull(ocrPromotions.fieldKey),
        sql`${ocrPromotions.targetSemanticKey}->>'source_screen' = 'pre_game_lobby_state_2'`,
      ),
    )
  const lobbyPromotionCount = lobbyRow?.count ?? 0

  const [loadoutRow] = await db
    .select({ count: sql<number>`count(*)::int`.as('count') })
    .from(ocrPromotions)
    .where(
      and(
        eq(ocrPromotions.runId, runId),
        eq(ocrPromotions.targetTable, 'player_loadout_snapshots'),
        eq(ocrPromotions.promotionStatus, 'promoted'),
        isNull(ocrPromotions.fieldKey),
        sql`(${ocrPromotions.targetSemanticKey}->>'source_screen' IS NULL
             OR ${ocrPromotions.targetSemanticKey}->>'source_screen' <> 'pre_game_lobby_state_2')`,
      ),
    )
  const loadoutPromotionCount = loadoutRow?.count ?? 0

  // Extractor errors — bucket by transform_error text. COALESCE so NULL
  // error text rolls up under '<no message>' rather than disappearing.
  const errorRows = await db
    .select({
      kind: sql<string>`coalesce(${ocrExtractions.transformError}, '<no message>')`.as('kind'),
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(ocrExtractions)
    .where(
      and(
        eq(ocrExtractions.runId, runId),
        eq(ocrExtractions.transformStatus, 'error'),
      ),
    )
    .groupBy(sql`coalesce(${ocrExtractions.transformError}, '<no message>')`)
  const extractorErrors: ExtractorErrorBucket[] = errorRows.map((r) => ({
    kind: String(r.kind),
    count: Number(r.count),
  }))

  const failureReasons: string[] = []
  if (loadoutPromotionCount < minLoadout) {
    failureReasons.push(
      `loadout promotions ${loadoutPromotionCount} < floor ${minLoadout}`,
    )
  }
  if (lobbyPromotionCount < minLobby) {
    failureReasons.push(
      `lobby promotions ${lobbyPromotionCount} < floor ${minLobby}`,
    )
  }
  if (extractorErrors.length > 0) {
    const totalErrors = extractorErrors.reduce((acc, e) => acc + e.count, 0)
    const summary = extractorErrors.map((e) => `${e.kind}=${e.count}`).join(', ')
    failureReasons.push(
      `extractor errors present (${totalErrors} total): ${summary}`,
    )
  }

  return {
    ok: failureReasons.length === 0,
    details: {
      runId,
      matchId: runRow.matchId,
      loadoutPromotionCount,
      lobbyPromotionCount,
      extractorErrors,
      failureReasons,
    },
  }
}
