import type { Metadata } from 'next'
import type { ClubGameTitleStats } from '@eanhl/db'
import type { GameMode } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import {
  listGameTitles,
  listArchiveGameTitles,
  getActiveGameTitleBySlug,
  getClubStats,
  getClubSeasonRank,
  getOfficialClubRecord,
  getOpponentClub,
  getRecentMatches,
  getRoster,
  getEARoster,
  getHistoricalClubTeamStatsBatch,
  type HistoricalClubTeamBatchRow,
} from '@eanhl/db/queries'
import { redirect } from 'next/navigation'
import { LatestResult } from '@/components/home/latest-result'
import { PlayerCarousel } from '@/components/home/player-carousel'
import { ScoringLeadersPanel } from '@/components/home/leaders-section'
import { SeasonRankWidget } from '@/components/home/season-rank-widget'
import { ClubRecordSection } from '@/components/home/club-record-section'
import { RecentGamesStrip } from '@/components/home/recent-games-strip'
import {
  TitleRecordsTable,
  type TitleRecordData,
  type RecordModeStats,
} from '@/components/home/title-records-table'
import type { RosterRow } from '@/components/home/player-card'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'

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
      const found = await getActiveGameTitleBySlug(titleSlug)
      if (found) return { gameTitle: found, invalidRequested: false }
    }
    const all = await listGameTitles()
    return { gameTitle: all[0] ?? null, invalidRequested: Boolean(titleSlug) }
  } catch {
    return { gameTitle: null, invalidRequested: Boolean(titleSlug) }
  }
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
  const { gameTitle, invalidRequested } = await resolveGameTitle(titleSlug)

  if (invalidRequested) {
    const qs = new URLSearchParams()
    if (gameMode !== null) qs.set('mode', gameMode)
    redirect(qs.size > 0 ? `/?${qs.toString()}` : '/')
  }

  if (!gameTitle) {
    return (
      <Panel className="flex min-h-[12rem] items-center justify-center">
        <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
          No game titles are configured yet.
        </p>
      </Panel>
    )
  }

  // All mode sources from EA full-season totals; 6s/3s modes source from local tracked stats.
  const rosterSource = gameMode === null ? 'EA season totals' : `local tracked ${gameMode}`

  const fetched = await (async () => {
    try {
      return await Promise.all([
        getClubStats(gameTitle.id, gameMode),
        getRecentMatches({ gameTitleId: gameTitle.id, limit: 6 }),
        gameMode === null ? getEARoster(gameTitle.id) : getRoster(gameTitle.id, gameMode),
        getOfficialClubRecord(gameTitle.id),
        getClubSeasonRank(gameTitle.id),
        listArchiveGameTitles(),
        getClubStats(gameTitle.id, null),
        getClubStats(gameTitle.id, '6s'),
        getClubStats(gameTitle.id, '3s'),
      ])
    } catch {
      return null
    }
  })()

  if (fetched === null) {
    return (
      <Panel className="flex min-h-[12rem] items-center justify-center">
        <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
          Unable to load data right now.
        </p>
      </Panel>
    )
  }

  const [
    clubStats,
    recentMatches,
    roster,
    officialRecord,
    seasonRank,
    archiveTitles,
    liveAll,
    live6s,
    live3s,
  ] = fetched

  const archiveHistRows: HistoricalClubTeamBatchRow[] =
    archiveTitles.length > 0
      ? await getHistoricalClubTeamStatsBatch(archiveTitles.map((t) => t.id)).catch(() => [])
      : []

  const titleRecords = buildTitleRecords(
    gameTitle,
    liveAll,
    live6s,
    live3s,
    archiveTitles,
    archiveHistRows,
  )
  const lastMatch = recentMatches[0] ?? null
  const latestClubRecord = officialRecord ?? null

  let lastMatchOpponent = null
  if (lastMatch !== null) {
    try {
      lastMatchOpponent = await getOpponentClub(lastMatch.opponentClubId)
    } catch {
      // Logo display degrades gracefully to initial badge
    }
  }

  const featuredPlayers = selectFeaturedPlayers(roster)
  // Filter skaters by position, not by wins === null.
  // The aggregate worker writes wins = 0 (not null) for all skaters, so wins === null
  // is always false and would produce an empty array. Position-based detection matches
  // how the rest of the codebase (player-card, roster-table) identifies goalies.
  const skaters = roster.filter((r) => r.position !== 'goalie')
  const pointsLeaders = skaters.slice(0, 10)
  const goalsLeaders = [...skaters]
    .sort((a, b) => b.goals - a.goals || b.points - a.points)
    .slice(0, 10)

  return (
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
          <PlayerCarousel players={featuredPlayers} />
        </section>
      )}

      {/* 3. SCORING LEADERS */}
      {pointsLeaders.length > 0 && (
        <section>
          <ScoringLeadersPanel
            pointsLeaders={pointsLeaders}
            goalsLeaders={goalsLeaders}
            gameMode={gameMode}
            source={rosterSource}
          />
        </section>
      )}

      {/* 4. CLUB RECORD STRIP */}
      <ClubRecordSection
        gameMode={gameMode}
        titleSlug={titleSlug}
        officialRecord={officialRecord}
        localStats={clubStats}
      />

      {/* 5. SEASON RANK / DIVISION STANDING */}
      {seasonRank !== null && (
        <section className="space-y-3">
          <SectionHeader label="Division Standing" />
          <SeasonRankWidget rank={seasonRank} />
        </section>
      )}

      {/* 6. RECENT RESULTS */}
      {recentMatches.length > 1 && (
        <section className="space-y-3">
          <SectionHeader label="Recent Results" />
          <RecentGamesStrip matches={recentMatches.slice(1)} />
        </section>
      )}

      {/* 7. TITLE RECORDS — cross-title comparison */}
      <section className="space-y-3">
        <SectionHeader label="Title Records" />
        <TitleRecordsTable titles={titleRecords} />
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
  )
}

