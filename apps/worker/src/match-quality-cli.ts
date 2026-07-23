/**
 * Match-quality report CLI. Grades a single match against the three quality
 * layers (classifier recall, OCR field accuracy, downstream completeness) and
 * surfaces the specific failure classes the manual page-review process catches.
 *
 * Usage:
 *   pnpm --filter worker match-quality --match 463
 *   pnpm --filter worker match-quality --match 463 --json
 */

import { db, sql as dbSql, ocrExtractions, matchEvents } from '@eanhl/db'
import { getMatchById, getMatchLineupProvenance } from '@eanhl/db/queries'
import { eq, sql } from 'drizzle-orm'
import {
  L1_THRESHOLD,
  L2_THRESHOLD,
  L3_THRESHOLD,
  computeLayers,
  type LayerScores,
} from './lib/quality-layers.js'
import {
  buildDownstreamCounts,
  buildQualityFlags,
  type DownstreamRow,
  type QualityFlag,
} from './lib/quality-inputs.js'
import { gateFromL4, type L4Gate } from './lib/l4-api-truth.js'

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

interface ScreenRow {
  screenType: string
  frames: number
  ok: number
  err: number
  reviewed: number
  avgConf: number | null
  minConf: number | null
  maxConf: number | null
}

async function buildScreenTable(matchId: number): Promise<ScreenRow[]> {
  const rows = await db
    .select({
      screenType: ocrExtractions.screenType,
      frames: sql<string>`COUNT(*)::text`,
      ok: sql<string>`COUNT(*) FILTER (WHERE ${ocrExtractions.transformStatus} = 'success')::text`,
      err: sql<string>`COUNT(*) FILTER (WHERE ${ocrExtractions.transformStatus} = 'error')::text`,
      reviewed: sql<string>`COUNT(*) FILTER (WHERE ${ocrExtractions.reviewStatus} = 'reviewed')::text`,
      avgConf: sql<
        string | null
      >`ROUND(AVG(${ocrExtractions.overallConfidence})::numeric, 3)::text`,
      minConf: sql<
        string | null
      >`ROUND(MIN(${ocrExtractions.overallConfidence})::numeric, 3)::text`,
      maxConf: sql<
        string | null
      >`ROUND(MAX(${ocrExtractions.overallConfidence})::numeric, 3)::text`,
    })
    .from(ocrExtractions)
    .where(eq(ocrExtractions.matchId, matchId))
    .groupBy(ocrExtractions.screenType)
    .orderBy(ocrExtractions.screenType)
  return rows.map((r) => ({
    screenType: r.screenType,
    frames: Number(r.frames),
    ok: Number(r.ok),
    err: Number(r.err),
    reviewed: Number(r.reviewed),
    avgConf: r.avgConf !== null ? Number(r.avgConf) : null,
    minConf: r.minConf !== null ? Number(r.minConf) : null,
    maxConf: r.maxConf !== null ? Number(r.maxConf) : null,
  }))
}

interface PeriodBreakdownRow {
  periodNumber: number
  periodLabel: string
  total: number
  goals: number
  shots: number
  hits: number
  faceoffs: number
  penalties: number
  plotted: number
  actorResolved: number
}

