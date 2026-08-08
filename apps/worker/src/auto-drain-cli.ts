/**
 * Auto-drain — automate the mechanical half of the OCR review backlog.
 *
 * THE PROBLEM THIS SOLVES. Mass extraction promoted rows into the canonical
 * tables at `review_status='pending_review'`, and the UI filters on `reviewed`.
 * The "grade the match ⇒ flip its rows" link was never wired, so thousands of
 * correctly-extracted event rows sat invisible with nothing wrong with them.
 * The criterion the recent manual drains actually applied is fully mechanical,
 * so a human re-deriving it per match added latency, not judgement.
 *
 * The criterion itself — and why it keys on flag classes A/B/D/G specifically —
 * lives in `lib/auto-drain.ts`. This file is the CLI front end.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *   - per-period rows (`match_period_summaries`): `reconcile-periods` owns
 *     those and is already at its policy limit. A gate PASS grades the FINAL
 *     and is never authorization to publish a period breakdown.
 *   - gate-HOLD matches: blocked on a real box-score read defect.
 *   - loadouts: ungated display, not part of this backlog.
 *
 * Usage:
 *   pnpm --filter worker auto-drain --all --dry-run     # report, write nothing
 *   pnpm --filter worker auto-drain --match 608         # drain one match
 *   pnpm --filter worker auto-drain --all               # drain the corpus
 *   pnpm --filter worker auto-drain --all --json
 *
 * A scope (`--match` or `--all`) is REQUIRED — a bare invocation prints usage
 * rather than draining everything.
 */

import { sql as dbSql } from '@eanhl/db'
import { getMatchById } from '@eanhl/db/queries'

import { computeLayers } from './lib/quality-layers.js'
import { buildDownstreamCounts, buildQualityFlags } from './lib/quality-inputs.js'
import { gateFromL4, type L4Gate } from './lib/l4-api-truth.js'
import {
  decideDrain,
  matchesWithPendingDrainableExtractions,
  pendingDrainableExtractionIds,
  type DrainDecision,
} from './lib/auto-drain.js'
import {
  addCascadeCounts,
  emptyCascadeCounts,
  formatCascadeCounts,
  setExtractionStatus,
  PERIOD_SUMMARY_PROVENANCE_GAP,
  PERIOD_SUMMARY_QUARANTINE_NOTE,
  type CascadeCounts,
} from './lib/review-cascade.js'

interface MatchOutcome {
  matchId: number
  gate: L4Gate | null
  decision: DrainDecision
  pendingExtractions: number
  drainedExtractions: number
  cascade: CascadeCounts
  error?: string
}

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function evaluate(matchId: number, dryRun: boolean): Promise<MatchOutcome> {
  const match = await getMatchById(matchId)
  if (!match) {
    return {
      matchId,
      gate: null,
      decision: { drain: false, reason: 'match row not found', blockers: [] },
      pendingExtractions: 0,
      drainedExtractions: 0,
      cascade: emptyCascadeCounts(),
      error: `match ${String(matchId)} not found`,
    }
  }

  const downstream = await buildDownstreamCounts(matchId, match)
  const flags = await buildQualityFlags(matchId, match)
  const layers = await computeLayers(matchId, downstream, flags)
  const gate = gateFromL4(layers.l4)
  const decision = decideDrain(gate, flags)

  const ids = await pendingDrainableExtractionIds(matchId)

  let cascade = emptyCascadeCounts()
  let drainedExtractions = 0
  if (decision.drain && !dryRun && ids.length > 0) {
    cascade = await setExtractionStatus(ids, 'reviewed')
    drainedExtractions = ids.length
  }

  return {
    matchId,
    gate,
    decision,
    pendingExtractions: ids.length,
    drainedExtractions,
    cascade,
  }
}

