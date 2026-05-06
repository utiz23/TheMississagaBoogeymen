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
  getTeamAverageShotLocations,
} from '@eanhl/db/queries'
import type { GameMode } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import { PlayerGameLogSection } from '@/components/roster/player-game-log-section'
import { ClubStatsTabs } from '@/components/roster/club-stats-tabs'
import { ContributionSection } from '@/components/roster/contribution-section'
import { RecentFormStrip } from '@/components/roster/recent-form-strip'
import { TrendChart } from '@/components/roster/trend-chart'
import { ProfileHero } from '@/components/roster/profile-hero'
import { CareerSeasonsTable } from '@/components/roster/career-seasons-table'
import { StatsRecordCard } from '@/components/roster/stats-record-card'
import { ChartsVisualsSection } from '@/components/roster/charts-visuals-section'
import { ComingSoonCard } from '@/components/roster/coming-soon-card'
import { ShotMap } from '@/components/roster/shot-map'

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
    return { title: `${overview.player.gamertag} — Club Stats` }
  } catch {
    return { title: 'Player — Club Stats' }
  }
}

export default async function PlayerPage({ params, searchParams }: Props) {
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

  let teamAverage: Awaited<ReturnType<typeof getTeamAverageShotLocations>> | null = null
  try {
    teamAverage = await getTeamAverageShotLocations(1)
  } catch {
    teamAverage = null
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
  const selectedRecentForm =
    selectedRole === 'skater' ? overview.skaterRecentForm : overview.goalieRecentForm

  // Trend: role-filtered, oldest first, max 15
  const trendGames = [...overview.trendGames]
    .filter((g) => g.isGoalie === (selectedRole === 'goalie'))
    .slice(0, 15)
    .reverse()

  return (
    <div className="space-y-8">
      <Link
        href="/roster"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
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

      {hasNoLocalData && (
        <div className="rounded border border-zinc-700 bg-zinc-900 px-4 py-3">
          <p className="text-sm text-zinc-400">
            <span className="font-semibold text-zinc-300">No local match history yet.</span> This
            player is registered but has not appeared in a tracked match. EA season totals may still
            show while local sections stay empty.
          </p>
        </div>
      )}

      <RecentFormStrip recentForm={selectedRecentForm} selectedRole={selectedRole} />

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

      {selectedRole === 'skater' && eaStats[0] !== undefined && <ClubStatsTabs season={eaStats[0]} />}
      {selectedRole === 'goalie' && (
        <ComingSoonCard
          title="Goalie Club Stats"
          description="Goalie Overview, Saves, and Situations tabs (matching ChelHead Tabs 6-8) coming in a future update."
        />
      )}

      <ContributionSection contribution={selectedContribution} selectedRole={selectedRole} />

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
        shotMap={
          overview.primaryRole === 'goalie' ? undefined : (
            <ShotMap
              player={resolveNhl26ShotLocations(eaStats)}
              teamAverage={teamAverage ?? emptyShotLocations()}
              hasData={teamAverage !== null && resolveNhl26ShotLocations(eaStats) !== null}
            />
          )
        }
      />
    </div>
  )
}

function resolveNhl26ShotLocations(
  rows: Awaited<ReturnType<typeof getPlayerEASeasonStats>>,
) {
  const nhl26 = rows.find((r) => r.gameTitleSlug === 'nhl26')
  return nhl26?.shotLocations ?? null
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
    <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
      <p className="text-sm text-zinc-500">{message}</p>
    </div>
  )
}
