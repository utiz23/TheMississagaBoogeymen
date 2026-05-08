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
import { ScoreCard } from '@/components/matches/score-card'
import { Panel } from '@/components/ui/panel'
import { SectionHeader } from '@/components/ui/section-header'
import { ResultPill } from '@/components/ui/result-pill'
import { formatMatchDate } from '@/lib/format'

export const metadata: Metadata = { title: 'Scores — Club Stats' }

// Matches are ingested every 5 minutes — revalidate on the same cadence
export const revalidate = 300

const PAGE_SIZE = 20

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

function parsePage(raw: string | string[] | undefined): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n >= 1 ? n : 1
}

function parseGameMode(raw: string | string[] | undefined): GameMode | null {
  if (typeof raw !== 'string') return null
  return (GAME_MODE as readonly string[]).includes(raw) ? (raw as GameMode) : null
}

export default async function GamesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
  const gameMode = parseGameMode(params.mode)
  const page = parsePage(params.page)
  const offset = (page - 1) * PAGE_SIZE

  const { gameTitle, invalidRequested } = await resolveGameTitle(titleSlug)

  if (invalidRequested) {
    const qs = new URLSearchParams()
    if (gameMode !== null) qs.set('mode', gameMode)
    if (page > 1) qs.set('page', String(page))
    redirect(qs.size > 0 ? `/games?${qs.toString()}` : '/games')
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
      getRecentMatches({ gameTitleId: gameTitle.id, limit: PAGE_SIZE, offset, gameMode }),
      countMatches({ gameTitleId: gameTitle.id, gameMode }),
      getRecentMatches({ gameTitleId: gameTitle.id, limit: 10, offset: 0, gameMode }),
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

  const emptyMessage =
    gameMode !== null
      ? `No ${gameMode} games recorded for ${gameTitle.name} yet.`
      : `No games recorded for ${gameTitle.name} yet.`

  const opponentClubMap = new Map(opponentClubs.map((club) => [club.eaClubId, club]))
  const dateGroups = groupMatchesByDate(pageMatches)

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

      <GameModeFilter titleSlug={titleSlug} activeMode={gameMode} />

      {formMatches.length > 0 && (
        <div className="space-y-2">
          <FormStrip matches={formMatches} />
          <TrendBullets matches={formMatches} />
        </div>
      )}

      {total === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <>
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
              titleSlug={titleSlug}
              gameMode={gameMode}
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

// ─── Game mode filter ─────────────────────────────────────────────────────────

function gameModeHref(mode: GameMode | null, titleSlug: string | undefined): string {
  const qs = new URLSearchParams()
  if (titleSlug) qs.set('title', titleSlug)
  if (mode !== null) qs.set('mode', mode)
  const qsStr = qs.toString()
  return `/games${qsStr ? `?${qsStr}` : ''}`
}

const MODE_LABELS: { mode: GameMode | null; label: string }[] = [
  { mode: null, label: 'All' },
  { mode: '6s', label: '6s' },
  { mode: '3s', label: '3s' },
]

function GameModeFilter({
  titleSlug,
  activeMode,
}: {
  titleSlug: string | undefined
  activeMode: GameMode | null
}) {
  return (
    <div className="flex gap-1">
      {MODE_LABELS.map(({ mode, label }) => {
        const isActive = mode === activeMode
        return (
          <Link
            key={label}
            href={gameModeHref(mode, titleSlug)}
            className={[
              'rounded border px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors',
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

// ─── Pagination ───────────────────────────────────────────────────────────────

function paginationHref(
  page: number,
  titleSlug: string | undefined,
  gameMode: GameMode | null,
): string {
  const qs = new URLSearchParams()
  if (titleSlug) qs.set('title', titleSlug)
  if (gameMode !== null) qs.set('mode', gameMode)
  qs.set('page', page.toString())
  return `/games?${qs.toString()}`
}

function PaginationNav({
  page,
  totalPages,
  titleSlug,
  gameMode,
}: {
  page: number
  totalPages: number
  titleSlug: string | undefined
  gameMode: GameMode | null
}) {
  const hasPrev = page > 1
  const hasNext = page < totalPages

  return (
    <div className="flex items-center justify-between py-1">
      {hasPrev ? (
        <Link
          href={paginationHref(page - 1, titleSlug, gameMode)}
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

      {hasNext ? (
        <Link
          href={paginationHref(page + 1, titleSlug, gameMode)}
          className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-200"
        >
          Older Results →
        </Link>
      ) : (
        <span className="select-none font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-700">
          Older Results →
        </span>
      )}
    </div>
  )
}

// ─── Form strip ───────────────────────────────────────────────────────────────

interface FormMatch { result: MatchResult; shotsFor: number; shotsAgainst: number; scoreAgainst: number }

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
  if (streak < 3 && wins >= Math.ceil(n * 0.7)) bullets.push(`Won ${wins.toString()} of last ${n.toString()}`)
  if (shotsWon >= Math.ceil(n * 0.7)) bullets.push(`Out-shot opponents in ${shotsWon.toString()} of last ${n.toString()}`)
  if (tightDefense >= Math.ceil(n * 0.5) && tightDefense >= 4) bullets.push(`Held opponents to 2 or fewer in ${tightDefense.toString()} of last ${n.toString()}`)

  if (bullets.length === 0) return null

  // Cap at 2 — avoid wall of bullets
  const shown = bullets.slice(0, 2)

  return (
    <ul className="flex flex-col gap-0.5">
      {shown.map((b) => (
        <li key={b} className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="text-accent" aria-hidden>▲</span>
          {b}
        </li>
      ))}
    </ul>
  )
}

// ─── Empty / error state ──────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <Panel className="flex min-h-[12rem] items-center justify-center">
      <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">{message}</p>
    </Panel>
  )
}
