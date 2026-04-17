import type { Metadata } from 'next'
import type { ClubGameTitleStats, ClubSeasonalStats } from '@eanhl/db'
import type { GameMode } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import Link from 'next/link'
import {
  listGameTitles,
  getGameTitleBySlug,
  getClubStats,
  getOfficialClubRecord,
  getRecentMatches,
  getRoster,
} from '@eanhl/db/queries'
import { LatestResult } from '@/components/home/latest-result'
import { PlayerCarousel } from '@/components/home/player-carousel'
import { ScoringLeadersPanel } from '@/components/home/leaders-section'
import type { RosterRow } from '@/components/home/player-card'

function parseGameMode(raw: string | string[] | undefined): GameMode | null {
  if (typeof raw !== 'string') return null
  return (GAME_MODE as readonly string[]).includes(raw) ? (raw as GameMode) : null
}

export const metadata: Metadata = { title: 'Club Stats' }

export const revalidate = 300

type SearchParams = Promise<Record<string, string | string[] | undefined>>

async function resolveGameTitle(titleSlug: string | undefined) {
  try {
    if (titleSlug) {
      const found = await getGameTitleBySlug(titleSlug)
      if (found) return found
    }
    const all = await listGameTitles()
    return all[0] ?? null
  } catch {
    return null
  }
}

/** Win% as "78.3%". Returns "—" when no games played. */
function winPct(wins: number, losses: number, otl: number): string {
  const total = wins + losses + otl
  if (total === 0) return '—'
  return ((wins / total) * 100).toFixed(1) + '%'
}

/**
 * Top players by points descending for the featured carousel.
 * Goalies sort naturally to the back (0 points). Returns up to 8.
 */
function selectFeaturedPlayers(roster: RosterRow[]): RosterRow[] {
  return [...roster]
    .sort((a, b) => b.points - a.points || b.gamesPlayed - a.gamesPlayed)
    .slice(0, 8)
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
  const gameMode = parseGameMode(params.mode)
  const gameTitle = await resolveGameTitle(titleSlug)

  if (!gameTitle) {
    return (
      <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
        <p className="text-sm text-zinc-500">No game titles are configured yet.</p>
      </div>
    )
  }

  const fetched = await (async () => {
    try {
      return await Promise.all([
        getClubStats(gameTitle.id, gameMode),
        getRecentMatches({ gameTitleId: gameTitle.id, limit: 1 }),
        getRoster(gameTitle.id, gameMode),
        getOfficialClubRecord(gameTitle.id),
      ])
    } catch {
      return null
    }
  })()

  if (fetched === null) {
    return (
      <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
        <p className="text-sm text-zinc-500">Unable to load data right now.</p>
      </div>
    )
  }

  const [clubStats, recentMatches, roster, officialRecord] = fetched
  const lastMatch = recentMatches[0] ?? null
  const latestClubRecord = officialRecord ?? null

  // Club win% — sourced from the mode-filtered club aggregate, consistent with the
  // mode-filtered player rows from getRoster. Passed to each player card as a supporting line.
  const clubWinPct =
    clubStats !== null && clubStats.gamesPlayed > 0
      ? winPct(clubStats.wins, clubStats.losses, clubStats.otl)
      : undefined

  // Derive featured players and leaders from roster
  const featuredPlayers = selectFeaturedPlayers(roster)
  // Filter skaters by position, not by wins === null.
  // The aggregate worker writes wins = 0 (not null) for all skaters, so wins === null
  // is always false and would produce an empty array. Position-based detection matches
  // how the rest of the codebase (player-card, roster-table) identifies goalies.
  const skaters = roster.filter((r) => r.position !== 'goalie')
  // Top 10 skaters by points (already points-desc from getRoster); tiebreak by goals.
  // TODO (post-schema rework): enforce minimum GP, full tiebreak chain per spec §10.
  const pointsLeaders = skaters.slice(0, 10)
  const goalsLeaders = [...skaters]
    .sort((a, b) => b.goals - a.goals || b.points - a.points)
    .slice(0, 10)

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-baseline gap-3">
        <h1 className="font-condensed text-2xl font-semibold uppercase tracking-wide text-zinc-50">
          Home
        </h1>
        <span className="text-sm text-zinc-500">{gameTitle.name}</span>
      </div>

      {/* Team record strip — compact context, mode-filterable */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Club Record
          </h2>
          <RecordGameModeFilter titleSlug={titleSlug} activeMode={gameMode} />
        </div>
        {clubStats !== null &&
        (clubStats.gamesPlayed > 0 || (gameMode === null && officialRecord !== null)) ? (
          <RecordStrip
            stats={clubStats}
            officialRecord={gameMode === null ? officialRecord : null}
          />
        ) : (
          <div className="flex items-center justify-center border border-zinc-800 bg-surface py-5">
            <p className="text-sm text-zinc-500">
              {gameMode !== null ? `No ${gameMode} games recorded yet.` : 'No games recorded yet.'}
            </p>
          </div>
        )}
      </section>

      {/* Latest result hero */}
      {lastMatch !== null && (
        <section>
          <LatestResult match={lastMatch} clubRecord={latestClubRecord} />
        </section>
      )}

      {/* Featured players carousel */}
      {featuredPlayers.length > 0 && (
        <section>
          <h2 className="mb-3 font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Featured Players
          </h2>
          <PlayerCarousel players={featuredPlayers} winPct={clubWinPct} />
        </section>
      )}

      {/* Scoring leaders */}
      {pointsLeaders.length > 0 && (
        <section>
          <ScoringLeadersPanel
            pointsLeaders={pointsLeaders}
            goalsLeaders={goalsLeaders}
            gameMode={gameMode}
          />
        </section>
      )}

      {/* Empty state when no data at all */}
      {clubStats !== null &&
        clubStats.gamesPlayed === 0 &&
        lastMatch === null &&
        roster.length === 0 && (
          <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
            <p className="text-sm text-zinc-500">No games recorded for {gameTitle.name} yet.</p>
          </div>
        )}
    </div>
  )
}

