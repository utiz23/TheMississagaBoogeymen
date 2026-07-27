import type { Metadata } from 'next'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getMatchById,
  getPlayerMatchStats,
  getOpponentPlayerMatchStats,
  getOpponentClub,
  getMatchSeasonNumber,
  getMatchSeriesContext,
  getAdjacentMatches,
  getMatchPeriodSummaries,
  getMatchEvents,
  getMatchActionTrackerProvenance,
  getMatchLineups,
  getMatchLineupProvenance,
  getMatchFaceoffDots,
  getMatchFaceoffZoneSummaries,
  getSeasonPlayerMatchStats,
} from '@eanhl/db/queries'
import type { Match } from '@eanhl/db'
import { HeroCard } from '@/components/matches/hero-card'
import { TopPerformers } from '@/components/matches/top-performers'
import { PossessionEdgeBar } from '@/components/matches/possession-edge'
import { TeamStats } from '@/components/matches/team-stats'
import { ContextFooter } from '@/components/matches/context-footer'
import { BoxScore } from '@/components/matches/box-score'
import { EventTimeline } from '@/components/matches/event-timeline'
import { ActionTrackerMap } from '@/components/matches/action-tracker-map'
import { LineupSection } from '@/components/matches/lineup-section'
import { Panel } from '@/components/ui/panel'
import {
  buildAllTeamScores,
  applyLoadoutOverrides,
  buildBoxScore,
  buildLineupFromStats,
  buildPossessionEdge,
  buildTopPerformers,
  computeSeasonAvgs,
  attachSeasonAvgs,
} from '@/lib/match-recap'
import { resolveOpponentColors } from '@/lib/opponent-colors'
import { abbreviateTeamName } from '@/lib/format'

// Match data never changes once written — cache indefinitely
export const revalidate = false