function render(outcomes: MatchOutcome[], dryRun: boolean): string {
  const lines: string[] = []
  lines.push('══ auto-drain ════════════════════════════════════════════════════════')
  lines.push(dryRun ? '   DRY RUN — nothing written.' : '   LIVE — flipping to reviewed.')
  lines.push('')
  lines.push('  match  gate              pending  action   reason')
  for (const o of outcomes) {
    const gateStr = o.gate?.decision ?? 'ERROR'
    const action = o.decision.drain ? (dryRun ? 'would' : 'DRAIN') : 'hold'
    lines.push(
      `  ${String(o.matchId).padStart(5)}  ${gateStr.padEnd(16)}  ` +
        `${String(o.pendingExtractions).padStart(7)}  ${action.padEnd(7)}  ${o.decision.reason}`,
    )
    // No silent skips: every blocking flag is printed under its match.
    for (const b of o.decision.blockers) {
      lines.push(`         └─ [FAIL] class ${b.classId}: ${b.message}`)
    }
  }
  lines.push('')

  const drainable = outcomes.filter((o) => o.decision.drain)
  const held = outcomes.filter((o) => !o.decision.drain && !o.error)
  const errored = outcomes.filter((o) => o.error)

  if (errored.length > 0) {
    lines.push('── errors ──')
    for (const o of errored) lines.push(`   ${String(o.matchId)}: ${o.error ?? ''}`)
    lines.push('')
  }

  const totalPending = drainable.reduce((a, o) => a + o.pendingExtractions, 0)
  const totalCascade = outcomes.reduce(
    (a, o) => addCascadeCounts(a, o.cascade),
    emptyCascadeCounts(),
  )

  lines.push(
    `${String(drainable.length)} match(es) drainable (${String(totalPending)} extraction(s)), ` +
      `${String(held.length)} held, ${String(errored.length)} errored.`,
  )
  if (dryRun) {
    lines.push('Re-run without --dry-run to apply.')
    if (drainable.length > 0) {
      lines.push('')
      lines.push('── would drain ──')
      for (const o of drainable) {
        lines.push(`   match ${String(o.matchId)}: ${String(o.pendingExtractions)} extraction(s)`)
      }
    }
  } else {
    lines.push(`cascade: ${formatCascadeCounts(totalCascade)}`)
    if (totalCascade.periodSummariesSkipped > 0) {
      lines.push(
        `⚠ ${String(totalCascade.periodSummariesSkipped)} match_period_summaries row(s) were ` +
          `NOT changed. ${PERIOD_SUMMARY_PROVENANCE_GAP}`,
      )
    }
    if (totalCascade.periodSummariesQuarantined > 0) {
      lines.push(
        `⚠ ${String(totalCascade.periodSummariesQuarantined)} match_period_summaries row(s) ` +
          `were QUARANTINED (published families withdrawn to pending_review). ` +
          PERIOD_SUMMARY_QUARANTINE_NOTE,
      )
    }
  }
  return lines.join('\n')
}

async function main(): Promise<void> {
  const matchStr = getFlag('match')
  const all = hasFlag('all')
  const dryRun = hasFlag('dry-run')
  const asJson = hasFlag('json')

  if (!matchStr && !all) {
    console.log('Usage:')
    console.log('  pnpm --filter worker auto-drain --all --dry-run')
    console.log('  pnpm --filter worker auto-drain --match <id> [--dry-run] [--json]')
    console.log('  pnpm --filter worker auto-drain --all [--dry-run] [--json]')
    console.log('')
    console.log('Drains a match iff the L4 gate says PASS and it carries no fail-severity')
    console.log('flags in classes A/B/D/G. HOLD / OPERATOR_CONFIRM matches are listed, never')
    console.log('touched. A scope flag is required — this never drains the corpus implicitly.')
    process.exitCode = 1
    return
  }

  let matchIds: number[]
  if (all) {
    matchIds = await matchesWithPendingDrainableExtractions()
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
      outcomes.push(await evaluate(id, dryRun))
    } catch (e) {
      // Per-match isolation: one bad match must not abort a corpus sweep.
      outcomes.push({
        matchId: id,
        gate: null,
        decision: { drain: false, reason: 'evaluation failed', blockers: [] },
        pendingExtractions: 0,
        drainedExtractions: 0,
        cascade: emptyCascadeCounts(),
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ dryRun, outcomes }, null, 2))
  } else {
    console.log(render(outcomes, dryRun))
  }
}

main()
  .catch((err: unknown) => {
    console.error('[auto-drain] Fatal error:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void dbSql.end()
  })
