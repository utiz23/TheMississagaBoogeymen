import { Fragment } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  getRecentMatches,
  countMatches,
  getOpponentClubs,
  getOcrCoverageForMatches,
  getClubFinalsBadges,
  getClubFinalsOverview,
  getEnginePeriodStrips,
  type ClubFinalsBadge,
  type EnginePeriodStripRow,
  type MatchOcrCoverage,
} from '@eanhl/db/queries'
import type { GameMode, MatchResult } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import type { GameTitle } from '@eanhl/db'
import { ScoreCard } from '@/components/matches/score-card'
import { ClubFinalsRoundDivider } from '@/components/matches/club-finals-badge'
import {
  GamesFilterPanel,
  LastTenStrip,
  type FilterGroup,
  type FilterTone,
} from '@/components/matches/games-filter'
import { Panel } from '@/components/ui/panel'
import { SectionHeader } from '@/components/ui/section-header'
import {
  FINALS_ROUND_COUNT,
  clubFinalsMatchIds,
  clubFinalsRoundKey,
  parseFinalsRound,
} from '@/lib/club-finals-view'
import { formatDataDay, formatMatchDate } from '@/lib/format'
import { resolveTitleFromSlug, switcherTitles } from '@/lib/title-resolver'

export const metadata: Metadata = { title: 'Scores — Club Stats' }

// Matches are ingested every 5 minutes — revalidate on the same cadence
export const revalidate = 300

const PAGE_SIZE = 20
const FORM_WINDOW_SIZE = 10
type ResultFilter = 'all' | 'WIN' | 'LOSS' | 'OTL_DNF'
/** `finals` = the derived Club Finals games (CF3); like `dev`, a fixed selection of matches. */
type GamesModeFilter = GameMode | 'dev' | 'finals' | null
/** Matches nothing: an empty id list would mean "no filter" to the query. */
const NO_MATCH_IDS = [-1]
const DEV_MATCH_IDS = [
  // Benchmark / OCR-labeled — source of truth
  250,
  463,
  967,
  968,
  // Phase B retrain candidates — recordings to disambiguate (session times CT)
  2397,
  2398,
  2399,
  2400, // 2026-05-30 Trim — grinder
  2577,
  2582,
  2640,
  2641, // 2026-05-31 — twd / 4×twd+2×grinder (×3 recordings)
  2664,
  2665,
  2666,
  2667, // 2026-06-12 — off-D (game 1 of 2)
  2669,
  2670,
  2671,
  2672,
  2673, // 2026-06-16 — twd+offD (18:50) / def-D Chara (19:57)
  2674, // 2026-06-17 — twd Dahlin (only game that day)
  2682,
  2683, // 2026-06-20 Trim — grinder
  2686,
  2687,
  2688, // 2026-06-21 Trim — enforcer
  2697, // 2026-06-25 — Evil Eastons (W 9-5)
] as const
interface GamesFilters {
  titleSlug: string | undefined
  gameMode: GamesModeFilter
  /** Club Finals round 1 to 4; only with `gameMode: 'finals'`. */
  round: number | null
  resultFilter: ResultFilter
  opponent: string
}

/** The derived Club Finals games of the title, as the query's `attempts` (empty = none). */
type FinalsAttempts = Awaited<ReturnType<typeof getClubFinalsOverview>>['attempts']

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function parsePage(raw: string | string[] | undefined): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n >= 1 ? n : 1
}

function parseGameMode(raw: string | string[] | undefined): GamesModeFilter {
  if (typeof raw !== 'string') return null
  if (raw === 'dev' || raw === 'finals') return raw
  return (GAME_MODE as readonly string[]).includes(raw) ? (raw as GameMode) : null
}

function parseResultFilter(raw: string | string[] | undefined): ResultFilter {
  if (raw === 'WIN' || raw === 'LOSS' || raw === 'OTL_DNF') return raw
  return 'all'
}

function parseOpponent(raw: string | string[] | undefined): string {
  return typeof raw === 'string' ? raw.trim().slice(0, 80) : ''
}

