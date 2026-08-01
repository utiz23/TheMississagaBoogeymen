/**
 * Quality-report input builders extracted from match-quality-cli for shared
 * use with run-quality-cli (Phase 3 of the Run-Level Quality Reporting
 * workstream, plan `/home/michal/.claude/plans/ok-plan-this-run-level-nifty-comet.md`).
 *
 * Extracted with NO behavior change from the prior inline implementation in
 * `match-quality-cli.ts`. The regression-floor JSONs at
 * `docs/calibration/regression-floor-match-*.json` are the byte-identical
 * contract — `quality-layers.test.ts` deep-equals the resulting `layers` and
 * a manual `match-quality --json` diff against those fixtures catches any
 * drift in the downstream / flags inputs.
 *
 * 2026-07-31 — the ONE deliberate departure from that extraction: the three
 * event tables reported `reviewed = actual` unconditionally, so every match's
 * report claimed its events were fully reviewed even when all of them sat at
 * `pending_review`. Corrected to a real filter. This is display-only —
 * `computeLayers` scores L3 on `actual / expected` and never reads `reviewed`
 * (and weights `match_events` at 0), so no score, `overall.pass`, or L4 gate
 * moves. The 250/463 floors were re-stamped for the corrected counts only.
 */

import {
  db as defaultDb,
  matchEvents,
  matchGoalEvents,
  matchPenaltyEvents,
  matchPeriodSummaries,
  matchShotTypeSummaries,
  matchFaceoffDots,
  matchFaceoffZoneSummaries,
  playerMatchStats,
  playerLoadoutSnapshots,
  playerLoadoutAttributes,
  playerLoadoutXFactors,
} from '@eanhl/db'
import { getMatchById } from '@eanhl/db/queries'
import { and, eq, isNotNull, sql } from 'drizzle-orm'

import type { DbOrTx } from '../ocr-promoters/index.js'

export interface DownstreamRow {
  table: string
  actual: number
  expected: number | null
  reviewed: number
  notes: string
}

