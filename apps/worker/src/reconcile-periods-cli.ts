/**
 * `period_reconciliation` CLI — the deferred half of the 2026-07-16 calibration
 * decision (docs/calibration/l4-per-period-review-gating-2026-07-16.md), now
 * bounded and per-family.
 *
 * Two jobs, both driven by the pure `reconcilePeriods` verdicts:
 *
 *   1. REPORT the review queue — which matches carry a `period_reconciliation`
 *      task (passed the gate, but their per-period goals are incomplete or don't
 *      sum to the API-verified final). Match 2675 is the archetype.
 *   2. PROMOTE the reconciled families — set `goals_review_status` /
 *      `faceoffs_review_status` to `reviewed` for the periods EA player TOI
 *      proves the game reached, on matches whose family reconciles exactly.
 *
 * ⚠️ THE INVARIANTS THIS CLI EXISTS TO ENFORCE
 *
 *   * `overall.pass` / `gateFromL4` grade the box-score FINAL, never the
 *     per-period rows. A PASS verdict is NOT authorization to publish periods.
 *   * EA publishes no per-period truth for ANY family. Goals and faceoffs are
 *     authorized by a bounded coverage + summed-consistency check against EA's
 *     whole-game totals; nothing else is.
 *   * The two families are authorized SEPARATELY. A goals verdict never
 *     promotes faceoffs, and vice versa.
 *   * SHOTS ARE NEVER PROMOTED HERE. EA's whole-game shot totals are not
 *     comparable truth for the box-score per-period counts, so no automatic
 *     check exists. They wait for an operator.
 *   * The period bound is the INDEPENDENTLY derived `periodsPlayed` (EA player
 *     TOI), never `max(period_number)` of the OCR rows — which would let a
 *     phantom OT row certify itself. A match whose bound cannot be derived
 *     promotes nothing.
 *
 * This CLI never fails a match, never withholds a final, and never touches
 * aggregates.
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
  countPendingOcrPeriodFamilies,
  promoteOcrPeriodFamily,
  type PendingOcrPeriodFamilyCounts,
  type PeriodSummaryFamily,
} from '@eanhl/db/queries'
import { eq, sql } from 'drizzle-orm'
import { computeLayers } from './lib/quality-layers.js'
import { buildDownstreamCounts, buildQualityFlags } from './lib/quality-inputs.js'
import type { PeriodReconciliation } from './lib/l4-api-truth.js'

/** The families this CLI may ever write. Shots are deliberately absent. */
const PROMOTABLE_FAMILIES: readonly PeriodSummaryFamily[] = ['goals', 'faceoffs']

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

interface FamilyOutcome {
  family: PeriodSummaryFamily
  promotable: boolean
  reason: string
  /** OCR per-period readings of this family still awaiting review. */
  pending: number
  /** Periods this run flipped to reviewed. */
  promotedPeriods: number[]
  /** Periods the verdict authorized (empty when not promotable). */
  authorizedPeriods: number[]
  /** OCR periods above the bound — reported, never promoted. */
  excludedPeriods: number[]
  /** Set when the DB result disagreed with the authorized set, or the call threw. */
  error?: string
}

interface MatchOutcome {
  matchId: number
  overallPass: boolean
  periodsPlayed: number | null
  periodCoverage: number | null
  periodAccuracy: number | null
  faceoffCoverage: number | null
  faceoffAccuracy: number | null
  reconciliation: PeriodReconciliation
  families: Record<PeriodSummaryFamily, FamilyOutcome>
  error?: string
}

function emptyFamilies(reason: string): Record<PeriodSummaryFamily, FamilyOutcome> {
  const make = (family: PeriodSummaryFamily): FamilyOutcome => ({
    family,
    promotable: false,
    reason,
    pending: 0,
    promotedPeriods: [],
    authorizedPeriods: [],
    excludedPeriods: [],
  })
  return { goals: make('goals'), shots: make('shots'), faceoffs: make('faceoffs') }
}

function notApplicable(reason: string): PeriodReconciliation {
  const verdict = (family: PeriodSummaryFamily) => ({
    family,
    promotable: false,
    authorizedPeriods: [],
    coverage: null,
    accuracy: null,
    reason,
  })
  return {
    status: 'not_applicable',
    flag: false,
    promotable: false,
    reason,
    periodsPlayed: null,
    families: {
      goals: verdict('goals'),
      shots: verdict('shots'),
      faceoffs: verdict('faceoffs'),
    },
  }
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

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const x = [...a].sort((m, n) => m - n)
  const y = [...b].sort((m, n) => m - n)
  return x.every((v, i) => v === y[i])
}