async function buildPeriodBreakdown(matchId: number): Promise<PeriodBreakdownRow[]> {
  // Group by period_number only; period_label varies between AT ("RT 1ST PERIOD")
  // and events screen ("1ST") so grouping by both splits the same period across
  // multiple rows. Take MIN(period_label) so the AT-style "RT NTH PERIOD" wins
  // alphabetically when both exist.
  const rows = await db
    .select({
      periodNumber: matchEvents.periodNumber,
      periodLabel: sql<string>`MAX(${matchEvents.periodLabel})`,
      total: sql<string>`COUNT(*)::text`,
      goals: sql<string>`COUNT(*) FILTER (WHERE ${matchEvents.eventType} = 'goal')::text`,
      shots: sql<string>`COUNT(*) FILTER (WHERE ${matchEvents.eventType} = 'shot')::text`,
      hits: sql<string>`COUNT(*) FILTER (WHERE ${matchEvents.eventType} = 'hit')::text`,
      faceoffs: sql<string>`COUNT(*) FILTER (WHERE ${matchEvents.eventType} = 'faceoff')::text`,
      penalties: sql<string>`COUNT(*) FILTER (WHERE ${matchEvents.eventType} = 'penalty')::text`,
      plotted: sql<string>`COUNT(*) FILTER (WHERE ${matchEvents.x} IS NOT NULL)::text`,
      actorResolved: sql<string>`COUNT(*) FILTER (WHERE ${matchEvents.actorPlayerId} IS NOT NULL)::text`,
    })
    .from(matchEvents)
    .where(eq(matchEvents.matchId, matchId))
    .groupBy(matchEvents.periodNumber)
    .orderBy(matchEvents.periodNumber)
  return rows.map((r) => ({
    periodNumber: r.periodNumber,
    periodLabel: r.periodLabel,
    total: Number(r.total),
    goals: Number(r.goals),
    shots: Number(r.shots),
    hits: Number(r.hits),
    faceoffs: Number(r.faceoffs),
    penalties: Number(r.penalties),
    plotted: Number(r.plotted),
    actorResolved: Number(r.actorResolved),
  }))
}

interface PendingReview {
  screenType: string
  pending: number
  reviewed: number
  total: number
}

async function buildPendingReview(matchId: number): Promise<PendingReview[]> {
  const rows = await db
    .select({
      screenType: ocrExtractions.screenType,
      pending: sql<string>`COUNT(*) FILTER (WHERE ${ocrExtractions.reviewStatus} = 'pending_review')::text`,
      reviewed: sql<string>`COUNT(*) FILTER (WHERE ${ocrExtractions.reviewStatus} = 'reviewed')::text`,
      total: sql<string>`COUNT(*)::text`,
    })
    .from(ocrExtractions)
    .where(eq(ocrExtractions.matchId, matchId))
    .groupBy(ocrExtractions.screenType)
    .orderBy(ocrExtractions.screenType)
  return rows.map((r) => ({
    screenType: r.screenType,
    pending: Number(r.pending),
    reviewed: Number(r.reviewed),
    total: Number(r.total),
  }))
}

function bar(s: string, n: number): string {
  return s.padEnd(n).slice(0, n)
}

function fmtPct(x: number | null): string {
  if (x === null) return ' n/a '
  return `${(x * 100).toFixed(1)}%`
}

function gateLabel(pass: boolean | null, threshold: number): string {
  if (pass === null) return '[ N/A ]'
  return pass
    ? `[  OK  ] ≥${(threshold * 100).toFixed(0)}%`
    : `[ FAIL ] <${(threshold * 100).toFixed(0)}%`
}

