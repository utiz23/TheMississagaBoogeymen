import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  getPlayerProfileOverview,
  getPlayerCareerSeasons,
  getPlayerGamertagHistory,
  getPlayerGameLog,
  countPlayerGameLog,
  getPlayerEASeasonStats,
  getAllEASeasonStatsForGameTitle,
  getTeamAverageShotLocations,
  getTeamAverageGoalieShotLocations,
  getPlayerLoadoutSnapshots,
  getPlayerCareerShots,
  getPlayerCardProgress,
} from '@eanhl/db/queries'
import type { GameMode } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import { PlayerGameLogSection } from '@/components/roster/player-game-log-section'
import { ClubStatsTabs } from '@/components/roster/club-stats-tabs'
import { ContributionSection } from '@/components/roster/contribution-section'
import { TrendChart } from '@/components/roster/trend-chart'
import { ProfileHero } from '@/components/roster/profile-hero'
import { CareerSeasonsTable } from '@/components/roster/career-seasons-table'
import { StatsRecordCard } from '@/components/roster/stats-record-card'
import { ChartsVisualsSection } from '@/components/roster/charts-visuals-section'
import { ComingSoonCard } from '@/components/roster/coming-soon-card'
import { ShotMap } from '@/components/roster/shot-map'
import { LoadoutHistoryStrip } from '@/components/roster/loadout-history-strip'
import { CareerShotMap } from '@/components/roster/career-shot-map'
import { Panel } from '@/components/ui/panel'
import { PlayerBadges } from '@/components/badges/player-badges'

export const revalidate = 3600

type SearchParams = Promise<Record<string, string | string[] | undefined>>

interface Props {
  params: Promise<{ id: string }>
  searchParams: SearchParams
}

const LOG_PAGE_SIZE = 20

function parseGameMode(raw: string | string[] | undefined): GameMode | null {
  if (typeof raw !== 'string') return null
  return (GAME_MODE as readonly string[]).includes(raw) ? (raw as GameMode) : null
}

function parseLogPage(raw: string | string[] | undefined): number {
  if (typeof raw !== 'string') return 1
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

function parseRole(raw: string | string[] | undefined): 'skater' | 'goalie' | null {
  if (raw === 'skater') return 'skater'
  if (raw === 'goalie') return 'goalie'
  return null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) return { title: 'Player Not Found — Club Stats' }

  try {
    const overview = await getPlayerProfileOverview(id)
    if (!overview) return { title: 'Player Not Found — Club Stats' }
    return { title: `PREVIEW · ${overview.player.gamertag} — Club Stats` }
  } catch {
    return { title: 'Player — Club Stats' }
  }
}

