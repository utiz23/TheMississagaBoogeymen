import { REPORTER_IDS } from '@eanhl/db/news'
import { writeSampleLine } from '../news/sample-line.ts'
import type { ClaimedRequest, RequestOutcome } from './box-requests-profile.ts'
import type { PressConfig } from './config.ts'
import type { PressDeps } from './pass.ts'
import { pressRecorder } from './question.ts'
import { extrasBudgetLeft } from './rules.ts'

/**
 * A Press Box `preview` request (task press-box-l4): one sample line from one reporter, as the
 * reporter's character reads now (the code definition with the admin's saved overrides). ONE model
 * call (`writeSampleLine`), counted in the monthly spend through `pressRecorder`. The extras budget
 * stop (80% of the month) applies, like a profile. The result is the sample line for the page, or a
 * short private reason; it is never posted anywhere and never stored as a news item.
 */

const dollars = (n: number): string => `$${n.toFixed(2)}`
const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Writes one sample line. Never throws. */
export async function runPreviewRequest(
  deps: PressDeps,
  config: PressConfig,
  req: ClaimedRequest,
): Promise<RequestOutcome> {
  const reporter = REPORTER_IDS.find((r) => r === req.reporter)
  if (reporter === undefined) return { status: 'failed', result: 'The request names no reporter.' }
  try {
    if (!extrasBudgetLeft(await deps.store.monthNewsSpendUsd(deps.now()), config.monthlyLimitUsd)) {
      return {
        status: 'failed',
        result: 'The monthly budget is past the 80% stop: no sample line until next month.',
      }
    }
    const out = await writeSampleLine(deps.call, reporter, pressRecorder(deps.store))
    if (!out.ok) {
      deps.log(`[press] box request ${String(req.id)}: sample line not shown (${out.reason})`)
      return {
        status: 'failed',
        result: `No sample line: ${out.reason}. Cost about ${dollars(out.costUsd)}.`,
      }
    }
    return { status: 'done', result: out.text }
  } catch (err: unknown) {
    deps.log(`[press] box request ${String(req.id)}: ${reason(err)}`)
    return { status: 'failed', result: 'The sample line could not be written.' }
  }
}