interface Props {
  params: Promise<{ id: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
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

export default async function GameDetailPage({ params, searchParams }: Props) {
  const { id: idStr } = await params
  const queryParams = searchParams ? await searchParams : {}
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
  const [
    playerStats,
    opponentPlayerStats,
    opponentClub,
    seasonNumber,
    seriesContext,
    adjacent,
    periodSummaries,
    matchEventRows,
    actionTrackerProvenance,
    lineups,
    lineupProvenance,
    faceoffDots,
    faceoffZones,
  ] = await Promise.all([
    safe(() => getPlayerMatchStats(m.id), []),
    safe(() => getOpponentPlayerMatchStats(m.id), []),
    safe(() => getOpponentClub(m.opponentClubId), null),
    safe(() => getMatchSeasonNumber(m.gameTitleId, m.playedAt), null),
    safe(() => getMatchSeriesContext(m.gameTitleId, m.opponentClubId, m.playedAt), null),
    safe(() => getAdjacentMatches(m.gameTitleId, m.playedAt), {
      previous: null,
      next: null,
    }),
    safe(() => getMatchPeriodSummaries(m.id), []),
    safe(() => getMatchEvents(m.id), []),
    safe(() => getMatchActionTrackerProvenance(m.id), { extractedAt: null, sources: [] }),
    safe(() => getMatchLineups(m.id), { bgm: [], opponent: [] }),
    safe(() => getMatchLineupProvenance(m.id), {
      capturedAt: null,
      sources: [],
      confidence: { canonical: 0, tiered: 0, attribute: 0 },
    }),
    safe(() => getMatchFaceoffDots(m.id), []),
    safe(() => getMatchFaceoffZoneSummaries(m.id), []),
  ])

  const opponentCrestAssetId = opponentClub?.crestAssetId ?? null
  const opponentCrestUseBaseAsset = opponentClub?.useBaseAsset ?? null
  const opponentPrimaryColor = opponentClub?.primaryColor ?? null

  // Opponent colour — resolved once server-side through the clash ladder
  // (BGM red is reserved; a raw brand hex never reaches a surface). Published
  // as the `--opp*` custom properties on the page root; see globals.css.
  const opponentColors = resolveOpponentColors({
    abbrev: abbreviateTeamName(m.opponentName),
    brandHex: m.oppColorHex ?? opponentClub?.primaryColor ?? null,
  })
  const opponentColorVars = {
    '--opp': opponentColors.base,
    '--opp-2': opponentColors.strong,
    '--opp-line': opponentColors.line,
    '--opp-soft': opponentColors.soft,
  } as CSSProperties

  // Season-to-date player history for the "vs season avg" delta on the
  // Three Stars cards. BGM-only — opponents have no profile / history.
  const bgmPlayerIds = playerStats.map((p) => p.playerId)
  const seasonRows = await safe(
    () => getSeasonPlayerMatchStats(m.gameTitleId, m.playedAt, bgmPlayerIds),
    [],
  )
  const seasonAvgs = computeSeasonAvgs(seasonRows)

  // ── View-model derivations ──────────────────────────────────────────────────
  // Three Stars sources position / jersey # / archetype from the pre-game
  // loadout OCR first, falling back to EA position + manual profile data.
  const playerStatsForStars = applyLoadoutOverrides(playerStats, lineups.bgm)
  const opponentStatsForStars = applyLoadoutOverrides(opponentPlayerStats, lineups.opponent)

  // Lineup & Loadouts source: use the OCR loadout snapshots when present;
  // otherwise fall back to the box score so we still show who dressed and
  // where (jersey # + archetype for BGM), rendered in the lean variant.
  const hasOcrLineups = lineups.bgm.length > 0 || lineups.opponent.length > 0
  const lineupVariant: 'ocr' | 'boxScore' = hasOcrLineups ? 'ocr' : 'boxScore'
  const lineupData = hasOcrLineups
    ? lineups
    : {
        bgm: buildLineupFromStats(playerStats, 'bgm', m.playedAt),
        opponent: buildLineupFromStats(opponentPlayerStats, 'opp', m.playedAt),
      }

  const topPerformers = attachSeasonAvgs(
    buildTopPerformers(match, playerStatsForStars, opponentStatsForStars),
    seasonAvgs,
  )
  const allTeamScores = buildAllTeamScores(match, playerStatsForStars, opponentStatsForStars)
  const possessionEdge = buildPossessionEdge(match, periodSummaries)
  const boxScore = buildBoxScore(match, playerStats, opponentPlayerStats, periodSummaries)

  const heroMeta = {
    seasonNumber,
    meetingNumber: seriesContext?.meetingNumber ?? null,
    seriesSummary: seriesContext ? formatSeriesSummary(seriesContext, match.opponentName) : null,
  }
  const listQuery = gamesListQuery(queryParams)
  const gamesHref = `/games${listQuery ? `?${listQuery}` : ''}`

  return (
    <div className="space-y-8" style={opponentColorVars}>
      {/* 1. Top bar */}
      <GameDetailNav gamesHref={gamesHref} adjacent={adjacent} listQuery={listQuery} />

      {/* 2. Scoreboard hero */}
      <HeroCard
        match={match}
        opponentCrestAssetId={opponentCrestAssetId}
        opponentCrestUseBaseAsset={opponentCrestUseBaseAsset}
        meta={heroMeta}
      />

      {/* 3. Sub-nav slot — the LOADOUTS | STATS segmented control lands here (Phase 3). */}

      {/* 4. Main grid — main column (3/4) + rail (1/4); the rail stacks after
            the main column below lg. */}
      <div className="grid items-start gap-4 lg:grid-cols-4">
        <div className="min-w-0 space-y-4 lg:col-span-3">
          {/* Pre-game lineup section. Rich OCR loadout ladder when snapshots
              exist; otherwise a lean box-score lineup (who dressed + position). */}
          <LineupSection
            lineups={lineupData}
            variant={lineupVariant}
            opponentLabel={match.opponentName}
            matchId={match.id}
            gameMode={match.gameMode}
            provenance={lineupProvenance}
          />

          {/* OCR-derived event timeline — story-mode scoresheet with running
              score, lead-change banners, and GWG highlight. */}
          <EventTimeline
            events={matchEventRows}
            opponentLabel={match.opponentName}
            bgmWasHome={match.bgmWasHome}
            bgmColor={match.bgmColorHex}
            oppColor={match.oppColorHex}
          />
        </div>

        <div className="min-w-0 space-y-4">
          <TopPerformers
            performers={topPerformers}
            allTeamScores={allTeamScores}
            opponentLabel={match.opponentName}
          />

          {/* Deserve-to-win — the DtW gauge replaces this bar in Phase 7. */}
          {possessionEdge !== null ? (
            <PossessionEdgeBar
              edge={possessionEdge}
              opponentName={match.opponentName}
              scoreFor={match.scoreFor}
              scoreAgainst={match.scoreAgainst}
            />
          ) : null}

          {/* OCR-derived per-period box score (hidden until reviewed). */}
          <BoxScore rows={periodSummaries} opponentLabel={match.opponentName} />

          <TeamStats rows={boxScore} opponentName={match.opponentName} />
        </div>
      </div>

      {/* 5. Full-width action tracker (rink-coordinate spatial extraction +
            all-type event card list mirroring the in-game post-game Action
            Tracker; hosts the Faceoff Map as a separate view-mode). */}
      <ActionTrackerMap
        events={matchEventRows}
        opponentLabel={match.opponentName}
        opponentColor={opponentPrimaryColor}
        bgmWasHome={match.bgmWasHome}
        bgmColor={match.bgmColorHex}
        oppColor={match.oppColorHex}
        faceoffDots={faceoffDots}
        faceoffZones={faceoffZones}
        provenance={actionTrackerProvenance}
      />

      {/* 6. Context footer (lowest priority — first to cut if scope shrinks) */}
      <ContextFooter previous={adjacent.previous} next={adjacent.next} />
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gamesListQuery(params: Record<string, string | string[] | undefined>): string {
  const qs = new URLSearchParams()
  for (const key of ['title', 'mode', 'result', 'opponent', 'page']) {
    const value = params[key]
    if (typeof value === 'string' && value.trim()) qs.set(key, value)
  }
  return qs.toString()
}

function gameHref(id: number, listQuery: string): string {
  return `/games/${id.toString()}${listQuery ? `?${listQuery}` : ''}`
}

function GameDetailNav({
  gamesHref,
  adjacent,
  listQuery,
}: {
  gamesHref: string
  adjacent: {
    previous: Awaited<ReturnType<typeof getAdjacentMatches>>['previous']
    next: Awaited<ReturnType<typeof getAdjacentMatches>>['next']
  }
  listQuery: string
}) {
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
      <Link
        href={gamesHref}
        className="inline-flex items-center gap-1.5 font-condensed text-xs font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <span aria-hidden>←</span> All Games
      </Link>

      <div className="flex items-center gap-2">
        {adjacent.previous ? (
          <Link
            href={gameHref(adjacent.previous.id, listQuery)}
            className="border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-condensed text-xs font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
          >
            ← Previous
          </Link>
        ) : (
          <span className="select-none border border-zinc-900 px-3 py-1.5 font-condensed text-xs font-semibold uppercase tracking-wider text-zinc-700">
            ← Previous
          </span>
        )}

        {adjacent.next ? (
          <Link
            href={gameHref(adjacent.next.id, listQuery)}
            className="border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-condensed text-xs font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
          >
            Next →
          </Link>
        ) : (
          <span className="select-none border border-zinc-900 px-3 py-1.5 font-condensed text-xs font-semibold uppercase tracking-wider text-zinc-700">
            Next →
          </span>
        )}
      </div>
    </nav>
  )
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

function formatSeriesSummary(
  ctx: {
    meetingNumber: number
    series: { wins: number; losses: number; otl: number; total: number }
  },
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
    <Panel className="flex min-h-[12rem] items-center justify-center">
      <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">{message}</p>
    </Panel>
  )
}