// ─── Cross-title records data builder ────────────────────────────────────────

/**
 * Playlist-to-mode mapping for the comparison table pill selector.
 *
 * Pill "6s"   → primary competitive EASHL/Clubs 6v6:   eashl_6v6 / clubs_6v6
 * Pill "6s+G" → full-squad 6-player mode (all human):  6_player_full_team / clubs_6_players
 * Pill "3s"   → primary competitive EASHL/Clubs 3v3:   eashl_3v3 / clubs_3v3
 *               (Threes casual mode intentionally excluded)
 *
 * NHL 22/23 use "clubs_*" naming; NHL 24/25+ use "eashl_*".
 * The mapping is explicit — no runtime inference.
 *
 * Live title (NHL 26): "All", "6s", and "3s" pills use local mode aggregates.
 * "6s+G" shows "—" — the live pipeline aggregates all 6-player playlists into
 * game_mode='6s' and does not distinguish full-team sub-mode.
 */
const HIST_PLAYLISTS_6S = new Set(['eashl_6v6', 'clubs_6v6'])
const HIST_PLAYLISTS_6SG = new Set(['6_player_full_team', 'clubs_6_players'])
const HIST_PLAYLISTS_3S = new Set(['eashl_3v3', 'clubs_3v3'])

function liveToRecord(stats: ClubGameTitleStats | null): RecordModeStats | null {
  if (!stats || stats.gamesPlayed === 0) return null
  const gfg =
    stats.gamesPlayed > 0 ? (stats.goalsFor / stats.gamesPlayed).toFixed(2) : null
  const gag =
    stats.gamesPlayed > 0 ? (stats.goalsAgainst / stats.gamesPlayed).toFixed(2) : null
  return {
    gamesPlayed: stats.gamesPlayed,
    wins: stats.wins,
    losses: stats.losses,
    otl: stats.otl,
    avgGoalsFor: gfg,
    avgGoalsAgainst: gag,
    avgTimeOnAttack: null,
    powerPlayPct: null,
    powerPlayKillPct: null,
  }
}

function histSingleRecord(
  rows: HistoricalClubTeamBatchRow[],
  titleId: number,
  playlists: Set<string>,
): RecordModeStats | null {
  const row = rows.find((r) => r.gameTitleId === titleId && playlists.has(r.playlist))
  if (!row?.gamesPlayed) return null
  return {
    gamesPlayed: row.gamesPlayed,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    otl: row.otl ?? 0,
    avgGoalsFor: row.avgGoalsFor ?? null,
    avgGoalsAgainst: row.avgGoalsAgainst ?? null,
    avgTimeOnAttack: row.avgTimeOnAttack ?? null,
    powerPlayPct: row.powerPlayPct ?? null,
    powerPlayKillPct: row.powerPlayKillPct ?? null,
  }
}

function histAllRecord(
  rows: HistoricalClubTeamBatchRow[],
  titleId: number,
): RecordModeStats | null {
  const titleRows = rows.filter((r) => r.gameTitleId === titleId && (r.gamesPlayed ?? 0) > 0)
  if (titleRows.length === 0) return null

  let gp = 0
  let w = 0
  let l = 0
  let otl = 0
  let gfgWeighted = 0
  let gagWeighted = 0
  let gpForRates = 0

  for (const r of titleRows) {
    const rGp = r.gamesPlayed ?? 0
    gp += rGp
    w += r.wins ?? 0
    l += r.losses ?? 0
    otl += r.otl ?? 0
    if (r.avgGoalsFor !== null && rGp > 0) {
      gfgWeighted += parseFloat(r.avgGoalsFor) * rGp
      gagWeighted += parseFloat(r.avgGoalsAgainst ?? '0') * rGp
      gpForRates += rGp
    }
  }

  return {
    gamesPlayed: gp,
    wins: w,
    losses: l,
    otl,
    avgGoalsFor: gpForRates > 0 ? (gfgWeighted / gpForRates).toFixed(2) : null,
    avgGoalsAgainst: gpForRates > 0 ? (gagWeighted / gpForRates).toFixed(2) : null,
    avgTimeOnAttack: null,
    powerPlayPct: null,
    powerPlayKillPct: null,
  }
}

function buildTitleRecords(
  liveTitle: { name: string; slug: string },
  liveAll: ClubGameTitleStats | null,
  live6s: ClubGameTitleStats | null,
  live3s: ClubGameTitleStats | null,
  archiveTitles: { id: number; name: string; slug: string }[],
  archiveHistRows: HistoricalClubTeamBatchRow[],
): TitleRecordData[] {
  const liveRow: TitleRecordData = {
    name: liveTitle.name,
    slug: liveTitle.slug,
    isLive: true,
    all: liveToRecord(liveAll),
    sixs: liveToRecord(live6s),
    sixsg: null,
    threes: liveToRecord(live3s),
  }

  const archiveRows: TitleRecordData[] = archiveTitles.map((t) => ({
    name: t.name,
    slug: t.slug,
    isLive: false,
    all: histAllRecord(archiveHistRows, t.id),
    sixs: histSingleRecord(archiveHistRows, t.id, HIST_PLAYLISTS_6S),
    sixsg: histSingleRecord(archiveHistRows, t.id, HIST_PLAYLISTS_6SG),
    threes: histSingleRecord(archiveHistRows, t.id, HIST_PLAYLISTS_3S),
  }))

  return [liveRow, ...archiveRows]
}