export default async function PreviewPlayerPage({ params, searchParams }: Props) {
  // Test-run page (spec "Test run"): never served in production. Deleted at the switch.
  if (process.env.NODE_ENV === 'production') notFound()
  const { id: idStr } = await params
  const sp = await searchParams
  const gameMode = parseGameMode(sp.mode)
  const logPage = parseLogPage(sp.logPage)
  const logOffset = (logPage - 1) * LOG_PAGE_SIZE
  const urlRole = parseRole(sp.role)
  const id = parseInt(idStr, 10)

  if (isNaN(id)) notFound()

  let overview: Awaited<ReturnType<typeof getPlayerProfileOverview>> = null
  let careerSeasons: Awaited<ReturnType<typeof getPlayerCareerSeasons>> = []
  let eaStats: Awaited<ReturnType<typeof getPlayerEASeasonStats>> = []
  let history: Awaited<ReturnType<typeof getPlayerGamertagHistory>> = []
  let gameLog: Awaited<ReturnType<typeof getPlayerGameLog>> = []
  let gameLogTotal = 0

  try {
    ;[overview, careerSeasons, eaStats, history, gameLog, gameLogTotal] = await Promise.all([
      getPlayerProfileOverview(id),
      getPlayerCareerSeasons(id),
      getPlayerEASeasonStats(id),
      getPlayerGamertagHistory(id),
      getPlayerGameLog(id, gameMode, LOG_PAGE_SIZE, logOffset),
      countPlayerGameLog(id, gameMode),
    ])
  } catch {
    return <ErrorState message="Unable to load player data right now." />
  }

  let loadoutSnapshots: Awaited<ReturnType<typeof getPlayerLoadoutSnapshots>> = []
  try {
    loadoutSnapshots = await getPlayerLoadoutSnapshots(id, 4)
  } catch {
    loadoutSnapshots = []
  }

  let careerShots: Awaited<ReturnType<typeof getPlayerCareerShots>> = []
  try {
    careerShots = await getPlayerCareerShots(id, 500)
  } catch {
    careerShots = []
  }

  let cardProgress: Awaited<ReturnType<typeof getPlayerCardProgress>> | null = null
  try {
    cardProgress = await getPlayerCardProgress(id)
  } catch {
    cardProgress = null
  }

  // Club Stats and both zone maps describe the player's newest EA title, so
  // the teammate pool and team baselines come from that same title.
  const focalEaRow = eaStats[0]

  let teamAverage: Awaited<ReturnType<typeof getTeamAverageShotLocations>> | null = null
  try {
    if (focalEaRow !== undefined) {
      teamAverage = await getTeamAverageShotLocations(focalEaRow.gameTitleId)
    }
  } catch {
    teamAverage = null
  }

  let teamGoalieAverage: Awaited<ReturnType<typeof getTeamAverageGoalieShotLocations>> | null = null
  try {
    if (focalEaRow !== undefined) {
      teamGoalieAverage = await getTeamAverageGoalieShotLocations(focalEaRow.gameTitleId)
    }
  } catch {
    teamGoalieAverage = null
  }

  let teammates: Awaited<ReturnType<typeof getAllEASeasonStatsForGameTitle>> = []
  try {
    if (focalEaRow !== undefined) {
      teammates = await getAllEASeasonStatsForGameTitle(focalEaRow.gameTitleId)
    }
  } catch {
    teammates = []
  }

  if (!overview) notFound()

  const { currentLocalSeason, currentEaSeason } = overview
  const hasNoLocalData = currentLocalSeason === null && gameLogTotal === 0

  // Role selection
  const hasSkaterData =
    (currentEaSeason?.skaterGp ?? 0) > 0 || (currentLocalSeason?.skaterGp ?? 0) > 0
  const hasGoalieData =
    (currentEaSeason?.goalieGp ?? 0) > 0 || (currentLocalSeason?.goalieGp ?? 0) > 0

  const selectedRole: 'skater' | 'goalie' =
    urlRole === 'goalie' && hasGoalieData
      ? 'goalie'
      : urlRole === 'skater' && hasSkaterData
        ? 'skater'
        : overview.primaryRole

  const selectedContribution =
    selectedRole === 'skater' ? overview.skaterContribution : overview.goalieContribution

  // Trend: role-filtered, oldest first, max 15
  const trendGames = [...overview.trendGames]
    .filter((g) => g.isGoalie === (selectedRole === 'goalie'))
    .slice(0, 15)
    .reverse()

  return (
    <div className="space-y-8">
      <Link
        prefetch
        href="/roster"
        className="inline-flex items-center gap-1.5 font-condensed text-xs font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <span aria-hidden>←</span> Roster
      </Link>

      <ProfileHero
        overview={overview}
        career={careerSeasons}
        history={history}
        selectedRole={selectedRole}
        hasSkaterData={hasSkaterData}
        hasGoalieData={hasGoalieData}
        gameMode={gameMode}
      />

      <PlayerBadges gamertag={overview.player.gamertag} rows={cardProgress?.badges ?? []} />

      {hasNoLocalData && (
        <Panel className="px-4 py-3">
          <p className="font-condensed text-sm text-zinc-400">
            <span className="font-semibold uppercase tracking-wider text-zinc-300">
              No local match history yet.
            </span>{' '}
            This player is registered but has not appeared in a tracked match. EA season totals may
            still show while local sections stay empty.
          </p>
        </Panel>
      )}

      <StatsRecordCard
        seasonTable={<CareerSeasonsTable seasons={careerSeasons} selectedRole={selectedRole} />}
        gameLog={
          <PlayerGameLogSection
            playerId={id}
            gameMode={gameMode}
            rows={gameLog}
            total={gameLogTotal}
            logPage={logPage}
            totalPages={Math.ceil(gameLogTotal / LOG_PAGE_SIZE)}
            showMode={gameMode === null}
          />
        }
      />

      {eaStats[0] !== undefined && (
        <ClubStatsTabs
          season={eaStats[0]}
          gamertag={overview.player.gamertag}
          teammates={teammates}
          role={selectedRole}
        />
      )}

      <ContributionSection
        contribution={selectedContribution}
        selectedRole={selectedRole}
        skaterSeason={eaStats[0] ?? null}
        teammates={teammates}
        playerId={overview.player.id}
        gamertag={overview.player.gamertag}
        gameTitleName={eaStats[0]?.gameTitleName}
        updatedAt={eaStats[0]?.lastFetchedAt}
      />

      <LoadoutHistoryStrip snapshots={loadoutSnapshots} />

      <CareerShotMap events={careerShots} />

      {selectedRole === 'skater' && focalEaRow !== undefined && (
        <ShotMap
          role="skater"
          player={focalEaRow.shotLocations}
          teamAverage={teamAverage ?? emptyShotLocations()}
          hasData={teamAverage !== null && focalEaRow.shotLocations !== null}
          titleName={focalEaRow.gameTitleName}
          gamertag={overview.player.gamertag}
          playerGp={focalEaRow.skaterGp}
          updatedDate={new Date().toISOString().slice(0, 10)}
        />
      )}
      {selectedRole === 'goalie' && focalEaRow !== undefined && (
        <ShotMap
          role="goalie"
          player={focalEaRow.goalieShotLocations}
          teamAverage={teamGoalieAverage ?? emptyShotLocations()}
          hasData={teamGoalieAverage !== null && focalEaRow.goalieShotLocations !== null}
          titleName={focalEaRow.gameTitleName}
          gamertag={overview.player.gamertag}
          playerGp={focalEaRow.goalieGp}
          updatedDate={new Date().toISOString().slice(0, 10)}
        />
      )}

      <ChartsVisualsSection
        trendChart={
          trendGames.length > 0 ? (
            <TrendChart trendGames={trendGames} selectedRole={selectedRole} />
          ) : (
            <ComingSoonCard
              title="Recent Form Trend"
              description="Per-game performance bars for the last 15 appearances. Will populate once enough game data is available."
            />
          )
        }
      />
    </div>
  )
}

function emptyShotLocations() {
  return {
    shotsIce: new Array(16).fill(0),
    goalsIce: new Array(16).fill(0),
    shotsNet: new Array(5).fill(0),
    goalsNet: new Array(5).fill(0),
  }
}

function ErrorState({ message }: { message: string }) {
  return (
    <Panel className="flex min-h-[12rem] items-center justify-center">
      <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">{message}</p>
    </Panel>
  )
}
