import type { ClubGameTitleStats } from '@eanhl/db'
import type { HistoricalClubTeamBatchRow } from '@eanhl/db/queries'
import type { RecordModeStats, TitleRecordData } from '@/components/home/title-records-table'

/**
 * Home-page Title Records rows. `buildTitleRecords` is pure — no DB, no React
 * — so it runs under `node --test` (run: node --test apps/web/src/lib/title-records.test.ts).
 * `loadTitleRecords` wraps it with an injectable async loader so the page can
 * fetch the dataset as one all-or-nothing unit, isolated from its other
 * critical data.
 *
 * Every title appears exactly once, in the order given (pass the resolver's
 * newest-first `allTitles`), whichever title is selected:
 *   - a live (match-backed) title uses its match-derived club aggregates;
 *   - a non-live title uses its reviewed historical-import rows.
 * The two sources are never combined for one title.
 */

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
 * Live titles: "All", "6s", and "3s" pills use local mode aggregates.
 * "6s+G" shows "—" — the live pipeline aggregates all 6-player playlists into
 * game_mode='6s' and does not distinguish full-team sub-mode.
 */
const HIST_PLAYLISTS_6S = new Set(['eashl_6v6', 'clubs_6v6'])
const HIST_PLAYLISTS_6SG = new Set(['6_player_full_team', 'clubs_6_players'])
const HIST_PLAYLISTS_3S = new Set(['eashl_3v3', 'clubs_3v3'])

export interface TitleRecordSource {
  id: number
  name: string
  slug: string
  isLive: boolean
}

/** Match-derived club aggregates for one live title, per mode. */
export interface LiveTitleRecordStats {
  all: ClubGameTitleStats | null
  sixs: ClubGameTitleStats | null
  threes: ClubGameTitleStats | null
}

function liveToRecord(stats: ClubGameTitleStats | null): RecordModeStats | null {
  if (!stats || stats.gamesPlayed === 0) return null
  const gfg = stats.gamesPlayed > 0 ? (stats.goalsFor / stats.gamesPlayed).toFixed(2) : null
  const gag = stats.gamesPlayed > 0 ? (stats.goalsAgainst / stats.gamesPlayed).toFixed(2) : null
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
  rows: readonly HistoricalClubTeamBatchRow[],
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

/** "8:30" → 510; anything else → null. */
function toaSeconds(v: string | null): number | null {
  const m = v === null ? null : /^(\d+):(\d{2})$/.exec(v.trim())
  return m === null ? null : Number(m[1]) * 60 + Number(m[2])
}

function toaText(seconds: number): string {
  const s = Math.round(seconds)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function histAllRecord(
  rows: readonly HistoricalClubTeamBatchRow[],
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
  let toaWeighted = 0
  let gpForToa = 0

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
    // Average TOA per game combines exactly across playlists (weighted by GP);
    // PP% / PK% need opportunity counts the archive doesn't keep, so they stay null.
    const toa = toaSeconds(r.avgTimeOnAttack)
    if (toa !== null && rGp > 0) {
      toaWeighted += toa * rGp
      gpForToa += rGp
    }
  }

  return {
    gamesPlayed: gp,
    wins: w,
    losses: l,
    otl,
    avgGoalsFor: gpForRates > 0 ? (gfgWeighted / gpForRates).toFixed(2) : null,
    avgGoalsAgainst: gpForRates > 0 ? (gagWeighted / gpForRates).toFixed(2) : null,
    avgTimeOnAttack: gpForToa > 0 ? toaText(toaWeighted / gpForToa) : null,
    powerPlayPct: null,
    powerPlayKillPct: null,
  }
}

export function buildTitleRecords(
  titles: readonly TitleRecordSource[],
  liveStatsByTitleId: ReadonlyMap<number, LiveTitleRecordStats>,
  archiveHistRows: readonly HistoricalClubTeamBatchRow[],
): TitleRecordData[] {
  return titles.map((t): TitleRecordData => {
    if (t.isLive) {
      const live = liveStatsByTitleId.get(t.id)
      return {
        name: t.name,
        slug: t.slug,
        isLive: true,
        all: liveToRecord(live?.all ?? null),
        sixs: liveToRecord(live?.sixs ?? null),
        sixsg: null,
        threes: liveToRecord(live?.threes ?? null),
      }
    }
    return {
      name: t.name,
      slug: t.slug,
      isLive: false,
      all: histAllRecord(archiveHistRows, t.id),
      sixs: histSingleRecord(archiveHistRows, t.id, HIST_PLAYLISTS_6S),
      sixsg: histSingleRecord(archiveHistRows, t.id, HIST_PLAYLISTS_6SG),
      threes: histSingleRecord(archiveHistRows, t.id, HIST_PLAYLISTS_3S),
    }
  })
}

export interface TitleRecordsLoaderDeps {
  /** All/6s/3s match-derived club aggregates for ONE live title. */
  getLiveStats: (gameTitleId: number) => Promise<LiveTitleRecordStats>
  /** Reviewed historical rows for a batch of archive title ids. */
  getArchiveRows: (gameTitleIds: number[]) => Promise<readonly HistoricalClubTeamBatchRow[]>
  onError?: (error: unknown) => void
}

export type TitleRecordsLoad = { status: 'ok'; rows: TitleRecordData[] } | { status: 'unavailable' }

/**
 * Load the complete Title Records dataset as one all-or-nothing unit: every
 * live title's three `getLiveStats` calls plus the archive batch query are
 * all required. If ANY of them rejects, the whole result is `unavailable` —
 * never a partial table, and never dashes standing in for a failure. A
 * genuinely empty-but-successful dataset is `ok` with `null` stat cells,
 * which `TitleRecordsTable` already renders as dashes — that is a real
 * answer, not a failure.
 *
 * This never throws; a caller awaits it like any other independently-settled
 * data source (see apps/web/src/app/page.tsx, which starts it concurrently
 * with the page's other critical queries but never lets its failure blank
 * the rest of the page).
 */
export async function loadTitleRecords(
  titles: readonly TitleRecordSource[],
  deps: TitleRecordsLoaderDeps,
): Promise<TitleRecordsLoad> {
  const liveTitles = titles.filter((t) => t.isLive)
  const archiveTitleIds = titles.filter((t) => !t.isLive).map((t) => t.id)
  try {
    const [liveEntries, archiveRows] = await Promise.all([
      Promise.all(liveTitles.map(async (t) => [t.id, await deps.getLiveStats(t.id)] as const)),
      archiveTitleIds.length > 0 ? deps.getArchiveRows(archiveTitleIds) : Promise.resolve([]),
    ])
    return { status: 'ok', rows: buildTitleRecords(titles, new Map(liveEntries), archiveRows) }
  } catch (error) {
    deps.onError?.(error)
    return { status: 'unavailable' }
  }
}
