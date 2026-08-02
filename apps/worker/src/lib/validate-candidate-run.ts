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
  /** Source screen of the failing extraction (drives fatal-vs-warning). */
  screenType?: string
}

export interface ValidationDetails {
  runId: number
  matchId: number
  loadoutPromotionCount: number
  lobbyPromotionCount: number
  /** All extractor-error buckets (fatal + warning), bucketed by (screen, message). */
  extractorErrors: ExtractorErrorBucket[]
  /** Subset that BLOCKS activation. Only these drive `failureReasons` / `ok`. */
  fatalExtractorErrors: ExtractorErrorBucket[]
  /** Subset recorded for operator visibility but NON-blocking. */
  warningExtractorErrors: ExtractorErrorBucket[]
  /** Empty when `ok=true`. */
  failureReasons: string[]
}

/**
 * Stable machine token prefixed onto the period-label throw in the secondary
 * post-game promoters (net-chart.ts / faceoff-map.ts). The validate gate matches
 * on this PREFIX so the fatal-vs-warning policy is decoupled from human prose —
 * keep this string in sync with those promoters.
 */
export const PERIOD_LABEL_UNRECOGNIZED = 'PERIOD_LABEL_UNRECOGNIZED:'

/**
 * Stable phrase inside the box-score "zero period cells" throw (box-score.ts).
 * Matched as a substring (rather than a prefix sentinel) so error rows already
 * persisted by an earlier dispatch reclassify without a re-dispatch — keep in
 * sync with the throw in box-score.ts.
 */
export const BOX_SCORE_ZERO_CELLS_PHRASE = 'produced zero period cells'

/**
 * Secondary post-game screens whose per-frame extraction misses are
 * supplementary/lossy: their data (shot-type / faceoff / box-score per-period
 * breakdowns) is redundant across frames and EA remains authoritative for the
 * box score, so a miss on a redundant/transition frame must never block
 * activation of the cleanly-extracted core data (action-tracker events, lineup).
 */
const WARNING_ELIGIBLE_SCREENS = new Set([
  'post_game_net_chart',
  'post_game_faceoff_map',
  'post_game_box_score_goals',
  'post_game_box_score_shots',
  'post_game_box_score_faceoffs',
])

/**
 * Classify a single extractor error as fatal (blocks activation) or warning
 * (recorded, non-blocking). A failure is a WARNING iff it is a known supplementary
 * miss on a secondary post-game screen:
 *   - an unreadable period label (net-chart / faceoff), or
 *   - a box-score frame that yielded zero period cells (redundant/transition frame).
 * Those frames are redundant/transition or genuinely unreadable, so losing them
 * must not block the cleanly-extracted core data. Everything else — incl.
 * "Cannot resolve BGM side", "missing away/home stat blocks", an unexpected
 * stat_kind, or any error on a non-secondary screen — stays FATAL. The
 * screen-type guard bounds the blast radius if another extractor emits a
 * similar message.
 */
export function classifyExtractorError(
  screenType: string | null | undefined,
  message: string | null | undefined,
): 'fatal' | 'warning' {
  if (
    screenType === null ||
    screenType === undefined ||
    !WARNING_ELIGIBLE_SCREENS.has(screenType)
  ) {
    return 'fatal'
  }
  const msg = message ?? ''
  if (msg.startsWith(PERIOD_LABEL_UNRECOGNIZED) || msg.includes(BOX_SCORE_ZERO_CELLS_PHRASE)) {
    return 'warning'
  }
  return 'fatal'
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

  // Extractor errors — bucket by (screen_type, transform_error). COALESCE so
  // NULL error text rolls up under '<no message>' rather than disappearing.
  // screen_type is NOT NULL, so it always groups cleanly.
  const errorRows = await db
    .select({
      screenType: ocrExtractions.screenType,
      kind: sql<string>`coalesce(${ocrExtractions.transformError}, '<no message>')`.as('kind'),
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(ocrExtractions)
    .where(and(eq(ocrExtractions.runId, runId), eq(ocrExtractions.transformStatus, 'error')))
    .groupBy(
      ocrExtractions.screenType,
      sql`coalesce(${ocrExtractions.transformError}, '<no message>')`,
    )
  const extractorErrors: ExtractorErrorBucket[] = errorRows.map((r) => ({
    kind: String(r.kind),
    count: Number(r.count),
    screenType: String(r.screenType),
  }))
  // Split fatal (blocks activation) from warning (non-blocking, supplementary).
  const fatalExtractorErrors = extractorErrors.filter(
    (e) => classifyExtractorError(e.screenType, e.kind) === 'fatal',
  )
  const warningExtractorErrors = extractorErrors.filter(
    (e) => classifyExtractorError(e.screenType, e.kind) === 'warning',
  )

  const failureReasons: string[] = []
  if (loadoutPromotionCount < minLoadout) {
    failureReasons.push(`loadout promotions ${loadoutPromotionCount} < floor ${minLoadout}`)
  }
  if (lobbyPromotionCount < minLobby) {
    failureReasons.push(`lobby promotions ${lobbyPromotionCount} < floor ${minLobby}`)
  }
  // ONLY fatal errors block activation; warnings are reported but never fail.
  if (fatalExtractorErrors.length > 0) {
    const totalErrors = fatalExtractorErrors.reduce((acc, e) => acc + e.count, 0)
    const summary = fatalExtractorErrors.map((e) => `${e.kind}=${e.count}`).join(', ')
    failureReasons.push(`extractor errors present (${totalErrors} total): ${summary}`)
  }

  return {
    ok: failureReasons.length === 0,
    details: {
      runId,
      matchId: runRow.matchId,
      loadoutPromotionCount,
      lobbyPromotionCount,
      extractorErrors,
      fatalExtractorErrors,
      warningExtractorErrors,
      failureReasons,
    },
  }
}
