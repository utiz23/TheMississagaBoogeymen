import type { Metadata } from 'next'
import type { GameMode, GameTitle } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  getEARoster,
  getSkaterStats,
  getGoalieStats,
  getEASkaterStats,
  getEAGoalieStats,
  getAllTimeSkaterStats,
  getAllTimeGoalieStats,
  getPlayerPositionEligibility,
  getOfficialClubRecord,
  getAllTimeTeamRecord,
  getAllTimeRosterLedger,
  getClubMemberSkaterStats,
  getClubMemberGoalieStats,
  getClubMemberSkaterStatsAllModes,
  getClubMemberGoalieStatsAllModes,
  getRecentMatches,
  getPlayerGameLog,
  getPlayersStatsMeta,
} from '@eanhl/db/queries'
import { DepthChart } from '@/components/roster/depth-chart'
import { RosterLedger } from '@/components/roster/roster-ledger'
import { Panel } from '@/components/ui/panel'
import type { DepthChartProps, DepthSlot } from '@/components/roster/depth-chart'
import { SkaterStatsTable } from '@/components/stats/skater-stats-table'
import { GoalieStatsTable } from '@/components/stats/goalie-stats-table'
import {
  TitleSelector,
  ModeFilter,
  EmptyState,
  statsSourceLabel,
} from '@/components/title-selector'
import { resolveTitleFromSlug } from '@/lib/title-resolver'

export const metadata: Metadata = { title: 'Roster — Club Stats' }

export const revalidate = 300

type SearchParams = Promise<Record<string, string | string[] | undefined>>

type RosterRow = Awaited<ReturnType<typeof getEARoster>>[number]
type EligRow = Awaited<ReturnType<typeof getPlayerPositionEligibility>>[number]