function resultValues(filter: ResultFilter): MatchResult | MatchResult[] | null {
  if (filter === 'all') return null
  if (filter === 'OTL_DNF') return ['OTL', 'DNF']
  return filter
}

function selectionMatchIds(
  gameMode: GamesModeFilter,
  round: number | null,
  finals: FinalsAttempts,
): number[] | null {
  if (gameMode === 'dev') return [...DEV_MATCH_IDS]
  if (gameMode === 'finals') {
    const ids = clubFinalsMatchIds(finals, round)
    return ids.length > 0 ? ids : NO_MATCH_IDS
  }
  return null
}

function dbGameMode(gameMode: GamesModeFilter): GameMode | null {
  return gameMode === 'dev' || gameMode === 'finals' ? null : gameMode
}

export default async function GamesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
  const gameMode = parseGameMode(params.mode)
  const round = gameMode === 'finals' ? parseFinalsRound(params.round) : null
  const resultFilter = parseResultFilter(params.result)
  const opponent = parseOpponent(params.opponent)
  const page = parsePage(params.page)
  const offset = (page - 1) * PAGE_SIZE
  const filters: GamesFilters = { titleSlug, gameMode, round, resultFilter, opponent }
  const queryGameMode = dbGameMode(gameMode)

  const result = await resolveTitleFromSlug(titleSlug, { liveOnly: true }).catch(() => null)

  if (result === null) {
    return <EmptyState message="Unable to load match data right now." />
  }

  if (result.kind === 'invalid') {
    redirect(gamesHref({ ...filters, titleSlug: undefined }, page))
  }

  if (result.kind === 'empty') {
    return <EmptyState message="No game titles are configured yet." />
  }

  const { gameTitle, allTitles } = result.resolved
  // Live titles plus the default and the selected title, newest first.
  const titles = switcherTitles(allTitles, gameTitle.id)

  // Club Finals games of this title (CF1's stored rows): the Club Finals filter and the round
  // filter select from them. Fails soft (also before migration 0083): no Club Finals tile.
  const finalsOverview = await getClubFinalsOverview(gameTitle.id).catch(() => null)
  const finalsAttempts: FinalsAttempts = finalsOverview?.attempts ?? []
  const matchIds = selectionMatchIds(gameMode, round, finalsAttempts)

  let pageMatches: Awaited<ReturnType<typeof getRecentMatches>> = []
  let formMatches: Awaited<ReturnType<typeof getRecentMatches>> = []
  let total = 0
  let opponentClubs: Awaited<ReturnType<typeof getOpponentClubs>> = []
  let counts: FilterCounts = { titles: [], modes: [], results: [], finals: 0, rounds: [] }
  try {
    ;[pageMatches, total, formMatches, counts] = await Promise.all([
      getRecentMatches({
        gameTitleId: gameTitle.id,
        limit: PAGE_SIZE,
        offset,
        gameMode: queryGameMode,
        result: resultValues(resultFilter),
        opponent,
        matchIds,
      }),
      countMatches({
        gameTitleId: gameTitle.id,
        gameMode: queryGameMode,
        result: resultValues(resultFilter),
        opponent,
        matchIds,
      }),
      getRecentMatches({
        gameTitleId: gameTitle.id,
        limit: FORM_WINDOW_SIZE,
        offset: 0,
        gameMode: queryGameMode,
        result: resultValues(resultFilter),
        opponent,
        matchIds,
      }),
      getFilterCounts(titles, gameTitle.id, filters, finalsAttempts),
    ])
    opponentClubs = await getOpponentClubs(
      Array.from(new Set(pageMatches.map((match) => match.opponentClubId))),
    )
  } catch {
    return <EmptyState message="Unable to load match data right now." />
  }

  // OCR coverage drives a decorative pill only, so it fails soft — an empty
  // map renders no pills rather than taking the whole list down with it.
  const pageIds = pageMatches.map((match) => match.id)
  const ocrCoverage = await getOcrCoverageForMatches(pageIds).catch(
    () => new Map<number, MatchOcrCoverage>(),
  )

  // Club Finals round and game (CF1) — a badge only; fails soft (also before migration 0083).
  const clubFinals = await getClubFinalsBadges(pageIds).catch(
    () => new Map<number, ClubFinalsBadge>(),
  )

  // Goals by period read from video (P1, goals only per D27): one small line on the card, only
  // for games whose period goals add up to EA's score. Fails soft: no line, the cards stay as they were.
  const periodStrips = await getEnginePeriodStrips(pageIds).catch(
    () => new Map<number, EnginePeriodStripRow[]>(),
  )

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  // Clamp page to valid range — handles stale bookmarks
  const clampedPage = Math.min(page, totalPages)
  if (page !== clampedPage) {
    redirect(gamesHref(filters, clampedPage))
  }

  const showingStart = total > 0 ? offset + 1 : 0
  const showingEnd = offset + pageMatches.length

  const emptyMessage = buildEmptyMessage(gameTitle.name, filters)

  const opponentClubMap = new Map(opponentClubs.map((club) => [club.eaClubId, club]))
  const dateGroups = groupMatchesByDate(pageMatches)
  const hasFinalsTile =
    finalsAttempts.length > 0 && clubFinalsMatchIds(finalsAttempts, null).length > 0
  const listContextQuery = gamesQueryString(filters, clampedPage)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5">
        <h1 className="font-condensed text-xl font-extrabold uppercase tracking-[0.08em] text-zinc-50 sm:text-[26px]">
          Scores
        </h1>
        <span className="font-condensed text-[11px] font-bold uppercase tracking-[0.18em] text-fg-4">
          {gameTitle.name}
          {total > 0 ? (
            <>
              {' · '}
              <span className="tabular-nums">{total}</span> matches
            </>
          ) : null}
        </span>
      </header>

      <div className="space-y-2">
        <GamesToolbar
          titles={titles}
          gameTitle={gameTitle}
          filters={filters}
          counts={counts}
          showFinalsTile={hasFinalsTile || gameMode === 'finals'}
          total={total}
          showingStart={showingStart}
          showingEnd={showingEnd}
        />

        {formMatches.length > 0 && (
          <LastTenStrip matches={formMatches} listContextQuery={listContextQuery} />
        )}
      </div>

      {formMatches.length > 0 && <TrendBullets matches={formMatches} />}

      {total === 0 ? (
        <EmptyState message={emptyMessage} clearHref={clearFiltersHref(filters)} />
      ) : (
        <>
          {totalPages > 1 && (
            <PaginationNav
              page={clampedPage}
              totalPages={totalPages}
              filters={filters}
              position="top"
            />
          )}

          <div className="space-y-8">
            {dateGroups.map((group) => (
              <section key={group.key} className="space-y-4">
                <div className="flex items-center gap-3">
                  <SectionHeader label={group.label} as="h2" />
                  <div className="h-px flex-1 bg-zinc-800" />
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {group.matches.map((match, i) => {
                    const opponent = opponentClubMap.get(match.opponentClubId) ?? null
                    const badge = clubFinals.get(match.id)
                    // A header where a Club Finals round starts in the list (newest first, so
                    // it sits over the round's newest game on this page).
                    const prevBadge =
                      i > 0 ? clubFinals.get(group.matches[i - 1]?.id ?? -1) : undefined
                    const startsRound =
                      badge !== undefined &&
                      (prevBadge === undefined ||
                        clubFinalsRoundKey(prevBadge) !== clubFinalsRoundKey(badge))
                    return (
                      <Fragment key={match.id}>
                        {startsRound ? <ClubFinalsRoundDivider badge={badge} /> : null}
                        <ScoreCard
                          match={match}
                          href={`/games/${match.id.toString()}${listContextQuery ? `?${listContextQuery}` : ''}`}
                          opponentCrestAssetId={opponent?.crestAssetId ?? null}
                          opponentCrestUseBaseAsset={opponent?.useBaseAsset ?? null}
                          ocrCoverage={ocrCoverage.get(match.id)}
                          clubFinals={badge}
                          periods={periodStrips.get(match.id) ?? null}
                        />
                      </Fragment>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>

          {totalPages > 1 && (
            <PaginationNav
              page={clampedPage}
              totalPages={totalPages}
              filters={filters}
              position="bottom"
            />
          )}
        </>
      )}
    </div>
  )
}

function groupMatchesByDate(matches: Awaited<ReturnType<typeof getRecentMatches>>) {
  const groups = new Map<string, { key: string; label: string; matches: typeof matches }>()

  for (const match of matches) {
    // The club's calendar day (the server runs UTC: evening games would split).
    const key = formatDataDay(match.playedAt)
    const label = formatMatchDate(match.playedAt)
    const group = groups.get(key)
    if (group) {
      group.matches.push(match)
    } else {
      groups.set(key, { key, label, matches: [match] })
    }
  }

  return Array.from(groups.values())
}

// ─── Toolbar + filters ────────────────────────────────────────────────────────

function gamesQueryString(filters: GamesFilters, page?: number): string {
  const qs = new URLSearchParams()
  if (filters.titleSlug) qs.set('title', filters.titleSlug)
  if (filters.gameMode !== null) qs.set('mode', filters.gameMode)
  if (filters.round !== null) qs.set('round', filters.round.toString())
  if (filters.resultFilter !== 'all') qs.set('result', filters.resultFilter)
  if (filters.opponent) qs.set('opponent', filters.opponent)
  if (page !== undefined && page > 1) qs.set('page', page.toString())
  return qs.toString()
}

function gamesHref(filters: GamesFilters, page?: number): string {
  const qs = gamesQueryString(filters, page)
  return `/games${qs ? `?${qs}` : ''}`
}

const MODE_LABELS: { mode: GamesModeFilter; label: string; tone: FilterTone }[] = [
  { mode: null, label: 'All', tone: 'accent' },
  { mode: '6s', label: '6s', tone: 's6' },
  { mode: '3s', label: '3s', tone: 's3' },
  { mode: 'dev', label: 'Dev', tone: 'dev' },
]

const RESULT_LABELS: { value: ResultFilter; label: string; tone: FilterTone }[] = [
  { value: 'all', label: 'All', tone: 'accent' },
  { value: 'WIN', label: 'Wins', tone: 'win' },
  { value: 'LOSS', label: 'Losses', tone: 'loss' },
  { value: 'OTL_DNF', label: 'OTL/DNF', tone: 'otl' },
]

/** Per-tile match counts, in the order of `titles`, MODE_LABELS and RESULT_LABELS. */
interface FilterCounts {
  titles: number[]
  modes: number[]
  results: number[]
  /** The Club Finals tile (all rounds), and one count per round 1 to 4. */
  finals: number
  rounds: number[]
}

/**
 * Each tile's count is what that option would show with the OTHER current
 * filters kept (a Mode tile keeps the title, result and opponent). Small
 * count queries, run in parallel.
 */
async function getFilterCounts(
  titles: GameTitle[],
  gameTitleId: number,
  filters: GamesFilters,
  finals: FinalsAttempts,
): Promise<FilterCounts> {
  const { gameMode, round, resultFilter, opponent } = filters
  // The Club Finals selection belongs to one title: a title tile counts that title's own games.
  const titleMode = gameMode === 'finals' ? null : gameMode
  const finalsCount = (matchRound: number | null) => {
    const ids = clubFinalsMatchIds(finals, matchRound)
    return ids.length === 0
      ? Promise.resolve(0)
      : countMatches({
          gameTitleId,
          result: resultValues(resultFilter),
          opponent,
          matchIds: ids,
        })
  }
  const [titleCounts, modeCounts, resultCounts, finalsTotal, roundCounts] = await Promise.all([
    Promise.all(
      titles.map((title) =>
        countMatches({
          gameTitleId: title.id,
          gameMode: dbGameMode(titleMode),
          result: resultValues(resultFilter),
          opponent,
          matchIds: selectionMatchIds(titleMode, null, []),
        }),
      ),
    ),
    Promise.all(
      MODE_LABELS.map(({ mode }) =>
        countMatches({
          gameTitleId,
          gameMode: dbGameMode(mode),
          result: resultValues(resultFilter),
          opponent,
          matchIds: selectionMatchIds(mode, null, finals),
        }),
      ),
    ),
    Promise.all(
      RESULT_LABELS.map(({ value }) =>
        countMatches({
          gameTitleId,
          gameMode: dbGameMode(gameMode),
          result: resultValues(value),
          opponent,
          matchIds: selectionMatchIds(gameMode, round, finals),
        }),
      ),
    ),
    finalsCount(null),
    Promise.all(Array.from({ length: FINALS_ROUND_COUNT }, (_, i) => finalsCount(i + 1))),
  ])
  return {
    titles: titleCounts,
    modes: modeCounts,
    results: resultCounts,
    finals: finalsTotal,
    rounds: roundCounts,
  }
}

function GamesToolbar({
  titles,
  gameTitle,
  filters,
  counts,
  showFinalsTile,
  total,
  showingStart,
  showingEnd,
}: {
  titles: GameTitle[]
  gameTitle: GameTitle
  filters: GamesFilters
  counts: FilterCounts
  showFinalsTile: boolean
  total: number
  showingStart: number
  showingEnd: number
}) {
  const hasFilters =
    filters.gameMode !== null || filters.resultFilter !== 'all' || filters.opponent.length > 0

  const groups: FilterGroup[] = [
    {
      key: 'title',
      legend: 'Title',
      tiles: titles.map((title, i) => ({
        key: title.slug,
        label: title.name,
        count: counts.titles[i] ?? 0,
        // The Club Finals selection is one title's: switching title leaves it.
        href: gamesHref(
          filters.gameMode === 'finals'
            ? { ...filters, titleSlug: title.slug, gameMode: null, round: null }
            : { ...filters, titleSlug: title.slug },
        ),
        active: title.id === gameTitle.id,
        tone: 'accent',
      })),
    },
    {
      key: 'mode',
      legend: 'Mode',
      tiles: [
        ...MODE_LABELS.map(({ mode, label, tone }, i) => ({
          key: label,
          label,
          count: counts.modes[i] ?? 0,
          href: gamesHref({ ...filters, gameMode: mode, round: null }),
          active: mode === filters.gameMode,
          tone,
          dot: true,
        })),
        ...(showFinalsTile
          ? [
              {
                key: 'finals',
                label: 'Finals',
                fullLabel: 'Club Finals',
                count: counts.finals,
                href: gamesHref({ ...filters, gameMode: 'finals', round: null }),
                active: filters.gameMode === 'finals',
                tone: 'finals' as const,
                dot: true,
              },
            ]
          : []),
      ],
    },
    {
      key: 'result',
      legend: 'Result',
      tiles: RESULT_LABELS.map(({ value, label, tone }, i) => ({
        key: value,
        label,
        count: counts.results[i] ?? 0,
        href: gamesHref({ ...filters, resultFilter: value }),
        active: value === filters.resultFilter,
        tone,
        dot: true,
      })),
    },
  ]

  // Round filter: only while Club Finals is the selection (a second row under the groups).
  const roundGroups: FilterGroup[] =
    filters.gameMode === 'finals'
      ? [
          {
            key: 'round',
            legend: 'Round',
            tiles: [
              {
                key: 'all-rounds',
                label: 'All',
                fullLabel: 'All Club Finals rounds',
                count: counts.finals,
                href: gamesHref({ ...filters, round: null }),
                active: filters.round === null,
                tone: 'finals' as const,
              },
              ...Array.from({ length: FINALS_ROUND_COUNT }, (_, i) => ({
                key: `r${(i + 1).toString()}`,
                label: `R${(i + 1).toString()}`,
                fullLabel:
                  i + 1 === FINALS_ROUND_COUNT
                    ? 'Round 4, the final'
                    : `Round ${(i + 1).toString()}`,
                count: counts.rounds[i] ?? 0,
                href: gamesHref({ ...filters, round: i + 1 }),
                active: filters.round === i + 1,
                tone: 'finals' as const,
              })),
            ],
          },
        ]
      : []

  return (
    <GamesFilterPanel groups={groups} secondaryGroups={roundGroups}>
      <form action="/games" className="flex w-full min-w-0 flex-col gap-1.5 sm:max-w-md">
        {filters.titleSlug ? <input type="hidden" name="title" value={filters.titleSlug} /> : null}
        {filters.gameMode !== null ? (
          <input type="hidden" name="mode" value={filters.gameMode} />
        ) : null}
        {filters.round !== null ? (
          <input type="hidden" name="round" value={filters.round.toString()} />
        ) : null}
        {filters.resultFilter !== 'all' ? (
          <input type="hidden" name="result" value={filters.resultFilter} />
        ) : null}
        <label htmlFor="games-opponent" className="gf-lbl">
          Opponent
        </label>
        <div className="flex">
          <input
            id="games-opponent"
            name="opponent"
            defaultValue={filters.opponent}
            placeholder="Search opponent"
            className="min-w-0 flex-1 border border-border bg-[#1c1a1b] px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-zinc-500"
          />
          <button
            type="submit"
            className="border border-l-0 border-border bg-surface px-4 py-2 font-condensed text-xs font-bold uppercase tracking-widest text-zinc-300 transition-colors hover:bg-surface-raised hover:text-zinc-50"
          >
            Apply
          </button>
        </div>
      </form>

      <div className="flex items-center gap-4">
        {hasFilters ? (
          <Link
            prefetch
            href={clearFiltersHref(filters)}
            className="font-condensed text-xs font-semibold uppercase tracking-widest text-accent-readable transition-colors hover:text-zinc-50"
          >
            Clear filters
          </Link>
        ) : null}
        <span className="font-condensed text-xs font-semibold uppercase tracking-widest tabular-nums text-fg-5">
          {total > 0
            ? `Showing ${showingStart.toString()}–${showingEnd.toString()} of ${total.toString()}`
            : 'No matches'}
        </span>
      </div>
    </GamesFilterPanel>
  )
}

function clearFiltersHref(filters: GamesFilters): string {
  return gamesHref({
    titleSlug: filters.titleSlug,
    gameMode: null,
    round: null,
    resultFilter: 'all',
    opponent: '',
  })
}

function buildEmptyMessage(gameTitleName: string, filters: GamesFilters): string {
  const parts: string[] = []
  if (filters.gameMode !== null) {
    parts.push(
      filters.gameMode === 'dev'
        ? 'dev selection'
        : filters.gameMode === 'finals'
          ? filters.round === null
            ? 'Club Finals'
            : `Club Finals round ${filters.round.toString()}`
          : filters.gameMode,
    )
  }
  if (filters.resultFilter === 'WIN') parts.push('wins')
  else if (filters.resultFilter === 'LOSS') parts.push('losses')
  else if (filters.resultFilter === 'OTL_DNF') parts.push('OTL/DNF results')
  if (filters.opponent) parts.push(`vs ${filters.opponent}`)

  const qualifier = parts.length > 0 ? ` ${parts.join(' ')}` : ''
  return `No${qualifier} games recorded for ${gameTitleName} yet.`
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function PaginationNav({
  page,
  totalPages,
  filters,
  position,
}: {
  page: number
  totalPages: number
  filters: GamesFilters
  position: 'top' | 'bottom'
}) {
  const hasPrev = page > 1
  const hasNext = page < totalPages
  const nearby = paginationWindow(page, totalPages)

  return (
    <nav
      aria-label={`${position === 'top' ? 'Top' : 'Bottom'} games pagination`}
      className="flex flex-wrap items-center justify-between gap-3 py-1"
    >
      {hasPrev ? (
        <Link
          prefetch
          href={gamesHref(filters, page - 1)}
          className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-200"
        >
          ← Newer Results
        </Link>
      ) : (
        <span className="select-none font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-700">
          ← Newer Results
        </span>
      )}

      {/* Phones only: wider screens show the numbered page links instead. */}
      <span className="font-condensed text-xs font-semibold uppercase tracking-widest tabular-nums text-fg-5 sm:hidden">
        Page {page} of {totalPages}
      </span>

      <div className="hidden items-center gap-1 sm:flex">
        <PageLink page={1} current={page} filters={filters} label="First" />
        {nearby[0] !== 1 ? <span className="px-1 text-zinc-700">…</span> : null}
        {nearby.map((p) => (
          <PageLink key={p} page={p} current={page} filters={filters} />
        ))}
        {nearby[nearby.length - 1] !== totalPages ? (
          <span className="px-1 text-zinc-700">…</span>
        ) : null}
        {totalPages > 1 ? (
          <PageLink page={totalPages} current={page} filters={filters} label="Last" />
        ) : null}
      </div>

      {hasNext ? (
        <Link
          prefetch
          href={gamesHref(filters, page + 1)}
          className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-200"
        >
          Older Results →
        </Link>
      ) : (
        <span className="select-none font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-700">
          Older Results →
        </span>
      )}
    </nav>
  )
}

function paginationWindow(page: number, totalPages: number): number[] {
  const start = Math.max(1, page - 2)
  const end = Math.min(totalPages, page + 2)
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}

function PageLink({
  page,
  current,
  filters,
  label,
}: {
  page: number
  current: number
  filters: GamesFilters
  label?: string
}) {
  const active = page === current
  return (
    <Link
      prefetch
      href={gamesHref(filters, page)}
      aria-current={active ? 'page' : undefined}
      className={[
        'min-w-8 border px-2.5 py-1 text-center font-condensed text-xs font-bold uppercase tracking-wider tabular-nums transition-colors',
        active
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-600 hover:text-zinc-200',
      ].join(' ')}
    >
      {label ?? page.toString()}
    </Link>
  )
}

// ─── Form strip ───────────────────────────────────────────────────────────────

interface FormMatch {
  result: MatchResult
  shotsFor: number
  shotsAgainst: number
  scoreAgainst: number
}

function TrendBullets({ matches }: { matches: FormMatch[] }) {
  const n = matches.length

  // Win streak — consecutive from newest, DNF breaks streak
  let streak = 0
  for (const m of matches) {
    if (m.result === 'WIN') streak++
    else break
  }

  // Wins in the window (all decisive games)
  const wins = matches.filter((m) => m.result === 'WIN').length

  // Shot edge — BGM out-shot opponent (strict majority)
  const shotsWon = matches.filter((m) => m.shotsFor > m.shotsAgainst).length

  // Goals-against tightness — held opponent to 2 or fewer
  const tightDefense = matches.filter((m) => m.result !== 'DNF' && m.scoreAgainst <= 2).length

  const bullets: string[] = []

  if (streak >= 3) bullets.push(`${streak.toString()}-game win streak`)
  // "Won N of last 10" only if a genuinely strong or cold signal
  if (streak < 3 && wins >= Math.ceil(n * 0.7))
    bullets.push(`Won ${wins.toString()} of last ${n.toString()}`)
  if (shotsWon >= Math.ceil(n * 0.7))
    bullets.push(`Out-shot opponents in ${shotsWon.toString()} of last ${n.toString()}`)
  if (tightDefense >= Math.ceil(n * 0.5) && tightDefense >= 4)
    bullets.push(
      `Held opponents to 2 or fewer in ${tightDefense.toString()} of last ${n.toString()}`,
    )

  if (bullets.length === 0) return null

  // Cap at 2 — avoid wall of bullets
  const shown = bullets.slice(0, 2)

  return (
    <ul className="flex flex-col gap-0.5">
      {shown.map((b) => (
        <li key={b} className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="text-accent" aria-hidden>
            ▲
          </span>
          {b}
        </li>
      ))}
    </ul>
  )
}

// ─── Empty / error state ──────────────────────────────────────────────────────

function EmptyState({ message, clearHref }: { message: string; clearHref?: string }) {
  return (
    <Panel className="flex min-h-[12rem] flex-col items-center justify-center gap-3">
      <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">{message}</p>
      {clearHref ? (
        <Link
          prefetch
          href={clearHref}
          className="font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-400 transition-colors hover:text-zinc-100"
        >
          Clear filters
        </Link>
      ) : null}
    </Panel>
  )
}
