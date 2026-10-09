import type { Metadata } from 'next'
import { MemberLinks } from '@/components/ui/member-links'
import type { GameMode } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import {
  getClubStats,
  getClubSeasonRank,
  getOfficialClubRecord,
  getOpponentClub,
  getRecentMatches,
  getMatchFaceoffTotals,
  getRoster,
  getEARoster,
  getRosterCarryOvers,
  getCardProgressForPlayers,
  getClubMemberIds,
  getHistoricalClubTeamStatsBatch,
} from '@eanhl/db/queries'
import { redirect } from 'next/navigation'
import { LatestResult } from '@/components/home/latest-result'
import { PlayerCarousel } from '@/components/home/player-carousel'
import { ScoringLeadersPanel } from '@/components/home/leaders-section'
import { RecordStrip } from '@/components/home/record-strip'
import { RecentGamesStrip } from '@/components/home/recent-games-strip'
import { TitleRecordsTable } from '@/components/home/title-records-table'
import { cardFromRosterRow } from '@/components/cards/card-adapters'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'
import { resolveTitleFromSlug } from '@/lib/title-resolver'
import { loadTitleRecords } from '@/lib/title-records'

function parseGameMode(raw: string | string[] | undefined): GameMode | null {
  if (typeof raw !== 'string') return null
  return (GAME_MODE as readonly string[]).includes(raw) ? (raw as GameMode) : null
}

export const metadata: Metadata = { title: 'Club Stats' }

export const revalidate = 300

type SearchParams = Promise<Record<string, string | string[] | undefined>>

type RosterRow = Awaited<ReturnType<typeof getRoster>>[number]

/**
 * Roster ordered by points descending for the featured carousel.
 * Goalies sort naturally to the back (0 points).
 */
