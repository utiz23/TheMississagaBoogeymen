import type { Metadata } from 'next'
import type { GameMode, GameTitle } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  getClubStats,
  getRecentMatches,
  getSkaterStats,
  getGoalieStats,
  getEASkaterStats,
  getEAGoalieStats,
  getOfficialClubRecord,
  getClubSeasonRank,
  getAllTimeSkaterStats,
  getAllTimeGoalieStats,
  getPlayersStatsMeta,
  getPlayerWithWithoutSplits,
  getPlayerPairs,
  getPairWinMatrix,
  getHistoricalSkaterStats,
  getHistoricalGoalieStats,
  getHistoricalSkaterStatsAllModes,
  getHistoricalGoalieStatsAllModes,
  getClubMemberSkaterStats,
  getClubMemberGoalieStats,
  getClubMemberSkaterStatsAllModes,
  getClubMemberGoalieStatsAllModes,
  getHistoricalClubTeamStats,
  getHistoricalClubTeamStatsBatch,
  getLiveTeamStatsByMode,
  listArchiveGameTitles,
  getTeamShotLocationAggregates,
  getTeamGoalieShotLocationAggregates,
  type HistoricalClubTeamStatsRow,
} from '@eanhl/db/queries'
import { TeamShotMap } from '@/components/stats/team-shot-map'
import { SectionHeader } from '@/components/ui/section-header'
import { MatchRow } from '@/components/matches/match-row'
import { RecordStrip } from '@/components/home/record-strip'
import { SkaterStatsTable } from '@/components/stats/skater-stats-table'
import { GoalieStatsTable } from '@/components/stats/goalie-stats-table'
import { WithWithoutTable, BestPairsTable } from '@/components/stats/chemistry-tables'
import { ChemistrySection } from '@/components/stats/chemistry-section'
import { PairWinMatrix } from '@/components/stats/pair-win-matrix'
import { TeamHistoryTable } from '@/components/stats/team-history-table'
import { CareerStatsSection } from '@/components/stats/career-stats-section'
import {
  TitleSelector,
  ModeFilter,
  EmptyState,
  statsSourceLabel,
} from '@/components/title-selector'
import { resolveTitleFromSlug } from '@/lib/title-resolver'
import { formatPct, formatWinPct } from '@/lib/format'

export const metadata: Metadata = { title: 'Stats — Club Stats' }

// Aggregates update each ingestion cycle (~5 min) — match the worker cadence
export const revalidate = 300

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function parseGameMode(raw: string | string[] | undefined): GameMode | null {
  if (typeof raw !== 'string') return null
  return (GAME_MODE as readonly string[]).includes(raw) ? (raw as GameMode) : null
}



export default async function StatsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
  const requestedMode = parseGameMode(params.mode)

  const result = await resolveTitleFromSlug(titleSlug)

  if (result.kind === 'invalid') {
    const nextParams = new URLSearchParams()
    if (typeof params.mode === 'string') nextParams.set('mode', params.mode)
    redirect(nextParams.size > 0 ? `/stats?${nextParams.toString()}` : '/stats')
  }
  if (result.kind === 'empty') {
    return <EmptyState message="No game titles are configured yet." />
  }

  const { gameTitle, isActive, allTitles } = result.resolved

  if (isActive) {
    return <ActiveStats allTitles={allTitles} gameTitle={gameTitle} gameMode={requestedMode} />
  }
  return <ArchiveStats allTitles={allTitles} gameTitle={gameTitle} gameMode={requestedMode} />
}

// ─── Active-title view (live NHL 26 data, all sections) ──────────────────────

