/**
 * Match-quality report CLI. Grades a single match against the three quality
 * layers (classifier recall, OCR field accuracy, downstream completeness) and
 * surfaces the specific failure classes the manual page-review process catches.
 *
 * Usage:
 *   pnpm --filter worker match-quality --match 463
 *   pnpm --filter worker match-quality --match 463 --json
 */

import {
  db,
  sql as dbSql,
  ocrExtractions,
  matchEvents,
  matchPeriodSummaries,
  matchShotTypeSummaries,
  matchFaceoffDots,
  matchFaceoffZoneSummaries,
  matchGoalEvents,
  matchPenaltyEvents,
  playerLoadoutSnapshots,
  playerLoadoutAttributes,
  playerLoadoutXFactors,
  players,
} from '@eanhl/db'
import { getMatchById, getMatchLineupProvenance } from '@eanhl/db/queries'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import {
  L1_THRESHOLD,
  L2_THRESHOLD,
  L3_THRESHOLD,
  computeLayers,
  type LayerScores,
} from './lib/quality-layers.js'

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

interface DownstreamRow {
  table: string
  actual: number
  expected: number | null
  reviewed: number
  notes: string
}

async function buildDownstreamCounts(
  matchId: number,
  match: NonNullable<Awaited<ReturnType<typeof getMatchById>>>,
): Promise<DownstreamRow[]> {
  const out: DownstreamRow[] = []

  const expectedEventsApprox =
    match.shotsFor + match.shotsAgainst + match.hitsFor + match.hitsAgainst + 30
  const [eventStats] = (await db
    .select({
      n: sql<string>`COUNT(*)::text`,
      plotted: sql<string>`COUNT(*) FILTER (WHERE ${matchEvents.x} IS NOT NULL)::text`,
    })
    .from(matchEvents)
    .where(eq(matchEvents.matchId, matchId))) as Array<{ n: string; plotted: string }>
  out.push({
    table: 'match_events',
    actual: Number(eventStats!.n),
    expected: expectedEventsApprox,
    reviewed: Number(eventStats!.n),
    notes: `${eventStats!.plotted} have x,y coords`,
  })

  const expectedGoals = match.scoreFor + match.scoreAgainst
  const [goalStats] = (await db
    .select({ n: sql<string>`COUNT(*)::text` })
    .from(matchGoalEvents)
    .innerJoin(matchEvents, eq(matchEvents.id, matchGoalEvents.eventId))
    .where(eq(matchEvents.matchId, matchId))) as Array<{ n: string }>
  out.push({
    table: 'match_goal_events',
    actual: Number(goalStats!.n),
    expected: expectedGoals,
    reviewed: Number(goalStats!.n),
    notes: `EA score ${match.scoreFor}-${match.scoreAgainst}`,
  })

  const expectedPenalty =
    (match.penaltyMinutes ?? 0) > 0 || (match.penaltyMinutesAgainst ?? 0) > 0 ? 1 : 0
  const [penaltyStats] = (await db
    .select({ n: sql<string>`COUNT(*)::text` })
    .from(matchPenaltyEvents)
    .innerJoin(matchEvents, eq(matchEvents.id, matchPenaltyEvents.eventId))
    .where(eq(matchEvents.matchId, matchId))) as Array<{ n: string }>
  out.push({
    table: 'match_penalty_events',
    actual: Number(penaltyStats!.n),
    expected: expectedPenalty,
    reviewed: Number(penaltyStats!.n),
    notes: `EA PIM for=${match.penaltyMinutes ?? 0} against=${match.penaltyMinutesAgainst ?? 0}`,
  })

  const expectedPeriods = match.result.startsWith('OT') || match.result === 'OTL' ? 4 : 3
  const [periodStats] = (await db
    .select({
      n: sql<string>`COUNT(*)::text`,
      reviewedN: sql<string>`COUNT(*) FILTER (WHERE ${matchPeriodSummaries.reviewStatus} = 'reviewed')::text`,
    })
    .from(matchPeriodSummaries)
    .where(eq(matchPeriodSummaries.matchId, matchId))) as Array<{ n: string; reviewedN: string }>
  out.push({
    table: 'match_period_summaries',
    actual: Number(periodStats!.n),
    expected: expectedPeriods,
    reviewed: Number(periodStats!.reviewedN),
    notes: `result=${match.result}`,
  })

  const expectedShotTypes = 2 * expectedPeriods + 2
  const [shotTypeStats] = (await db
    .select({
      n: sql<string>`COUNT(*)::text`,
      reviewedN: sql<string>`COUNT(*) FILTER (WHERE ${matchShotTypeSummaries.reviewStatus} = 'reviewed')::text`,
    })
    .from(matchShotTypeSummaries)
    .where(eq(matchShotTypeSummaries.matchId, matchId))) as Array<{
    n: string
    reviewedN: string
  }>
  out.push({
    table: 'match_shot_type_summaries',
    actual: Number(shotTypeStats!.n),
    expected: expectedShotTypes,
    reviewed: Number(shotTypeStats!.reviewedN),
    notes: 'per-period BGM+opp + match totals',
  })

  const [dotStats] = (await db
    .select({
      n: sql<string>`COUNT(*)::text`,
      reviewedN: sql<string>`COUNT(*) FILTER (WHERE ${matchFaceoffDots.reviewStatus} = 'reviewed')::text`,
    })
    .from(matchFaceoffDots)
    .where(eq(matchFaceoffDots.matchId, matchId))) as Array<{ n: string; reviewedN: string }>
  out.push({
    table: 'match_faceoff_dots',
    actual: Number(dotStats!.n),
    expected: 9,
    reviewed: Number(dotStats!.reviewedN),
    notes: 'one per zone',
  })

  const [zoneStats] = (await db
    .select({
      n: sql<string>`COUNT(*)::text`,
      reviewedN: sql<string>`COUNT(*) FILTER (WHERE ${matchFaceoffZoneSummaries.reviewStatus} = 'reviewed')::text`,
    })
    .from(matchFaceoffZoneSummaries)
    .where(eq(matchFaceoffZoneSummaries.matchId, matchId))) as Array<{
    n: string
    reviewedN: string
  }>
  out.push({
    table: 'match_faceoff_zone_summaries',
    actual: Number(zoneStats!.n),
    expected: 3,
    reviewed: Number(zoneStats!.reviewedN),
    notes: 'one per neutral/o-zone/d-zone',
  })

  const [anchorStats] = (await db
    .select({ n: sql<string>`COUNT(*)::text` })
    .from(playerLoadoutSnapshots)
    .where(
      and(
        eq(playerLoadoutSnapshots.matchId, matchId),
        eq(playerLoadoutSnapshots.reviewStatus, 'reviewed'),
        eq(playerLoadoutSnapshots.isCpu, false),
      ),
    )) as Array<{ n: string }>
  const reviewedAnchors = Number(anchorStats!.n)
  out.push({
    table: 'player_loadout_snapshots (reviewed)',
    actual: reviewedAnchors,
    expected: 10,
    reviewed: reviewedAnchors,
    notes: 'consolidator anchors',
  })

  const [attrStats] = (await db
    .select({ n: sql<string>`COUNT(*)::text` })
    .from(playerLoadoutAttributes)
    .innerJoin(
      playerLoadoutSnapshots,
      eq(playerLoadoutSnapshots.id, playerLoadoutAttributes.loadoutSnapshotId),
    )
    .where(
      and(
        eq(playerLoadoutSnapshots.matchId, matchId),
        eq(playerLoadoutSnapshots.reviewStatus, 'reviewed'),
        eq(playerLoadoutSnapshots.isCpu, false),
      ),
    )) as Array<{ n: string }>
  out.push({
    table: 'player_loadout_attributes',
    actual: Number(attrStats!.n),
    expected: 23 * reviewedAnchors,
    reviewed: Number(attrStats!.n),
    notes: '23 attrs × reviewed slots',
  })

  const [xfStats] = (await db
    .select({ n: sql<string>`COUNT(*)::text` })
    .from(playerLoadoutXFactors)
    .innerJoin(
      playerLoadoutSnapshots,
      eq(playerLoadoutSnapshots.id, playerLoadoutXFactors.loadoutSnapshotId),
    )
    .where(
      and(
        eq(playerLoadoutSnapshots.matchId, matchId),
        eq(playerLoadoutSnapshots.reviewStatus, 'reviewed'),
        eq(playerLoadoutSnapshots.isCpu, false),
      ),
    )) as Array<{ n: string }>
  out.push({
    table: 'player_loadout_x_factors',
    actual: Number(xfStats!.n),
    expected: 3 * reviewedAnchors,
    reviewed: Number(xfStats!.n),
    notes: '3 x-factors × reviewed slots',
  })

  return out
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

interface QualityFlag {
  classId: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
  severity: 'fail' | 'warn'
  message: string
  evidence?: string
}

interface DupeRow {
  period_number: number
  clock: string
  event_type: string
  n: number
}

async function buildQualityFlags(
  matchId: number,
  match: NonNullable<Awaited<ReturnType<typeof getMatchById>>>,
): Promise<QualityFlag[]> {
  const flags: QualityFlag[] = []

  const dupes = (await db.execute(sql`
    SELECT period_number, clock, event_type, COUNT(*) AS n
    FROM ${matchEvents}
    WHERE match_id = ${matchId} AND clock IS NOT NULL
    GROUP BY period_number, clock, event_type
    HAVING COUNT(*) > 1
    ORDER BY period_number, clock
  `)) as unknown as DupeRow[]
  if (dupes.length > 0) {
    const total = dupes.reduce((acc, d) => acc + (Number(d.n) - 1), 0)
    flags.push({
      classId: 'A',
      severity: total > 5 ? 'fail' : 'warn',
      message: `${total} duplicate event(s) across ${dupes.length} (period, clock, type) bucket(s) — OCR-variant dedup failure`,
      evidence: dupes
        .slice(0, 5)
        .map((d) => `P${d.period_number} ${d.clock} ${d.event_type} ×${d.n}`)
        .join(', '),
    })
  }

  const [unresolvedRow] = (await db
    .select({ n: sql<string>`COUNT(*)::text` })
    .from(matchEvents)
    .where(
      and(
        eq(matchEvents.matchId, matchId),
        eq(matchEvents.teamSide, 'for'),
        isNotNull(matchEvents.actorGamertagSnapshot),
        sql`${matchEvents.actorPlayerId} IS NULL`,
      ),
    )) as Array<{ n: string }>
  const unresolvedBgm = Number(unresolvedRow!.n)
  if (unresolvedBgm > 0) {
    flags.push({
      classId: 'B',
      severity: unresolvedBgm > 5 ? 'fail' : 'warn',
      message: `${unresolvedBgm} BGM-side event(s) have actor_gamertag_snapshot but no actor_player_id — alias resolver missed`,
    })
  }

  // Class C — events within 1.0 hockey unit of each other within the same
  // period. Exact (x,y) equality misses cases where the chevron jittered by
  // a fraction of a unit between captures but the matcher still chose the
  // same cluster (off-by-0.01 instead of off-by-zero). A 1.0-unit gate
  // catches "same chevron" collisions while staying loose enough that two
  // legitimately-distinct close-by events aren't false-flagged.
  const collisions = (await db.execute(sql`
    SELECT a.period_number,
           a.id AS a_id, a.clock AS a_clock, a.event_type AS a_type,
           a.actor_gamertag_snapshot AS a_actor, a.x AS a_x, a.y AS a_y,
           b.id AS b_id, b.clock AS b_clock, b.event_type AS b_type,
           b.actor_gamertag_snapshot AS b_actor
    FROM ${matchEvents} a
    JOIN ${matchEvents} b ON
         a.match_id = b.match_id
     AND a.period_number = b.period_number
     AND a.id < b.id
     AND a.x IS NOT NULL AND b.x IS NOT NULL
     AND ABS((a.x::numeric) - (b.x::numeric)) <= 1.0
     AND ABS((a.y::numeric) - (b.y::numeric)) <= 1.0
    WHERE a.match_id = ${matchId}
    ORDER BY a.period_number, a.id
    LIMIT 25
  `)) as unknown as Array<{
    period_number: number
    a_id: number
    a_clock: string
    a_type: string
    a_actor: string
    a_x: string
    a_y: string
    b_id: number
    b_clock: string
    b_type: string
    b_actor: string
  }>
  if (collisions.length > 0) {
    flags.push({
      classId: 'C',
      severity: collisions.length > 3 ? 'fail' : 'warn',
      message: `${collisions.length} event pair(s) share marker (x,y) within 1.0 hockey unit — chevron extractor collisions / cluster-radius too coarse`,
      evidence: collisions
        .slice(0, 5)
        .map(
          (c) =>
            `P${c.period_number} ${c.a_type}@${c.a_clock} (${c.a_actor}) ≈ ${c.b_type}@${c.b_clock} (${c.b_actor}) @(${c.a_x},${c.a_y})`,
        )
        .join('; '),
    })
  }

  const eaPimTotal = (match.penaltyMinutes ?? 0) + (match.penaltyMinutesAgainst ?? 0)
  const [penEventsRow] = (await db
    .select({ n: sql<string>`COUNT(*)::text` })
    .from(matchEvents)
    .where(and(eq(matchEvents.matchId, matchId), eq(matchEvents.eventType, 'penalty')))) as Array<{
    n: string
  }>
  if (eaPimTotal > 0 && Number(penEventsRow!.n) === 0) {
    flags.push({
      classId: 'D',
      severity: 'fail',
      message: `EA payload reports ${eaPimTotal} total PIM but match_events has 0 penalty rows — post_game_events penalty parser failed`,
    })
  }

  const [noActorRow] = (await db
    .select({ n: sql<string>`COUNT(*)::text` })
    .from(matchEvents)
    .where(
      and(
        eq(matchEvents.matchId, matchId),
        sql`${matchEvents.actorGamertagSnapshot} IS NULL`,
        sql`${matchEvents.eventType} != 'faceoff'`,
      ),
    )) as Array<{ n: string }>
  if (Number(noActorRow!.n) > 0) {
    flags.push({
      classId: 'B',
      severity: 'warn',
      message: `${noActorRow!.n} non-faceoff event(s) have no actor at all — OCR failed to read the actor column`,
    })
  }

  // Class G — actor/target resolved to a player NOT in this match's lineup.
  // The legitimate persona→gamertag mapping (e.g. "M. RANTANEN" → "Stick
  // Menace") doesn't trigger this because Stick Menace IS in match 463's
  // lineup. But "H. JENKINS" → "JoeyFlopfish" does, because JoeyFlopfish
  // didn't play this match — that's a stale match-250 alias leaking through.
  const offRosterResolutions = (await db.execute(sql`
    SELECT e.target_gamertag_snapshot AS snap, p.gamertag AS resolved,
           p.id AS player_id, COUNT(*) AS n
    FROM ${matchEvents} e
    JOIN players p ON p.id = e.target_player_id
    WHERE e.match_id = ${matchId}
      AND p.id NOT IN (
        SELECT DISTINCT player_id
        FROM ${playerLoadoutSnapshots}
        WHERE match_id = ${matchId}
          AND review_status = 'reviewed'
          AND player_id IS NOT NULL
      )
    GROUP BY e.target_gamertag_snapshot, p.gamertag, p.id
    ORDER BY n DESC
    LIMIT 10
  `)) as unknown as Array<{ snap: string; resolved: string; player_id: number; n: number }>
  if (offRosterResolutions.length > 0) {
    const total = offRosterResolutions.reduce((acc, r) => acc + Number(r.n), 0)
    flags.push({
      classId: 'G',
      severity: 'fail',
      message: `${total} event(s) where target_player_id resolves to a player NOT in this match's lineup — stale alias leak`,
      evidence: offRosterResolutions
        .slice(0, 5)
        .map((r) => `"${r.snap}" → "${r.resolved}" (id=${r.player_id}) ×${r.n}`)
        .join(', '),
    })
  }

  // Same check on actor side
  const actorOffRoster = (await db.execute(sql`
    SELECT e.actor_gamertag_snapshot AS snap, p.gamertag AS resolved,
           p.id AS player_id, COUNT(*) AS n
    FROM ${matchEvents} e
    JOIN players p ON p.id = e.actor_player_id
    WHERE e.match_id = ${matchId}
      AND p.id NOT IN (
        SELECT DISTINCT player_id
        FROM ${playerLoadoutSnapshots}
        WHERE match_id = ${matchId}
          AND review_status = 'reviewed'
          AND player_id IS NOT NULL
      )
    GROUP BY e.actor_gamertag_snapshot, p.gamertag, p.id
    ORDER BY n DESC
    LIMIT 10
  `)) as unknown as Array<{ snap: string; resolved: string; player_id: number; n: number }>
  if (actorOffRoster.length > 0) {
    const total = actorOffRoster.reduce((acc, r) => acc + Number(r.n), 0)
    flags.push({
      classId: 'G',
      severity: 'fail',
      message: `${total} event(s) where actor_player_id resolves to a player NOT in this match's lineup — stale alias leak`,
      evidence: actorOffRoster
        .slice(0, 5)
        .map((r) => `"${r.snap}" → "${r.resolved}" (id=${r.player_id}) ×${r.n}`)
        .join(', '),
    })
  }

  return flags
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
    }
    console.log(JSON.stringify(out, null, 2))
  } else {
    console.log(
      renderHuman(matchId, match, screens, downstream, periods, provenance, flags, pending, layers),
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
