/**
 * `period_reconciliation` CLI — the deferred half of the 2026-07-16 calibration
 * decision (docs/calibration/l4-per-period-review-gating-2026-07-16.md).
 *
 * Two jobs, both driven by the same pure `reconcilePeriods` verdict:
 *
 *   1. REPORT the review queue — which matches carry a `period_reconciliation`
 *      task (passed the gate, but their per-period rows are incomplete or don't
 *      sum to the API-verified final). Match 2675 is the archetype.
 *   2. PROMOTE the reconciled ones — flip `match_period_summaries` rows from
 *      `pending_review` to `reviewed` (⇒ visible on the recap) for matches whose
 *      periods are complete AND sum to the final.
 *
 * ⚠️ THE INVARIANT THIS CLI EXISTS TO ENFORCE: `overall.pass` / `gateFromL4`
 * grade the box-score FINAL, never the per-period rows, and EA publishes no
 * per-period truth to grade them against. So a PASS verdict is NOT authorization
 * to publish periods. The only automatic authorization is full reconciliation
 * (`periodCoverage === 1 && periodAccuracy === 1`); everything else waits for a
 * human (`ingest-ocr-review`). This CLI never fails a match, never withholds a
 * final, and never touches aggregates.
 *
 * Usage:
 *   pnpm --filter worker reconcile-periods --match 2675
 *   pnpm --filter worker reconcile-periods --match 2675 --promote
 *   pnpm --filter worker reconcile-periods --all            # sweep, report only
 *   pnpm --filter worker reconcile-periods --all --promote  # sweep + promote
 *   pnpm --filter worker reconcile-periods --all --json
 *
 * Reporting is the default; `--promote` is required to write anything.
 */

import { db, sql as dbSql, matchPeriodSummaries } from '@eanhl/db'
import {
  getMatchById,
  countPendingOcrPeriodSummaries,
  markOcrPeriodSummariesReviewed,
} from '@eanhl/db/queries'
import { eq, sql } from 'drizzle-orm'
import { computeLayers } from './lib/quality-layers.js'
import { buildDownstreamCounts, buildQualityFlags } from './lib/quality-inputs.js'
import type { PeriodReconciliation } from './lib/l4-api-truth.js'

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

interface MatchOutcome {
  matchId: number
  overallPass: boolean
  periodCoverage: number | null
  periodAccuracy: number | null
  reconciliation: PeriodReconciliation
  pendingRows: number
  promotedRows: number
  error?: string
}

/** Every match that has at least one OCR per-period row — the only candidates. */
async function matchesWithOcrPeriods(): Promise<number[]> {
  const rows = await db
    .selectDistinct({ matchId: matchPeriodSummaries.matchId })
    .from(matchPeriodSummaries)
    .where(eq(matchPeriodSummaries.source, 'ocr'))
    .orderBy(sql`1`)
  return rows.map((r) => r.matchId)
}

async function evaluate(matchId: number, promote: boolean): Promise<MatchOutcome> {
  const match = await getMatchById(matchId)
  if (!match) {
    return {
      matchId,
      overallPass: false,
      periodCoverage: null,
      periodAccuracy: null,
      reconciliation: {
        status: 'not_applicable',
        flag: false,
        promotable: false,
        reason: 'match row not found',
      },
      pendingRows: 0,
      promotedRows: 0,
      error: `match ${String(matchId)} not found`,
    }
  }

  const downstream = await buildDownstreamCounts(matchId, match)
  const flags = await buildQualityFlags(matchId, match)
  const layers = await computeLayers(matchId, downstream, flags)
  const reconciliation = layers.l4.periodReconciliation
  const pendingRows = await countPendingOcrPeriodSummaries(matchId)

  // THE GUARD. `promotable` is the only thing consulted — deliberately not
  // `layers.overall.pass`, and deliberately not the L4 gate decision.
  let promotedRows = 0
  if (promote && reconciliation.promotable && pendingRows > 0) {
    promotedRows = await markOcrPeriodSummariesReviewed(matchId)
  }

  return {
    matchId,
    overallPass: layers.overall.pass,
    periodCoverage: layers.l4.periodCoverage,
    periodAccuracy: layers.l4.periodAccuracy,
    reconciliation,
    pendingRows,
    promotedRows,
  }
}