function renderHuman(
  matchId: number,
  match: NonNullable<Awaited<ReturnType<typeof getMatchById>>>,
  screens: ScreenRow[],
  downstream: DownstreamRow[],
  periods: PeriodBreakdownRow[],
  provenance: Awaited<ReturnType<typeof getMatchLineupProvenance>>,
  flags: QualityFlag[],
  pending: PendingReview[],
  layers: LayerScores,
  gate: L4Gate,
): string {
  const lines: string[] = []
  lines.push('')
  lines.push(`══ Match ${matchId} quality report ═══════════════════════════════════════`)
  lines.push(
    `   ${match.playedAt.toISOString().slice(0, 10)}  vs ${match.opponentName}  · ${match.scoreFor}-${match.scoreAgainst}  ${match.result}`,
  )
  lines.push(
    `   bgm_was_home=${match.bgmWasHome === null ? 'null' : match.bgmWasHome ? 'true' : 'false'}  bgm=${match.bgmColorHex ?? 'null'}  opp=${match.oppColorHex ?? 'null'}  ea_pim=${match.penaltyMinutes ?? 0}/${match.penaltyMinutesAgainst ?? 0}`,
  )
  lines.push('')

  lines.push('── 1. OCR extractions per screen ─────────────────────────────────────')
  lines.push('   screen_type                   frames  ok  err  rev  avg_conf  min/max')
  for (const s of screens) {
    lines.push(
      `   ${bar(s.screenType, 30)} ${String(s.frames).padStart(5)} ${String(s.ok).padStart(4)} ${String(s.err).padStart(4)} ${String(s.reviewed).padStart(4)}  ${(s.avgConf ?? 0).toFixed(3)}   ${(s.minConf ?? 0).toFixed(2)} / ${(s.maxConf ?? 0).toFixed(2)}`,
    )
  }
  lines.push('')

  lines.push('── 2. Downstream rows vs expected ────────────────────────────────────')
  lines.push('   table                                  actual / exp  rev  notes')
  for (const d of downstream) {
    const ratio = d.expected !== null && d.expected > 0 ? d.actual / d.expected : null
    const tag = ratio === null ? '   ' : ratio >= 1 ? ' OK' : ratio >= L3_THRESHOLD ? 'OK ' : 'GAP'
    lines.push(
      `   ${tag} ${bar(d.table, 38)} ${String(d.actual).padStart(4)} / ${String(d.expected ?? '—').padStart(4)}  ${String(d.reviewed).padStart(4)}  ${d.notes}`,
    )
  }
  lines.push('')

  lines.push('── 3. Action Tracker per period ───────────────────────────────────────')
  lines.push('   P  label              total goal shot hit fo pen  plotted  actor_resolved')
  for (const p of periods) {
    lines.push(
      `   ${p.periodNumber}  ${bar(p.periodLabel, 18)} ${String(p.total).padStart(5)} ${String(p.goals).padStart(4)} ${String(p.shots).padStart(4)} ${String(p.hits).padStart(3)} ${String(p.faceoffs).padStart(2)} ${String(p.penalties).padStart(3)}  ${String(p.plotted).padStart(7)}  ${String(p.actorResolved).padStart(14)}`,
    )
  }
  lines.push('')

  lines.push('── 4. Lineup provenance ──────────────────────────────────────────────')
  lines.push(
    `   canonical=${fmtPct(provenance.confidence.canonical)}  tiered=${fmtPct(provenance.confidence.tiered)}  attribute=${fmtPct(provenance.confidence.attribute)}`,
  )
  for (const s of provenance.sources) {
    lines.push(`   source: ${s.screenType} ×${s.snapshotCount}`)
  }
  lines.push('')

  lines.push('── 5. Quality flags ──────────────────────────────────────────────────')
  if (flags.length === 0) {
    lines.push('   (none)')
  } else {
    for (const f of flags) {
      const sev = f.severity === 'fail' ? '[FAIL]' : '[WARN]'
      lines.push(`   ${sev} (class ${f.classId})  ${f.message}`)
      if (f.evidence) lines.push(`            evidence: ${f.evidence}`)
    }
  }
  lines.push('')

  lines.push('── 6. Pending-review queue ───────────────────────────────────────────')
  const anyPending = pending.some((p) => p.pending > 0)
  if (!anyPending) {
    lines.push('   (all reviewed)')
  } else {
    for (const p of pending) {
      if (p.pending === 0) continue
      lines.push(`   ${bar(p.screenType, 30)}  pending=${p.pending}  reviewed=${p.reviewed}`)
    }
  }
  lines.push('')

  lines.push('══ Layer scores ═══════════════════════════════════════════════════════')
  lines.push(
    `   L1 classifier recall      ${gateLabel(layers.l1.pass, L1_THRESHOLD)}    ${layers.l1.notes}`,
  )
  lines.push(
    `   L2 actor resolution  ${fmtPct(layers.l2.score).padStart(6)}  ${gateLabel(layers.l2.pass, L2_THRESHOLD)}    ${layers.l2.notes}`,
  )
  lines.push(
    `   L2 lineup fields     ${fmtPct(layers.l2_lineup.score).padStart(6)}  ${gateLabel(layers.l2_lineup.pass, L2_THRESHOLD)}    ${layers.l2_lineup.notes}`,
    `   L3 downstream        ${fmtPct(layers.l3.score).padStart(6)}  ${gateLabel(layers.l3.pass, L3_THRESHOLD)}    ${layers.l3.notes}`,
  )
  lines.push('')
  lines.push(`   Overall  ${layers.overall.pass ? '[ PASS ]' : '[ FAIL ]'}`)
  lines.push('')
  // L4 is deliberately absent from `Overall` (see quality-layers.ts) — report it
  // as its own verdict so a hand-run report shows what batch-promote would say.
  lines.push(
    `   L4 API-truth verdict  [ ${gate.decision} ]  ${gate.reason}`,
    `      final=${fmtPct(layers.l4.finalAccuracy)}  period_cov=${fmtPct(layers.l4.periodCoverage)}  period_acc=${fmtPct(layers.l4.periodAccuracy)}` +
      `  periods_played=${layers.l4.periodsPlayed === null ? '\u2014' : String(layers.l4.periodsPlayed)}`,
  )
  // The per-period verdict is separate from the L4 verdict on purpose: L4 grades
  // the FINAL (which is what publishes), this grades the per-period rows (which
  // stay quarantined until reconciled). A REVIEW here never demotes the PASS.
  const recon = layers.l4.periodReconciliation
  lines.push(
    `   Per-period reconciliation  [ ${recon.status.toUpperCase()} ]  ${recon.reason}`,
    `      review_task=${recon.flag ? 'period_reconciliation' : 'none'}  auto-promote periods to reviewed=${recon.promotable ? 'YES' : 'no'}`,
  )
  if (recon.flag) {
    lines.push(`      → run: pnpm --filter worker reconcile-periods --match ${String(matchId)}`)
  }
  lines.push('')
  return lines.join('\n')
}

