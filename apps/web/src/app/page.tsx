import type { Metadata } from 'next'
import type { ClubGameTitleStats, Match, MatchResult } from '@eanhl/db'
import type { GameMode } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import Link from 'next/link'
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
import {
  TitleRecordsTable,
  type TitleRecordData,
  type RecordModeStats,
} from '@/components/home/title-records-table'
import type { RosterRow } from '@/components/home/player-card'
import { formatMatchDate } from '@/lib/format'

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
  const { gameTitle, invalidRequested } = await resolveGameTitle(titleSlug)

  if (invalidRequested) {
    const qs = new URLSearchParams()
    if (gameMode !== null) qs.set('mode', gameMode)
    redirect(qs.size > 0 ? `/?${qs.toString()}` : '/')
  }

  if (!gameTitle) {
    return (
      <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
        <p className="text-sm text-zinc-500">No game titles are configured yet.</p>
      </div>
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
        // For the cross-title comparison table:
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
      <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
        <p className="text-sm text-zinc-500">Unable to load data right now.</p>
      </div>
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

  // Sequential: archive title IDs only known after round 1
  const archiveHistRows: HistoricalClubTeamBatchRow[] =
    archiveTitles.length > 0
      ? await getHistoricalClubTeamStatsBatch(archiveTitles.map((t) => t.id)).catch(() => [])
      : []

  // Build cross-title records data for the comparison table
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

  // Fetch opponent club metadata for crest display — non-fatal if unavailable
  let lastMatchOpponent = null
  if (lastMatch !== null) {
    try {
      lastMatchOpponent = await getOpponentClub(lastMatch.opponentClubId)
    } catch {
      // Logo display degrades gracefully to initial badge
    }
  }

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
      {/* Page header — team identity first */}
      <div className="flex items-baseline gap-3">
        <h1 className="font-condensed text-2xl font-semibold uppercase tracking-wide text-zinc-50">
          Boogeymen
        </h1>
        <span className="text-sm text-zinc-500">{gameTitle.name}</span>
      </div>

      {/* Latest result hero */}
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

      {/* Roster spotlight carousel — visual identity */}
      {featuredPlayers.length > 0 && (
        <section>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
                Roster Spotlight
              </h2>
              <p className="text-[11px] text-zinc-600">{rosterSource}</p>
            </div>
            <RecordGameModeFilter titleSlug={titleSlug} activeMode={gameMode} />
          </div>
          <PlayerCarousel players={featuredPlayers} winPct={clubWinPct} />
        </section>
      )}

      {/* Scoring leaders — high-value quick lookup */}
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

      {/* Cross-title club records comparison */}
      <section>
        <h2 className="mb-3 font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Title Records
        </h2>
        <TitleRecordsTable titles={titleRecords} />
      </section>

      {/* Recent results strip — the 5 games before the latest, quick-scan trend */}
      {recentMatches.length > 1 && (
        <section>
          <h2 className="mb-2 font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Recent Results
          </h2>
          <RecentGamesStrip matches={recentMatches.slice(1)} />
        </section>
      )}

      {/* Season rank / division widget */}
      {seasonRank !== null && (
        <section>
          <h2 className="mb-3 font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Division Standing
          </h2>
          <SeasonRankWidget rank={seasonRank} />
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

// ─── Recent games strip ───────────────────────────────────────────────────────

const RECENT_RESULT_CONFIG: Record<MatchResult, { label: string; className: string }> = {
  WIN: { label: 'W', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' },
  LOSS: { label: 'L', className: 'border-red-500/40 bg-red-500/10 text-red-400' },
  OTL: { label: 'OT', className: 'border-orange-500/40 bg-orange-500/10 text-orange-300' },
  DNF: { label: '—', className: 'border-zinc-600/40 bg-zinc-800/40 text-zinc-500' },
}

function RecentGamesStrip({ matches }: { matches: Match[] }) {
  if (matches.length === 0) return null

  return (
    <div className="divide-y divide-zinc-800/60 border border-zinc-800 bg-surface">
      {matches.map((match) => {
        const cfg = RECENT_RESULT_CONFIG[match.result]
        return (
          <Link
            key={match.id}
            href={`/games/${match.id.toString()}`}
            className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-800/30"
          >
            <span
              className={`inline-flex h-6 w-8 shrink-0 items-center justify-center rounded border font-condensed text-[11px] font-bold ${cfg.className}`}
            >
              {cfg.label}
            </span>
            <span className="flex-1 truncate font-condensed text-sm font-semibold text-zinc-200">
              vs {match.opponentName}
            </span>
            <span className="shrink-0 font-condensed text-sm font-bold tabular-nums text-zinc-400">
              {match.scoreFor.toString()}–{match.scoreAgainst.toString()}
            </span>
            {match.gameMode !== null && (
              <span className="hidden shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-500 sm:inline">
                {match.gameMode}
              </span>
            )}
            <span className="hidden shrink-0 text-xs text-zinc-600 sm:inline">
              {formatMatchDate(match.playedAt)}
            </span>
          </Link>
        )
      })}
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
