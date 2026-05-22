/**
 * Promoter registry: maps OcrScreenType → function that writes domain rows.
 *
 * Each promoter receives the parsed OCR result, the extraction id (for FK),
 * an optional matchId (set at batch time, may be null for unassigned batches),
 * and a transactional db connection. It writes whatever domain tables are
 * appropriate for that screen and returns when done.
 *
 * Promoter throws → caller marks transform_status='error'. Promoter returns
 * normally → caller marks transform_status='success'.
 */

import type { db, OcrScreenType } from '@eanhl/db'
import { promoteLoadout } from './loadout.js'
import { promotePreGameLobby } from './pre-game-lobby.js'
import { promotePostGamePlayerSummary } from './post-game-player-summary.js'
import { promoteBoxScore } from './box-score.js'
import { promoteNetChart } from './net-chart.js'
import { promoteFaceoffMap } from './faceoff-map.js'
import { promoteEvents } from './events.js'
import { promoteActionTracker } from './action-tracker.js'
import type { OcrResult } from '../ocr-cli-runner.js'

export type PromoterDb = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface PromoterContext {
  result: OcrResult
  extractionId: number
  matchId: number | null
  /** Absolute path of the capture file. Promoters use it as a fallback when
   *  OCR-derived metadata is unreliable — e.g., the action-tracker promoter
   *  reads the period from the parent folder name when the parser couldn't
   *  parse it from the period_label text. */
  sourcePath: string
  db: PromoterDb
  /**
   * Pass-2 loadout extraction engine flag (forwarded from IngestOcrBatchInput).
   * When 'typed_v1', per-extraction promoteLoadout is SKIPPED for
   * player_loadout_view screens; the per-match promoteLoadoutFromEvidence
   * runs at end of batch instead. Default undefined/legacy preserves existing
   * behaviour.
   */
  loadoutEngine?: string
  /**
   * Pass-2 lobby extraction engine flag (Phase 3b). When 'typed_v1', per-
   * extraction `promotePreGameLobby` is SKIPPED for `pre_game_lobby_state_2`
   * screens; the per-match `promoteLobbyFromEvidence` runs at end of batch.
   * pre_game_lobby_state_1 always uses the legacy promoter (no typed
   * extractor exists for state_1 per Phase 3a).
   */
  lobbyEngine?: string
}

export type Promoter = (ctx: PromoterContext) => Promise<void>

/**
 * Wraps the legacy promoteLoadout in a guard that skips promotion when
 * loadoutEngine='typed_v1'. The typed_v1 path runs promoteLoadoutFromEvidence
 * once per match at the end of ingestOcrBatch (after writeFieldEvidenceForBatch).
 */
const loadoutPromoterWithEngineGuard: Promoter = async (ctx) => {
  if (ctx.loadoutEngine === 'typed_v1') {
    // typed_v1 path: skip per-extraction promotion. The per-match
    // promoteLoadoutFromEvidence will run in ingest-ocr.ts after
    // all extractions in the batch have been processed.
    return
  }
  await promoteLoadout(ctx)
}

/**
 * Wraps the legacy promotePreGameLobby in a guard that skips promotion when
 * lobbyEngine='typed_v1'. The typed_v1 path runs promoteLobbyFromEvidence
 * once per match at the end of ingestOcrBatch.
 *
 * Only applies to pre_game_lobby_state_2 — pre_game_lobby_state_1 has no
 * typed extractor and always uses the legacy path.
 */
const lobbyPromoterWithEngineGuard: Promoter = async (ctx) => {
  if (ctx.lobbyEngine === 'typed_v1') {
    return
  }
  await promotePreGameLobby(ctx)
}

const promoters: Partial<Record<OcrScreenType, Promoter>> = {
  pre_game_lobby_state_1: promotePreGameLobby,
  pre_game_lobby_state_2: lobbyPromoterWithEngineGuard,
  player_loadout_view: loadoutPromoterWithEngineGuard,
  post_game_player_summary: promotePostGamePlayerSummary,
  post_game_box_score_goals: promoteBoxScore,
  post_game_box_score_shots: promoteBoxScore,
  post_game_box_score_faceoffs: promoteBoxScore,
  post_game_net_chart: promoteNetChart,
  post_game_faceoff_map: promoteFaceoffMap,
  post_game_events: promoteEvents,
  post_game_action_tracker: promoteActionTracker,
}

export function getPromoter(screen: OcrScreenType): Promoter | undefined {
  return promoters[screen]
}
