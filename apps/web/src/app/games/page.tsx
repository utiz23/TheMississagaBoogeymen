import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  listGameTitles,
  getActiveGameTitleBySlug,
  getRecentMatches,
  countMatches,
  getOpponentClubs,
} from '@eanhl/db/queries'
import type { GameMode, MatchResult } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import type { GameTitle } from '@eanhl/db'
import { ScoreCard } from '@/components/matches/score-card'
import { Panel } from '@/components/ui/panel'
import { SectionHeader } from '@/components/ui/section-header'
import { ResultPill } from '@/components/ui/result-pill'
import { formatMatchDate } from '@/lib/format'

export const metadata: Metadata = { title: 'Scores — Club Stats' }

// Matches are ingested every 5 minutes — revalidate on the same cadence
export const revalidate = 300

const PAGE_SIZE = 20
type ResultFilter = 'all' | 'WIN' | 'LOSS' | 'OTL_DNF'
interface GamesFilters {
  titleSlug: string | undefined
  gameMode: GameMode | null
  resultFilter: ResultFilter
  opponent: string
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

async function resolveGameTitle(titleSlug: string | undefined) {
  try {
    const all = await listGameTitles()
    if (titleSlug) {
      const found =
        all.find((title) => title.slug === titleSlug) ?? (await getActiveGameTitleBySlug(titleSlug))
      if (found) return { gameTitle: found, titles: all, invalidRequested: false }
    }
    return { gameTitle: all[0] ?? null, titles: all, invalidRequested: Boolean(titleSlug) }
  } catch {
    return { gameTitle: null, titles: [], invalidRequested: Boolean(titleSlug) }
  }
}

function parsePage(raw: string | string[] | undefined): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n >= 1 ? n : 1
}

