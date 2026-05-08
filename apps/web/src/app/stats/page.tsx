import type { Metadata } from 'next'
import type { ClubGameTitleStats, GameMode, GameTitle } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import { redirect } from 'next/navigation'
import {
  getClubStats,
  getRecentMatches,
  getSkaterStats,
  getGoalieStats,
  getEASkaterStats,
  getEAGoalieStats,
  getPlayerWithWithoutSplits,
  getPlayerPairs,
  getHistoricalSkaterStats,
  getHistoricalGoalieStats,
  getHistoricalSkaterStatsAllModes,
  getHistoricalGoalieStatsAllModes,
  getClubMemberSkaterStats,
  getClubMemberGoalieStats,
  getClubMemberSkaterStatsAllModes,
  getClubMemberGoalieStatsAllModes,
  getHistoricalClubTeamStats,
  getTeamShotLocationAggregates,
  type HistoricalClubTeamStatsRow,
} from '@eanhl/db/queries'
import { TeamShotMap } from '@/components/stats/team-shot-map'
import { StatCard } from '@/components/ui/stat-card'
import { Panel } from '@/components/ui/panel'
import { SectionHeader } from '@/components/ui/section-header'
import { MatchRow } from '@/components/matches/match-row'
import { SkaterStatsTable } from '@/components/stats/skater-stats-table'
import { GoalieStatsTable } from '@/components/stats/goalie-stats-table'
import {
  WithWithoutTable,
  BestPairsTable,
  ChemistrySection,
} from '@/components/stats/chemistry-tables'
import {
  TitleSelector,
  ModeFilter,
  EmptyState,
  statsSourceLabel,
} from '@/components/title-selector'
import { resolveTitleFromSlug } from '@/lib/title-resolver'
import { formatPct } from '@/lib/format'

export const metadata: Metadata = { title: 'Stats — Club Stats' }

// Aggregates update each ingestion cycle (~5 min) — match the worker cadence
export const revalidate = 300

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function parseGameMode(raw: string | string[] | undefined): GameMode | null {
  if (typeof raw !== 'string') return null
  return (GAME_MODE as readonly string[]).includes(raw) ? (raw as GameMode) : null
}

