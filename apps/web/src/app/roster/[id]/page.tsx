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
} from '@eanhl/db/queries'
import type { GameMode } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import { ResultBadge } from '@/components/ui/result-badge'
import { PlayerSilhouette } from '@/components/home/player-card'
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
      getPlayerCareerStats(id, gameMode),
      getPlayerEASeasonStats(id),
      getPlayerGamertagHistory(id),
      getPlayerGameLog(id, gameMode, LOG_PAGE_SIZE, logOffset),
      countPlayerGameLog(id, gameMode),
    ])
  } catch {
    return <ErrorState message="Unable to load player data right now." />
  }

  if (!overview) notFound()

  const { currentLocalSeason } = overview
  const hasHistory = history.some((entry) => entry.seenUntil !== null)
  const hasNoLocalData = currentLocalSeason === null && gameLogTotal === 0

  return (
    <div className="space-y-8">
      <Link
        href="/roster"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <span aria-hidden>←</span> Roster
      </Link>

      <HeroSection overview={overview} />

      {hasNoLocalData && (
        <div className="rounded border border-zinc-700 bg-zinc-900 px-4 py-3">
          <p className="text-sm text-zinc-400">
            <span className="font-semibold text-zinc-300">No local match history yet.</span> This
            player is registered as a club member but has not appeared in a tracked match. The EA
            season snapshot may still show totals while local sections stay empty until new games
            are ingested.
          </p>
        </div>
      )}

      <section id="overview" className="space-y-8 scroll-mt-24">
        <CurrentSeasonSnapshotSection overview={overview} />
        <ContributionWheelSection overview={overview} />
        <RecentFormSection overview={overview} />
      </section>

      <section id="career" className="space-y-4 scroll-mt-24">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Career Stats
            </h2>
            <p className="mt-0.5 text-xs text-zinc-600">
              Locally recorded club history. Filter applies to this table and the game log below.
            </p>
          </div>
          <GameModeFilter playerId={id} activeMode={gameMode} />
        </div>

        {careerStats.length === 0 ? (
          <EmptyPanel
            message={
              gameMode !== null
                ? `No ${gameMode} career stats recorded yet.`
                : 'No career stats recorded yet.'
            }
          />
        ) : (
          <CareerStatsTable rows={careerStats} />
        )}
      </section>

      <section id="ea-totals" className="space-y-4 scroll-mt-24">
        <div>
          <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
            EA Season Totals
          </h2>
          <p className="mt-0.5 text-xs text-zinc-600">
            EA-reported full season aggregates. Not mode-filtered. This is the canonical current
            season source when EA provides the metric.
          </p>
        </div>
        {eaStats.length === 0 ? (
          <EmptyPanel message="No EA season totals available yet." />
        ) : (
          <EASeasonStatsTable rows={eaStats} />
        )}
      </section>

      <section id="game-log" className="space-y-4 scroll-mt-24">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Full Game Log
            </h2>
            <p className="mt-0.5 text-xs text-zinc-600">
              Local tracked appearances only.
              {gameMode !== null ? ` Filtered to ${gameMode}.` : ''}
            </p>
          </div>
          {gameLogTotal > 0 && (
            <span className="text-xs tabular text-zinc-600">
              {logOffset + 1}–{Math.min(logOffset + LOG_PAGE_SIZE, gameLogTotal)} of {gameLogTotal}
            </span>
          )}
        </div>

        {gameLog.length === 0 && gameLogTotal > 0 ? (
          <div className="flex min-h-[6rem] flex-col items-center justify-center gap-3 border border-zinc-800 bg-surface">
            <p className="text-sm text-zinc-500">Page {logPage} is beyond the available games.</p>
            <Link
              href={gameLogPageHref(id, gameMode, 1)}
              className="text-xs font-semibold text-accent hover:underline"
            >
              Back to first page
            </Link>
          </div>
        ) : gameLog.length === 0 ? (
          <EmptyPanel
            message={gameMode !== null ? `No ${gameMode} games recorded yet.` : 'No games recorded yet.'}
          />
        ) : (
          <>
            <GameLog rows={gameLog} showMode={gameMode === null} />
            <GameLogPaginationNav
              playerId={id}
              gameMode={gameMode}
              logPage={logPage}
              totalPages={Math.ceil(gameLogTotal / LOG_PAGE_SIZE)}
            />
          </>
        )}
      </section>

      {hasHistory && (
        <section id="history" className="space-y-4 scroll-mt-24">
          <div>
            <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Gamertag History
            </h2>
            <p className="mt-0.5 text-xs text-zinc-600">
              Archival identity record from tracked membership changes.
            </p>
          </div>
          <div className="divide-y divide-zinc-800/60 border border-zinc-800 bg-surface">
            {history.map((entry) => (
              <div key={entry.id} className="flex items-center gap-4 px-4 py-3">
                <span
                  className={`text-sm font-medium ${entry.seenUntil === null ? 'text-zinc-200' : 'text-zinc-500'}`}
                >
                  {entry.gamertag}
                </span>
                <span className="ml-auto text-xs text-zinc-600">
                  {formatMatchDate(entry.seenFrom)}
                  {entry.seenUntil !== null && ` → ${formatMatchDate(entry.seenUntil)}`}
                  {entry.seenUntil === null && (
                    <span className="ml-1.5 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                      current
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

type Overview = NonNullable<Awaited<ReturnType<typeof getPlayerProfileOverview>>>
type CareerRow = Awaited<ReturnType<typeof getPlayerCareerStats>>[number]
type GameLogRow = Awaited<ReturnType<typeof getPlayerGameLog>>[number]
type EASeasonRow = Awaited<ReturnType<typeof getPlayerEASeasonStats>>[number]

function HeroSection({ overview }: { overview: Overview }) {
  const { player, primaryRole, secondaryRole, currentEaSeason, currentLocalSeason } = overview
  const displayPosition = player.preferredPosition ?? currentEaSeason?.favoritePosition ?? player.position
  const positionLabel = displayPosition ? formatPosition(displayPosition) : null
  const primaryGp =
    primaryRole === 'goalie'
      ? (currentEaSeason?.goalieGp ?? currentLocalSeason?.goalieGp ?? 0)
      : (currentEaSeason?.skaterGp ?? currentLocalSeason?.skaterGp ?? 0)
  const hasSeasonData = currentEaSeason !== null || currentLocalSeason !== null

  return (
    <section className="relative overflow-hidden border border-zinc-800 border-t-2 border-t-accent bg-surface">
      {/* Background: red bloom from top-left, dark field */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_90%_at_0%_0%,rgba(225,29,72,0.11),transparent_55%),linear-gradient(165deg,rgba(24,24,27,0.55)_15%,rgba(9,9,11,1)_70%)]" />

      {/* Jersey number watermark — large faded accent in the background */}
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

      {/* Main layout */}
      <div className="relative z-10 grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        {/* ── Identity column ── */}
        <div className="space-y-4 px-6 py-7 lg:py-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-600">
            Boogeymen Club Profile
          </p>

          <div className="space-y-1">
            <h1 className="font-condensed text-4xl font-black uppercase tracking-[0.04em] text-zinc-50 sm:text-5xl lg:text-6xl">
              {player.gamertag}
            </h1>
            {player.jerseyNumber != null && (
              <p className="font-condensed text-xl font-bold text-accent">
                #{player.jerseyNumber}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {positionLabel && <HeroChip accent>{positionLabel}</HeroChip>}
            <HeroChip>{ROLE_CHIPS[primaryRole]}</HeroChip>
            {player.clubRoleLabel && <HeroChip>{player.clubRoleLabel}</HeroChip>}
            {player.nationality && <HeroChip>{player.nationality}</HeroChip>}
            {!player.isActive && <HeroChip muted>Inactive</HeroChip>}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            {primaryGp > 0 && <span>{primaryGp} GP this season</span>}
            {secondaryRole !== null && <span>Also plays {ROLE_CHIPS[secondaryRole]}</span>}
            <span>Last seen {formatMatchDate(player.lastSeenAt)}</span>
            <span className="text-zinc-700">
              {currentLocalSeason === null ? 'EA data only' : 'EA + local history'}
            </span>
          </div>

          {player.bio && (
            <p className="max-w-2xl text-sm leading-relaxed text-zinc-300">{player.bio}</p>
          )}

          <AnchorPillNav />
        </div>

        {/* ── Silhouette column — floats directly on the gradient, no wrapper card ── */}
        <div className="relative hidden lg:flex items-end justify-end pb-0 pl-6 pr-6 pt-7 min-w-[200px]">
          <div className="absolute right-8 top-6 opacity-[0.18]">
            <Image
              src="/images/bgm-logo.png"
              alt="Boogeymen"
              width={48}
              height={48}
              className="h-11 w-11 object-contain"
            />
          </div>
          <PlayerSilhouette className="text-zinc-800/60" sizeClass="h-[200px] w-[200px]" />
        </div>
      </div>

      {/* ── Integrated stat strip — pulls key season numbers into the hero ── */}
      {hasSeasonData && <HeroStatStrip overview={overview} />}
    </section>
  )
}

function HeroStatStrip({ overview }: { overview: Overview }) {
  const { currentEaSeason, currentLocalSeason, primaryRole } = overview
  const skaterGp = currentEaSeason?.skaterGp ?? currentLocalSeason?.skaterGp ?? 0
  const goalieGp = currentEaSeason?.goalieGp ?? currentLocalSeason?.goalieGp ?? 0
  const appearanceRecord =
    currentLocalSeason !== null
      ? formatRecord(
          currentLocalSeason.wins ?? 0,
          currentLocalSeason.losses ?? 0,
          currentLocalSeason.otl ?? 0,
        )
      : '—'

  const stats =
    primaryRole === 'goalie'
      ? [
          { label: 'GP', value: goalieGp.toString() },
          { label: 'SV%', value: formatDbPct(currentEaSeason?.goalieSavePct ?? null) },
          { label: 'GAA', value: currentEaSeason?.goalieGaa ?? '—' },
          { label: 'SO', value: (currentEaSeason?.goalieShutouts ?? 0).toString() },
          { label: 'App. Record', value: appearanceRecord },
        ]
      : [
          { label: 'GP', value: skaterGp.toString() },
          {
            label: 'G',
            value: (currentEaSeason?.goals ?? currentLocalSeason?.goals ?? 0).toString(),
          },
          {
            label: 'A',
            value: (currentEaSeason?.assists ?? currentLocalSeason?.assists ?? 0).toString(),
          },
          {
            label: 'PTS',
            value: (currentEaSeason?.points ?? currentLocalSeason?.points ?? 0).toString(),
          },
          {
            label: 'P / GP',
            value: formatDecimal(
              perGame(currentEaSeason?.points ?? currentLocalSeason?.points ?? 0, skaterGp),
              2,
            ),
          },
          { label: 'App. Record', value: appearanceRecord },
        ]

  return (
    <div className="relative z-10 flex divide-x divide-zinc-800 border-t border-zinc-800">
      {stats.map((stat) => (
        <div key={stat.label} className="flex-1 bg-zinc-950/30 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
            {stat.label}
          </p>
          <p className="mt-1 font-condensed text-xl font-black text-zinc-100">{stat.value}</p>
        </div>
      ))}
    </div>
  )
}

function AnchorPillNav() {
  const links = [
    { href: '#overview', label: 'Overview' },
    { href: '#career', label: 'Career' },
    { href: '#ea-totals', label: 'EA Totals' },
    { href: '#game-log', label: 'Game Log' },
    { href: '#history', label: 'History' },
  ]

  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="rounded-full border border-zinc-700 bg-zinc-900/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
        >
          {link.label}
        </a>
      ))}
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

function CurrentSeasonSnapshotSection({ overview }: { overview: Overview }) {
  const { currentEaSeason, currentLocalSeason, primaryRole, secondaryRole } = overview

  if (!currentEaSeason && !currentLocalSeason) {
    return (
      <section className="space-y-3">
        <SectionHeading
          title="Current Season Snapshot"
          subtitle="No current-season profile data is available yet."
        />
        <EmptyPanel message="This player does not have current season totals yet." />
      </section>
    )
  }

  const appearanceRecord =
    currentLocalSeason !== null
      ? formatRecord(currentLocalSeason.wins ?? 0, currentLocalSeason.losses ?? 0, currentLocalSeason.otl ?? 0)
      : '—'
  const skaterGp = currentEaSeason?.skaterGp ?? currentLocalSeason?.skaterGp ?? 0
  const goalieGp = currentEaSeason?.goalieGp ?? currentLocalSeason?.goalieGp ?? 0
  const hasSecondaryRole = secondaryRole !== null && (secondaryRole === 'goalie' ? goalieGp > 0 : skaterGp > 0)

  return (
    <section className="space-y-4">
      <SectionHeading
        title="Current Season Snapshot"
        subtitle="EA season totals power the main box. Appearance record comes from locally tracked matches."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="border border-zinc-800 bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
            <div>
              <p className="font-condensed text-lg font-bold uppercase tracking-wide text-zinc-100">
                {primaryRole === 'goalie' ? 'Goalie Snapshot' : 'Skater Snapshot'}
              </p>
              <p className="text-xs text-zinc-600">
                {currentEaSeason?.gameTitleName ?? currentLocalSeason?.gameTitleName ?? 'Current title'}
              </p>
            </div>
            <HeroChip accent>{ROLE_CHIPS[primaryRole]}</HeroChip>
          </div>

          {primaryRole === 'goalie' ? (
            <div className="grid gap-px bg-zinc-800 sm:grid-cols-4 xl:grid-cols-7">
              <SnapshotStat label="GP" value={goalieGp.toString()} />
              <SnapshotStat
                label="W-L-OTL"
                value={formatRecord(
                  currentEaSeason?.goalieWins ?? 0,
                  currentEaSeason?.goalieLosses ?? 0,
                  currentEaSeason?.goalieOtl ?? 0,
                )}
              />
              <SnapshotStat label="SV%" value={formatDbPct(currentEaSeason?.goalieSavePct ?? null)} />
              <SnapshotStat label="GAA" value={currentEaSeason?.goalieGaa ?? '—'} />
              <SnapshotStat label="SO" value={(currentEaSeason?.goalieShutouts ?? 0).toString()} />
              <SnapshotStat label="Saves" value={(currentEaSeason?.goalieSaves ?? 0).toString()} />
              <SnapshotStat
                label="SV / GP"
                value={formatDecimal(perGame(currentEaSeason?.goalieSaves ?? null, goalieGp), 1)}
              />
            </div>
          ) : (
            <div className="grid gap-px bg-zinc-800 sm:grid-cols-3 xl:grid-cols-9">
              <SnapshotStat label="GP" value={skaterGp.toString()} />
              <SnapshotStat label="G" value={(currentEaSeason?.goals ?? currentLocalSeason?.goals ?? 0).toString()} />
              <SnapshotStat label="A" value={(currentEaSeason?.assists ?? currentLocalSeason?.assists ?? 0).toString()} />
              <SnapshotStat label="PTS" value={(currentEaSeason?.points ?? currentLocalSeason?.points ?? 0).toString()} />
              <SnapshotStat
                label="+/-"
                value={formatSigned(currentEaSeason?.plusMinus ?? currentLocalSeason?.plusMinus ?? 0)}
              />
              <SnapshotStat label="Hits" value={(currentEaSeason?.hits ?? currentLocalSeason?.hits ?? 0).toString()} />
              <SnapshotStat label="PIM" value={(currentEaSeason?.pim ?? currentLocalSeason?.pim ?? 0).toString()} />
              <SnapshotStat
                label="P / GP"
                value={formatDecimal(
                  perGame(currentEaSeason?.points ?? currentLocalSeason?.points ?? 0, skaterGp),
                  2,
                )}
              />
              <SnapshotStat label="App. Record" value={appearanceRecord} />
            </div>
          )}
        </div>

        <div className="grid gap-4">
          <SurfaceCard>
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Source Notes
              </p>
              <ul className="space-y-2 text-sm text-zinc-400">
                <li>Season box uses EA totals where EA exposes the stat.</li>
                <li>Appearance record uses locally tracked match outcomes.</li>
                <li>Goalie-specific content only appears when goalie GP exists.</li>
              </ul>
            </div>
          </SurfaceCard>

          {hasSecondaryRole && (
            <SecondaryRoleStrip
              overview={overview}
              role={secondaryRole}
              appearanceRecord={appearanceRecord}
            />
          )}
        </div>
      </div>
    </section>
  )
}

function SecondaryRoleStrip({
  overview,
  role,
  appearanceRecord,
}: {
  overview: Overview
  role: 'skater' | 'goalie'
  appearanceRecord: string
}) {
  const { currentEaSeason, currentLocalSeason } = overview
  const gp = role === 'goalie' ? currentEaSeason?.goalieGp ?? 0 : currentEaSeason?.skaterGp ?? 0

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Secondary Role
          </p>
          <p className="mt-1 font-condensed text-lg font-bold uppercase tracking-wide text-zinc-100">
            {ROLE_CHIPS[role]}
          </p>
        </div>
        <HeroChip>{gp} GP</HeroChip>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {role === 'goalie' ? (
          <>
            <MiniStat
              label="Goalie Record"
              value={formatRecord(
                currentEaSeason?.goalieWins ?? 0,
                currentEaSeason?.goalieLosses ?? 0,
                currentEaSeason?.goalieOtl ?? 0,
              )}
            />
            <MiniStat label="SV%" value={formatDbPct(currentEaSeason?.goalieSavePct ?? null)} />
            <MiniStat label="GAA" value={currentEaSeason?.goalieGaa ?? '—'} />
          </>
        ) : (
          <>
            <MiniStat label="PTS" value={(currentEaSeason?.points ?? currentLocalSeason?.points ?? 0).toString()} />
            <MiniStat
              label="P / GP"
              value={formatDecimal(
                perGame(currentEaSeason?.points ?? currentLocalSeason?.points ?? 0, currentEaSeason?.skaterGp ?? 0),
                2,
              )}
            />
            <MiniStat label="Appearance Record" value={appearanceRecord} />
          </>
        )}
      </div>
    </SurfaceCard>
  )
}

function ContributionWheelSection({ overview }: { overview: Overview }) {
  const summary = overview.contributionSummary

  return (
    <section className="space-y-4">
      <SectionHeading
        title="Contribution Summary"
        subtitle="Normalized against teammates in the same role group for the current EA season."
      />

      {!summary ? (
        <EmptyPanel message="Not enough tracked role data yet to generate a contribution summary." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <SurfaceCard className="flex items-center justify-center">
            <ContributionRadar metrics={summary.metrics} />
          </SurfaceCard>
          <SurfaceCard>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-condensed text-lg font-bold uppercase tracking-wide text-zinc-100">
                  {ROLE_CHIPS[summary.role]} Profile
                </p>
                <p className="text-xs text-zinc-600">
                  Based on {summary.sampleSize} current-season {summary.role} appearances.
                </p>
              </div>
              <HeroChip accent>Trusted inputs only</HeroChip>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {summary.metrics.map((metric) => (
                <MetricBar key={metric.label} label={metric.label} value={metric.value} />
              ))}
            </div>
          </SurfaceCard>
        </div>
      )}
    </section>
  )
}

function RecentFormSection({ overview }: { overview: Overview }) {
  const recent = overview.recentForm

  return (
    <section className="space-y-4">
      <SectionHeading
        title="Recent Form"
        subtitle="Last 5 tracked appearances in the player’s current primary role."
      />

      {!recent ? (
        <EmptyPanel message="Not enough recent local appearances yet." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SurfaceCard>
              <MiniStat
                label="Games Analyzed"
                value={recent.gamesAnalyzed.toString()}
                subtle="Tracked appearances"
              />
            </SurfaceCard>
            <SurfaceCard>
              <MiniStat
                label="Recent Record"
                value={formatRecord(recent.record.wins, recent.record.losses, recent.record.otl)}
                subtle="Team result during appearances"
              />
              {recent.recentResults.length > 0 && (
                <div className="mt-3 border-t border-zinc-800/60 pt-3">
                  <ResultPips results={recent.recentResults as MatchResult[]} />
                </div>
              )}
            </SurfaceCard>
            {recent.role === 'goalie' ? (
              <>
                <SurfaceCard>
                  <MiniStat
                    label="Save %"
                    value={recent.savePct !== null ? `${recent.savePct.toFixed(1)}%` : '—'}
                    subtle={`${recent.saves.toString()} saves`}
                  />
                </SurfaceCard>
                <SurfaceCard>
                  <MiniStat
                    label="Goals Against"
                    value={recent.goalsAgainst.toString()}
                    subtle="Recent goalie sample"
                  />
                </SurfaceCard>
              </>
            ) : (
              <>
                <SurfaceCard>
                  <MiniStat
                    label="Goals / Assists"
                    value={`${recent.goals.toString()} / ${recent.assists.toString()}`}
                    subtle={`${recent.points.toString()} points`}
                  />
                </SurfaceCard>
                <SurfaceCard>
                  <MiniStat
                    label="+/-"
                    value={formatSigned(recent.plusMinus)}
                    subtle="Recent skater sample"
                  />
                </SurfaceCard>
              </>
            )}
          </div>

          <SurfaceCard>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Best Recent Game
            </p>
            {recent.bestGame ? (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Link
                    href={`/games/${recent.bestGame.matchId.toString()}`}
                    className="font-condensed text-lg font-bold uppercase tracking-wide text-zinc-100 transition-colors hover:text-accent"
                  >
                    vs {recent.bestGame.opponentName}
                  </Link>
                  <ResultBadge result={recent.bestGame.result} />
                </div>
                <p className="text-sm text-zinc-500">
                  {formatMatchDate(recent.bestGame.playedAt)} ·{' '}
                  {formatScore(recent.bestGame.scoreFor, recent.bestGame.scoreAgainst)}
                </p>
                <p className="text-sm text-zinc-300">
                  {recent.role === 'goalie'
                    ? `${(recent.bestGame.saves ?? 0).toString()} saves, ${(recent.bestGame.goalsAgainst ?? 0).toString()} GA`
                    : `${recent.bestGame.goals.toString()} G · ${recent.bestGame.assists.toString()} A · ${(recent.bestGame.goals + recent.bestGame.assists).toString()} PTS`}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">No standout game available yet.</p>
            )}
          </SurfaceCard>
        </div>
      )}
    </section>
  )
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h2>
      <p className="mt-0.5 text-xs text-zinc-600">{subtitle}</p>
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

function SnapshotStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-2 font-condensed text-2xl font-black text-zinc-100">{value}</p>
    </div>
  )
}

function MiniStat({
  label,
  value,
  subtle,
}: {
  label: string
  value: string
  subtle?: string
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-2 font-condensed text-2xl font-black text-zinc-100">{value}</p>
      {subtle && <p className="mt-1 text-xs text-zinc-600">{subtle}</p>}
    </div>
  )
}

function MetricBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-300">{label}</span>
        <span className="text-xs tabular text-zinc-500">{Math.round(value).toString()}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(6, value).toString()}%` }} />
      </div>
    </div>
  )
}

function ContributionRadar({
  metrics,
}: {
  metrics: NonNullable<Overview['contributionSummary']>['metrics']
}) {
  const center = 110
  const radius = 76
  const angleStep = (Math.PI * 2) / metrics.length

  const point = (index: number, value: number, scale = 1) => {
    const angle = -Math.PI / 2 + index * angleStep
    const r = radius * scale * (value / 100)
    return [center + Math.cos(angle) * r, center + Math.sin(angle) * r] as const
  }

  const polygon = metrics
    .map((metric, index) => {
      const [x, y] = point(index, metric.value)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg viewBox="0 0 220 220" className="h-[240px] w-[240px]" aria-hidden>
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon
          key={ring}
          points={metrics
            .map((_, index) => {
              const [x, y] = point(index, 100, ring)
              return `${x.toFixed(1)},${y.toFixed(1)}`
            })
            .join(' ')}
          fill="none"
          stroke="rgb(63 63 70)"
          strokeWidth="1"
        />
      ))}
      {metrics.map((metric, index) => {
        const [x, y] = point(index, 100)
        return (
          <g key={metric.label}>
            <line x1={center} y1={center} x2={x} y2={y} stroke="rgb(63 63 70)" strokeWidth="1" />
            <text
              x={x}
              y={y}
              dx={x >= center ? 8 : -8}
              dy={y >= center ? 12 : -4}
              textAnchor={x >= center ? 'start' : 'end'}
              className="fill-zinc-500 text-[9px] font-semibold uppercase tracking-widest"
            >
              {metric.label}
            </text>
          </g>
        )
      })}
      <polygon points={polygon} fill="rgba(225,29,72,0.20)" stroke="rgb(225 29 72)" strokeWidth="2" />
      {metrics.map((metric, index) => {
        const [x, y] = point(index, metric.value)
        return <circle key={`${metric.label}-dot`} cx={x} cy={y} r="3" fill="rgb(225 29 72)" />
      })}
    </svg>
  )
}

const MODE_LABELS: { mode: GameMode | null; label: string }[] = [
  { mode: null, label: 'All' },
  { mode: '6s', label: '6s' },
  { mode: '3s', label: '3s' },
]

function gameModeHref(playerId: number, mode: GameMode | null): string {
  const qs = new URLSearchParams()
  if (mode !== null) qs.set('mode', mode)
  const qsStr = qs.toString()
  return `/roster/${playerId.toString()}${qsStr ? `?${qsStr}` : ''}`
}

function gameLogPageHref(playerId: number, mode: GameMode | null, page: number): string {
  const qs = new URLSearchParams()
  if (mode !== null) qs.set('mode', mode)
  if (page > 1) qs.set('logPage', page.toString())
  const qsStr = qs.toString()
  return `/roster/${playerId.toString()}${qsStr ? `?${qsStr}` : ''}`
}

function GameModeFilter({
  playerId,
  activeMode,
}: {
  playerId: number
  activeMode: GameMode | null
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {MODE_LABELS.map(({ mode, label }) => {
        const isActive = mode === activeMode
        return (
          <Link
            key={label}
            href={gameModeHref(playerId, mode)}
            className={[
              'rounded border px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors',
              isActive
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-zinc-700 bg-transparent text-zinc-500 hover:border-zinc-500 hover:text-zinc-300',
            ].join(' ')}
          >
            {label}
          </Link>
        )
      })}
    </div>
  )
}

function GameLogPaginationNav({
  playerId,
  gameMode,
  logPage,
  totalPages,
}: {
  playerId: number
  gameMode: GameMode | null
  logPage: number
  totalPages: number
}) {
  if (totalPages <= 1) return null

  const hasPrev = logPage > 1
  const hasNext = logPage < totalPages

  return (
    <div className="flex items-center justify-between border border-t-0 border-zinc-800 bg-surface px-4 py-3">
      {hasPrev ? (
        <Link
          href={gameLogPageHref(playerId, gameMode, logPage - 1)}
          className="text-xs font-semibold text-zinc-400 transition-colors hover:text-zinc-200"
        >
          ← Newer
        </Link>
      ) : (
        <span className="text-xs text-zinc-700">← Newer</span>
      )}
      <span className="text-xs text-zinc-600">
        Page {logPage} of {totalPages}
      </span>
      {hasNext ? (
        <Link
          href={gameLogPageHref(playerId, gameMode, logPage + 1)}
          className="text-xs font-semibold text-zinc-400 transition-colors hover:text-zinc-200"
        >
          Older →
        </Link>
      ) : (
        <span className="text-xs text-zinc-700">Older →</span>
      )}
    </div>
  )
}

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
                className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600"
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
    key: 'pm',
    label: '+/-',
    render: (row) => <span className={signedClass(row.plusMinus)}>{formatSigned(row.plusMinus)}</span>,
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

function CareerStatsDataRow({ row, hasGoalie }: { row: CareerRow; hasGoalie: boolean }) {
  return (
    <tr className="border-b border-zinc-800/60 transition-colors last:border-0 hover:bg-surface-raised">
      <td className="py-2.5 pl-4 pr-2 text-sm font-medium text-zinc-300">{row.gameTitleName}</td>
      {SKATER_COLS.map((col) => (
        <td key={col.key} className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
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

function GameLog({ rows, showMode }: { rows: GameLogRow[]; showMode: boolean }) {
  return (
    <div className="overflow-x-auto border border-zinc-800 bg-surface">
      <table className="w-full min-w-[520px]">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="py-2 pl-4 pr-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Date
            </th>
            <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Opponent
            </th>
            {showMode && (
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Mode
              </th>
            )}
            <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Result
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Score
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              G
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              A
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              PTS
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              +/-
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              SV
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <GameLogDataRow key={row.matchId} row={row} showMode={showMode} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GameLogDataRow({ row, showMode }: { row: GameLogRow; showMode: boolean }) {
  const points = row.goals + row.assists

  return (
    <tr className="border-b border-zinc-800/60 transition-colors last:border-0 hover:bg-surface-raised">
      <td className="whitespace-nowrap py-2.5 pl-4 pr-2 text-sm tabular text-zinc-500">
        {formatMatchDate(row.playedAt)}
      </td>
      <td className="max-w-[12rem] truncate px-2 py-2.5">
        <Link
          href={`/games/${row.matchId.toString()}`}
          className="text-sm font-medium text-zinc-200 transition-colors hover:text-accent"
        >
          {row.opponentName}
        </Link>
      </td>
      {showMode && (
        <td className="px-2 py-2.5">
          {row.gameMode ? (
            <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {row.gameMode}
            </span>
          ) : (
            <span className="text-zinc-700">—</span>
          )}
        </td>
      )}
      <td className="px-2 py-2.5">
        <ResultBadge result={row.result} />
      </td>
      <td className="px-2 py-2.5 text-right font-condensed text-sm font-semibold tabular text-zinc-100">
        {formatScore(row.scoreFor, row.scoreAgainst)}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">{row.isGoalie ? '—' : row.goals}</td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">{row.isGoalie ? '—' : row.assists}</td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">{row.isGoalie ? '—' : points}</td>
      <td className="px-2 py-2.5 text-right text-sm tabular">
        {row.isGoalie ? (
          <span className="text-zinc-500">—</span>
        ) : (
          <span className={signedClass(row.plusMinus)}>{formatSigned(row.plusMinus)}</span>
        )}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {row.isGoalie ? (row.saves ?? '—') : '—'}
      </td>
    </tr>
  )
}

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
                className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600"
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
    key: 'pm',
    label: '+/-',
    render: (row) => <span className={signedClass(row.plusMinus)}>{formatSigned(row.plusMinus)}</span>,
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

function EASeasonStatsDataRow({ row, hasGoalie }: { row: EASeasonRow; hasGoalie: boolean }) {
  return (
    <tr className="border-b border-zinc-800/60 transition-colors last:border-0 hover:bg-surface-raised">
      <td className="py-2.5 pl-4 pr-2 text-sm font-medium text-zinc-300">{row.gameTitleName}</td>
      {EA_SKATER_COLS.map((col) => (
        <td key={col.key} className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
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
    <div className="flex items-center gap-1.5" aria-label="Recent results">
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
            className={`block h-3 w-3 rounded-sm ${color}`}
            aria-label={r}
            title={r}
          />
        )
      })}
    </div>
  )
}

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
