import type { Metadata } from 'next'
import type { GameMode, GameTitle } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import { FIRST_CARD_RELEASE_ORDER } from '@eanhl/db/cards'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  getEARoster,
  getRosterCarryOvers,
  getSkaterStats,
  getGoalieStats,
  getEASkaterStats,
  getEAGoalieStats,
  getEASkaterExpandedStats,
  getEAGoalieExpandedStats,
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
  getCardProgressForPlayers,
  getPositionSkaterStats,
  getAllTimePositionSkaterStats,
} from '@eanhl/db/queries'
import type { GoalieStatsRow, SkaterStatsRow } from '@eanhl/db/queries'
import { DepthChart } from '@/components/roster/depth-chart'
import { SectionError } from '@/components/roster/section-error'
import { RosterLedger } from '@/components/roster/roster-ledger'
import { Panel } from '@/components/ui/panel'
import type { DepthChartProps, DepthSlot } from '@/components/roster/depth-chart'
import { SkaterStatsTable } from '@/components/stats/skater-stats-table'
import type { PositionData } from '@/components/stats/stats-table/position-adapters'
import { GoalieStatsTable } from '@/components/stats/goalie-stats-table'
import { TitleSelector, ModeFilter, EmptyState } from '@/components/title-selector'
import { deriveRosterSections, loadRosterData, settle } from '@/lib/roster-load'
import { liveSource, careerSource, ARCHIVE_CLUB_MEMBER_SOURCE } from '@/lib/stats-sources'
import { resolveTitleFromSlug } from '@/lib/title-resolver'
import { buildDepthChart, chartPos, type ChartPos, type ChartSlot } from '@/lib/depth-chart-build'

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

/** Return the first element of `arr` under `cmp` ordering, scanning once instead of sorting. */
function pickFirst<T>(arr: T[], cmp: (a: T, b: T) => number): T | null {
  let best: T | null = null
  for (const item of arr) {
    if (best === null || cmp(item, best) < 0) best = item
  }
  return best
}

/** Depth chart from the roster rows (lib/depth-chart-build.ts): a card at every position played. */
function buildChart(rows: RosterRow[], eligRows: EligRow[]): DepthChartProps {
  const local = new Map<number, Partial<Record<ChartPos, number>>>()
  for (const r of eligRows) {
    const pos = chartPos(r.position)
    if (pos === null) continue
    const counts = local.get(r.playerId) ?? {}
    counts[pos] = (counts[pos] ?? 0) + r.gameCount
    local.set(r.playerId, counts)
  }
  const built = buildDepthChart(rows, local)
  const slot = (s: ChartSlot<RosterRow> | null): DepthSlot | null =>
    s === null ? null : { player: s.player, isDepth: s.isDepth }
  return {
    forwards: built.forwards.map((l) => ({ lw: slot(l.lw), c: slot(l.c), rw: slot(l.rw) })),
    defense: built.defense.map((p) => ({ ld: slot(p.ld), rd: slot(p.rd) })),
    goalies: built.goalies.map(slot),
  }
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

  const { gameTitle, allTitles } = result.resolved

  // Live = polled OR has captured matches — not the ingestion flag.
  if (gameTitle.isLive) {
    return <ActiveRoster allTitles={allTitles} gameTitle={gameTitle} gameMode={requestedMode} />
  }
  return <ArchiveRoster allTitles={allTitles} gameTitle={gameTitle} gameMode={requestedMode} />
}

// ─── Source labels ────────────────────────────────────────────────────────────
// Shared with /stats — see apps/web/src/lib/stats-sources.ts.

const ARCHIVE_SOURCE = ARCHIVE_CLUB_MEMBER_SOURCE