export interface QualityFlag {
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

export async function buildDownstreamCounts(
  matchId: number,
  match: NonNullable<Awaited<ReturnType<typeof getMatchById>>>,
  conn: DbOrTx = defaultDb,
): Promise<DownstreamRow[]> {
  const out: DownstreamRow[] = []

  const expectedEventsApprox =
    match.shotsFor + match.shotsAgainst + match.hitsFor + match.hitsAgainst + 30
  const [eventStats] = (await conn
    .select({
      n: sql<string>`COUNT(*)::text`,
      reviewedN: sql<string>`COUNT(*) FILTER (WHERE ${matchEvents.reviewStatus} = 'reviewed')::text`,
      plotted: sql<string>`COUNT(*) FILTER (WHERE ${matchEvents.x} IS NOT NULL)::text`,
    })
    .from(matchEvents)
    .where(eq(matchEvents.matchId, matchId))) as Array<{
    n: string
    reviewedN: string
    plotted: string
  }>
  out.push({
    table: 'match_events',
    actual: Number(eventStats!.n),
    expected: expectedEventsApprox,
    reviewed: Number(eventStats!.reviewedN),
    notes: `${eventStats!.plotted} have x,y coords`,
  })

  const expectedGoals = match.scoreFor + match.scoreAgainst
  // `match_goal_events` / `match_penalty_events` carry no `review_status` of
  // their own — they are detail rows hanging off `match_events`, so their
  // review state IS the parent event's. Filter on the joined parent.
  const [goalStats] = (await conn
    .select({
      n: sql<string>`COUNT(*)::text`,
      reviewedN: sql<string>`COUNT(*) FILTER (WHERE ${matchEvents.reviewStatus} = 'reviewed')::text`,
    })
    .from(matchGoalEvents)
    .innerJoin(matchEvents, eq(matchEvents.id, matchGoalEvents.eventId))
    .where(eq(matchEvents.matchId, matchId))) as Array<{ n: string; reviewedN: string }>
  out.push({
    table: 'match_goal_events',
    actual: Number(goalStats!.n),
    expected: expectedGoals,
    reviewed: Number(goalStats!.reviewedN),
    notes: `EA score ${match.scoreFor}-${match.scoreAgainst}`,
  })

  const expectedPenalty =
    (match.penaltyMinutes ?? 0) > 0 || (match.penaltyMinutesAgainst ?? 0) > 0 ? 1 : 0
  const [penaltyStats] = (await conn
    .select({
      n: sql<string>`COUNT(*)::text`,
      reviewedN: sql<string>`COUNT(*) FILTER (WHERE ${matchEvents.reviewStatus} = 'reviewed')::text`,
    })
    .from(matchPenaltyEvents)
    .innerJoin(matchEvents, eq(matchEvents.id, matchPenaltyEvents.eventId))
    .where(eq(matchEvents.matchId, matchId))) as Array<{ n: string; reviewedN: string }>
  out.push({
    table: 'match_penalty_events',
    actual: Number(penaltyStats!.n),
    expected: expectedPenalty,
    reviewed: Number(penaltyStats!.reviewedN),
    notes: `EA PIM for=${match.penaltyMinutes ?? 0} against=${match.penaltyMinutesAgainst ?? 0}`,
  })

  const expectedPeriods = match.result.startsWith('OT') || match.result === 'OTL' ? 4 : 3
  const [periodStats] = (await conn
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
  const [shotTypeStats] = (await conn
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

  const [dotStats] = (await conn
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

  const [zoneStats] = (await conn
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

  const [anchorStats] = (await conn
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

  const [attrStats] = (await conn
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

  const [xfStats] = (await conn
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

export async function buildQualityFlags(
  matchId: number,
  match: NonNullable<Awaited<ReturnType<typeof getMatchById>>>,
  conn: DbOrTx = defaultDb,
): Promise<QualityFlag[]> {
  const flags: QualityFlag[] = []

  const dupes = (await conn.execute(sql`
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

  const [unresolvedRow] = (await conn
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
  const collisions = (await conn.execute(sql`
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
  const [penEventsRow] = (await conn
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

  const [noActorRow] = (await conn
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
  // lineup. But "H. JENKINS" → "JoeyFlopfish" would, because JoeyFlopfish
  // didn't play this match — that's a stale match-250 alias leaking through.
  //
  // ⚠️ THE LINEUP AUTHORITY IS THE EA API (`player_match_stats`), NOT reviewed
  // loadout snapshots. Keying solely on `player_loadout_snapshots WHERE
  // review_status='reviewed'` made this check circular: those rows are
  // themselves quarantined at `pending_review`, so the subquery was EMPTY for
  // 97 of 101 matches, every resolution was trivially "not in the lineup", and
  // class G fired on 68 of them. Measured 2026-07-31: all 4,462 resolved
  // actor/target refs DB-wide ARE in their match's EA-API lineup — every one of
  // those 68 firings was a false positive, and the reported "stale alias leak"
  // did not exist. `player_match_stats` is always populated and is EA truth.
  //
  // The reviewed-loadout set stays UNIONed in, never as the sole source: it can
  // only ever accept a player the API omitted (dressed but recorded no stats),
  // so it removes false positives and can never introduce one.
  //
  // This DOES overturn a documented decision. `resolve-identity.ts` (~line 205)
  // notes that its own lineup gate is ALL snapshots while "the match-quality
  // CLI's class-G check uses the reviewed-only subset … Distinct gates, distinct
  // questions." The gate was deliberate; what it did not anticipate is that the
  // reviewed-only subset would go empty corpus-wide, at which point class G's
  // question stopped being answerable and it just re-measured the backlog.
  // Anchoring on EA truth keeps the question meaningful and independent of OCR:
  // a resolver slip to someone who genuinely did not play still fires. Note the
  // resolver's `empty_lineup_passthrough` cases are now validated against the
  // API rather than waved through, so coverage there is strictly better.
  const lineupAuthority = sql`
    SELECT pms.player_id
    FROM ${playerMatchStats} pms
    WHERE pms.match_id = ${matchId} AND pms.player_id IS NOT NULL
    UNION
    SELECT pls.player_id
    FROM ${playerLoadoutSnapshots} pls
    WHERE pls.match_id = ${matchId}
      AND pls.review_status = 'reviewed'
      AND pls.player_id IS NOT NULL
  `
  const offRosterResolutions = (await conn.execute(sql`
    SELECT e.target_gamertag_snapshot AS snap, p.gamertag AS resolved,
           p.id AS player_id, COUNT(*) AS n
    FROM ${matchEvents} e
    JOIN players p ON p.id = e.target_player_id
    WHERE e.match_id = ${matchId}
      AND p.id NOT IN (${lineupAuthority})
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
  const actorOffRoster = (await conn.execute(sql`
    SELECT e.actor_gamertag_snapshot AS snap, p.gamertag AS resolved,
           p.id AS player_id, COUNT(*) AS n
    FROM ${matchEvents} e
    JOIN players p ON p.id = e.actor_player_id
    WHERE e.match_id = ${matchId}
      AND p.id NOT IN (${lineupAuthority})
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