async function ActiveStats({
  allTitles,
  gameTitle,
  gameMode,
}: {
  allTitles: GameTitle[]
  gameTitle: GameTitle
  gameMode: GameMode | null
}) {
  const subtitle = statsSourceLabel({ isActive: true, gameMode })

  const fetched = await (async () => {
    try {
      return await Promise.all([
        getClubStats(gameTitle.id, gameMode),
        // 10 — RecordStrip looks at the first 10 for its form ribbon; the
        // bottom Recent Games section slices to 3 below.
        getRecentMatches({ gameTitleId: gameTitle.id, limit: 10 }),
        gameMode === null ? getEASkaterStats(gameTitle.id) : getSkaterStats(gameTitle.id, gameMode),
        gameMode === null ? getEAGoalieStats(gameTitle.id) : getGoalieStats(gameTitle.id, gameMode),
        getPlayerWithWithoutSplits(gameTitle.id, gameMode),
        getPlayerPairs(gameTitle.id, gameMode),
        getPairWinMatrix(gameTitle.id, gameMode),
        // RecordStrip — soft-fail to null if the EA endpoint hasn't run yet.
        getOfficialClubRecord(gameTitle.id).catch(() => null),
        getClubSeasonRank(gameTitle.id).catch(() => null),
        // Stats tables: All-Time scope toggle + per-player metadata tooltips.
        getAllTimeSkaterStats().catch(() => []),
        getAllTimeGoalieStats().catch(() => []),
      ])
    } catch {
      return null
    }
  })()

  if (fetched === null) {
    return (
      <PageShell gameTitle={gameTitle}>
        <EmptyState message="Unable to load stats right now." />
      </PageShell>
    )
  }

  const [
    clubStats,
    recentMatches,
    skaterRows,
    goalieRows,
    withWithoutRows,
    pairRows,
    pairWinMatrix,
    officialRecord,
    seasonRank,
    allTimeSkaterRows,
    allTimeGoalieRows,
  ] = fetched
  const emptyModeLabel = gameMode !== null ? `${gameMode} ` : ''

  // Per-player metadata for the stats tables' gamertag tooltip (jersey #,
  // preferred position, last-seen ISO date). Soft-fail to an empty map.
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
    // Soft-fail — tooltips fall back to the bare gamertag.
  }

  // Subtitle that shows on the All-Time scope tab. Pulls the title count from
  // the same place the roster page uses.
  const allTimeSubtitle =
    allTimeSkaterRows.length > 0 || allTimeGoalieRows.length > 0
      ? 'Career totals across all titles · all clubs'
      : undefined

  // Career Team Stats rows — live (NHL 26 derived from `matches`) + archive
  // (reviewed historical_club_team_stats across every prior title). Both
  // sources share the same row shape so the table renders them uniformly.
  type TeamHistoryRow = Awaited<ReturnType<typeof getHistoricalClubTeamStatsBatch>>[number] & {
    titleName: string
  }
  let teamHistoryRows: TeamHistoryRow[] = []
  try {
    const archiveTitles = await listArchiveGameTitles()
    const archiveIds = archiveTitles.map((t) => t.id)
    const titleNameById = new Map([
      [gameTitle.id, gameTitle.name],
      ...archiveTitles.map((t) => [t.id, t.name] as const),
    ])
    const [liveRows, archiveRows] = await Promise.all([
      getLiveTeamStatsByMode(gameTitle.id).catch(() => []),
      archiveIds.length > 0
        ? getHistoricalClubTeamStatsBatch(archiveIds).catch(() => [])
        : Promise.resolve([]),
    ])
    teamHistoryRows = [...liveRows, ...archiveRows].map((r) => ({
      ...r,
      titleName: titleNameById.get(r.gameTitleId) ?? '',
    }))
  } catch {
    teamHistoryRows = []
  }

  // Offense (shots taken) + defense (shots faced) team aggregates feed the
  // Offense/Defense toggle on the team shot map.
  let teamShotAggregates: Awaited<ReturnType<typeof getTeamShotLocationAggregates>> | null = null
  let teamGoalieAggregates:
    | Awaited<ReturnType<typeof getTeamGoalieShotLocationAggregates>>
    | null = null
  try {
    ;[teamShotAggregates, teamGoalieAggregates] = await Promise.all([
      getTeamShotLocationAggregates(gameTitle.id),
      getTeamGoalieShotLocationAggregates(gameTitle.id),
    ])
  } catch {
    teamShotAggregates = null
    teamGoalieAggregates = null
  }

  const isNhl26 = gameTitle.slug === 'nhl26'
  const offenseHasData =
    isNhl26 && (teamShotAggregates?.shotsIce.some((v) => v > 0) ?? false)
  const defenseHasData =
    isNhl26 && (teamGoalieAggregates?.shotsIce.some((v) => v > 0) ?? false)

  return (
    <PageShell gameTitle={gameTitle}>
      {/* Record strip — broadcast-style season ledger (W/L/OTL bar, win-pct
          gauge, goal differential, last-10 form ribbon). Shared component with
          the home page; renders cleanly even when officialRecord/seasonRank
          haven't been fetched yet (the EA endpoints lag the local aggregate). */}
      <RecordStrip
        officialRecord={officialRecord}
        localStats={clubStats}
        seasonRank={seasonRank}
        recentResults={recentMatches}
        gameTitleName={gameTitle.name}
      />

      {/* Selectors — page-level context, sit just under the record strip. */}
      <div className="flex flex-wrap items-center gap-3">
        <TitleSelector
          pathname="/stats"
          titles={allTitles}
          activeTitleSlug={gameTitle.slug}
          activeMode={gameMode}
        />
        <ModeFilter
          pathname="/stats"
          titleSlug={gameTitle.slug}
          activeMode={gameMode}
          modes={['all', '6s', '3s']}
        />
      </div>

      {clubStats === null || clubStats.gamesPlayed === 0 ? (
        <EmptyState
          message={
            gameMode !== null
              ? `No ${emptyModeLabel}games recorded for ${gameTitle.name} yet.`
              : `No stats recorded for ${gameTitle.name} yet.`
          }
        />
      ) : null}

      <TeamShotMap
        offense={teamShotAggregates ?? emptyShotLocations()}
        offenseHasData={offenseHasData}
        defense={teamGoalieAggregates ?? emptyShotLocations()}
        defenseHasData={defenseHasData}
        {...(clubStats !== null && clubStats.gamesPlayed > 0
          ? { teamGp: clubStats.gamesPlayed }
          : {})}
        {...(recentMatches[0]
          ? { updatedDate: recentMatches[0].playedAt.toISOString().slice(0, 10) }
          : {})}
      />

      {/* Career team stats — per-title, per-playlist rows from reviewed
          archive imports (NHL 22-25). Surfaces PP%/PK% and team-rate metrics
          we don't compute live yet. */}
      {teamHistoryRows.length > 0 && <TeamHistoryTable rows={teamHistoryRows} />}

      {/* Skater + Goalie stats — wrapped together in a shared module-frame
          container so they read as one "Player Stats" module, matching the
          depth-chart card frame on /roster (visually-linked sibling). */}
      {skaterRows.length > 0 || goalieRows.length > 0 ? (
        <section className="module-frame divide-y divide-zinc-800/60">
          {skaterRows.length > 0 ? (
            <SkaterStatsTable
              rows={skaterRows}
              title="Skaters"
              subtitle={subtitle}
              allTimeRows={allTimeSkaterRows}
              {...(allTimeSubtitle !== undefined ? { allTimeSubtitle } : {})}
              playerMeta={playerMeta}
            />
          ) : null}
          {goalieRows.length > 0 ? (
            <GoalieStatsTable
              rows={goalieRows}
              title="Goalies"
              subtitle={subtitle}
              allTimeRows={allTimeGoalieRows}
              {...(allTimeSubtitle !== undefined ? { allTimeSubtitle } : {})}
              playerMeta={playerMeta}
            />
          ) : null}
        </section>
      ) : (
        clubStats !== null &&
        clubStats.gamesPlayed > 0 && (
          <EmptyState message={`No ${emptyModeLabel}skater stats recorded yet.`} />
        )
      )}

      <ChemistrySection
        withWithout={<WithWithoutTable rows={withWithoutRows} />}
        bestPairs={<BestPairsTable rows={pairRows} />}
        matrix={
          <PairWinMatrix
            data={pairWinMatrix}
            titleName={gameTitle.name}
            clubName="Boogeymen"
            updatedLabel={
              recentMatches[0]
                ? recentMatches[0].playedAt.toISOString().slice(0, 10)
                : undefined
            }
            scope={
              gameMode !== null
                ? `Pairwise win % when both players appeared · ${gameMode} mode · ${String(pairWinMatrix.players.length)} skaters`
                : undefined
            }
          />
        }
      />

      {recentMatches.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <SectionHeader label="Recent Games" />
            <Link
              href="/games"
              className="font-condensed text-xs font-bold uppercase tracking-widest text-zinc-500 transition-colors hover:text-accent"
            >
              View all matches →
            </Link>
          </div>
          <div className="space-y-2">
            {recentMatches.slice(0, 3).map((match, i) => (
              <MatchRow key={match.id} match={match} isMostRecent={i === 0} />
            ))}
          </div>
        </section>
      )}
    </PageShell>
  )
}