function fmt(n: number | null): string {
  return n === null ? '  —  ' : n.toFixed(2).padStart(5)
}

function render(outcomes: MatchOutcome[], promote: boolean): string {
  const lines: string[] = []
  lines.push('══ period_reconciliation ══════════════════════════════════════════════')
  lines.push('')
  lines.push('  match  overall  cov    acc    status          pending  promoted')
  for (const o of outcomes) {
    lines.push(
      `  ${String(o.matchId).padStart(5)}  ${(o.overallPass ? 'PASS' : 'FAIL').padEnd(7)}  ` +
        `${fmt(o.periodCoverage)}  ${fmt(o.periodAccuracy)}  ` +
        `${o.reconciliation.status.padEnd(14)}  ${String(o.pendingRows).padStart(7)}  ` +
        `${String(o.promotedRows).padStart(8)}`,
    )
  }
  lines.push('')

  const queued = outcomes.filter((o) => o.reconciliation.flag)
  if (queued.length > 0) {
    lines.push(`── review queue: ${String(queued.length)} match(es) need per-period review ──`)
    for (const o of queued) {
      lines.push(`   ${String(o.matchId).padStart(5)}  ${o.reconciliation.reason}`)
    }
    lines.push('')
    lines.push('   These matches PASS and publish their (correct) final — only the')
    lines.push('   per-period breakdown is withheld. Resolve with a clean re-OCR or:')
    lines.push('     pnpm --filter worker ingest-ocr-review --extraction <id> --status reviewed')
    lines.push('')
  }

  const promotable = outcomes.filter((o) => o.reconciliation.promotable && o.pendingRows > 0)
  if (!promote && promotable.length > 0) {
    lines.push(
      `── ${String(promotable.length)} match(es) fully reconciled and awaiting promotion ──`,
    )
    lines.push('   Re-run with --promote to mark their period rows reviewed.')
    lines.push('')
  }

  const errored = outcomes.filter((o) => o.error)
  if (errored.length > 0) {
    lines.push('── errors ──')
    for (const o of errored) lines.push(`   ${String(o.matchId)}: ${o.error ?? ''}`)
    lines.push('')
  }

  const totalPromoted = outcomes.reduce((a, o) => a + o.promotedRows, 0)
  lines.push(
    promote
      ? `Promoted ${String(totalPromoted)} per-period row(s) across ${String(outcomes.filter((o) => o.promotedRows > 0).length)} match(es).`
      : 'Report only — nothing written (pass --promote to apply).',
  )
  return lines.join('\n')
}

async function main(): Promise<void> {
  const matchStr = getFlag('match')
  const all = hasFlag('all')
  const promote = hasFlag('promote')
  const asJson = hasFlag('json')

  if (!matchStr && !all) {
    console.log('Usage:')
    console.log('  pnpm --filter worker reconcile-periods --match <id> [--promote] [--json]')
    console.log('  pnpm --filter worker reconcile-periods --all [--promote] [--json]')
    console.log('')
    console.log('Reports which matches carry a period_reconciliation review task.')
    console.log('--promote marks FULLY RECONCILED matches’ period rows reviewed.')
    console.log('A PASS verdict alone never promotes — see the calibration decision doc.')
    process.exitCode = 1
    return
  }

  let matchIds: number[]
  if (all) {
    matchIds = await matchesWithOcrPeriods()
  } else {
    const id = Number.parseInt(matchStr ?? '', 10)
    if (!Number.isFinite(id)) {
      console.error(`Invalid --match: ${matchStr ?? ''}`)
      process.exitCode = 1
      return
    }
    matchIds = [id]
  }

  const outcomes: MatchOutcome[] = []
  for (const id of matchIds) {
    try {
      outcomes.push(await evaluate(id, promote))
    } catch (e) {
      // Per-match isolation: one bad match must not abort a corpus sweep.
      outcomes.push({
        matchId: id,
        overallPass: false,
        periodCoverage: null,
        periodAccuracy: null,
        reconciliation: {
          status: 'not_applicable',
          flag: false,
          promotable: false,
          reason: 'evaluation failed',
        },
        pendingRows: 0,
        promotedRows: 0,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ promote, outcomes }, null, 2))
  } else {
    console.log(render(outcomes, promote))
  }
}

main()
  .catch((err: unknown) => {
    console.error('[reconcile-periods] Fatal error:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void dbSql.end()
  })
