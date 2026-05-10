/**
 * Post-game player summary: no domain promotion in Phase 1.
 *
 * The data here (per-player goals, assists, saves, save%) is redundant with
 * what the EA API already gives us via player_match_stats. We keep the OCR
 * extraction record + ocr_extraction_fields rows for audit/review, but do not
 * write to a domain table.
 *
 * Phase 4+ may revisit promoting this as a third evidence source for
 * player_match_stats reconciliation when EA payloads disagree with the in-game
 * scoreboard.
 */

import type { PromoterContext } from './index.js'

export function promotePostGamePlayerSummary(_ctx: PromoterContext): Promise<void> {
  // No-op. Caller marks transform_status = 'success' on return.
  return Promise.resolve()
}
