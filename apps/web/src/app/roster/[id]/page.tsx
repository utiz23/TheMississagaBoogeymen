import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import type { ReactNode } from 'react'
import {
  getPlayerProfileOverview,
  getPlayerCareerStats,
  getPlayerGamertagHistory,
  getPlayerGameLog,
  countPlayerGameLog,
  getPlayerEASeasonStats,
  getPlayerPositionUsage,
  getGameTitleBySlug,
  getHistoricalGoalieStatsAllModes,
  getHistoricalSkaterStatsAllModes,
} from '@eanhl/db/queries'
import type { GameMode } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import { PositionPill } from '@/components/matches/position-pill'
import { PlayerGameLogSection } from '@/components/roster/player-game-log-section'
import {
  formatMatchDate,
  formatPosition,
  formatRecord,
  formatScore,
} from '@/lib/format'

export const revalidate = 3600

type SearchParams = Promise<Record<string, string | string[] | undefined>>

interface Props {
  params: Promise<{ id: string }>
  searchParams: SearchParams
}

const LOG_PAGE_SIZE = 20
const ROLE_CHIPS = {
  skater: 'Skater',
  goalie: 'Goalie',
} as const

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
  let careerStats: Awaited<ReturnType<typeof getPlayerCareerStats>> = []
  let eaStats: Awaited<ReturnType<typeof getPlayerEASeasonStats>> = []
  let history: Awaited<ReturnType<typeof getPlayerGamertagHistory>> = []
  let gameLog: Awaited<ReturnType<typeof getPlayerGameLog>> = []
  let gameLogTotal = 0

  try {
    ;[overview, careerStats, eaStats, history, gameLog, gameLogTotal] = await Promise.all([
      getPlayerProfileOverview(id),
      getPlayerCareerStats(id, null),
      getPlayerEASeasonStats(id),
      getPlayerGamertagHistory(id),
      getPlayerGameLog(id, gameMode, LOG_PAGE_SIZE, logOffset),
      countPlayerGameLog(id, gameMode),
    ])
  } catch {
    return <ErrorState message="Unable to load player data right now." />
  }

  if (!overview) notFound()

  const { currentLocalSeason, currentEaSeason } = overview
  const hasNoLocalData = currentLocalSeason === null && gameLogTotal === 0

  const gameTitleId = currentEaSeason?.gameTitleId ?? currentLocalSeason?.gameTitleId ?? null
  let positionUsage: Awaited<ReturnType<typeof getPlayerPositionUsage>> = []
  if (gameTitleId !== null) {
    try {
      positionUsage = await getPlayerPositionUsage(id, gameTitleId)
    } catch {
      // non-critical
    }
  }

  const previousSeasonSlug = previousTitleSlug(
    currentEaSeason?.gameTitleSlug ?? currentLocalSeason?.gameTitleSlug ?? null,
  )
  let previousSeasonTotals: PreviousSeasonTotalsRow | null = null
  if (previousSeasonSlug !== null) {
    try {
      const previousTitle = await getGameTitleBySlug(previousSeasonSlug)
      if (previousTitle !== null) {
        const [previousSkaters, previousGoalies] = await Promise.all([
          getHistoricalSkaterStatsAllModes(previousTitle.id),
          getHistoricalGoalieStatsAllModes(previousTitle.id),
        ])
        previousSeasonTotals = buildPreviousSeasonTotals(
          previousTitle.id,
          previousTitle.name,
          previousTitle.slug,
          id,
          previousSkaters,
          previousGoalies,
        )
      }
    } catch {
      // non-critical
    }
  }

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

  const hasHistory = history.some((entry) => entry.seenUntil !== null)

  return (
    <div className="space-y-8">
      <Link
        href="/roster"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <span aria-hidden>←</span> Roster
      </Link>

      <HeroSection
        overview={overview}
        positionUsage={positionUsage}
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

      <CurrentSeasonSection overview={overview} selectedRole={selectedRole} />

      {trendGames.length > 0 && (
        <TrendSection
          trendGames={trendGames}
          selectedRole={selectedRole}
          recentForm={selectedRecentForm}
        />
      )}

      <ContributionSection contribution={selectedContribution} selectedRole={selectedRole} />

      <section id="career" className="space-y-4 scroll-mt-24">
        <SectionHeading
          title="Career Stats"
          subtitle="Locally recorded club history, all modes."
        />
        {careerStats.length === 0 ? (
          <EmptyPanel message="No career stats recorded yet." />
        ) : (
          <CareerStatsTable rows={careerStats} />
        )}
      </section>

      <section id="ea-totals" className="space-y-4 scroll-mt-24">
        <SectionHeading
          title="EA Season Totals"
          subtitle="EA-reported full season aggregates. Not mode-filtered."
        />
        {eaStats.length === 0 ? (
          <EmptyPanel message="No EA season totals available yet." />
        ) : (
          <EASeasonStatsTable rows={eaStats} />
        )}
      </section>

      {previousSeasonTotals !== null && (
        <section id="prev-season" className="space-y-4 scroll-mt-24">
          <SectionHeading
            title="Previous NHL Season"
            subtitle="Historical totals from the prior title, reviewed and archived."
          />
          <PreviousSeasonStatsTable row={previousSeasonTotals} />
        </section>
      )}

      {hasHistory && (
        <section id="history" className="space-y-3 scroll-mt-24">
          <p className="pl-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-600">
            Gamertag History
          </p>
          <div className="divide-y divide-zinc-800/60 border border-zinc-800 bg-surface">
            {history.map((entry) => (
              <div key={entry.id} className="flex items-center gap-4 px-4 py-2.5">
                <span
                  className={`text-sm font-medium ${entry.seenUntil === null ? 'text-zinc-300' : 'text-zinc-600'}`}
                >
                  {entry.gamertag}
                </span>
                <span className="ml-auto text-xs text-zinc-700">
                  {formatMatchDate(entry.seenFrom)}
                  {entry.seenUntil !== null && ` → ${formatMatchDate(entry.seenUntil)}`}
                  {entry.seenUntil === null && (
                    <span className="ml-1.5 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      current
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <PlayerGameLogSection
        playerId={id}
        gameMode={gameMode}
        rows={gameLog}
        total={gameLogTotal}
        logPage={logPage}
        totalPages={Math.ceil(gameLogTotal / LOG_PAGE_SIZE)}
        showMode={gameMode === null}
      />
    </div>
  )
}

// ─── Types ───────────────────────────────────────────────────────────────────

type Overview = NonNullable<Awaited<ReturnType<typeof getPlayerProfileOverview>>>
type CareerRow = Awaited<ReturnType<typeof getPlayerCareerStats>>[number]
type EASeasonRow = Awaited<ReturnType<typeof getPlayerEASeasonStats>>[number]
type GameLogRow = Awaited<ReturnType<typeof getPlayerGameLog>>[number]
type PositionUsageRow = Awaited<ReturnType<typeof getPlayerPositionUsage>>[number]
type HistoricalSkaterSeasonRow = Awaited<
  ReturnType<typeof getHistoricalSkaterStatsAllModes>
>[number]
type HistoricalGoalieSeasonRow = Awaited<
  ReturnType<typeof getHistoricalGoalieStatsAllModes>
>[number]

interface PreviousSeasonTotalsRow {
  gameTitleId: number
  gameTitleName: string
  gameTitleSlug: string
  skaterGp: number
  goals: number
  assists: number
  points: number
  plusMinus: number
  shots: number
  hits: number
  pim: number
  takeaways: number
  giveaways: number
  shotPct: string | null
  goalieGp: number
  goalieWins: number | null
  goalieLosses: number | null
  goalieOtl: number | null
  goalieSavePct: string | null
  goalieGaa: string | null
  goalieShutouts: number | null
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

const POSITION_COLORS: Record<string, string> = {
  center: '#fbbf24',
  leftWing: '#38bdf8',
  rightWing: '#a78bfa',
  defenseMen: '#34d399',
  goalie: '#e11d48',
}
const POSITION_FALLBACK = '#71717a'

function computeSkaterArchetype(
  goals: number,
  assists: number,
  hits: number,
  skaterGp: number,
  plusMinus: number,
): string | null {
  if (skaterGp < 5) return null
  const gPerGp = goals / skaterGp
  const aPerGp = assists / skaterGp
  const hPerGp = hits / skaterGp
  const ptsPerGp = gPerGp + aPerGp
  if (hPerGp >= 3 && ptsPerGp < 0.7) return 'Enforcer'
  if (goals > assists && gPerGp >= 0.35) return 'Sniper'
  if (assists > goals * 1.3 && aPerGp >= 0.3) return 'Playmaker'
  if (plusMinus > 0 && ptsPerGp >= 0.5) return 'Two-Way'
  return 'Balanced'
}

function roleHref(playerId: number, role: 'skater' | 'goalie', gameMode: GameMode | null): string {
  const qs = new URLSearchParams()
  qs.set('role', role)
  if (gameMode !== null) qs.set('mode', gameMode)
  return `/roster/${playerId.toString()}?${qs.toString()}`
}

function HeroSection({
  overview,
  positionUsage,
  selectedRole,
  hasSkaterData,
  hasGoalieData,
  gameMode,
}: {
  overview: Overview
  positionUsage: PositionUsageRow[]
  selectedRole: 'skater' | 'goalie'
  hasSkaterData: boolean
  hasGoalieData: boolean
  gameMode: GameMode | null
}) {
  const { player, primaryRole, currentEaSeason } = overview
  const displayPosition =
    player.preferredPosition ?? currentEaSeason?.favoritePosition ?? player.position
  const positionLabel = displayPosition ? formatPosition(displayPosition) : null
  const showRoleSelector = hasSkaterData && hasGoalieData

  const archetypeLabel =
    primaryRole === 'skater' && currentEaSeason !== null
      ? (computeSkaterArchetype(
          currentEaSeason.goals,
          currentEaSeason.assists,
          currentEaSeason.hits,
          currentEaSeason.skaterGp,
          currentEaSeason.plusMinus,
        ) ?? 'Skater')
      : ROLE_CHIPS[primaryRole]

  const anchorLinks = [
    { href: '#season', label: 'Season' },
    { href: '#form', label: 'Form' },
    { href: '#profile', label: 'Profile' },
    { href: '#career', label: 'Career' },
    { href: '#ea-totals', label: 'EA Totals' },
    { href: '#game-log', label: 'Game Log' },
  ]

  return (
    <section className="relative overflow-hidden border border-zinc-800 border-t-2 border-t-accent bg-surface">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_90%_at_0%_0%,rgba(225,29,72,0.16),transparent_55%),linear-gradient(165deg,rgba(24,24,27,0.55)_15%,rgba(9,9,11,1)_70%)]" />

      {player.jerseyNumber != null && (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 flex select-none items-center pr-2"
          aria-hidden
        >
          <span
            className="font-condensed font-black leading-none text-zinc-50"
            style={{ fontSize: '13rem', opacity: 0.04 }}
          >
            {player.jerseyNumber}
          </span>
        </div>
      )}

      <div className="relative z-10 grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        {/* Identity column */}
        <div className="space-y-4 px-6 py-7 lg:py-8">
          <div className="space-y-1">
            <h1 className="font-condensed text-4xl font-black uppercase tracking-[0.04em] text-zinc-50 sm:text-5xl lg:text-6xl">
              {player.gamertag}
            </h1>
            {player.jerseyNumber != null && (
              <p className="font-condensed text-xl font-bold text-accent">#{player.jerseyNumber}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {displayPosition && positionLabel && (
              <PositionPill
                label={positionLabel}
                position={displayPosition}
                isGoalie={displayPosition === 'goalie'}
              />
            )}
            <HeroChip accent>{archetypeLabel}</HeroChip>
            {player.clubRoleLabel && <HeroChip>{player.clubRoleLabel}</HeroChip>}
            {player.nationality && <HeroChip>{player.nationality}</HeroChip>}
            {!player.isActive && <HeroChip muted>Inactive</HeroChip>}
          </div>

          {player.bio && (
            <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">{player.bio}</p>
          )}

          {showRoleSelector && (
            <div className="flex items-center gap-1">
              <Link
                href={roleHref(player.id, 'skater', gameMode)}
                className={[
                  'rounded border px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors',
                  selectedRole === 'skater'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300',
                ].join(' ')}
              >
                Skater
              </Link>
              <Link
                href={roleHref(player.id, 'goalie', gameMode)}
                className={[
                  'rounded border px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors',
                  selectedRole === 'goalie'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300',
                ].join(' ')}
              >
                Goalie
              </Link>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {anchorLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-full border border-zinc-700 bg-zinc-900/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        {/* Position usage donut — replaces generic silhouette */}
        <div className="relative hidden lg:flex items-start justify-end pb-0 pl-4 pr-6 pt-7 min-w-[220px]">
          <div className="absolute right-7 top-5 opacity-[0.15]">
            <Image
              src="/images/bgm-logo.png"
              alt="Boogeymen"
              width={44}
              height={44}
              className="h-10 w-10 object-contain"
            />
          </div>
          {positionUsage.length > 0 ? (
            <PositionDonut usage={positionUsage} />
          ) : null}
        </div>
      </div>

      {/* Stat strip — role-aware */}
      <HeroStatStrip overview={overview} selectedRole={selectedRole} />
    </section>
  )
}

function PositionDonut({ usage }: { usage: PositionUsageRow[] }) {
  const size = 160
  const strokeWidth = 18
  const cx = size / 2
  const cy = size / 2
  const r = (size - strokeWidth * 2) / 2
  const circumference = 2 * Math.PI * r
  const GAP = 3

  const validUsage = usage.filter(
    (u): u is PositionUsageRow & { position: string } => u.position !== null,
  )
  const total = validUsage.reduce((sum, u) => sum + u.gameCount, 0)

  const cumulativeLengths = validUsage.reduce<number[]>((acc, u) => {
    const prev = acc[acc.length - 1] ?? 0
    const segFull = total > 0 ? (u.gameCount / total) * circumference : 0
    return [...acc, prev + segFull]
  }, [])

  return (
    <div className="flex flex-col items-center gap-3">
      <svg viewBox={`0 0 ${size.toString()} ${size.toString()}`} className="h-[140px] w-[140px]" aria-hidden>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgb(39 39 42)"
          strokeWidth={strokeWidth}
        />
        {total > 0 &&
          validUsage.map((u, i) => {
            const segFull = (u.gameCount / total) * circumference
            const segLen = Math.max(0, segFull - GAP)
            const prevAcc = i === 0 ? 0 : (cumulativeLengths[i - 1] ?? 0)
            const color = POSITION_COLORS[u.position] ?? POSITION_FALLBACK
            return (
              <circle
                key={u.position}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${segLen.toString()} ${(circumference - segLen).toString()}`}
                strokeDashoffset={circumference * 0.25 - prevAcc}
              >
                <title>
                  {formatPosition(u.position)}: {u.gameCount} GP
                </title>
              </circle>
            )
          })}
        <text
          x={cx}
          y={cy - 5}
          textAnchor="middle"
          className="fill-zinc-500 text-[9px] font-bold uppercase tracking-widest"
          fontSize="9"
          fontFamily="inherit"
        >
          Position
        </text>
        <text
          x={cx}
          y={cy + 10}
          textAnchor="middle"
          className="fill-zinc-300 text-[13px] font-black"
          fontSize="13"
          fontFamily="inherit"
          fontWeight="900"
        >
          {total} GP
        </text>
      </svg>
      <div className="flex flex-col gap-1">
        {validUsage.map((u) => (
          <div key={u.position} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: POSITION_COLORS[u.position] ?? POSITION_FALLBACK }}
            />
            <span className="font-condensed text-[11px] font-semibold text-zinc-400">
              {formatPosition(u.position)}
            </span>
            <span className="ml-auto font-condensed text-[11px] text-zinc-600">{u.gameCount}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HeroStatStrip({
  overview,
  selectedRole,
}: {
  overview: Overview
  selectedRole: 'skater' | 'goalie'
}) {
  const { currentEaSeason, currentLocalSeason } = overview
  const skaterGp = currentEaSeason?.skaterGp ?? currentLocalSeason?.skaterGp ?? 0
  const goalieGp = currentEaSeason?.goalieGp ?? 0
  const appearanceRecord =
    currentLocalSeason !== null
      ? formatRecord(
          currentLocalSeason.wins ?? 0,
          currentLocalSeason.losses ?? 0,
          currentLocalSeason.otl ?? 0,
        )
      : '—'

  const stats: { label: string; value: string; featured?: boolean }[] =
    selectedRole === 'goalie'
      ? [
          { label: 'GP', value: goalieGp.toString() },
          {
            label: 'W-L-OTL',
            value: formatRecord(
              currentEaSeason?.goalieWins ?? 0,
              currentEaSeason?.goalieLosses ?? 0,
              currentEaSeason?.goalieOtl ?? 0,
            ),
          },
          {
            label: 'SV%',
            value: formatDbPct(currentEaSeason?.goalieSavePct ?? null),
            featured: true,
          },
          { label: 'GAA', value: currentEaSeason?.goalieGaa ?? '—' },
          { label: 'SO', value: (currentEaSeason?.goalieShutouts ?? 0).toString() },
          { label: 'Saves', value: (currentEaSeason?.goalieSaves ?? 0).toString() },
        ]
      : [
          { label: 'GP', value: skaterGp.toString() },
          {
            label: 'PTS',
            value: (currentEaSeason?.points ?? currentLocalSeason?.points ?? 0).toString(),
            featured: true,
          },
          {
            label: 'PTS / GP',
            value: formatDecimal(
              perGame(currentEaSeason?.points ?? currentLocalSeason?.points ?? 0, skaterGp),
              2,
            ),
          },
          {
            label: 'G',
            value: (currentEaSeason?.goals ?? currentLocalSeason?.goals ?? 0).toString(),
          },
          {
            label: 'A',
            value: (currentEaSeason?.assists ?? currentLocalSeason?.assists ?? 0).toString(),
          },
          {
            label: '+/-',
            value: formatSigned(currentEaSeason?.plusMinus ?? currentLocalSeason?.plusMinus ?? 0),
          },
          {
            label: 'Hits',
            value: (currentEaSeason?.hits ?? currentLocalSeason?.hits ?? 0).toString(),
          },
          { label: 'App. Record', value: appearanceRecord },
        ]

  return (
    <div className="relative z-10 overflow-x-auto border-t border-zinc-800">
      <div className="flex min-w-max divide-x divide-zinc-800">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`min-w-[5rem] px-4 py-3 ${stat.featured ? 'bg-accent/10' : 'bg-zinc-950/30'}`}
          >
            <p
              className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${stat.featured ? 'text-accent/70' : 'text-zinc-600'}`}
            >
              {stat.label}
            </p>
            <p
              className={`mt-1 font-condensed text-xl font-black ${stat.featured ? 'text-accent' : 'text-zinc-100'}`}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Current Season ───────────────────────────────────────────────────────────

function CurrentSeasonSection({
  overview,
  selectedRole,
}: {
  overview: Overview
  selectedRole: 'skater' | 'goalie'
}) {
  const { currentEaSeason, currentLocalSeason } = overview
  if (currentEaSeason === null && currentLocalSeason === null) return null

  const titleName = currentEaSeason?.gameTitleName ?? currentLocalSeason?.gameTitleName ?? 'Current Season'

  if (selectedRole === 'goalie') {
    const gp = currentEaSeason?.goalieGp ?? 0
    if (gp === 0) return null

    return (
      <section id="season" className="space-y-4 scroll-mt-24">
        <SectionHeading
          title="Current Season — Goalie"
          subtitle={`${titleName} · EA-reported full season totals`}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          <SeasonStatCard label="GP" value={gp.toString()} />
          <SeasonStatCard
            label="W-L-OTL"
            value={formatRecord(
              currentEaSeason?.goalieWins ?? 0,
              currentEaSeason?.goalieLosses ?? 0,
              currentEaSeason?.goalieOtl ?? 0,
            )}
          />
          <SeasonStatCard
            label="SV%"
            value={formatDbPct(currentEaSeason?.goalieSavePct ?? null)}
            featured
          />
          <SeasonStatCard label="GAA" value={currentEaSeason?.goalieGaa ?? '—'} />
          <SeasonStatCard label="SO" value={(currentEaSeason?.goalieShutouts ?? 0).toString()} />
          <SeasonStatCard label="Saves" value={(currentEaSeason?.goalieSaves ?? 0).toString()} />
          <SeasonStatCard
            label="Saves / GP"
            value={
              gp > 0
                ? formatDecimal(perGame(currentEaSeason?.goalieSaves ?? 0, gp), 1)
                : '—'
            }
          />
        </div>
      </section>
    )
  }

  // Skater
  const gp = currentEaSeason?.skaterGp ?? currentLocalSeason?.skaterGp ?? 0
  const goals = currentEaSeason?.goals ?? currentLocalSeason?.goals ?? 0
  const assists = currentEaSeason?.assists ?? currentLocalSeason?.assists ?? 0
  const points = currentEaSeason?.points ?? currentLocalSeason?.points ?? 0
  const plusMinus = currentEaSeason?.plusMinus ?? currentLocalSeason?.plusMinus ?? 0
  const hits = currentEaSeason?.hits ?? currentLocalSeason?.hits ?? 0
  const shots = currentEaSeason?.shots ?? currentLocalSeason?.shots ?? 0

  return (
    <section id="season" className="space-y-4 scroll-mt-24">
      <SectionHeading
        title="Current Season — Skater"
        subtitle={`${titleName} · EA-reported full season totals`}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        <SeasonStatCard label="GP" value={gp.toString()} />
        <SeasonStatCard label="PTS" value={points.toString()} featured />
        <SeasonStatCard
          label="PTS / GP"
          value={gp > 0 ? formatDecimal(perGame(points, gp), 2) : '—'}
        />
        <SeasonStatCard label="G" value={goals.toString()} />
        <SeasonStatCard
          label="G / GP"
          value={gp > 0 ? formatDecimal(perGame(goals, gp), 2) : '—'}
        />
        <SeasonStatCard label="A" value={assists.toString()} />
        <SeasonStatCard
          label="A / GP"
          value={gp > 0 ? formatDecimal(perGame(assists, gp), 2) : '—'}
        />
        <SeasonStatCard label="+/-" value={formatSigned(plusMinus)} />
        <SeasonStatCard label="Hits" value={hits.toString()} />
        <SeasonStatCard
          label="Hits / GP"
          value={gp > 0 ? formatDecimal(perGame(hits, gp), 1) : '—'}
        />
        {currentEaSeason?.shotPct !== null && (
          <SeasonStatCard label="SHT%" value={formatDbPct(currentEaSeason?.shotPct ?? null)} />
        )}
        {shots > 0 && gp > 0 && (
          <SeasonStatCard
            label="SOG / GP"
            value={formatDecimal(perGame(shots, gp), 1)}
          />
        )}
      </div>
    </section>
  )
}

function SeasonStatCard({
  label,
  value,
  featured = false,
}: {
  label: string
  value: string
  featured?: boolean
}) {
  return (
    <div
      className={`border px-4 py-3 ${featured ? 'border-accent/30 bg-accent/5' : 'border-zinc-800 bg-surface'}`}
    >
      <p
        className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${featured ? 'text-accent/70' : 'text-zinc-600'}`}
      >
        {label}
      </p>
      <p
        className={`mt-1.5 font-condensed text-2xl font-black ${featured ? 'text-accent' : 'text-zinc-100'}`}
      >
        {value}
      </p>
    </div>
  )
}

// ─── Trend ────────────────────────────────────────────────────────────────────

type RecentForm = Overview['skaterRecentForm']

function TrendSection({
  trendGames,
  selectedRole,
  recentForm,
}: {
  trendGames: GameLogRow[]
  selectedRole: 'skater' | 'goalie'
  recentForm: RecentForm
}) {
  const stats = trendGames.map((g) =>
    selectedRole === 'goalie' ? (g.saves ?? 0) : g.goals + g.assists,
  )
  const maxStat = Math.max(...stats, 1)
  const total = stats.reduce((a, b) => a + b, 0)
  const avg = stats.length > 0 ? total / stats.length : 0

  const chartW = 280
  const chartH = 64
  const barW = Math.max(4, Math.floor((chartW - trendGames.length) / trendGames.length))

  const avgY = chartH - Math.max(2, (avg / maxStat) * (chartH - 4))

  return (
    <section id="form" className="space-y-4 scroll-mt-24">
      <SectionHeading
        title="Recent Form"
        subtitle={`Last ${trendGames.length.toString()} ${selectedRole} appearances · oldest to newest`}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <SurfaceCard>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
            {selectedRole === 'goalie' ? 'Saves per game' : 'Points per game'}
          </p>
          <svg
            viewBox={`0 0 ${chartW.toString()} ${chartH.toString()}`}
            className="w-full"
            style={{ height: `${chartH.toString()}px` }}
            aria-hidden
          >
            {/* Average reference line */}
            <line
              x1="0"
              y1={avgY}
              x2={chartW}
              y2={avgY}
              stroke="rgba(255,255,255,0.07)"
              strokeWidth="1"
              strokeDasharray="4 3"
            />
            {trendGames.map((g, i) => {
              const stat = stats[i] ?? 0
              const barH = Math.max(3, (stat / maxStat) * (chartH - 4))
              const x = i * (barW + 1)
              const color =
                g.result === 'WIN'
                  ? '#10b981'
                  : g.result === 'OTL'
                    ? '#f59e0b'
                    : '#e11d48'
              return (
                <rect
                  key={g.matchId}
                  x={x}
                  y={chartH - barH}
                  width={barW}
                  height={barH}
                  fill={color}
                  rx="1"
                  opacity="0.85"
                >
                  <title>
                    {`vs ${g.opponentName} (${g.result}): ${stat.toString()} ${selectedRole === 'goalie' ? 'saves' : 'pts'}`}
                  </title>
                </rect>
              )
            })}
          </svg>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-600">
            <span>avg {avg.toFixed(1)} / game</span>
            {selectedRole === 'skater' && recentForm?.role === 'skater' && (
              <>
                <span>·</span>
                <span>
                  {recentForm.goals}G / {recentForm.assists}A in last {recentForm.gamesAnalyzed}
                </span>
              </>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500 opacity-85" />
                W
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-amber-500 opacity-85" />
                OT
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-rose-500 opacity-85" />
                L
              </span>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          {recentForm ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Last {recentForm.gamesAnalyzed}
                </p>
                <ResultPips results={recentForm.recentResults as MatchResult[]} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MiniStat
                  label="Record"
                  value={formatRecord(
                    recentForm.record.wins,
                    recentForm.record.losses,
                    recentForm.record.otl,
                  )}
                />
                {recentForm.role === 'skater' ? (
                  <>
                    <MiniStat label="G / A" value={`${recentForm.goals.toString()} / ${recentForm.assists.toString()}`} />
                    <MiniStat
                      label="+/-"
                      value={formatSigned(recentForm.plusMinus)}
                    />
                  </>
                ) : (
                  <>
                    <MiniStat
                      label="SV%"
                      value={recentForm.savePct !== null ? `${recentForm.savePct.toFixed(1)}%` : '—'}
                    />
                    <MiniStat label="GA" value={recentForm.goalsAgainst.toString()} />
                  </>
                )}
              </div>
              {recentForm.bestGame && (
                <div className="border-t border-zinc-800/60 pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent/60">
                    Best Recent
                  </p>
                  <Link
                    href={`/games/${recentForm.bestGame.matchId.toString()}`}
                    className="mt-1.5 block font-condensed text-sm font-bold uppercase tracking-wide text-zinc-200 transition-colors hover:text-accent"
                  >
                    vs {recentForm.bestGame.opponentName}
                  </Link>
                  <p className="mt-0.5 text-xs text-zinc-600">
                    {formatMatchDate(recentForm.bestGame.playedAt)} ·{' '}
                    {formatScore(recentForm.bestGame.scoreFor, recentForm.bestGame.scoreAgainst)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">
                    {recentForm.role === 'goalie'
                      ? `${(recentForm.bestGame.saves ?? 0).toString()} saves, ${(recentForm.bestGame.goalsAgainst ?? 0).toString()} GA`
                      : `${recentForm.bestGame.goals.toString()} G · ${recentForm.bestGame.assists.toString()} A · ${(recentForm.bestGame.goals + recentForm.bestGame.assists).toString()} PTS`}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No recent appearances tracked yet.</p>
          )}
        </SurfaceCard>
      </div>
    </section>
  )
}

// ─── Contribution (donut) ─────────────────────────────────────────────────────

const CONTRIBUTION_COLORS = [
  '#e11d48',
  '#fbbf24',
  '#38bdf8',
  '#34d399',
  '#a78bfa',
  '#fb923c',
]

function ContributionSection({
  contribution,
  selectedRole,
}: {
  contribution: Overview['skaterContribution']
  selectedRole: 'skater' | 'goalie'
}) {
  return (
    <section id="profile" className="space-y-4 scroll-mt-24">
      <SectionHeading
        title="Season Profile"
        subtitle={`Normalized vs teammates in the same role · ${selectedRole === 'skater' ? 'skater' : 'goalie'} view`}
      />
      {!contribution || contribution.metrics.length === 0 ? (
        <EmptyPanel message="Not enough data to compute a season profile yet." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <SurfaceCard className="flex flex-col items-center justify-center gap-4 py-6">
            <ContributionDonut metrics={contribution.metrics} />
            <p className="text-[11px] text-zinc-600">
              Based on {contribution.sampleSize} {contribution.role} appearances
            </p>
          </SurfaceCard>
          <SurfaceCard>
            <p className="font-condensed text-base font-bold uppercase tracking-wide text-zinc-100">
              {ROLE_CHIPS[contribution.role]} Profile
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {contribution.metrics.map((metric, i) => (
                <MetricBar
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  color={CONTRIBUTION_COLORS[i % CONTRIBUTION_COLORS.length] ?? '#e11d48'}
                />
              ))}
            </div>
          </SurfaceCard>
        </div>
      )}
    </section>
  )
}

function ContributionDonut({
  metrics,
}: {
  metrics: NonNullable<Overview['skaterContribution']>['metrics']
}) {
  const size = 180
  const strokeWidth = 20
  const cx = size / 2
  const cy = size / 2
  const r = (size - strokeWidth * 2) / 2
  const circumference = 2 * Math.PI * r
  const GAP = 3

  const total = metrics.reduce((sum, m) => sum + Math.max(m.value, 0), 0)

  const cumulativeLengths = metrics.reduce<number[]>((acc, m) => {
    const prev = acc[acc.length - 1] ?? 0
    const segFull = total > 0 ? (Math.max(m.value, 0) / total) * circumference : 0
    return [...acc, prev + segFull]
  }, [])

  return (
    <svg viewBox={`0 0 ${size.toString()} ${size.toString()}`} className="h-[160px] w-[160px]" aria-hidden>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="rgb(39 39 42)"
        strokeWidth={strokeWidth}
      />
      {total > 0 &&
        metrics.map((metric, i) => {
          const segFull = (Math.max(metric.value, 0) / total) * circumference
          const segLen = Math.max(0, segFull - GAP)
          const prevAcc = i === 0 ? 0 : (cumulativeLengths[i - 1] ?? 0)
          return (
            <circle
              key={metric.label}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={CONTRIBUTION_COLORS[i % CONTRIBUTION_COLORS.length]}
              strokeWidth={strokeWidth}
              strokeDasharray={`${segLen.toString()} ${(circumference - segLen).toString()}`}
              strokeDashoffset={circumference * 0.25 - prevAcc}
            >
              <title>
                {metric.label}: {Math.round(metric.value).toString()}
              </title>
            </circle>
          )
        })}
    </svg>
  )
}

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-300">{label}</span>
        <span className="text-xs tabular text-zinc-500">{Math.round(value).toString()}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(4, value).toString()}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

// ─── Career Stats Table ───────────────────────────────────────────────────────

interface StatCol {
  key: string
  label: string
  render: (row: CareerRow) => ReactNode
}

const SKATER_COLS: StatCol[] = [
  { key: 'gp', label: 'GP', render: (row) => row.skaterGp },
  { key: 'g', label: 'G', render: (row) => row.goals },
  { key: 'a', label: 'A', render: (row) => row.assists },
  { key: 'pts', label: 'PTS', render: (row) => row.points },
  {
    key: 'ptspgp',
    label: 'P/GP',
    render: (row) => formatDecimal(perGame(row.points, row.skaterGp), 2),
  },
  {
    key: 'pm',
    label: '+/-',
    render: (row) => (
      <span className={signedClass(row.plusMinus)}>{formatSigned(row.plusMinus)}</span>
    ),
  },
  { key: 'sog', label: 'SOG', render: (row) => row.shots },
  { key: 'hits', label: 'Hits', render: (row) => row.hits },
  { key: 'pim', label: 'PIM', render: (row) => row.pim },
  { key: 'ta', label: 'TA', render: (row) => row.takeaways },
  { key: 'gv', label: 'GV', render: (row) => row.giveaways },
]

const GOALIE_COLS: StatCol[] = [
  { key: 'ggp', label: 'G-GP', render: (row) => row.goalieGp },
  { key: 'w', label: 'W', render: (row) => row.wins ?? '—' },
  { key: 'l', label: 'L', render: (row) => row.losses ?? '—' },
  { key: 'otl', label: 'OTL', render: (row) => row.otl ?? '—' },
  { key: 'svpct', label: 'SV%', render: (row) => formatDbPct(row.savePct) },
  { key: 'gaa', label: 'GAA', render: (row) => row.gaa ?? '—' },
]

function CareerStatsTable({ rows }: { rows: CareerRow[] }) {
  const hasGoalie = rows.some((row) => row.goalieGp > 0)

  return (
    <div className="overflow-x-auto border border-zinc-800 bg-surface">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="py-2 pl-4 pr-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Season
            </th>
            {SKATER_COLS.map((col) => (
              <th
                key={col.key}
                className={`px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider ${col.key === 'ptspgp' ? 'text-accent/60' : 'text-zinc-600'}`}
              >
                {col.label}
              </th>
            ))}
            {hasGoalie &&
              GOALIE_COLS.map((col) => (
                <th
                  key={col.key}
                  className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600"
                >
                  {col.label}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <CareerStatsDataRow key={row.gameTitleId} row={row} hasGoalie={hasGoalie} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CareerStatsDataRow({ row, hasGoalie }: { row: CareerRow; hasGoalie: boolean }) {
  return (
    <tr className="border-b border-zinc-800/60 transition-colors last:border-0 hover:bg-surface-raised">
      <td className="py-2.5 pl-4 pr-2 text-sm font-medium text-zinc-300">
        <Link
          href={`/stats?title=${encodeURIComponent(row.gameTitleSlug)}`}
          className="transition-colors hover:text-accent hover:underline"
        >
          {row.gameTitleName}
        </Link>
      </td>
      {SKATER_COLS.map((col) => (
        <td
          key={col.key}
          className={`px-2 py-2.5 text-right text-sm tabular ${col.key === 'ptspgp' ? 'font-semibold text-accent/80' : 'text-zinc-300'}`}
        >
          {col.render(row)}
        </td>
      ))}
      {hasGoalie &&
        GOALIE_COLS.map((col) => (
          <td key={col.key} className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
            {col.render(row)}
          </td>
        ))}
    </tr>
  )
}

// ─── EA Season Stats Table ────────────────────────────────────────────────────

interface EAStatCol {
  key: string
  label: string
  render: (row: EASeasonRow) => ReactNode
}

const EA_SKATER_COLS: EAStatCol[] = [
  { key: 'gp', label: 'GP', render: (row) => row.skaterGp },
  { key: 'g', label: 'G', render: (row) => row.goals },
  { key: 'a', label: 'A', render: (row) => row.assists },
  { key: 'pts', label: 'PTS', render: (row) => row.points },
  {
    key: 'ptspgp',
    label: 'P/GP',
    render: (row) => formatDecimal(perGame(row.points, row.skaterGp), 2),
  },
  {
    key: 'pm',
    label: '+/-',
    render: (row) => (
      <span className={signedClass(row.plusMinus)}>{formatSigned(row.plusMinus)}</span>
    ),
  },
  { key: 'sog', label: 'SOG', render: (row) => row.shots },
  { key: 'hits', label: 'Hits', render: (row) => row.hits },
  { key: 'pim', label: 'PIM', render: (row) => row.pim },
  { key: 'shtpct', label: 'SHT%', render: (row) => formatDbPct(row.shotPct) },
  { key: 'ta', label: 'TA', render: (row) => row.takeaways },
  { key: 'gv', label: 'GV', render: (row) => row.giveaways },
]

const EA_GOALIE_COLS: EAStatCol[] = [
  { key: 'ggp', label: 'G-GP', render: (row) => row.goalieGp },
  { key: 'w', label: 'W', render: (row) => row.goalieWins ?? '—' },
  { key: 'l', label: 'L', render: (row) => row.goalieLosses ?? '—' },
  { key: 'otl', label: 'OTL', render: (row) => row.goalieOtl ?? '—' },
  { key: 'svpct', label: 'SV%', render: (row) => formatDbPct(row.goalieSavePct) },
  { key: 'gaa', label: 'GAA', render: (row) => row.goalieGaa ?? '—' },
  { key: 'so', label: 'SO', render: (row) => row.goalieShutouts ?? '—' },
]

function EASeasonStatsTable({ rows }: { rows: EASeasonRow[] }) {
  const hasGoalie = rows.some((row) => row.goalieGp > 0)

  return (
    <div className="overflow-x-auto border border-zinc-800 bg-surface">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="py-2 pl-4 pr-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Season
            </th>
            {EA_SKATER_COLS.map((col) => (
              <th
                key={col.key}
                className={`px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider ${col.key === 'ptspgp' ? 'text-accent/60' : 'text-zinc-600'}`}
              >
                {col.label}
              </th>
            ))}
            {hasGoalie &&
              EA_GOALIE_COLS.map((col) => (
                <th
                  key={col.key}
                  className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600"
                >
                  {col.label}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <EASeasonStatsDataRow key={row.gameTitleId} row={row} hasGoalie={hasGoalie} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EASeasonStatsDataRow({ row, hasGoalie }: { row: EASeasonRow; hasGoalie: boolean }) {
  return (
    <tr className="border-b border-zinc-800/60 transition-colors last:border-0 hover:bg-surface-raised">
      <td className="py-2.5 pl-4 pr-2 text-sm font-medium text-zinc-300">
        <Link
          href={`/stats?title=${encodeURIComponent(row.gameTitleSlug)}`}
          className="transition-colors hover:text-accent hover:underline"
        >
          {row.gameTitleName}
        </Link>
      </td>
      {EA_SKATER_COLS.map((col) => (
        <td
          key={col.key}
          className={`px-2 py-2.5 text-right text-sm tabular ${col.key === 'ptspgp' ? 'font-semibold text-accent/80' : 'text-zinc-300'}`}
        >
          {col.render(row)}
        </td>
      ))}
      {hasGoalie &&
        EA_GOALIE_COLS.map((col) => (
          <td key={col.key} className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
            {col.render(row)}
          </td>
        ))}
    </tr>
  )
}

// ─── Previous Season Stats Table ──────────────────────────────────────────────

function PreviousSeasonStatsTable({ row }: { row: PreviousSeasonTotalsRow }) {
  return (
    <div className="overflow-x-auto border border-zinc-800 bg-surface">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="py-2 pl-4 pr-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Season
            </th>
            {EA_SKATER_COLS.map((col) => (
              <th
                key={col.key}
                className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600"
              >
                {col.label}
              </th>
            ))}
            {['G-GP', 'W', 'L', 'OTL', 'SV%', 'GAA', 'SO'].map((h) => (
              <th
                key={h}
                className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <PreviousSeasonStatsDataRow row={row} />
        </tbody>
      </table>
    </div>
  )
}

function PreviousSeasonStatsDataRow({ row }: { row: PreviousSeasonTotalsRow }) {
  return (
    <tr className="border-b border-zinc-800/60 transition-colors last:border-0 hover:bg-surface-raised">
      <td className="py-2.5 pl-4 pr-2 text-sm font-medium text-zinc-300">
        <Link
          href={`/stats?title=${encodeURIComponent(row.gameTitleSlug)}`}
          className="transition-colors hover:text-accent hover:underline"
        >
          {row.gameTitleName}
        </Link>
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">{row.skaterGp}</td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">{row.goals}</td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">{row.assists}</td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">{row.points}</td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {formatDecimal(perGame(row.points, row.skaterGp), 2)}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        <span className={signedClass(row.plusMinus)}>{formatSigned(row.plusMinus)}</span>
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">{row.shots}</td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">{row.hits}</td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">{row.pim}</td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {formatDbPct(row.shotPct)}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">{row.takeaways}</td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">{row.giveaways}</td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">{row.goalieGp}</td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {row.goalieWins ?? '—'}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {row.goalieLosses ?? '—'}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {row.goalieOtl ?? '—'}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {formatDbPct(row.goalieSavePct)}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {row.goalieGaa ?? '—'}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {row.goalieShutouts ?? '—'}
      </td>
    </tr>
  )
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="border-l-2 border-l-accent pl-3">
      <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-300">
        {title}
      </h2>
      <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
    </div>
  )
}

function SurfaceCard({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`border border-zinc-800 bg-surface p-4 ${className}`}>{children}</div>
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-1.5 font-condensed text-xl font-black text-zinc-100">{value}</p>
    </div>
  )
}

function HeroChip({
  children,
  accent = false,
  muted = false,
}: {
  children: ReactNode
  accent?: boolean
  muted?: boolean
}) {
  const classes = accent
    ? 'border-accent/40 bg-accent/10 text-accent'
    : muted
      ? 'border-zinc-700 bg-zinc-900 text-zinc-500'
      : 'border-zinc-700 bg-zinc-900 text-zinc-300'

  return (
    <span
      className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${classes}`}
    >
      {children}
    </span>
  )
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="flex min-h-[6rem] items-center justify-center border border-zinc-800 bg-surface">
      <p className="px-4 text-center text-sm text-zinc-500">{message}</p>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
      <p className="text-sm text-zinc-500">{message}</p>
    </div>
  )
}

type MatchResult = 'WIN' | 'LOSS' | 'OTL' | 'DNF'

function ResultPips({ results }: { results: MatchResult[] }) {
  if (results.length === 0) return null
  return (
    <div className="flex items-center gap-1" aria-label="Recent results">
      {results.map((r, i) => {
        const color =
          r === 'WIN'
            ? 'bg-emerald-500'
            : r === 'LOSS'
              ? 'bg-rose-600'
              : r === 'OTL'
                ? 'bg-amber-500'
                : 'bg-zinc-600'
        return (
          <span
            key={i}
            className={`block h-2.5 w-2.5 rounded-sm ${color}`}
            aria-label={r}
            title={r}
          />
        )
      })}
    </div>
  )
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function perGame(value: number | null, gp: number): number | null {
  if (value === null || gp <= 0) return null
  return value / gp
}

function formatDecimal(value: number | null, digits: number): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

function formatDbPct(value: string | null): string {
  return value === null ? '—' : `${value}%`
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value.toString()}` : value.toString()
}

function signedClass(value: number): string {
  if (value > 0) return 'text-emerald-400'
  if (value < 0) return 'text-rose-400'
  return 'text-zinc-400'
}

function previousTitleSlug(currentSlug: string | null): string | null {
  if (currentSlug === null) return null
  const year = Number.parseInt(currentSlug.replace(/^\D+/u, ''), 10)
  if (!Number.isFinite(year) || year <= 0) return null
  return `nhl${(year - 1).toString()}`
}

function buildPreviousSeasonTotals(
  gameTitleId: number,
  gameTitleName: string,
  gameTitleSlug: string,
  playerId: number,
  skaters: HistoricalSkaterSeasonRow[],
  goalies: HistoricalGoalieSeasonRow[],
): PreviousSeasonTotalsRow | null {
  const skater = skaters.find((row) => row.playerId === playerId) ?? null
  const goalie = goalies.find((row) => row.playerId === playerId) ?? null

  if (skater === null && goalie === null) return null

  const shotPct =
    skater !== null && skater.shots > 0
      ? ((skater.goals / skater.shots) * 100).toFixed(2)
      : null

  return {
    gameTitleId,
    gameTitleName,
    gameTitleSlug,
    skaterGp: skater?.gamesPlayed ?? 0,
    goals: skater?.goals ?? 0,
    assists: skater?.assists ?? 0,
    points: skater?.points ?? 0,
    plusMinus: skater?.plusMinus ?? 0,
    shots: skater?.shots ?? 0,
    hits: skater?.hits ?? 0,
    pim: skater?.pim ?? 0,
    takeaways: skater?.takeaways ?? 0,
    giveaways: skater?.giveaways ?? 0,
    shotPct,
    goalieGp: goalie?.gamesPlayed ?? 0,
    goalieWins: goalie?.wins ?? null,
    goalieLosses: goalie?.losses ?? null,
    goalieOtl: goalie?.otl ?? null,
    goalieSavePct: goalie?.savePct ?? null,
    goalieGaa: goalie?.gaa ?? null,
    goalieShutouts: goalie?.shutouts ?? null,
  }
}
