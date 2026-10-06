import type { Metadata } from 'next'
import type { GameMode, GameTitle } from '@eanhl/db'
import type { GameTitleListing } from '@eanhl/db/queries'
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
  getTeamShotLocationAggregates,
  getTeamGoalieShotLocationAggregates,
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
import { TeamHistoryTable, TeamHistoryUnavailable } from '@/components/stats/team-history-table'
import { CareerStatsSection } from '@/components/stats/career-stats-section'
import { TitleSelector, ModeFilter, EmptyState } from '@/components/title-selector'
import { resolveTitleFromSlug } from '@/lib/title-resolver'
import { archiveRowToTeamHistoryInput, loadTeamHistory } from '@/lib/team-history'
import {
  settle,
  rowsOrEmpty,
  resolveTablePresentation,
  shouldShowPlayerModule,
} from '@/lib/stats-load'
import {
  liveSource,
  careerSource,
  ARCHIVE_CLUB_MEMBER_SOURCE,
  ARCHIVE_PLAYER_CARD_SOURCE,
} from '@/lib/stats-sources'

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

  const { gameTitle, allTitles } = result.resolved

  // Live = polled OR has captured matches, so a title keeps this view after
  // polling stops. Not the ingestion flag.
  if (gameTitle.isLive) {
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
  allTitles: GameTitleListing[]
  gameTitle: GameTitle
  gameMode: GameMode | null
}) {
  // Page-critical, non-player-stat dependencies: kept at one failure boundary
  // (unchanged from before this unit) since a failure here has always meant
  // there is nothing coherent to render — record strip, selectors, team shot
  // map and chemistry all need this same handful of queries.
  const pageCore = await (async () => {
    try {
      return await Promise.all([
        getClubStats(gameTitle.id, gameMode),
        // 10 — RecordStrip looks at the first 10 for its form ribbon; the
        // bottom Recent Games section slices to 3 below.
        getRecentMatches({ gameTitleId: gameTitle.id, limit: 10 }),
        getPlayerWithWithoutSplits(gameTitle.id, gameMode),
        getPlayerPairs(gameTitle.id, gameMode),
        getPairWinMatrix(gameTitle.id, gameMode),
        // RecordStrip — soft-fail to null if the EA endpoint hasn't run yet.
        getOfficialClubRecord(gameTitle.id).catch(() => null),
        getClubSeasonRank(gameTitle.id).catch(() => null),
      ])
    } catch {
      return null
    }
  })()

  if (pageCore === null) {
    return (
      <PageShell gameTitle={gameTitle}>
        <EmptyState message="Unable to load stats right now." />
      </PageShell>
    )
  }

  const [
    clubStats,
    recentMatches,
    withWithoutRows,
    pairRows,
    pairWinMatrix,
    officialRecord,
    seasonRank,
  ] = pageCore
  const emptyModeLabel = gameMode !== null ? `${gameMode} ` : ''

  // Player-stat tables + All-Time toggle: each settles independently so one
  // failing query never blanks the whole page or the other table. A failure
  // renders that table's own "unavailable" state (via `state`/
  // `allTimeUnavailable`), never a false empty/zero result.
  const [skaters, goalies, allTimeSkaters, allTimeGoalies] = await Promise.all([
    settle('current skater stats', () =>
      gameMode === null ? getEASkaterStats(gameTitle.id) : getSkaterStats(gameTitle.id, gameMode),
    ),
    settle('current goalie stats', () =>
      gameMode === null ? getEAGoalieStats(gameTitle.id) : getGoalieStats(gameTitle.id, gameMode),
    ),
    settle('all-time skater stats', () => getAllTimeSkaterStats()),
    settle('all-time goalie stats', () => getAllTimeGoalieStats()),
  ])
  const skaterRows = rowsOrEmpty(skaters)
  const goalieRows = rowsOrEmpty(goalies)
  const allTimeSkaterRows = rowsOrEmpty(allTimeSkaters)
  const allTimeGoalieRows = rowsOrEmpty(allTimeGoalies)
  // The Skaters/Goalies module renders whenever there is real state to show:
  // club activity, a non-empty Current or All Time result, or ANY of the
  // four player queries having failed (a failure must never be hidden just
  // because the club's season GP happens to be 0 — see
  // `shouldShowPlayerModule`). It only stays hidden when every query
  // succeeded and came back empty, in which case the page-top "no stats
  // recorded" notice already covers it. Once it renders, each role's table
  // is independent: a failed query shows that table's own error, and a
  // successful-but-empty result shows an explicit role-specific empty
  // message via `emptyMessage`.
  const showPlayerModule = shouldShowPlayerModule({
    hasClubActivity: clubStats !== null && clubStats.gamesPlayed > 0,
    currentSkaters: skaters,
    currentGoalies: goalies,
    allTimeSkaters,
    allTimeGoalies,
  })

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

  // Career Team Stats — live rows for every live (match-backed) title plus
  // reviewed archive rows for every other title. If any required query fails
  // the section renders an explicit "unavailable" state instead of a
  // partial/empty table; the rest of the page is unaffected.
  const teamHistory = await loadTeamHistory({
    activeTitles: allTitles.filter((t) => t.isLive),
    listArchiveTitles: () => Promise.resolve(allTitles.filter((t) => !t.isLive)),
    getLiveRows: getLiveTeamStatsByMode,
    getArchiveRows: getHistoricalClubTeamStatsBatch,
    onError: (error) => {
      console.error('[stats] Career Team Stats unavailable', error)
    },
  })

  // Offense (shots taken) + defense (shots faced) team aggregates feed the
  // Offense/Defense toggle on the team shot map.
  let teamShotAggregates: Awaited<ReturnType<typeof getTeamShotLocationAggregates>> | null = null
  let teamGoalieAggregates: Awaited<ReturnType<typeof getTeamGoalieShotLocationAggregates>> | null =
    null
  try {
    ;[teamShotAggregates, teamGoalieAggregates] = await Promise.all([
      getTeamShotLocationAggregates(gameTitle.id),
      getTeamGoalieShotLocationAggregates(gameTitle.id),
    ])
  } catch {
    teamShotAggregates = null
    teamGoalieAggregates = null
  }

  const offenseHasData = teamShotAggregates?.shotsIce.some((v) => v > 0) ?? false
  const defenseHasData = teamGoalieAggregates?.shotsIce.some((v) => v > 0) ?? false

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
        titleName={gameTitle.name}
        {...(clubStats !== null && clubStats.gamesPlayed > 0
          ? { teamGp: clubStats.gamesPlayed }
          : {})}
        {...(recentMatches[0]
          ? { updatedDate: recentMatches[0].playedAt.toISOString().slice(0, 10) }
          : {})}
      />

      {/* Career team stats — live NHL rows for every active title plus
          reviewed archive imports; sources stay separate in the table. */}
      {teamHistory.status === 'unavailable' ? (
        <TeamHistoryUnavailable />
      ) : teamHistory.rows.length > 0 ? (
        <TeamHistoryTable rows={teamHistory.rows} />
      ) : null}

      {/* Skater + Goalie stats — wrapped together in a shared module-frame
          container so they read as one "Player Stats" module, matching the
          depth-chart card frame on /roster (visually-linked sibling). Both
          tables always render together (see `shouldShowPlayerModule`) so
          neither role's independent result — error, explicit empty, or rows
          — can hide the other, or hide its own All Time dataset. */}
      {showPlayerModule ? (
        <section className="module-frame divide-y divide-zinc-800/60">
          <SkaterStatsTable
            rows={skaterRows}
            title="Skaters"
            source={liveSource(gameMode)}
            allTimeRows={allTimeSkaterRows}
            allTimeSource={careerSource('Career totals across all titles · all clubs')}
            allTimeUnavailable={allTimeSkaters.status === 'error'}
            playerMeta={playerMeta}
            state={skaters.status}
            emptyMessage={`No ${emptyModeLabel}skater stats recorded yet.`}
          />
          <GoalieStatsTable
            rows={goalieRows}
            title="Goalies"
            source={liveSource(gameMode)}
            allTimeRows={allTimeGoalieRows}
            allTimeSource={careerSource('Career totals across all titles · all clubs')}
            allTimeUnavailable={allTimeGoalies.status === 'error'}
            playerMeta={playerMeta}
            state={goalies.status}
            emptyMessage={`No ${emptyModeLabel}goalie stats recorded yet.`}
          />
        </section>
      ) : null}

      <ChemistrySection
        withWithout={<WithWithoutTable rows={withWithoutRows} />}
        bestPairs={<BestPairsTable rows={pairRows} />}
        matrix={
          <PairWinMatrix
            data={pairWinMatrix}
            titleName={gameTitle.name}
            clubName="Boogeymen"
            updatedLabel={
              recentMatches[0] ? recentMatches[0].playedAt.toISOString().slice(0, 10) : undefined
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
  // Five archive queries settle independently: a failed one shows its own
  // table's unavailable state (or, for club/team, an explicit "unavailable"
  // message) while every other successfully loaded section stays visible.
  const [clubSkaters, clubGoalies, cardSkaters, cardGoalies, teamRowsResult] = await Promise.all([
    settle('archive club-member skaters', () =>
      gameMode === null
        ? getClubMemberSkaterStatsAllModes(gameTitle.id)
        : getClubMemberSkaterStats(gameTitle.id, gameMode),
    ),
    settle('archive club-member goalies', () =>
      gameMode === null
        ? getClubMemberGoalieStatsAllModes(gameTitle.id)
        : getClubMemberGoalieStats(gameTitle.id, gameMode),
    ),
    settle('archive player-card skaters', () =>
      gameMode === null
        ? getHistoricalSkaterStatsAllModes(gameTitle.id)
        : getHistoricalSkaterStats(gameTitle.id, gameMode),
    ),
    settle('archive player-card goalies', () =>
      gameMode === null
        ? getHistoricalGoalieStatsAllModes(gameTitle.id)
        : getHistoricalGoalieStats(gameTitle.id, gameMode),
    ),
    settle('archive club/team rows', () => getHistoricalClubTeamStats(gameTitle.id, gameMode)),
  ])

  const clubSkatersP = resolveTablePresentation(clubSkaters)
  const clubGoaliesP = resolveTablePresentation(clubGoalies)
  const cardSkatersP = resolveTablePresentation(cardSkaters)
  const cardGoaliesP = resolveTablePresentation(cardGoalies)
  const teamRowsP = resolveTablePresentation(teamRowsResult)

  const modeLabel = gameMode ?? 'combined'

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

      {/* Career Team Stats — the same redesigned presentation used on the
          active title, locked to this one archive title. Rows come from the
          reviewed, mode-filtered archive query above (settled independently
          of every other section); error/empty/rows stay three distinct
          outcomes, none silently dropped. */}
      {teamRowsP.kind === 'error' ? (
        <TeamHistoryUnavailable />
      ) : teamRowsP.kind === 'empty' ? (
        <TeamHistoryTable rows={[]} lockedTitle={gameTitle.name} />
      ) : (
        <TeamHistoryTable
          rows={teamRowsP.rows.map((row) =>
            archiveRowToTeamHistoryInput(row, { id: gameTitle.id, name: gameTitle.name }),
          )}
          lockedTitle={gameTitle.name}
        />
      )}

      <CareerStatsSection
        titleName={gameTitle.name}
        clubScoped={
          <>
            {clubSkatersP.kind === 'rows' ? (
              <SkaterStatsTable
                rows={clubSkatersP.rows}
                title="Skaters"
                source={ARCHIVE_CLUB_MEMBER_SOURCE}
              />
            ) : clubSkatersP.kind === 'error' ? (
              <SkaterStatsTable
                rows={[]}
                title="Skaters"
                source={ARCHIVE_CLUB_MEMBER_SOURCE}
                state="error"
              />
            ) : (
              <EmptyState
                message={`No club-scoped ${modeLabel} skater totals captured for ${gameTitle.name}.`}
              />
            )}
            {clubGoaliesP.kind === 'rows' ? (
              <GoalieStatsTable
                rows={clubGoaliesP.rows}
                title="Goalies"
                source={ARCHIVE_CLUB_MEMBER_SOURCE}
              />
            ) : clubGoaliesP.kind === 'error' ? (
              <GoalieStatsTable
                rows={[]}
                title="Goalies"
                source={ARCHIVE_CLUB_MEMBER_SOURCE}
                state="error"
              />
            ) : (
              <EmptyState
                message={`No club-scoped ${modeLabel} goalie totals captured for ${gameTitle.name}.`}
              />
            )}
          </>
        }
        playerCard={
          <>
            {cardSkatersP.kind === 'rows' ? (
              <SkaterStatsTable
                rows={cardSkatersP.rows}
                title="Skaters"
                source={ARCHIVE_PLAYER_CARD_SOURCE}
              />
            ) : cardSkatersP.kind === 'error' ? (
              <SkaterStatsTable
                rows={[]}
                title="Skaters"
                source={ARCHIVE_PLAYER_CARD_SOURCE}
                state="error"
              />
            ) : (
              <EmptyState
                message={`No player-card ${modeLabel} skater totals for ${gameTitle.name}.`}
              />
            )}
            {cardGoaliesP.kind === 'rows' ? (
              <GoalieStatsTable
                rows={cardGoaliesP.rows}
                title="Goalies"
                source={ARCHIVE_PLAYER_CARD_SOURCE}
              />
            ) : cardGoaliesP.kind === 'error' ? (
              <GoalieStatsTable
                rows={[]}
                title="Goalies"
                source={ARCHIVE_PLAYER_CARD_SOURCE}
                state="error"
              />
            ) : (
              <EmptyState
                message={`No player-card ${modeLabel} goalie totals for ${gameTitle.name}.`}
              />
            )}
          </>
        }
      />
    </PageShell>
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
