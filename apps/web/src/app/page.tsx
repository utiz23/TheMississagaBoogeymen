import type { Metadata } from 'next'
import type { ClubGameTitleStats, ClubSeasonalStats, Match, MatchResult } from '@eanhl/db'
import type { GameMode } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import Link from 'next/link'
import {
  listGameTitles,
  getGameTitleBySlug,
  getClubStats,
  getClubSeasonRank,
  getOfficialClubRecord,
  getOpponentClub,
  getRecentMatches,
  getRoster,
  getEARoster,
} from '@eanhl/db/queries'
import { LatestResult } from '@/components/home/latest-result'
import { PlayerCarousel } from '@/components/home/player-carousel'
import { ScoringLeadersPanel } from '@/components/home/leaders-section'
import { SeasonRankWidget } from '@/components/home/season-rank-widget'
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

  const [clubStats, recentMatches, roster, officialRecord, seasonRank] = fetched
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

      {/* Team record strip — compact context, mode-filterable */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Club Record
          </h2>
          <RecordGameModeFilter titleSlug={titleSlug} activeMode={gameMode} />
        </div>
        {gameMode === null ? (
          officialRecord !== null ? (
            <RecordStrip officialRecord={officialRecord} localStats={clubStats} />
          ) : (
            <OfficialRecordUnavailable localStats={clubStats} />
          )
        ) : clubStats !== null && clubStats.gamesPlayed > 0 ? (
          <LocalModeRecordStrip stats={clubStats} gameMode={gameMode} />
        ) : (
          <div className="flex items-center justify-center border border-zinc-800 bg-surface py-5">
            <p className="text-sm text-zinc-500">No {gameMode} games recorded yet.</p>
          </div>
        )}
      </section>

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

      {/* Roster spotlight carousel — visual identity, lower priority */}
      {featuredPlayers.length > 0 && (
        <section>
          <div className="mb-3 flex flex-col">
            <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Roster Spotlight
            </h2>
            <p className="text-[11px] text-zinc-600">{rosterSource}</p>
          </div>
          <PlayerCarousel players={featuredPlayers} winPct={clubWinPct} />
        </section>
      )}

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

// ─── Record strip variants ────────────────────────────────────────────────────

/** All-modes: official EA record. Never falls back to local aggregate. */
function RecordStrip({
  officialRecord,
  localStats,
}: {
  officialRecord: ClubSeasonalStats
  localStats: ClubGameTitleStats | null
}) {
  const pct = winPct(officialRecord.wins, officialRecord.losses, officialRecord.otl)

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border border-zinc-800 bg-surface px-5 py-3">
      <div className="flex items-center gap-4 font-condensed font-bold tabular leading-none">
        <span className="text-accent">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">W </span>
          <span className="text-xl">{officialRecord.wins.toString()}</span>
        </span>
        <span>
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">L </span>
          <span className="text-xl text-zinc-300">{officialRecord.losses.toString()}</span>
        </span>
        <span>
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">OTL </span>
          <span className="text-xl text-zinc-300">{officialRecord.otl.toString()}</span>
        </span>
      </div>

      <span className="font-condensed text-sm font-semibold tabular text-zinc-400">{pct} Win%</span>
      <span className="text-xs text-zinc-500">{officialRecord.gamesPlayed.toString()} GP</span>

      {officialRecord.rankingPoints != null && (
        <span className="text-xs text-zinc-500">{officialRecord.rankingPoints.toString()} pts</span>
      )}

      {/* GF/GA sourced from local match data — explicitly labelled */}
      {localStats !== null && localStats.gamesPlayed > 0 && (
        <span className="text-xs tabular text-zinc-500">
          {localStats.goalsFor.toString()} GF – {localStats.goalsAgainst.toString()} GA
        </span>
      )}

      <span className="text-xs text-zinc-600">EA official</span>
    </div>
  )
}

/** All-modes: official record not yet fetched. Shows local GF/GA if available. */
function OfficialRecordUnavailable({ localStats }: { localStats: ClubGameTitleStats | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border border-zinc-800 bg-surface px-5 py-3">
      <span className="text-sm text-zinc-500">Official record not yet available</span>
      {localStats !== null && localStats.gamesPlayed > 0 && (
        <span className="text-xs tabular text-zinc-500">
          {localStats.goalsFor.toString()} GF – {localStats.goalsAgainst.toString()} GA ·{' '}
          {localStats.gamesPlayed.toString()} ingested GP
        </span>
      )}
    </div>
  )
}

/** Mode-filtered: local aggregate only. Labelled so it's clear these are not EA-official. */
function LocalModeRecordStrip({
  stats,
  gameMode,
}: {
  stats: ClubGameTitleStats
  gameMode: GameMode
}) {
  const pct = winPct(stats.wins, stats.losses, stats.otl)

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border border-zinc-800 bg-surface px-5 py-3">
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

      <span className="font-condensed text-sm font-semibold tabular text-zinc-400">{pct} Win%</span>
      <span className="text-xs text-zinc-500">{stats.gamesPlayed.toString()} GP</span>

      <span className="text-xs tabular text-zinc-500">
        {stats.goalsFor.toString()} GF – {stats.goalsAgainst.toString()} GA
      </span>

      <span className="text-xs text-zinc-600">local · {gameMode} only</span>
    </div>
  )
}