// ─── Archive-title view (legacy season aggregates only) ──────────────────────

async function ArchiveStats({
  allTitles,
  gameTitle,
  gameMode,
}: {
  allTitles: GameTitle[]
  gameTitle: GameTitle
  gameMode: GameMode | null
}) {
  const fetched = await (async () => {
    try {
      if (gameMode === null) {
        return await Promise.all([
          // Primary: club-scoped member totals (CLUBS → MEMBERS captures).
          getClubMemberSkaterStatsAllModes(gameTitle.id),
          getClubMemberGoalieStatsAllModes(gameTitle.id),
          // Secondary: player-card season totals (may include other clubs).
          getHistoricalSkaterStatsAllModes(gameTitle.id),
          getHistoricalGoalieStatsAllModes(gameTitle.id),
          // Club/team totals (STATS → CLUB STATS captures).
          getHistoricalClubTeamStats(gameTitle.id, null),
        ])
      }
      return await Promise.all([
        getClubMemberSkaterStats(gameTitle.id, gameMode),
        getClubMemberGoalieStats(gameTitle.id, gameMode),
        getHistoricalSkaterStats(gameTitle.id, gameMode),
        getHistoricalGoalieStats(gameTitle.id, gameMode),
        getHistoricalClubTeamStats(gameTitle.id, gameMode),
      ])
    } catch {
      return null
    }
  })()

  if (fetched === null) {
    return (
      <PageShell gameTitle={gameTitle}>
        <EmptyState message="Unable to load archived stats right now." />
      </PageShell>
    )
  }

  const [clubSkaterRows, clubGoalieRows, cardSkaterRows, cardGoalieRows, teamRows] = fetched

  return (
    <PageShell gameTitle={gameTitle}>
      <p className="font-condensed text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
        Archive · no match data captured
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <TitleSelector
          pathname="/stats"
          titles={allTitles}
          activeTitleSlug={gameTitle.slug}
          activeMode={gameMode}
        />
        <ModeFilter
          pathname="/stats"
          titleSlug={gameTitle.slug}
          activeMode={gameMode}
          modes={['all', '6s', '3s']}
        />
      </div>

      {/* CLUB/TEAM totals — overview before per-player breakdowns. */}
      {teamRows.length > 0 && <ArchiveClubTeamSection rows={teamRows} titleName={gameTitle.name} />}

      <CareerStatsSection
        titleName={gameTitle.name}
        clubScoped={
          <>
            {clubSkaterRows.length > 0 ? (
              <SkaterStatsTable
                rows={clubSkaterRows}
                title="Skaters"
                subtitle="Club-member totals (reviewed screenshot import)"
              />
            ) : (
              <EmptyState
                message={`No club-scoped ${gameMode ?? 'combined'} skater totals captured for ${gameTitle.name}.`}
              />
            )}
            {clubGoalieRows.length > 0 ? (
              <GoalieStatsTable
                rows={clubGoalieRows}
                title="Goalies"
                subtitle="Club-member totals (reviewed screenshot import)"
              />
            ) : null}
          </>
        }
        playerCard={
          <>
            {cardSkaterRows.length > 0 ? (
              <SkaterStatsTable
                rows={cardSkaterRows}
                title="Skaters"
                subtitle="Player-card season totals — may include games for other clubs"
              />
            ) : (
              <EmptyState
                message={`No player-card ${gameMode ?? 'combined'} skater totals for ${gameTitle.name}.`}
              />
            )}
            {cardGoalieRows.length > 0 ? (
              <GoalieStatsTable
                rows={cardGoalieRows}
                title="Goalies"
                subtitle="Player-card season totals — may include games for other clubs"
              />
            ) : null}
          </>
        }
      />
    </PageShell>
  )
}

