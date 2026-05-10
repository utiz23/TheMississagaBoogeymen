/**
 * Post-game Faceoff Map: audit-only in v1.
 *
 * The text panel data (overall win %, offensive/defensive zone splits) is
 * captured into ocr_extraction_fields for review but does NOT promote to a
 * domain table. Reasoning:
 *  - Box Score's faceoffs tab already populates match_period_summaries with
 *    faceoffs_for/_against per period.
 *  - Zone splits (offensive/defensive) have no schema columns today and the
 *    rink-coordinate map is Phase 5 work.
 *
 * If/when zone splits earn their own match_period_summaries columns, this
 * promoter writes to them. For now, no-op.
 */

import type { PromoterContext } from './index.js'

export function promoteFaceoffMap(_ctx: PromoterContext): Promise<void> {
  return Promise.resolve()
}