function byPlayerId<T extends { playerId: number }>(rows: T[]): Record<number, T> {
  return Object.fromEntries(rows.map((r) => [r.playerId, r]))
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
  // Non-critical — page renders without it if the worker hasn't fetched it yet
  let officialRecord: Awaited<ReturnType<typeof getOfficialClubRecord>> = null
  try {
    officialRecord = await getOfficialClubRecord(gameTitle.id)
  } catch {
    // intentionally swallowed
  }

  // Each core query settles on its own so one failure never blanks the page and
  // never reads as an empty roster (see lib/roster-load.ts).
  const data = await loadRosterData({
    roster: () => getEARoster(gameTitle.id),
    eligibility: () => getPlayerPositionEligibility(gameTitle.id),
    skaters: (): Promise<SkaterStatsRow[]> =>
      gameMode === null ? getEASkaterStats(gameTitle.id) : getSkaterStats(gameTitle.id, gameMode),
    goalies: (): Promise<GoalieStatsRow[]> =>
      gameMode === null ? getEAGoalieStats(gameTitle.id) : getGoalieStats(gameTitle.id, gameMode),
  })
  const sections = deriveRosterSections(data)

  if (sections.pageEmpty) {
    return (
      <PageShell gameTitle={gameTitle}>
        <EmptyState message={`No player stats recorded for ${gameTitle.name} yet.`} />
      </PageShell>
    )
  }

  const eaRows: RosterRow[] = data.roster.status === 'ok' ? data.roster.data : []
  const skaterRows: SkaterStatsRow[] = data.skaters.status === 'ok' ? data.skaters.data : []
  const goalieRows: GoalieStatsRow[] = data.goalies.status === 'ok' ? data.goalies.data : []
  const eligibilityRows: EligRow[] = data.eligibility.status === 'ok' ? data.eligibility.data : []

  // EA-only expanded stats: All mode only, independent of the base rows. A
  // failure degrades to base metrics with a notice; it never shows zeros.
  const [expandedSkaters, expandedGoalies] =
    gameMode === null
      ? await Promise.all([
          settle('getEASkaterExpandedStats', () => getEASkaterExpandedStats(gameTitle.id)),
          settle('getEAGoalieExpandedStats', () => getEAGoalieExpandedStats(gameTitle.id)),
        ])
      : [null, null]

  // Career rows for the tables' All Time toggle. Each settles on its own; a
  // failure disables the toggle with a reason instead of hiding it silently.
  const [allTimeSkaters, allTimeGoalies] = await Promise.all([
    settle('getAllTimeSkaterStats', () => getAllTimeSkaterStats()),
    settle('getAllTimeGoalieStats', () => getAllTimeGoalieStats()),
  ])
  const allTimeSkaterRows = allTimeSkaters.status === 'ok' ? allTimeSkaters.data : []
  const allTimeGoalieRows = allTimeGoalies.status === 'ok' ? allTimeGoalies.data : []

  // Per-position rows for the skater table's Position pills. A failure only
  // disables the pills with a reason; the base table is unaffected.
  const [positionSkaters, allTimePositionSkaters] = await Promise.all([
    settle('getPositionSkaterStats', () => getPositionSkaterStats(gameTitle.id, gameMode)),
    settle('getAllTimePositionSkaterStats', () => getAllTimePositionSkaterStats()),
  ])
  const positions: PositionData = {
    current: positionSkaters.status === 'ok' ? positionSkaters.data : 'error',
    allTime: allTimePositionSkaters.status === 'ok' ? allTimePositionSkaters.data : 'error',
  }

  // ─── Ledger + depth chart (need the roster rows) ───────────────────────────

  // Last title's members who haven't played this title yet join the chart
  // (zero games, previous position). A failure only leaves them out.
  const carryOvers = await settle('getRosterCarryOvers', () => getRosterCarryOvers(gameTitle.id))
  const chartRows: RosterRow[] = [...eaRows, ...(carryOvers.status === 'ok' ? carryOvers.data : [])]
  const builtChart = sections.depthChart === 'ready' ? buildChart(chartRows, eligibilityRows) : null
  // Card tier/theme/featured badge for every charted player, in one query; a
  // failure only drops the progression (every card then shows tier 1). Each
  // title is its own season: this title's cards, or each player's newest card
  // for a title from before season cards began.
  const cardTitleId =
    (gameTitle.releaseOrder ?? 0) >= FIRST_CARD_RELEASE_ORDER ? gameTitle.id : undefined
  const cardSummaries =
    builtChart === null
      ? new Map<number, never>()
      : await getCardProgressForPlayers(
          chartRows.map((r) => r.playerId),
          cardTitleId,
        ).catch(() => new Map<number, never>())
  const withCard = (slot: DepthSlot | null): DepthSlot | null =>
    slot === null ? null : { ...slot, card: cardSummaries.get(slot.player.playerId) }
  const chart: DepthChartProps | null =
    builtChart === null
      ? null
      : {
          ...builtChart,
          forwards: builtChart.forwards.map((l) => ({
            lw: withCard(l.lw),
            c: withCard(l.c),
            rw: withCard(l.rw),
          })),
          defense: builtChart.defense.map((p) => ({ ld: withCard(p.ld), rd: withCard(p.rd) })),
          goalies: builtChart.goalies.map(withCard),
        }

  let ledger: React.ReactNode = null
  let allTimeRecord: Awaited<ReturnType<typeof getAllTimeTeamRecord>> | null = null
  if (sections.summary === 'ready') {
    const totalGp = eaRows.reduce((acc, r) => Math.max(acc, r.skaterGp + r.goalieGp), 0)
    const scopeLabel =
      `SEASON · ${gameTitle.name.toUpperCase()}` + (totalGp > 0 ? ` · ${String(totalGp)} GP` : '')

    let allTimeRows: Awaited<ReturnType<typeof getAllTimeRosterLedger>> = []
    let recentMatches: Awaited<ReturnType<typeof getRecentMatches>> = []
    try {
      ;[allTimeRows, allTimeRecord, recentMatches] = await Promise.all([
        getAllTimeRosterLedger(),
        getAllTimeTeamRecord(),
        getRecentMatches({ gameTitleId: gameTitle.id, limit: 14 }),
      ])
    } catch {
      // soft-fail: the ledger's All-Time tab will simply remain disabled.
    }

    const allTimeScopeLabel = allTimeRecord
      ? `ALL TIME · ${String(allTimeRecord.gamesPlayed)} BGM GP`
      : undefined

    // Build the sparkline payload for whichever player ends up as the leader of
    // each tile in either scope. Up to 6 unique IDs (often fewer when leaders
    // overlap across tiles).
    const ptsLeaderId = pickFirst(eaRows, (a, b) => b.points - a.points)?.playerId ?? null
    const goalsLeaderId = pickFirst(eaRows, (a, b) => b.goals - a.goals)?.playerId ?? null
    const goalieLeaderId =
      pickFirst(
        eaRows.filter((r) => r.goalieGp > 0 && r.savePct !== null),
        (a, b) => parseFloat(b.savePct ?? '0') - parseFloat(a.savePct ?? '0'),
      )?.playerId ?? null

    const allPtsLeaderId = pickFirst(allTimeRows, (a, b) => b.points - a.points)?.playerId ?? null
    const allGoalsLeaderId = pickFirst(allTimeRows, (a, b) => b.goals - a.goals)?.playerId ?? null
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

    ledger = (
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
    )
  }

  const allTimeStatsSubtitle =
    allTimeRecord !== null && allTimeRecord.titlesCount > 0
      ? `Career totals across ${String(allTimeRecord.titlesCount)} title${allTimeRecord.titlesCount === 1 ? '' : 's'} · all clubs`
      : 'Career totals across all titles · all clubs'
  const allTimeSource = careerSource(allTimeStatsSubtitle)

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
    // Soft-fail: names render without the jersey/position line.
  }

  const source = liveSource(gameMode)
  const modeText = gameMode === null ? '' : `${gameMode} `

  return (
    <PageShell gameTitle={gameTitle}>
      {sections.summary === 'unavailable' ? (
        <SectionError
          title="Roster summary and depth chart unavailable"
          message="The roster data was not received, so nothing is shown here. This is not an empty roster."
        />
      ) : (
        <>
          {ledger}
          {chart !== null ? (
            <DepthChart
              {...chart}
              scopeLabel={`Boogeymen · ${gameTitle.name} · ${gameMode === null ? 'Season Totals' : `${gameMode} mode`}`}
            />
          ) : (
            <SectionError
              title="Depth chart unavailable"
              message="Position eligibility was not received, so the depth chart is not shown rather than guessed."
            />
          )}
        </>
      )}
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
      <section>
        <SkaterStatsTable
          rows={skaterRows}
          title="Skaters"
          source={source}
          allTimeRows={allTimeSkaterRows}
          allTimeSource={allTimeSource}
          allTimeUnavailable={allTimeSkaters.status === 'error'}
          playerMeta={playerMeta}
          state={sections.skaters.state}
          emptyMessage={`No ${modeText}skater stats recorded for ${gameTitle.name} yet.`}
          {...(expandedSkaters?.status === 'ok'
            ? { expanded: byPlayerId(expandedSkaters.data) }
            : {})}
          expandedFailed={expandedSkaters?.status === 'error'}
          positions={positions}
        />
      </section>
      <section>
        <GoalieStatsTable
          rows={goalieRows}
          title="Goalies"
          source={source}
          allTimeRows={allTimeGoalieRows}
          allTimeSource={allTimeSource}
          allTimeUnavailable={allTimeGoalies.status === 'error'}
          playerMeta={playerMeta}
          state={sections.goalies.state}
          emptyMessage={`No ${modeText}goalie stats recorded for ${gameTitle.name} yet.`}
          {...(expandedGoalies?.status === 'ok'
            ? { expanded: byPlayerId(expandedGoalies.data) }
            : {})}
          expandedFailed={expandedGoalies?.status === 'error'}
        />
      </section>
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
  // Skater and goalie fetches settle separately: one failing is an error state
  // for that table only, never an empty table.
  // Position pills switch to player-card screenshots (the club-member import
  // has no position split); their source badge says so.
  const [skaters, goalies, positionSkaters] = await Promise.all([
    settle('club-member skater stats', () =>
      gameMode === null
        ? getClubMemberSkaterStatsAllModes(gameTitle.id)
        : getClubMemberSkaterStats(gameTitle.id, gameMode),
    ),
    settle('club-member goalie stats', () =>
      gameMode === null
        ? getClubMemberGoalieStatsAllModes(gameTitle.id)
        : getClubMemberGoalieStats(gameTitle.id, gameMode),
    ),
    settle('getPositionSkaterStats', () => getPositionSkaterStats(gameTitle.id, gameMode)),
  ])
  const positions: PositionData = {
    current: positionSkaters.status === 'ok' ? positionSkaters.data : 'error',
  }
  const hasPositionRows =
    positionSkaters.status === 'ok' &&
    Object.values(positionSkaters.data.positions).some((p) => 'rows' in p && p.rows.length > 0)

  const skaterRows = skaters.status === 'ok' ? skaters.data : []
  const goalieRows = goalies.status === 'ok' ? goalies.data : []
  const skaterCount = skaters.status === 'ok' ? skaters.data.length.toString() : '—'
  const goalieCount = goalies.status === 'ok' ? goalies.data.length.toString() : '—'

  return (
    <PageShell gameTitle={gameTitle}>
      <p className="text-sm text-zinc-500">
        Club-scoped roster from reviewed CLUBS → MEMBERS captures — what each member produced for
        the BGM in {gameTitle.name}. Depth chart unavailable — match-level data was not captured.
        Broader player-card season totals (which can include other-club games) live on the{' '}
        <Link prefetch href={`/stats?title=${gameTitle.slug}`} className="text-zinc-400 underline">
          /stats
        </Link>{' '}
        page.
      </p>

      <Panel className="flex flex-wrap divide-y divide-zinc-800 sm:flex-nowrap sm:divide-x sm:divide-y-0">
        <SummaryCell label="Title" primary={gameTitle.name} />
        <SummaryCell label="Mode" primary={gameMode ?? 'All'} />
        <SummaryCell label="Skaters" primary={skaterCount} />
        <SummaryCell label="Goalies" primary={goalieCount} />
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

      {skaters.status === 'error' ? (
        <section>
          <SkaterStatsTable rows={[]} title="Skaters" source={ARCHIVE_SOURCE} state="error" />
        </section>
      ) : skaterRows.length > 0 || hasPositionRows ? (
        <section>
          <SkaterStatsTable
            rows={skaterRows}
            title="Skaters"
            source={ARCHIVE_SOURCE}
            positions={positions}
            emptyMessage={`No club-scoped ${gameMode ?? 'combined'} skater totals captured for ${gameTitle.name}. Pick a position for player-card totals.`}
          />
        </section>
      ) : (
        <EmptyState
          message={`No club-scoped ${gameMode ?? 'combined'} skater totals captured for ${gameTitle.name}.`}
        />
      )}
      {goalies.status === 'error' ? (
        <section>
          <GoalieStatsTable rows={[]} title="Goalies" source={ARCHIVE_SOURCE} state="error" />
        </section>
      ) : goalieRows.length > 0 ? (
        <section>
          <GoalieStatsTable rows={goalieRows} title="Goalies" source={ARCHIVE_SOURCE} />
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