function selectFeaturedPlayers(roster: RosterRow[]): RosterRow[] {
  return [...roster].sort((a, b) => b.points - a.points || b.gamesPlayed - a.gamesPlayed)
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
  const gameMode = parseGameMode(params.mode)
  const result = await resolveTitleFromSlug(titleSlug, { liveOnly: true }).catch(() => null)

  if (result === null) {
    return (
      <Panel className="flex min-h-[12rem] items-center justify-center">
        <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
          Unable to load data right now.
        </p>
      </Panel>
    )
  }

  if (result.kind === 'invalid') {
    const qs = new URLSearchParams()
    if (gameMode !== null) qs.set('mode', gameMode)
    redirect(qs.size > 0 ? `/?${qs.toString()}` : '/')
  }

  if (result.kind === 'empty') {
    return (
      <Panel className="flex min-h-[12rem] items-center justify-center">
        <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
          No game titles are configured yet.
        </p>
      </Panel>
    )
  }

  const { gameTitle, allTitles } = result.resolved

  // All mode sources from EA full-season totals; 6s/3s modes source from local tracked stats.
  const rosterSource = gameMode === null ? 'EA season totals' : `local tracked ${gameMode}`

  // The selected title's page-critical data and the supplemental cross-title
  // Title Records dataset are started concurrently but settle independently:
  // a Title Records failure must never blank the rest of the page, and a
  // page-critical failure must never be masked as valid (empty) Title Records.
  const criticalPromise = (async () => {
    try {
      return await Promise.all([
        getClubStats(gameTitle.id, gameMode),
        getRecentMatches({ gameTitleId: gameTitle.id, limit: 11 }),
        gameMode === null ? getEARoster(gameTitle.id) : getRoster(gameTitle.id, gameMode),
        getOfficialClubRecord(gameTitle.id),
        getClubSeasonRank(gameTitle.id),
      ])
    } catch {
      return null
    }
  })()

  const titleRecordsPromise = loadTitleRecords(allTitles, {
    getLiveStats: async (titleId) => {
      const [all, sixs, threes] = await Promise.all([
        getClubStats(titleId, null),
        getClubStats(titleId, '6s'),
        getClubStats(titleId, '3s'),
      ])
      return { all, sixs, threes }
    },
    getArchiveRows: getHistoricalClubTeamStatsBatch,
    onError: (error) => {
      console.error('[home] Title Records unavailable', error)
    },
  })

  const [fetched, titleRecords] = await Promise.all([criticalPromise, titleRecordsPromise])

  if (fetched === null) {
    return (
      <Panel className="flex min-h-[12rem] items-center justify-center">
        <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
          Unable to load data right now.
        </p>
      </Panel>
    )
  }

  const [clubStats, recentMatches, roster, officialRecord, seasonRank] = fetched
  const lastMatch = recentMatches[0] ?? null
  const latestClubRecord = officialRecord ?? null

  let lastMatchOpponent = null
  let lastMatchFaceoffs: Awaited<ReturnType<typeof getMatchFaceoffTotals>> | null = null
  if (lastMatch !== null) {
    try {
      lastMatchOpponent = await getOpponentClub(lastMatch.opponentClubId)
    } catch {
      // Logo display degrades gracefully to initial badge
    }
    lastMatchFaceoffs = await getMatchFaceoffTotals(lastMatch.id)
  }

  // The carousel also carries last title's members who haven't played this
  // title yet (zero games, sorted last). A failure only leaves them out.
  const carryOvers = await getRosterCarryOvers(gameTitle.id).catch(() => [])
  // Cards are for team members only (operator, 2026-10-09): a mode's local
  // roster also holds guests who filled in. A failure keeps everyone.
  const memberIds = await getClubMemberIds()
    .then((ids) => new Set(ids))
    .catch(() => null)
  const featuredPlayers = selectFeaturedPlayers(
    [...roster, ...carryOvers].filter((p) => memberIds === null || memberIds.has(p.playerId)),
  )
  // Player cards (tier, theme, featured badge). A failure only drops the
  // progression: every card then shows tier 1, as for a player not yet computed.
  const cardSummaries = await getCardProgressForPlayers(
    featuredPlayers.map((p) => p.playerId),
  ).catch(() => new Map<number, never>())
  const featuredCards = featuredPlayers.map((p) =>
    cardFromRosterRow(p, cardSummaries.get(p.playerId)),
  )
  // Filter skaters by position, not by wins === null.
  // The aggregate worker writes wins = 0 (not null) for all skaters, so wins === null
  // is always false and would produce an empty array. Position-based detection matches
  // how the rest of the codebase (player-card, roster-table) identifies goalies.
  const skaters = roster.filter((r) => r.position !== 'goalie')
  const pointsLeaders = skaters.slice(0, 10)
  const goalsLeaders = [...skaters]
    .sort((a, b) => b.goals - a.goals || b.points - a.points)
    .slice(0, 10)
  const goalieLeaders = roster.filter((r) => r.goalieGp > 0 && r.savePct !== null)
  const teamGp = officialRecord ? officialRecord.gamesPlayed : (clubStats?.gamesPlayed ?? null)

  return (
    <MemberLinks>
      <div className="space-y-8">
        {/* Page header — team identity first */}
        <div className="flex items-baseline gap-3">
          <h1 className="font-condensed text-2xl font-semibold uppercase tracking-widest text-zinc-50">
            Boogeymen
          </h1>
          <span className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
            {gameTitle.name}
          </span>
        </div>

        {/* 1. LATEST RESULT */}
        {lastMatch !== null && (
          <section>
            <LatestResult
              match={lastMatch}
              clubRecord={latestClubRecord}
              opponentCrestAssetId={lastMatchOpponent?.crestAssetId ?? null}
              opponentCrestUseBaseAsset={lastMatchOpponent?.useBaseAsset ?? null}
              faceoffs={lastMatchFaceoffs}
              divisionName={seasonRank?.divisionName ?? null}
            />
          </section>
        )}

        {/* 2. ROSTER SPOTLIGHT */}
        {featuredPlayers.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <SectionHeader label="Roster Spotlight" />
              <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-600">
                {rosterSource}
              </span>
            </div>
            <PlayerCarousel cards={featuredCards} />
          </section>
        )}

        {/* 3. SCORING LEADERS */}
        {(pointsLeaders.length > 0 || goalieLeaders.length > 0) && (
          <section>
            <ScoringLeadersPanel
              pointsLeaders={pointsLeaders}
              goalsLeaders={goalsLeaders}
              goalieLeaders={goalieLeaders}
              gameMode={gameMode}
              source={rosterSource}
              teamGp={teamGp ?? undefined}
            />
          </section>
        )}

        {/* 4. RECORD STRIP — record / win% / goal diff / form */}
        <RecordStrip
          officialRecord={officialRecord}
          localStats={clubStats}
          seasonRank={seasonRank}
          recentResults={recentMatches.map((m) => ({ result: m.result, playedAt: m.playedAt }))}
          gameTitleName={gameTitle.name}
        />

        {/* 5. RECENT RESULTS */}
        {recentMatches.length > 1 && (
          <section className="space-y-3">
            <SectionHeader label="Recent Results" />
            <RecentGamesStrip matches={recentMatches.slice(1, 6)} />
          </section>
        )}

        {/* 7. TITLE RECORDS — cross-title comparison */}
        <section className="space-y-3">
          <SectionHeader label="Title Records" />
          {titleRecords.status === 'ok' ? (
            <TitleRecordsTable titles={titleRecords.rows} />
          ) : (
            <Panel className="flex min-h-[8rem] items-center justify-center">
              <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
                Title Records unavailable right now.
              </p>
            </Panel>
          )}
        </section>

        {/* Empty state when no data at all */}
        {clubStats !== null &&
          clubStats.gamesPlayed === 0 &&
          lastMatch === null &&
          roster.length === 0 && (
            <Panel className="flex min-h-[12rem] items-center justify-center">
              <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
                No games recorded for {gameTitle.name} yet.
              </p>
            </Panel>
          )}
      </div>
    </MemberLinks>
  )
}