function parseGameMode(raw: string | string[] | undefined): GameMode | null {
  if (typeof raw !== 'string') return null
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

export default async function GamesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
  const gameMode = parseGameMode(params.mode)
  const resultFilter = parseResultFilter(params.result)
  const opponent = parseOpponent(params.opponent)
  const page = parsePage(params.page)
  const offset = (page - 1) * PAGE_SIZE
  const filters: GamesFilters = { titleSlug, gameMode, resultFilter, opponent }

  const { gameTitle, titles, invalidRequested } = await resolveGameTitle(titleSlug)

  if (invalidRequested) {
    redirect(gamesHref({ ...filters, titleSlug: undefined }, page))
  }

  if (!gameTitle) {
    return <EmptyState message="No game titles are configured yet." />
  }

  let pageMatches: Awaited<ReturnType<typeof getRecentMatches>> = []
  let formMatches: Awaited<ReturnType<typeof getRecentMatches>> = []
  let total = 0
  let opponentClubs: Awaited<ReturnType<typeof getOpponentClubs>> = []
  try {
    ;[pageMatches, total, formMatches] = await Promise.all([
      getRecentMatches({
        gameTitleId: gameTitle.id,
        limit: PAGE_SIZE,
        offset,
        gameMode,
        result: resultValues(resultFilter),
        opponent,
      }),
      countMatches({
        gameTitleId: gameTitle.id,
        gameMode,
        result: resultValues(resultFilter),
        opponent,
      }),
      getRecentMatches({
        gameTitleId: gameTitle.id,
        limit: 10,
        offset: 0,
        gameMode,
        result: resultValues(resultFilter),
        opponent,
      }),
    ])
    opponentClubs = await getOpponentClubs(
      Array.from(new Set(pageMatches.map((match) => match.opponentClubId))),
    )
  } catch {
    return <EmptyState message="Unable to load match data right now." />
  }

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
  const listContextQuery = gamesQueryString(filters, clampedPage)

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-condensed text-2xl font-semibold uppercase tracking-widest text-zinc-50">
            Scores
          </h1>
          <span className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
            {gameTitle.name}
          </span>
          {total > 0 && (
            <span className="font-condensed text-sm uppercase tracking-wider text-zinc-600">
              <span className="tabular-nums">{total}</span> matches
            </span>
          )}
        </div>
      </div>

      <GamesToolbar
        titles={titles}
        gameTitle={gameTitle}
        filters={filters}
        total={total}
        page={clampedPage}
        totalPages={totalPages}
        showingStart={showingStart}
        showingEnd={showingEnd}
      />

      {formMatches.length > 0 && (
        <div className="space-y-2">
          <FormStrip matches={formMatches} />
          <TrendBullets matches={formMatches} />
        </div>
      )}

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
                  {group.matches.map((match) => {
                    const opponent = opponentClubMap.get(match.opponentClubId) ?? null
                    return (
                      <ScoreCard
                        key={match.id}
                        match={match}
                        href={`/games/${match.id.toString()}${listContextQuery ? `?${listContextQuery}` : ''}`}
                        opponentCrestAssetId={opponent?.crestAssetId ?? null}
                        opponentCrestUseBaseAsset={opponent?.useBaseAsset ?? null}
                      />
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
    const d = new Date(match.playedAt)
    const key = `${d.getFullYear().toString()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`
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
  if (filters.resultFilter !== 'all') qs.set('result', filters.resultFilter)
  if (filters.opponent) qs.set('opponent', filters.opponent)
  if (page !== undefined && page > 1) qs.set('page', page.toString())
  return qs.toString()
}

function gamesHref(filters: GamesFilters, page?: number): string {
  const qs = gamesQueryString(filters, page)
  return `/games${qs ? `?${qs}` : ''}`
}

const MODE_LABELS: { mode: GameMode | null; label: string }[] = [
  { mode: null, label: 'All' },
  { mode: '6s', label: '6s' },
  { mode: '3s', label: '3s' },
]

const RESULT_LABELS: { value: ResultFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'WIN', label: 'Wins' },
  { value: 'LOSS', label: 'Losses' },
  { value: 'OTL_DNF', label: 'OTL / DNF' },
]

function GamesToolbar({
  titles,
  gameTitle,
  filters,
  total,
  page,
  totalPages,
  showingStart,
  showingEnd,
}: {
  titles: GameTitle[]
  gameTitle: GameTitle
  filters: GamesFilters
  total: number
  page: number
  totalPages: number
  showingStart: number
  showingEnd: number
}) {
  const hasFilters =
    filters.gameMode !== null || filters.resultFilter !== 'all' || filters.opponent.length > 0

  return (
    <Panel className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedLinks
            label="Title"
            items={titles.map((title) => ({
              key: title.slug,
              label: title.name,
              href: gamesHref({ ...filters, titleSlug: title.slug }),
              active: title.id === gameTitle.id,
            }))}
          />
          <SegmentedLinks
            label="Mode"
            items={MODE_LABELS.map(({ mode, label }) => ({
              key: label,
              label,
              href: gamesHref({ ...filters, gameMode: mode }),
              active: mode === filters.gameMode,
            }))}
          />
          <SegmentedLinks
            label="Result"
            items={RESULT_LABELS.map(({ value, label }) => ({
              key: value,
              label,
              href: gamesHref({ ...filters, resultFilter: value }),
              active: value === filters.resultFilter,
            }))}
          />
        </div>

        <div className="font-condensed text-xs font-semibold uppercase tracking-widest tabular-nums text-zinc-500">
          {total > 0
            ? `Showing ${showingStart.toString()}-${showingEnd.toString()} of ${total.toString()}`
            : 'No matches'}
          {totalPages > 1 ? ` · Page ${page.toString()} of ${totalPages.toString()}` : ''}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-zinc-800 pt-4 sm:flex-row sm:items-end sm:justify-between">
        <form action="/games" className="flex flex-1 flex-col gap-1.5 sm:max-w-md">
          {filters.titleSlug ? (
            <input type="hidden" name="title" value={filters.titleSlug} />
          ) : null}
          {filters.gameMode !== null ? (
            <input type="hidden" name="mode" value={filters.gameMode} />
          ) : null}
          {filters.resultFilter !== 'all' ? (
            <input type="hidden" name="result" value={filters.resultFilter} />
          ) : null}
          <label
            htmlFor="games-opponent"
            className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500"
          >
            Opponent
          </label>
          <div className="flex">
            <input
              id="games-opponent"
              name="opponent"
              defaultValue={filters.opponent}
              placeholder="Search opponent"
              className="min-w-0 flex-1 border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-zinc-500"
            />
            <button
              type="submit"
              className="border border-l-0 border-zinc-700 bg-zinc-900 px-4 py-2 font-condensed text-xs font-bold uppercase tracking-widest text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-50"
            >
              Apply
            </button>
          </div>
        </form>

        {hasFilters ? (
          <Link
            href={clearFiltersHref(filters)}
            className="font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-200"
          >
            Clear filters
          </Link>
        ) : null}
      </div>
    </Panel>
  )
}

function SegmentedLinks({
  label,
  items,
}: {
  label: string
  items: { key: string; label: string; href: string; active: boolean }[]
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-600">
        {label}
      </span>
      <div className="flex overflow-hidden border border-zinc-700">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={[
              'border-r border-zinc-700 px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-widest transition-colors last:border-r-0',
              item.active
                ? 'bg-accent text-white'
                : 'bg-zinc-950 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200',
            ].join(' ')}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

function clearFiltersHref(filters: GamesFilters): string {
  return gamesHref({
    titleSlug: filters.titleSlug,
    gameMode: null,
    resultFilter: 'all',
    opponent: '',
  })
}

function buildEmptyMessage(gameTitleName: string, filters: GamesFilters): string {
  const parts: string[] = []
  if (filters.gameMode !== null) parts.push(filters.gameMode)
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

      <span className="font-condensed text-xs font-semibold uppercase tracking-widest tabular-nums text-zinc-600">
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

function FormStrip({ matches }: { matches: FormMatch[] }) {
  const wins = matches.filter((m) => m.result === 'WIN').length
  const losses = matches.filter((m) => m.result === 'LOSS' || m.result === 'DNF').length
  const otl = matches.filter((m) => m.result === 'OTL').length
  const n = matches.length

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
        Last <span className="tabular-nums">{n}</span>
      </span>
      <div className="flex items-center gap-1">
        {matches.map((m, i) => (
          <ResultPill key={i} result={m.result} size="sm" />
        ))}
      </div>
      <span className="font-condensed text-sm font-bold tabular-nums text-zinc-400">
        {wins}-{losses}-{otl}
      </span>
    </div>
  )
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
          href={clearHref}
          className="font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-400 transition-colors hover:text-zinc-100"
        >
          Clear filters
        </Link>
      ) : null}
    </Panel>
  )
}