/** Win% as a display string, e.g. "78.3%". Returns "—" when no games played. */
function winPct(wins: number, losses: number, otl: number): string {
  const total = wins + losses + otl
  if (total === 0) return '—'
  return ((wins / total) * 100).toFixed(1) + '%'
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
        getRecentMatches({ gameTitleId: gameTitle.id, limit: 5 }),
        gameMode === null ? getEASkaterStats(gameTitle.id) : getSkaterStats(gameTitle.id, gameMode),
        gameMode === null ? getEAGoalieStats(gameTitle.id) : getGoalieStats(gameTitle.id, gameMode),
        getPlayerWithWithoutSplits(gameTitle.id, gameMode),
        getPlayerPairs(gameTitle.id, gameMode),
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

  const [clubStats, recentMatches, skaterRows, goalieRows, withWithoutRows, pairRows] = fetched
  const emptyModeLabel = gameMode !== null ? `${gameMode} ` : ''

  let teamShotAggregates: Awaited<ReturnType<typeof getTeamShotLocationAggregates>> | null = null
  try {
    teamShotAggregates = await getTeamShotLocationAggregates(gameTitle.id)
  } catch {
    teamShotAggregates = null
  }

  const shotMapHasData =
    gameTitle.slug === 'nhl26' && (teamShotAggregates?.shotsIce.some((v) => v > 0) ?? false)

  return (
    <PageShell gameTitle={gameTitle}>
      {/* Record + stat cards — show when at least 1 game is recorded */}
      {clubStats !== null && clubStats.gamesPlayed > 0 ? (
        <>
          <RecordCard stats={clubStats} />

          <section className="space-y-3">
            <SectionHeader label="Team Averages" />
            <div className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-6">
              <StatCard
                label="Goals For"
                value={clubStats.goalsFor.toString()}
                sublabel={`${clubStats.gamesPlayed.toString()} GP`}
                featured
              />
              <StatCard
                label="Goals Against"
                value={clubStats.goalsAgainst.toString()}
                sublabel={`${clubStats.gamesPlayed.toString()} GP`}
              />
              <StatCard label="Shots / GP" value={clubStats.shotsPerGame ?? '—'} />
              <StatCard label="Hits / GP" value={clubStats.hitsPerGame ?? '—'} />
              <StatCard label="Faceoff %" value={formatPct(clubStats.faceoffPct)} />
              <StatCard label="Pass %" value={formatPct(clubStats.passPct)} />
            </div>
          </section>
        </>
      ) : (
        <EmptyState
          message={
            gameMode !== null
              ? `No ${emptyModeLabel}games recorded for ${gameTitle.name} yet.`
              : `No stats recorded for ${gameTitle.name} yet.`
          }
        />
      )}

      <TeamShotMap
        aggregates={teamShotAggregates ?? emptyShotLocations()}
        hasData={shotMapHasData}
      />

      {/* Selectors — sit above the stats tables, the sections they most directly filter */}
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

      {/* Skater stats — primary table content */}
      {skaterRows.length > 0 ? (
        <section>
          <SkaterStatsTable rows={skaterRows} title="Skaters" subtitle={subtitle} />
        </section>
      ) : (
        clubStats !== null &&
        clubStats.gamesPlayed > 0 && (
          <EmptyState message={`No ${emptyModeLabel}skater stats recorded yet.`} />
        )
      )}

      {goalieRows.length > 0 && (
        <section>
          <GoalieStatsTable rows={goalieRows} title="Goalies" subtitle={subtitle} />
        </section>
      )}

      <section className="space-y-6">
        <SectionHeader label="Chemistry" />
        <ChemistrySection title="Team Record With / Without">
          <WithWithoutTable rows={withWithoutRows} />
        </ChemistrySection>
        <ChemistrySection title="Best Pairs">
          <BestPairsTable rows={pairRows} />
        </ChemistrySection>
      </section>

      {recentMatches.length > 0 && (
        <section className="space-y-3">
          <SectionHeader label="Recent Games" />
          <div className="space-y-2">
            {recentMatches.map((match, i) => (
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
      <p className="text-sm text-zinc-500">
        Two reviewed historical sources are available for {gameTitle.name} — they are kept separate
        because they describe different things. Match-level analytics (chemistry, recent results)
        are not available for {gameTitle.name} — match data was not captured.
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

      {/* PRIMARY: club-scoped member totals. */}
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-condensed text-base font-semibold uppercase tracking-widest text-zinc-300">
            Club-scoped totals
          </h2>
          <p className="text-xs text-zinc-500">
            What each member produced while wearing the BGM crest in {gameTitle.name}. Sourced from
            CLUBS → MEMBERS leaderboard captures.
          </p>
        </div>
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
        {clubGoalieRows.length > 0 && (
          <GoalieStatsTable
            rows={clubGoalieRows}
            title="Goalies"
            subtitle="Club-member totals (reviewed screenshot import)"
          />
        )}
      </section>

      {/* SECONDARY: player-card season totals. */}
      <section className="space-y-4 border-t border-zinc-800 pt-6">
        <div className="space-y-1">
          <h2 className="font-condensed text-base font-semibold uppercase tracking-widest text-zinc-300">
            Player-card season totals
          </h2>
          <p className="text-xs text-zinc-500">
            Season totals from each player's individual stat-card screen.{' '}
            <span className="text-amber-300/80">
              These can include games the player played for other clubs in {gameTitle.name}
            </span>{' '}
            — they are not club-scoped. Use the section above for the BGM-only number.
          </p>
        </div>
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
        {cardGoalieRows.length > 0 && (
          <GoalieStatsTable
            rows={cardGoalieRows}
            title="Goalies"
            subtitle="Player-card season totals — may include games for other clubs"
          />
        )}
      </section>
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
                  <td className="px-3 py-3 text-right text-zinc-300">{winPct(w, l, otl)}</td>
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

// ─── Record hero card ─────────────────────────────────────────────────────────

function RecordCard({ stats }: { stats: ClubGameTitleStats }) {
  const pct = winPct(stats.wins, stats.losses, stats.otl)

  return (
    <section className="space-y-3">
      <SectionHeader label="Record" />
      <div className="border border-l-4 border-zinc-800 border-l-accent bg-surface px-6 py-5">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <div className="flex items-end gap-6 font-condensed font-bold leading-none tabular">
            <RecordStat label="W" value={stats.wins} accent />
            <RecordStat label="L" value={stats.losses} />
            <RecordStat label="OTL" value={stats.otl} />
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="font-condensed text-lg font-semibold tabular text-zinc-300">
              {pct}
            </span>
            <span className="text-xs text-zinc-500">Win% · {stats.gamesPlayed.toString()} GP</span>
          </div>
        </div>
      </div>
    </section>
  )
}

interface RecordStatProps {
  label: string
  value: number
  accent?: boolean
}

function RecordStat({ label, value, accent = false }: RecordStatProps) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className={`text-4xl sm:text-5xl font-bold ${accent ? 'text-accent' : 'text-zinc-100'}`}
      >
        {value.toString()}
      </span>
      <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
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