async function main(): Promise<void> {
  const matchStr = getFlag('match')
  const asJson = hasFlag('json')

  if (!matchStr) {
    console.log('Usage:')
    console.log('  pnpm --filter worker match-quality --match <id> [--json]')
    process.exitCode = 1
    return
  }

  const matchId = Number.parseInt(matchStr, 10)
  if (!Number.isFinite(matchId)) {
    console.error(`Invalid --match: ${matchStr}`)
    process.exitCode = 1
    return
  }

  const match = await getMatchById(matchId)
  if (!match) {
    console.error(`Match ${String(matchId)} not found.`)
    process.exitCode = 1
    return
  }

  const [screens, downstream, periods, provenance, pending] = await Promise.all([
    buildScreenTable(matchId),
    buildDownstreamCounts(matchId, match),
    buildPeriodBreakdown(matchId),
    getMatchLineupProvenance(matchId),
    buildPendingReview(matchId),
  ])
  const flags = await buildQualityFlags(matchId, match)
  const layers = await computeLayers(matchId, downstream, flags)

  // Task 4.G's L4 verdict, surfaced for ④'s `video-ingest batch-promote` pass,
  // which shells out to this CLI and reads `gate.decision` per promoted match.
  // `layers.l4` structurally satisfies gateFromL4's
  // Pick<L4Result, 'finalAccuracy' | 'gradable'>, so no extra plumbing is needed.
  //
  // ADVISORY, AND NECESSARILY POST-PROMOTION: promoteBoxScore already ran inside
  // the ingest-ocr transaction the moment the reel dispatched under this
  // match_id, so match_period_summaries rows exist before this is ever computed.
  // HOLD / OPERATOR_CONFIRM route a match to the review queue; they cannot undo
  // a promotion. The only gate that actually withholds anything is the operator
  // confirm that precedes dispatch.
  const gate = gateFromL4(layers.l4)

  if (asJson) {
    const out = {
      matchId,
      match: {
        playedAt: match.playedAt,
        opponentName: match.opponentName,
        result: match.result,
        scoreFor: match.scoreFor,
        scoreAgainst: match.scoreAgainst,
        bgmWasHome: match.bgmWasHome,
        bgmColorHex: match.bgmColorHex,
        oppColorHex: match.oppColorHex,
      },
      screens,
      downstream,
      periods,
      provenance,
      flags,
      pending,
      layers,
      gate,
    }
    console.log(JSON.stringify(out, null, 2))
  } else {
    console.log(
      renderHuman(
        matchId,
        match,
        screens,
        downstream,
        periods,
        provenance,
        flags,
        pending,
        layers,
        gate,
      ),
    )
  }
}

main()
  .catch((err: unknown) => {
    console.error('[match-quality] Fatal error:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void dbSql.end()
  })
