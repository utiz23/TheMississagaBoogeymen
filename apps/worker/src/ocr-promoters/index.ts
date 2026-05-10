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
  db: PromoterDb
}

export type Promoter = (ctx: PromoterContext) => Promise<void>

const promoters: Partial<Record<OcrScreenType, Promoter>> = {
  pre_game_lobby_state_1: promotePreGameLobby,
  pre_game_lobby_state_2: promotePreGameLobby,
  player_loadout_view: promoteLoadout,
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
