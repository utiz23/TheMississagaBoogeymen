import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getMatchById,
  getPlayerMatchStats,
  getOpponentClub,
  getMatchSeasonNumber,
  getMatchSeriesContext,
  getAdjacentMatches,
} from '@eanhl/db/queries'
import type { Match } from '@eanhl/db'
import { HeroCard } from '@/components/matches/hero-card'
import { TopPerformers } from '@/components/matches/top-performers'
import { PossessionEdgeBar } from '@/components/matches/possession-edge'
import { TeamStats } from '@/components/matches/team-stats'
import { GoalieSpotlightSection } from '@/components/matches/goalie-spotlight'
import { ScoresheetSection } from '@/components/matches/scoresheet'
import { ContextFooter } from '@/components/matches/context-footer'
import {
  buildBoxScore,
  buildGoalieSpotlight,
  buildPossessionEdge,
  buildScoresheet,
  buildTopPerformers,
} from '@/lib/match-recap'

// Match data never changes once written — cache indefinitely
export const revalidate = false

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) return { title: 'Game Not Found — Club Stats' }
  try {
    const match = await getMatchById(id)
    if (!match) return { title: 'Game Not Found — Club Stats' }
    return { title: `vs ${match.opponentName} — Club Stats` }
  } catch {
    return { title: 'Game — Club Stats' }
  }
}

export default async function GameDetailPage({ params }: Props) {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) notFound()

  let match: Match | null = null
  try {
    match = await getMatchById(id)
  } catch {
    return <ErrorState message="Unable to load match data right now." />
  }
  if (!match) notFound()

  // Capture into a const so TS narrowing carries through the closures below.
  const m = match
  // Fetch all secondary data in parallel; each can fail independently and the
  // section that needs it will simply hide. The hero + main page still render.
  const [playerStats, opponentClub, seasonNumber, seriesContext, adjacent] =
    await Promise.all([
      safe(() => getPlayerMatchStats(m.id), []),
      safe(() => getOpponentClub(m.opponentClubId), null),
      safe(() => getMatchSeasonNumber(m.gameTitleId, m.playedAt), null),
      safe(
        () => getMatchSeriesContext(m.gameTitleId, m.opponentClubId, m.playedAt),
        null,
      ),
      safe(() => getAdjacentMatches(m.gameTitleId, m.playedAt), {
        previous: null,
        next: null,
      }),
    ])

  const opponentCrestAssetId = opponentClub?.crestAssetId ?? null
  const opponentCrestUseBaseAsset = opponentClub?.useBaseAsset ?? null

  // ── View-model derivations ──────────────────────────────────────────────────
  const topPerformers = buildTopPerformers(playerStats)
  const possessionEdge = buildPossessionEdge(match)
  const boxScore = buildBoxScore(match)
  const goalieSpotlight = buildGoalieSpotlight(playerStats)
  const scoresheet = buildScoresheet(playerStats)

  const heroMeta = {
    seasonNumber,
    meetingNumber: seriesContext?.meetingNumber ?? null,
    seriesSummary: seriesContext ? formatSeriesSummary(seriesContext, match.opponentName) : null,
  }

  return (
    <div className="space-y-8">
      {/* Back link */}
      <Link
        href="/games"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <span aria-hidden>←</span> Games
      </Link>

      {/* 1. Hero */}
      <HeroCard
        match={match}
        opponentCrestAssetId={opponentCrestAssetId}
        opponentCrestUseBaseAsset={opponentCrestUseBaseAsset}
        meta={heroMeta}
      />

      {/* 2. Story strip — Top Performers + Possession Edge */}
      {(topPerformers.length > 0 || possessionEdge !== null) && (
        <div className="space-y-6">
          {topPerformers.length > 0 ? <TopPerformers performers={topPerformers} /> : null}
          {possessionEdge !== null ? <PossessionEdgeBar edge={possessionEdge} /> : null}
        </div>
      )}

      {/* 3. Team stats */}
      <TeamStats rows={boxScore} />

      {/* 4. Goalie spotlight (omitted entirely if no goalie data) */}
      <GoalieSpotlightSection goalies={goalieSpotlight} />

      {/* 5. BGM scoresheet */}
      {scoresheet.skaters.length === 0 && scoresheet.goalies.length === 0 ? (
        <EmptyScoresheet />
      ) : (
        <ScoresheetSection scoresheet={scoresheet} />
      )}

      {/* 6. Context footer (lowest priority — first to cut if scope shrinks) */}
      <ContextFooter previous={adjacent.previous} next={adjacent.next} />
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

function formatSeriesSummary(
  ctx: { meetingNumber: number; series: { wins: number; losses: number; otl: number; total: number } },
  opponentName: string,
): string | null {
  const { meetingNumber, series } = ctx
  if (series.total <= 1) return null // first meeting — nothing prior to summarize
  const ord = ordinal(meetingNumber)
  const record = `${series.wins.toString()}-${series.losses.toString()}-${series.otl.toString()}`
  return `${ord} meeting vs ${opponentName} · series ${record}`
}

function ordinal(n: number): string {
  const s = n.toString()
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 13) return `${s}th`
  switch (n % 10) {
    case 1:
      return `${s}st`
    case 2:
      return `${s}nd`
    case 3:
      return `${s}rd`
    default:
      return `${s}th`
  }
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
      <p className="text-sm text-zinc-500">{message}</p>
    </div>
  )
}

function EmptyScoresheet() {
  return (
    <section>
      <div className="flex min-h-[6rem] items-center justify-center border border-zinc-800 bg-surface">
        <p className="text-sm text-zinc-500">No player stats recorded for this game.</p>
      </div>
    </section>
  )
}