// ─── Record game mode filter ──────────────────────────────────────────────────

const RECORD_MODE_LABELS: { mode: GameMode | null; label: string }[] = [
  { mode: null, label: 'All' },
  { mode: '6s', label: '6s' },
  { mode: '3s', label: '3s' },
]

function recordModeHref(mode: GameMode | null, titleSlug: string | undefined): string {
  const qs = new URLSearchParams()
  if (titleSlug) qs.set('title', titleSlug)
  if (mode !== null) qs.set('mode', mode)
  const s = qs.toString()
  return `/${s ? `?${s}` : ''}`
}

function RecordGameModeFilter({
  titleSlug,
  activeMode,
}: {
  titleSlug: string | undefined
  activeMode: GameMode | null
}) {
  return (
    <div className="flex gap-1">
      {RECORD_MODE_LABELS.map(({ mode, label }) => {
        const isActive = mode === activeMode
        return (
          <Link
            key={label}
            href={recordModeHref(mode, titleSlug)}
            className={[
              'px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded border transition-colors',
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

// ─── Record strip — compact team summary ─────────────────────────────────────

function RecordStrip({
  stats,
  officialRecord,
}: {
  stats: ClubGameTitleStats
  officialRecord: ClubSeasonalStats | null
}) {
  // Use official EA record (W/L/OTL/GP) when available; fall back to local aggregate.
  const record = officialRecord ?? stats
  const pct = winPct(record.wins, record.losses, record.otl)

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border border-zinc-800 bg-surface px-5 py-3">
      {/* W / L / OTL */}
      <div className="flex items-center gap-4 font-condensed font-bold tabular leading-none">
        <span className="text-accent">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">W </span>
          <span className="text-xl">{record.wins.toString()}</span>
        </span>
        <span>
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">L </span>
          <span className="text-xl text-zinc-300">{record.losses.toString()}</span>
        </span>
        <span>
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">OTL </span>
          <span className="text-xl text-zinc-300">{record.otl.toString()}</span>
        </span>
      </div>

      {/* Win% */}
      <span className="font-condensed text-sm font-semibold tabular text-zinc-400">{pct} Win%</span>

      {/* GP from official record or local */}
      <span className="text-xs text-zinc-500">{record.gamesPlayed.toString()} GP</span>

      {/* Ranking points — only in official record */}
      {officialRecord?.rankingPoints != null && (
        <span className="text-xs text-zinc-500">{officialRecord.rankingPoints.toString()} pts</span>
      )}

      {/* GF/GA from local match data */}
      {stats.gamesPlayed > 0 && (
        <span className="text-xs tabular text-zinc-500">
          {stats.goalsFor.toString()} GF – {stats.goalsAgainst.toString()} GA
        </span>
      )}
    </div>
  )
}