// ─── Archive club-team totals ─────────────────────────────────────────────────

const PLAYLIST_LABEL: Record<string, string> = {
  eashl_6v6: 'EASHL 6v6',
  eashl_3v3: 'EASHL 3v3',
  clubs_6v6: 'Clubs 6v6',
  clubs_3v3: 'Clubs 3v3',
  '6_player_full_team': '6P Full Team',
  clubs_6_players: 'Clubs 6P',
  threes: 'Threes',
  quickplay_3v3: 'Quickplay 3v3',
}

function ArchiveClubTeamSection({
  rows,
  titleName,
}: {
  rows: HistoricalClubTeamStatsRow[]
  titleName: string
}) {
  return (
    <section className="space-y-4 border-t border-zinc-800 pt-6">
      <div className="space-y-1">
        <h2 className="font-condensed text-base font-semibold uppercase tracking-widest text-zinc-300">
          Club team records
        </h2>
        <p className="text-xs text-zinc-500">
          Season totals from {titleName} STATS → CLUB STATS screen captures, per playlist. PP% and
          PK% are not tracked in 3v3 and Threes modes.
        </p>
      </div>
      <div className="overflow-x-auto border border-zinc-800">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="border-b border-zinc-800 text-right text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-2 text-left font-medium">Playlist</th>
              <th className="px-3 py-2 font-medium">GP</th>
              <th className="px-3 py-2 font-medium text-accent">W</th>
              <th className="px-3 py-2 font-medium">L</th>
              <th className="px-3 py-2 font-medium">OTL</th>
              <th className="px-3 py-2 font-medium">W%</th>
              <th className="px-3 py-2 font-medium">GF/G</th>
              <th className="px-3 py-2 font-medium">GA/G</th>
              <th className="px-3 py-2 font-medium">TOA</th>
              <th className="px-3 py-2 font-medium">PP%</th>
              <th className="px-3 py-2 font-medium">PK%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {rows.map((row) => {
              const gp = row.gamesPlayed ?? 0
              const w = row.wins ?? 0
              const l = row.losses ?? 0
              const otl = row.otl ?? 0
              return (
                <tr key={row.playlist} className="bg-surface">
                  <td className="px-4 py-3 font-medium text-zinc-300">
                    {PLAYLIST_LABEL[row.playlist] ?? row.playlist}
                  </td>
                  <td className="px-3 py-3 text-right text-zinc-300">{gp}</td>
                  <td className="px-3 py-3 text-right font-semibold text-accent">{w}</td>
                  <td className="px-3 py-3 text-right text-zinc-400">{l}</td>
                  <td className="px-3 py-3 text-right text-zinc-500">{otl}</td>
                  <td className="px-3 py-3 text-right text-zinc-300">{formatWinPct(w, w + l + otl)}</td>
                  <td className="px-3 py-3 text-right text-zinc-300">{row.avgGoalsFor ?? '—'}</td>
                  <td className="px-3 py-3 text-right text-zinc-400">
                    {row.avgGoalsAgainst ?? '—'}
                  </td>
                  <td className="px-3 py-3 text-right text-zinc-400">
                    {row.avgTimeOnAttack ?? '—'}
                  </td>
                  <td className="px-3 py-3 text-right text-zinc-400">
                    {formatPct(row.powerPlayPct)}
                  </td>
                  <td className="px-3 py-3 text-right text-zinc-400">
                    {formatPct(row.powerPlayKillPct)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ─── Shared page shell (header) ──────────────────────────────────────────────

function PageShell({ gameTitle, children }: { gameTitle: GameTitle; children: React.ReactNode }) {
  return (
    <div className="space-y-8">
      <div className="flex items-baseline gap-3">
        <h1 className="font-condensed text-2xl font-semibold uppercase tracking-widest text-zinc-50">
          Stats
        </h1>
        <span className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
          {gameTitle.name}
        </span>
      </div>

      {children}
    </div>
  )
}

function emptyShotLocations() {
  return {
    shotsIce: new Array(16).fill(0) as number[],
    goalsIce: new Array(16).fill(0) as number[],
    shotsNet: new Array(5).fill(0) as number[],
    goalsNet: new Array(5).fill(0) as number[],
  }
}