function parseGameMode(raw: string | string[] | undefined): GameMode | null {
  if (typeof raw !== 'string') return null
  return (GAME_MODE as readonly string[]).includes(raw) ? (raw as GameMode) : null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FORWARD_POSITIONS = ['leftWing', 'center', 'rightWing'] as const
type ForwardPos = (typeof FORWARD_POSITIONS)[number]

// ─── Member stats ─────────────────────────────────────────────────────────────
//
// Primary forward/defense signal: local player_match_stats lane counts.
// Primary goalie signal: EA goalieGp (team members rarely play goalie in tracked games).
// Chart input: eaRows only (no guests — guests appear in eligRows but are filtered out).
//
// Role tiers drive allocation priority:
//   isDefensePrimary — defGames > totalFwdGames: player skews toward blue line.
//     Gets a -1000 penalty in forward scoring so they don't block early forward lines.
//   isGoaliePrimary — EA favoritePosition='goalie' or goalieGp > skaterGp: player is
//     primarily a goalie. Gets -2000 penalty in forward AND defense scoring.

interface MemberData {
  eaRow: RosterRow
  lwGames: number
  cGames: number
  rwGames: number
  defGames: number
  totalFwdGames: number
  isForwardCapable: boolean
  isDefenseCapable: boolean
  isGoalieCapable: boolean
  isDefensePrimary: boolean
  isGoaliePrimary: boolean
}

function buildMemberStats(eaRows: RosterRow[], eligRows: EligRow[]): MemberData[] {
  const memberIds = new Set(eaRows.map((r) => r.playerId))
  const usage = new Map<number, Map<string, number>>()
  for (const row of eligRows) {
    if (!row.position || !memberIds.has(row.playerId)) continue
    let m = usage.get(row.playerId)
    if (!m) {
      m = new Map()
      usage.set(row.playerId, m)
    }
    m.set(row.position, row.gameCount)
  }

  return eaRows.map((ea) => {
    const u = usage.get(ea.playerId)
    const lwGames = u?.get('leftWing') ?? 0
    const cGames = u?.get('center') ?? 0
    const rwGames = u?.get('rightWing') ?? 0
    const defGames = u?.get('defenseMen') ?? 0
    const totalFwdGames = lwGames + cGames + rwGames
    return {
      eaRow: ea,
      lwGames,
      cGames,
      rwGames,
      defGames,
      totalFwdGames,
      isForwardCapable: totalFwdGames > 0,
      isDefenseCapable: defGames > 0,
      isGoalieCapable: ea.goalieGp > 0,
      isDefensePrimary: defGames > totalFwdGames,
      isGoaliePrimary: ea.favoritePosition === 'goalie' || ea.goalieGp > ea.skaterGp,
    }
  })
}

// ─── Role classification ──────────────────────────────────────────────────────
//
// Determines each member's line-order priority within the Phase 1 unique forward pass.
// All 10 members still appear exactly once; role class shifts WHICH LINE they land in.
//
//   forward-first  — no D capability: fills lines 1–2
//   hybrid-skater  — has real D usage alongside forward: lines 2–3
//   defense-first  — defGames > totalFwdGames: lines 3–4
//   goalie-primary — EA favoritePosition='goalie' or goalieGp>skaterGp: line 4

type RoleClass = 'forward-first' | 'hybrid-skater' | 'defense-first' | 'goalie-primary'

function classifyRole(m: MemberData): RoleClass {
  if (m.isGoaliePrimary) return 'goalie-primary'
  if (m.isDefensePrimary) return 'defense-first'
  if (m.isDefenseCapable) return 'hybrid-skater'
  return 'forward-first'
}

const FWD_ROLE_PENALTY: Record<RoleClass, number> = {
  'forward-first': 0,
  'hybrid-skater': -200,
  'defense-first': -500,
  'goalie-primary': -1000,
}

// ─── Score functions ──────────────────────────────────────────────────────────
//
// laneFitScore: local lane affinity + EA favoritePosition lane bonus.
//   EA_FWD_LANE_BONUS (+600): authoritative override of sparse local sampling.
//   Bonus applies only when EA favoritePosition matches a forward lane (LW/C/RW).
//   Magnitude 600 corrects up to ~5 games of local bias; 7+ local games in the
//   "wrong" lane still override the EA signal (local data is that strong).
//
// fwdPhase1Score: laneFitScore + FWD_ROLE_PENALTY — used in Phase 1 unique pass.
//   Does NOT have a score threshold; all members get placed, just in order of class.
//
// fwdEffectiveScore: laneFitScore + defense-primary/goalie-primary penalty — used
//   for Phase 2 reuse picks (prefers pure forwards for the 2 remaining slots).
//
// defEffectiveScore: D-games ordering with goalie-primary last.

const EA_FWD_LANE_BONUS = 600

function laneFitScore(m: MemberData, lane: ForwardPos): number {
  const gamesInLane = lane === 'leftWing' ? m.lwGames : lane === 'center' ? m.cGames : m.rwGames

  const sorted = (
    [
      ['leftWing', m.lwGames],
      ['center', m.cGames],
      ['rightWing', m.rwGames],
    ] as [ForwardPos, number][]
  ).sort((a, b) => b[1] - a[1])

  const bestLane = sorted[0]?.[0] ?? 'center'
  const secondLane = sorted[1]?.[0] ?? bestLane

  let score = gamesInLane * 100
  if (lane === bestLane) score += 30
  else if (lane === secondLane) score += 10
  if (lane === 'center') score += 5

  // EA favoritePosition — authoritative forward lane identity.
  // Overrides sampling artifacts in sparse local tracking data.
  const fp = m.eaRow.favoritePosition
  if (
    (fp === 'leftWing' && lane === 'leftWing') ||
    (fp === 'center' && lane === 'center') ||
    (fp === 'rightWing' && lane === 'rightWing')
  ) {
    score += EA_FWD_LANE_BONUS
  }

  return score
}

function fwdPhase1Score(m: MemberData, lane: ForwardPos): number {
  return laneFitScore(m, lane) + FWD_ROLE_PENALTY[classifyRole(m)]
}

function fwdEffectiveScore(m: MemberData, lane: ForwardPos): number {
  let score = laneFitScore(m, lane)
  if (m.isGoaliePrimary) score -= 2000
  else if (m.isDefensePrimary) score -= 1000
  return score
}

function defEffectiveScore(m: MemberData): number {
  let score = m.defGames * 100 + 10
  if (m.isGoaliePrimary) score -= 2000
  return score
}

// ─── Slot picker ──────────────────────────────────────────────────────────────

/** Return the first element of `arr` after sorting by `cmp` (descending logic
 *  is implied by passing `(a, b) => b.x - a.x`). Skips the actual sort by
 *  scanning once. */
function pickFirst<T>(arr: T[], cmp: (a: T, b: T) => number): T | null {
  let best: T | null = null
  for (const item of arr) {
    if (best === null || cmp(item, best) < 0) best = item
  }
  return best
}

function pickBest(
  pool: MemberData[],
  excluded: Set<number>,
  scoreFn: (m: MemberData) => number,
  minScore = -Infinity,
): MemberData | null {
  let bestScore = minScore
  let best: MemberData | null = null
  for (const m of pool) {
    if (excluded.has(m.eaRow.playerId)) continue
    const s = scoreFn(m)
    if (
      s > bestScore ||
      (s === bestScore && best !== null && m.eaRow.skaterGp > best.eaRow.skaterGp)
    ) {
      bestScore = s
      best = m
    }
  }
  return best
}

// ─── Chart builder ────────────────────────────────────────────────────────────
//
// Forward (12 slots = 4 lines × 3 lanes):
//   Phase 1 — all-member unique pass: every member placed exactly once.
//     Row-by-row, fwdPhase1Score = laneFitScore (EA favPos bonus included) + role penalty.
//     EA favoritePosition (+600) corrects lane identity when sparse local data skews the
//     distribution (e.g. Silky with more local LW than C games despite EA=center).
//     Role penalty steers hybrids/D-first/goalie-primary to later lines without excluding
//     them — all 10 members appear, just in priority order.
//   Phase 2 — 2-slot controlled reuse: fills the 2 remaining empty slots.
//     fwdEffectiveScore (defense-primary/goalie-primary penalties) keeps reuse picks
//     preferring pure forwards. fwdReused prevents same member across multiple slots.
//
// Defense (6 slots = 3 pairs × LD/RD):
//   Phase 1 — D-capable unique pass, ordered by defEffectiveScore (D games desc).
//   Phase 2 — reuse/fallback, same ordering, goalie-primary land last.
//
// Goalies (5 slots): all members with EA goalieGp > 0, sorted by goalieGp desc.

function buildChart(eaRows: RosterRow[], eligRows: EligRow[]): DepthChartProps {
  const members = buildMemberStats(eaRows, eligRows)
  const memberById = new Map(members.map((m) => [m.eaRow.playerId, m]))

  // Goalies — independent of skater chart. No empty padding — render only real goalies.
  const goalieSlots: (RosterRow | null)[] = members
    .filter((m) => m.isGoalieCapable)
    .sort((a, b) => b.eaRow.goalieGp - a.eaRow.goalieGp)
    .map((m) => m.eaRow)
    .slice(0, 5)

  // ── Forwards ──────────────────────────────────────────────────────────────
  const fwdSlots: Record<ForwardPos, (RosterRow | null)[]> = {
    leftWing: [],
    center: [],
    rightWing: [],
  }
  const fwdPlaced = new Set<number>()

  // Phase 1: unique forward pass — every member placed exactly once.
  // fwdPhase1Score = laneFitScore (with EA favPos bonus) + FWD_ROLE_PENALTY.
  // forward-first members fill early lines; hybrids/D-first/goalie-primary fall
  // to later lines. No score threshold — all members still get placed.
  for (let line = 0; line < 4; line++) {
    for (const lane of FORWARD_POSITIONS) {
      if (fwdSlots[lane].length >= 4) continue
      const best = pickBest(members, fwdPlaced, (m) => fwdPhase1Score(m, lane))
      if (best !== null) {
        fwdSlots[lane].push(best.eaRow)
        fwdPlaced.add(best.eaRow.playerId)
      }
    }
  }

  // Phase 2: controlled reuse — fills remaining empty slots (≤2 for 10 members).
  // Tier penalties in fwdEffectiveScore keep pure forwards preferred for reuse.
  // fwdReused prevents the same member filling multiple reuse slots.
  const fwdReused = new Set<number>()
  for (const lane of FORWARD_POSITIONS) {
    while (fwdSlots[lane].length < 4) {
      const best = pickBest(members, fwdReused, (m) => fwdEffectiveScore(m, lane))
      if (best === null) {
        fwdSlots[lane].push(null)
        break
      }
      fwdSlots[lane].push(best.eaRow)
      fwdReused.add(best.eaRow.playerId)
    }
    while (fwdSlots[lane].length < 4) fwdSlots[lane].push(null)
  }

  // Forward-slot depth: role doesn't fit forward (defense-primary or goalie-
  // primary) OR the player has already taken an earlier forward slot.
  const seenInForwards = new Set<number>()
  const fwdToSlot = (player: RosterRow | null): DepthSlot | null => {
    if (player === null) return null
    const m = memberById.get(player.playerId)
    const reused = seenInForwards.has(player.playerId)
    seenInForwards.add(player.playerId)
    const roleMismatch = m ? m.isDefensePrimary || m.isGoaliePrimary : false
    return { player, isDepth: reused || roleMismatch }
  }

  // Slot order in the rendered chart: line-by-line, LW→C→RW.
  const forwards = Array.from({ length: 4 }, (_, i) => ({
    lw: fwdToSlot(fwdSlots.leftWing[i] ?? null),
    c: fwdToSlot(fwdSlots.center[i] ?? null),
    rw: fwdToSlot(fwdSlots.rightWing[i] ?? null),
  }))

  // ── Defense ───────────────────────────────────────────────────────────────
  // Ordered strictly by D games played (defEffectiveScore = defGames*100+10,
  // goalie-primary penalized -2000 so they land last).
  const defSlots: (RosterRow | null)[] = []
  const defPlaced = new Set<number>()

  const defCapable = members
    .filter((m) => m.isDefenseCapable)
    .sort((a, b) => defEffectiveScore(b) - defEffectiveScore(a))

  for (const m of defCapable) {
    if (defSlots.length >= 6) break
    defSlots.push(m.eaRow)
    defPlaced.add(m.eaRow.playerId)
  }

  if (defSlots.length < 6) {
    const defReuse = members
      .filter((m) => !defPlaced.has(m.eaRow.playerId))
      .sort((a, b) => defEffectiveScore(b) - defEffectiveScore(a))
    for (const m of defReuse) {
      if (defSlots.length >= 6) break
      defSlots.push(m.eaRow)
    }
  }

  while (defSlots.length < 6) defSlots.push(null)

  // Defense-slot depth: role isn't defense-primary OR already placed in defense.
  const seenInDefense = new Set<number>()
  const defToSlot = (player: RosterRow | null): DepthSlot | null => {
    if (player === null) return null
    const m = memberById.get(player.playerId)
    const reused = seenInDefense.has(player.playerId)
    seenInDefense.add(player.playerId)
    const roleMismatch = m ? !m.isDefensePrimary : true
    return { player, isDepth: reused || roleMismatch }
  }

  const defense = Array.from({ length: 3 }, (_, i) => ({
    ld: defToSlot(defSlots[i * 2] ?? null),
    rd: defToSlot(defSlots[i * 2 + 1] ?? null),
  }))

  // Goalie-slot depth: role isn't goalie-primary (skaters playing goalie).
  const goalies = goalieSlots.map((player): DepthSlot | null => {
    if (player === null) return null
    const m = memberById.get(player.playerId)
    return { player, isDepth: !(m?.isGoaliePrimary ?? false) }
  })

  return { forwards, defense, goalies }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function RosterPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
  const requestedMode = parseGameMode(params.mode)

  const result = await resolveTitleFromSlug(titleSlug)
  if (result.kind === 'invalid') {
    const nextParams = new URLSearchParams()
    if (typeof params.mode === 'string') nextParams.set('mode', params.mode)
    redirect(nextParams.size > 0 ? `/roster?${nextParams.toString()}` : '/roster')
  }
  if (result.kind === 'empty') {
    return <EmptyState message="No game titles are configured yet." />
  }

  const { gameTitle, isActive, allTitles } = result.resolved

  if (isActive) {
    return <ActiveRoster allTitles={allTitles} gameTitle={gameTitle} gameMode={requestedMode} />
  }
  return <ArchiveRoster allTitles={allTitles} gameTitle={gameTitle} gameMode={requestedMode} />
}

// ─── Active-title view (live data, depth chart + season summary) ─────────────

async function ActiveRoster({
  allTitles,
  gameTitle,
  gameMode,
}: {
  allTitles: GameTitle[]
  gameTitle: GameTitle
  gameMode: GameMode | null
}) {
  const subtitle = statsSourceLabel({ isActive: true, gameMode })

  // Non-critical — page renders without it if the worker hasn't fetched it yet
  let officialRecord: Awaited<ReturnType<typeof getOfficialClubRecord>> = null
  try {
    officialRecord = await getOfficialClubRecord(gameTitle.id)
  } catch {
    // intentionally swallowed
  }

  let eaRows: RosterRow[] = []
  let skaterRows: Awaited<ReturnType<typeof getEASkaterStats>> = []
  let goalieRows: Awaited<ReturnType<typeof getEAGoalieStats>> = []
  let eligibilityRows: EligRow[] = []

  try {
    const [ea, skaters, goalies, elig] = await Promise.all([
      getEARoster(gameTitle.id),
      gameMode === null ? getEASkaterStats(gameTitle.id) : getSkaterStats(gameTitle.id, gameMode),
      gameMode === null ? getEAGoalieStats(gameTitle.id) : getGoalieStats(gameTitle.id, gameMode),
      getPlayerPositionEligibility(gameTitle.id),
    ])
    eaRows = ea
    skaterRows = skaters
    goalieRows = goalies
    eligibilityRows = elig
  } catch {
    return (
      <PageShell gameTitle={gameTitle}>
        <EmptyState message="Unable to load roster data right now." />
      </PageShell>
    )
  }

  if (eaRows.length === 0) {
    return (
      <PageShell gameTitle={gameTitle}>
        <EmptyState message={`No player stats recorded for ${gameTitle.name} yet.`} />
      </PageShell>
    )
  }

  const chart = buildChart(eaRows, eligibilityRows)

  const totalGp = eaRows.reduce(
    (acc, r) => Math.max(acc, r.skaterGp + r.goalieGp),
    0,
  )
  const scopeLabel =
    `SEASON · ${gameTitle.name.toUpperCase()}` +
    (totalGp > 0 ? ` · ${String(totalGp)} GP` : '')

  // ─── All-Time data + sparklines ────────────────────────────────────────────

  let allTimeRows: Awaited<ReturnType<typeof getAllTimeRosterLedger>> = []
  let allTimeRecord: Awaited<ReturnType<typeof getAllTimeTeamRecord>> | null = null
  let recentMatches: Awaited<ReturnType<typeof getRecentMatches>> = []
  let allTimeSkaterRows: Awaited<ReturnType<typeof getAllTimeSkaterStats>> = []
  let allTimeGoalieRows: Awaited<ReturnType<typeof getAllTimeGoalieStats>> = []
  try {
    ;[allTimeRows, allTimeRecord, recentMatches, allTimeSkaterRows, allTimeGoalieRows] =
      await Promise.all([
        getAllTimeRosterLedger(),
        getAllTimeTeamRecord(),
        getRecentMatches({ gameTitleId: gameTitle.id, limit: 14 }),
        getAllTimeSkaterStats(),
        getAllTimeGoalieStats(),
      ])
  } catch {
    // soft-fail: All-Time tab will simply remain disabled.
  }

  const allTimeScopeLabel = allTimeRecord
    ? `ALL TIME · ${String(allTimeRecord.gamesPlayed)} BGM GP`
    : undefined

  const allTimeStatsSubtitle =
    allTimeRecord !== null && allTimeRecord.titlesCount > 0
      ? `Career totals across ${String(allTimeRecord.titlesCount)} title${allTimeRecord.titlesCount === 1 ? '' : 's'} · all clubs`
      : 'Career totals across all titles · all clubs'

  // Build the sparkline payload for whichever player ends up as the leader of
  // each tile in either scope. Up to 6 unique IDs (often fewer when leaders
  // overlap across tiles).
  const ptsLeaderId = pickFirst(eaRows, (a, b) => b.points - a.points)?.playerId ?? null
  const goalsLeaderId =
    pickFirst(eaRows, (a, b) => b.goals - a.goals)?.playerId ?? null
  const goalieLeaderId =
    pickFirst(
      eaRows.filter((r) => r.goalieGp > 0 && r.savePct !== null),
      (a, b) => parseFloat(b.savePct ?? '0') - parseFloat(a.savePct ?? '0'),
    )?.playerId ?? null

  const allPtsLeaderId =
    pickFirst(allTimeRows, (a, b) => b.points - a.points)?.playerId ?? null
  const allGoalsLeaderId =
    pickFirst(allTimeRows, (a, b) => b.goals - a.goals)?.playerId ?? null
  const allGoalieLeaderId =
    pickFirst(
      allTimeRows.filter((r) => r.goalieGp > 0 && r.savePct !== null),
      (a, b) => parseFloat(b.savePct ?? '0') - parseFloat(a.savePct ?? '0'),
    )?.playerId ?? null

  const sparklineIds = Array.from(
    new Set(
      [
        ptsLeaderId,
        goalsLeaderId,
        goalieLeaderId,
        allPtsLeaderId,
        allGoalsLeaderId,
        allGoalieLeaderId,
      ].filter((id): id is number => id !== null),
    ),
  )

  const SPARK_LIMIT = 10
  const sparklines: Record<number, { points: number[]; goals: number[]; savePct: number[] }> = {}
  await Promise.all(
    sparklineIds.map(async (id) => {
      try {
        const log = await getPlayerGameLog(id, null, SPARK_LIMIT, 0)
        // Game log is newest-first; sparkline expects chronological (oldest → newest).
        const ordered = [...log].reverse()
        sparklines[id] = {
          points: ordered.map((g) => g.goals + g.assists),
          goals: ordered.map((g) => g.goals),
          savePct: ordered
            .filter((g) => g.isGoalie && g.saves !== null && g.goalsAgainst !== null)
            .map((g) => {
              const sa = (g.saves ?? 0) + (g.goalsAgainst ?? 0)
              return sa > 0 ? ((g.saves ?? 0) / sa) * 100 : 0
            }),
        }
      } catch {
        sparklines[id] = { points: [], goals: [], savePct: [] }
      }
    }),
  )

  const recordSparkline = recentMatches
    .slice(0, SPARK_LIMIT)
    .reverse()
    .map((m) => m.result)

  // Per-player metadata for skater/goalie row tooltips. Collect every distinct
  // playerId across all four datasets surfaced on the page.
  const metaIds = Array.from(
    new Set([
      ...skaterRows.map((r) => r.playerId),
      ...goalieRows.map((r) => r.playerId),
      ...allTimeSkaterRows.map((r) => r.playerId),
      ...allTimeGoalieRows.map((r) => r.playerId),
    ]),
  )
  let playerMeta: Awaited<ReturnType<typeof getPlayersStatsMeta>> = {}
  try {
    playerMeta = await getPlayersStatsMeta(metaIds)
  } catch {
    // Soft-fail: tooltips just fall back to the gamertag.
  }

  return (
    <PageShell gameTitle={gameTitle}>
      <RosterLedger
        rows={eaRows}
        record={officialRecord ?? null}
        scopeLabel={scopeLabel}
        allTimeRows={allTimeRows}
        allTimeRecord={allTimeRecord}
        allTimeScopeLabel={allTimeScopeLabel}
        recordSparkline={recordSparkline}
        sparklines={sparklines}
      />
      <DepthChart
        {...chart}
        scopeLabel={`Boogeymen · ${gameTitle.name} · ${gameMode === null ? 'Season Totals' : `${gameMode} mode`}`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <TitleSelector
          pathname="/roster"
          titles={allTitles}
          activeTitleSlug={gameTitle.slug}
          activeMode={gameMode}
        />
        <ModeFilter
          pathname="/roster"
          titleSlug={gameTitle.slug}
          activeMode={gameMode}
          modes={['all', '6s', '3s']}
        />
      </div>
      {skaterRows.length > 0 ? (
        <section>
          <SkaterStatsTable
            rows={skaterRows}
            title="Skaters"
            subtitle={subtitle}
            allTimeRows={allTimeSkaterRows}
            allTimeSubtitle={allTimeStatsSubtitle}
            playerMeta={playerMeta}
          />
        </section>
      ) : (
        gameMode !== null && (
          <EmptyState message={`No ${gameMode} skater stats recorded for ${gameTitle.name} yet.`} />
        )
      )}
      {goalieRows.length > 0 && (
        <section>
          <GoalieStatsTable
            rows={goalieRows}
            title="Goalies"
            subtitle={subtitle}
            allTimeRows={allTimeGoalieRows}
            allTimeSubtitle={allTimeStatsSubtitle}
            playerMeta={playerMeta}
          />
        </section>
      )}
    </PageShell>
  )
}

// ─── Archive-title view (legacy season aggregates only) ──────────────────────

async function ArchiveRoster({
  allTitles,
  gameTitle,
  gameMode,
}: {
  allTitles: GameTitle[]
  gameTitle: GameTitle
  gameMode: GameMode | null
}) {
  // Roster is club-scoped, so use club-member totals as the only source.
  // Player-card season totals can include other-club games and would be
  // misleading on a roster page; surface them on /stats only.
  const fetched = await (async () => {
    try {
      if (gameMode === null) {
        return await Promise.all([
          getClubMemberSkaterStatsAllModes(gameTitle.id),
          getClubMemberGoalieStatsAllModes(gameTitle.id),
        ])
      }
      return await Promise.all([
        getClubMemberSkaterStats(gameTitle.id, gameMode),
        getClubMemberGoalieStats(gameTitle.id, gameMode),
      ])
    } catch {
      return null
    }
  })()

  if (fetched === null) {
    return (
      <PageShell gameTitle={gameTitle}>
        <EmptyState message="Unable to load archived roster right now." />
      </PageShell>
    )
  }

  const [skaterRows, goalieRows] = fetched
  const skaterCount = skaterRows.length
  const goalieCount = goalieRows.length

  return (
    <PageShell gameTitle={gameTitle}>
      <p className="text-sm text-zinc-500">
        Club-scoped roster from reviewed CLUBS → MEMBERS captures — what each member produced for
        the BGM in {gameTitle.name}. Depth chart unavailable — match-level data was not captured.
        Broader player-card season totals (which can include other-club games) live on the{' '}
        <Link href={`/stats?title=${gameTitle.slug}`} className="text-zinc-400 underline">
          /stats
        </Link>{' '}
        page.
      </p>

      <Panel className="flex flex-wrap divide-y divide-zinc-800 sm:flex-nowrap sm:divide-x sm:divide-y-0">
        <SummaryCell label="Title" primary={gameTitle.name} />
        <SummaryCell label="Mode" primary={gameMode ?? 'All'} />
        <SummaryCell label="Skaters" primary={skaterCount.toString()} />
        <SummaryCell label="Goalies" primary={goalieCount.toString()} />
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <TitleSelector
          pathname="/roster"
          titles={allTitles}
          activeTitleSlug={gameTitle.slug}
          activeMode={gameMode}
        />
        <ModeFilter
          pathname="/roster"
          titleSlug={gameTitle.slug}
          activeMode={gameMode}
          modes={['all', '6s', '3s']}
        />
      </div>

      {skaterRows.length > 0 ? (
        <section>
          <SkaterStatsTable
            rows={skaterRows}
            title="Skaters"
            subtitle="Club-member totals (reviewed screenshot import)"
          />
        </section>
      ) : (
        <EmptyState
          message={`No club-scoped ${gameMode ?? 'combined'} skater totals captured for ${gameTitle.name}.`}
        />
      )}
      {goalieRows.length > 0 ? (
        <section>
          <GoalieStatsTable
            rows={goalieRows}
            title="Goalies"
            subtitle="Club-member totals (reviewed screenshot import)"
          />
        </section>
      ) : (
        <EmptyState
          message={`No club-scoped ${gameMode ?? 'combined'} goalie totals captured for ${gameTitle.name}.`}
        />
      )}
    </PageShell>
  )
}

// ─── Shared page shell (header) ──────────────────────────────────────────────

function PageShell({ gameTitle, children }: { gameTitle: GameTitle; children: React.ReactNode }) {
  return (
    <div className="space-y-10">
      <PageHeader gameTitle={gameTitle} />
      {children}
    </div>
  )
}

function SummaryCell({
  label,
  primary,
  secondary,
  dim = false,
}: {
  label: string
  primary: string
  secondary?: string
  dim?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3">
      <span className="font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        {label}
      </span>
      <span
        className={`truncate font-condensed text-sm font-bold uppercase tracking-wide ${dim ? 'text-zinc-600' : 'text-zinc-100'}`}
      >
        {primary}
      </span>
      {secondary !== undefined && (
        <span className="font-condensed text-xs text-zinc-500">{secondary}</span>
      )}
    </div>
  )
}

// ─── Page header ──────────────────────────────────────────────────────────────

function PageHeader({ gameTitle }: { gameTitle: { name: string } }) {
  return (
    <div className="flex items-baseline gap-3">
      <h1 className="font-condensed text-2xl font-semibold uppercase tracking-widest text-zinc-50">
        Roster
      </h1>
      <span className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
        {gameTitle.name}
      </span>
    </div>
  )
}
