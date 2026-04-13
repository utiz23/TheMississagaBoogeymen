import type { Metadata } from 'next'
import type { ClubGameTitleStats } from '@eanhl/db'
import Link from 'next/link'
import {
  listGameTitles,
  getGameTitleBySlug,
  getClubStats,
  getRecentMatches,
  getRoster,
} from '@eanhl/db/queries'
import { MatchRow } from '@/components/matches/match-row'
import { LatestResult } from '@/components/home/latest-result'
import { PlayerCarousel } from '@/components/home/player-carousel'
import { LeadersSection } from '@/components/home/leaders-section'
import type { RosterRow } from '@/components/home/player-card'

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
 * Build a curated featured-player set for the 5-slot stacked carousel.
 *
 * Targets 5–6 players for optimal carousel presentation. Strategy:
 *   1. Top 3 skaters by points
 *   2. Top goals scorer (if not already in set)
 *   3. Top hitter (if not already in set)
 *   4. Best goalie by wins (if any exists, not already in set)
 *   5. Fill to 5 skaters from remaining points-ranked players
 *
 * All steps are deduplicated. Result is 3–6 players.
 */
function selectFeaturedPlayers(roster: RosterRow[]): RosterRow[] {
  if (roster.length === 0) return []

  const seen = new Set<number>()
  const featured: RosterRow[] = []

  const pick = (row: RosterRow | undefined) => {
    if (!row || seen.has(row.playerId)) return
    seen.add(row.playerId)
    featured.push(row)
  }

  const skaters = roster.filter((r) => r.wins === null)

  // 1. Top 3 skaters by points (roster already sorted by points desc)
  skaters.slice(0, 3).forEach(pick)

  // 2. Top goals scorer
  pick([...skaters].sort((a, b) => b.goals - a.goals)[0])

  // 3. Top hitter
  pick([...skaters].sort((a, b) => b.hits - a.hits)[0])

  // 4. Best goalie by wins
  pick([...roster.filter((r) => r.wins !== null)].sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0))[0])

  // 5. Pad to 5 skaters from next points-ranked players (ensures ≥5 if team is large enough)
  for (const row of skaters.slice(3)) {
    if (featured.filter((r) => r.wins === null).length >= 5) break
    pick(row)
  }

  return featured
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
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
        getClubStats(gameTitle.id),
        getRecentMatches({ gameTitleId: gameTitle.id, limit: 5 }),
        getRoster(gameTitle.id),
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

  const [clubStats, recentMatches, roster] = fetched
  const lastMatch = recentMatches[0] ?? null

  // Derive featured players and leaders from roster
  const featuredPlayers = selectFeaturedPlayers(roster)
  const pointsLeaders = roster.filter((r) => r.wins === null).slice(0, 5)
  const goalsLeaders = [...roster.filter((r) => r.wins === null)]
    .sort((a, b) => b.goals - a.goals || b.points - a.points)
    .slice(0, 5)

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-baseline gap-3">
        <h1 className="font-condensed text-2xl font-semibold uppercase tracking-wide text-zinc-50">
          Home
        </h1>
        <span className="text-sm text-zinc-500">{gameTitle.name}</span>
      </div>

      {/* Team record strip — compact context */}
      {clubStats !== null && clubStats.gamesPlayed > 0 && <RecordStrip stats={clubStats} />}

      {/* Latest result hero */}
      {lastMatch !== null && (
        <section>
          <LatestResult match={lastMatch} />
        </section>
      )}

      {/* Featured players carousel */}
      {featuredPlayers.length > 0 && (
        <section>
          <h2 className="mb-3 font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Featured Players
          </h2>
          <PlayerCarousel players={featuredPlayers} />
        </section>
      )}

      {/* Leaders */}
      {pointsLeaders.length > 0 && (
        <section>
          <h2 className="mb-3 font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Leaders
          </h2>
          <LeadersSection pointsLeaders={pointsLeaders} goalsLeaders={goalsLeaders} />
        </section>
      )}

      {/* Recent games */}
      {recentMatches.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Recent Games
            </h2>
            <Link
              href="/games"
              className="text-xs text-zinc-600 transition-colors hover:text-zinc-400"
            >
              All games →
            </Link>
          </div>
          <div className="overflow-hidden border border-zinc-800 bg-surface divide-y divide-zinc-800/60">
            {recentMatches.map((match, i) => (
              <MatchRow key={match.id} match={match} isMostRecent={i === 0} />
            ))}
          </div>
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

// ─── Record strip — compact team summary ─────────────────────────────────────

function RecordStrip({ stats }: { stats: ClubGameTitleStats }) {
  const pct = winPct(stats.wins, stats.losses, stats.otl)

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border border-zinc-800 bg-surface px-5 py-3">
      {/* W / L / OTL */}
      <div className="flex items-center gap-4 font-condensed font-bold tabular leading-none">
        <span className="text-accent">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">W </span>
          <span className="text-xl">{stats.wins.toString()}</span>
        </span>
        <span>
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">L </span>
          <span className="text-xl text-zinc-300">{stats.losses.toString()}</span>
        </span>
        <span>
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">OTL </span>
          <span className="text-xl text-zinc-300">{stats.otl.toString()}</span>
        </span>
      </div>

      {/* Win% */}
      <span className="font-condensed text-sm font-semibold tabular text-zinc-400">{pct} Win%</span>

      {/* GP + GF/GA */}
      <span className="text-xs text-zinc-500">{stats.gamesPlayed.toString()} GP</span>
      <span className="text-xs tabular text-zinc-500">
        {stats.goalsFor.toString()} GF – {stats.goalsAgainst.toString()} GA
      </span>
    </div>
  )
}