/**
 * Promote ONE family, then verify the DB acted on exactly the authorized set.
 *
 * The mutation API is all-or-nothing and bounded, so the periods it reports as
 * reviewed (freshly promoted + already reviewed) must equal the verdict's
 * authorized set. Anything else means the row state moved under the decision —
 * recorded as an error on this family, never reported as a promotion.
 */
async function promoteFamily(
  matchId: number,
  family: PeriodSummaryFamily,
  authorizedPeriods: number[],
  periodsPlayed: number,
): Promise<{ promotedPeriods: number[]; excludedPeriods: number[]; error?: string }> {
  try {
    const result = await promoteOcrPeriodFamily({ matchId, family, maxPeriod: periodsPlayed })
    const reviewed = [...result.promotedPeriods, ...result.alreadyReviewedPeriods]
    if (!result.authorized || !sameSet(reviewed, authorizedPeriods)) {
      return {
        promotedPeriods: [],
        excludedPeriods: result.excludedPeriods,
        error:
          `${family}: DB authorized [${reviewed.join(',')}] but reconciliation authorized ` +
          `[${authorizedPeriods.join(',')}] — ${result.reason}`,
      }
    }
    return { promotedPeriods: result.promotedPeriods, excludedPeriods: result.excludedPeriods }
  } catch (e) {
    return {
      promotedPeriods: [],
      excludedPeriods: [],
      error: `${family}: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

async function evaluate(matchId: number, promote: boolean): Promise<MatchOutcome> {
  const match = await getMatchById(matchId)
  if (!match) {
    const reason = 'match row not found'
    return {
      matchId,
      overallPass: false,
      periodsPlayed: null,
      periodCoverage: null,
      periodAccuracy: null,
      faceoffCoverage: null,
      faceoffAccuracy: null,
      reconciliation: notApplicable(reason),
      families: emptyFamilies(reason),
      error: `match ${String(matchId)} not found`,
    }
  }

  const downstream = await buildDownstreamCounts(matchId, match)
  const flags = await buildQualityFlags(matchId, match)
  const layers = await computeLayers(matchId, downstream, flags)
  const reconciliation = layers.l4.periodReconciliation
  const pending: PendingOcrPeriodFamilyCounts = await countPendingOcrPeriodFamilies(matchId)
  const periodsPlayed = reconciliation.periodsPlayed

  const families: Record<PeriodSummaryFamily, FamilyOutcome> = {
    goals: {
      family: 'goals',
      promotable: reconciliation.families.goals.promotable,
      reason: reconciliation.families.goals.reason,
      pending: pending.goals,
      promotedPeriods: [],
      authorizedPeriods: reconciliation.families.goals.authorizedPeriods,
      excludedPeriods: layers.l4.excludedPeriods,
    },
    shots: {
      family: 'shots',
      promotable: false,
      reason: reconciliation.families.shots.reason,
      pending: pending.shots,
      promotedPeriods: [],
      authorizedPeriods: [],
      excludedPeriods: layers.l4.excludedPeriods,
    },
    faceoffs: {
      family: 'faceoffs',
      promotable: reconciliation.families.faceoffs.promotable,
      reason: reconciliation.families.faceoffs.reason,
      pending: pending.faceoffs,
      promotedPeriods: [],
      authorizedPeriods: reconciliation.families.faceoffs.authorizedPeriods,
      excludedPeriods: layers.l4.excludedPeriods,
    },
  }

  // THE GUARD. Each family consults its OWN verdict — deliberately not
  // `layers.overall.pass`, not the L4 gate decision, and not another family's
  // verdict. Shots are not in PROMOTABLE_FAMILIES and so are never written.
  if (promote && periodsPlayed !== null && periodsPlayed >= 1) {
    for (const family of PROMOTABLE_FAMILIES) {
      const outcome = families[family]
      if (!outcome.promotable || outcome.pending === 0) continue
      const result = await promoteFamily(matchId, family, outcome.authorizedPeriods, periodsPlayed)
      outcome.promotedPeriods = result.promotedPeriods
      if (result.excludedPeriods.length > 0) outcome.excludedPeriods = result.excludedPeriods
      if (result.error) outcome.error = result.error
    }
  }

  return {
    matchId,
    overallPass: layers.overall.pass,
    periodsPlayed,
    periodCoverage: layers.l4.periodCoverage,
    periodAccuracy: layers.l4.periodAccuracy,
    faceoffCoverage: layers.l4.faceoffCoverage,
    faceoffAccuracy: layers.l4.faceoffAccuracy,
    reconciliation,
    families,
  }
}

function fmt(n: number | null): string {
  return n === null ? '  —  ' : n.toFixed(2).padStart(5)
}

function totalPromoted(o: MatchOutcome): number {
  return (
    o.families.goals.promotedPeriods.length +
    o.families.shots.promotedPeriods.length +
    o.families.faceoffs.promotedPeriods.length
  )
}

function render(outcomes: MatchOutcome[], promote: boolean): string {
  const lines: string[] = []
  lines.push('══ period_reconciliation ══════════════════════════════════════════════')
  lines.push('')
  lines.push('  match  overall  per  gCov   gAcc   fCov   fAcc   status')
  for (const o of outcomes) {
    lines.push(
      `  ${String(o.matchId).padStart(5)}  ${(o.overallPass ? 'PASS' : 'FAIL').padEnd(7)}  ` +
        `${(o.periodsPlayed === null ? '—' : String(o.periodsPlayed)).padStart(3)}  ` +
        `${fmt(o.periodCoverage)}  ${fmt(o.periodAccuracy)}  ` +
        `${fmt(o.faceoffCoverage)}  ${fmt(o.faceoffAccuracy)}  ` +
        `${o.reconciliation.status}`,
    )
    for (const family of ['goals', 'shots', 'faceoffs'] as const) {
      const f = o.families[family]
      lines.push(
        `           ${family.padEnd(9)} pending=${String(f.pending).padStart(2)} ` +
          `promoted=${String(f.promotedPeriods.length).padStart(2)}` +
          (f.promotedPeriods.length > 0 ? ` [${f.promotedPeriods.join(',')}]` : '') +
          (f.excludedPeriods.length > 0 ? ` excluded=[${f.excludedPeriods.join(',')}]` : '') +
          (f.error ? `  ⚠ ${f.error}` : ''),
      )
    }
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

  const awaiting = outcomes.flatMap((o) =>
    PROMOTABLE_FAMILIES.filter((f) => o.families[f].promotable && o.families[f].pending > 0).map(
      (f) => `${String(o.matchId)}/${f}`,
    ),
  )
  if (!promote && awaiting.length > 0) {
    lines.push(`── ${String(awaiting.length)} family(ies) reconciled and awaiting promotion ──`)
    lines.push(`   ${awaiting.join(', ')}`)
    lines.push('   Re-run with --promote to mark those periods reviewed.')
    lines.push('')
  }

  const excludedTotal = outcomes.filter((o) => o.families.goals.excludedPeriods.length > 0)
  if (excludedTotal.length > 0) {
    lines.push('── out-of-range OCR periods (above the EA-TOI bound; never promoted) ──')
    for (const o of excludedTotal) {
      lines.push(
        `   ${String(o.matchId).padStart(5)}  periods [${o.families.goals.excludedPeriods.join(',')}] ` +
          `> periodsPlayed=${String(o.periodsPlayed)}`,
      )
    }
    lines.push('')
  }

  const errored = outcomes.filter((o) => o.error ?? Object.values(o.families).some((f) => f.error))
  if (errored.length > 0) {
    lines.push('── errors ──')
    for (const o of errored) {
      if (o.error) lines.push(`   ${String(o.matchId)}: ${o.error}`)
      for (const f of Object.values(o.families)) {
        if (f.error) lines.push(`   ${String(o.matchId)}: ${f.error}`)
      }
    }
    lines.push('')
  }

  if (!promote) {
    lines.push('Report only — nothing written (pass --promote to apply).')
  } else {
    const promotedTotal = outcomes.reduce((a, o) => a + totalPromoted(o), 0)
    const matchCount = outcomes.filter((o) => totalPromoted(o) > 0).length
    lines.push(
      promotedTotal === 0
        ? 'Nothing became publishable — no family reconciled with periods still pending.'
        : `Promoted ${String(promotedTotal)} per-period family reading(s) across ` +
            `${String(matchCount)} match(es). Shots were not promoted (manual review only).`,
    )
  }
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
    console.log('--promote marks RECONCILED FAMILIES reviewed, bounded to the periods EA')
    console.log('player TOI proves were played. Goals and faceoffs are authorized')
    console.log('separately; shots are never promoted automatically.')
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
      // Per-match isolation: one bad match must not abort a corpus sweep, and its
      // failure must stay visible rather than being folded into a zero.
      const reason = 'evaluation failed'
      outcomes.push({
        matchId: id,
        overallPass: false,
        periodsPlayed: null,
        periodCoverage: null,
        periodAccuracy: null,
        faceoffCoverage: null,
        faceoffAccuracy: null,
        reconciliation: notApplicable(reason),
        families: emptyFamilies(reason),
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
