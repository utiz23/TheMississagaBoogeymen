import Link from 'next/link'
import { abbreviateTeamName } from '@/lib/format'

// Sub-nav of the game sheet — a direct port of the prototype's SUB NAV
// (`Game Sheet copy.dc.html`): bordered ALL GAMES chip · gradient hairline ·
// one segmented PREV|NEXT box naming each adjacent game by number and
// opponent abbreviation. Every href carries the games list query through so
// back-nav and paging state survive the round trip.
//
// The adjacent game numbers come free: `seasonNumber` is the chronological
// position of THIS match within its game title, and prev/next are by
// definition the matches either side of it — so they are seasonNumber ∓ 1.
// No extra query.

interface AdjacentGame {
  id: number
  opponentName: string
}

interface GameTopBarProps {
  gamesHref: string
  listQuery: string
  /** Chronological position of this match in its game title ("Game 64"). */
  seasonNumber: number | null
  adjacent: {
    previous: AdjacentGame | null
    next: AdjacentGame | null
  }
}

export function GameTopBar({ gamesHref, listQuery, seasonNumber, adjacent }: GameTopBarProps) {
  const { previous, next } = adjacent
  // Both edges empty (a single-match game title) would render a box holding
  // two em-dashes — nothing to navigate to, so the box itself is dropped.
  const showPager = previous !== null || next !== null

  return (
    <nav
      aria-label="Game navigation"
      className="flex flex-wrap items-center gap-3 font-condensed uppercase"
    >
      <Link
        href={gamesHref}
        className="flex min-h-11 items-center gap-2 border border-border bg-surface px-[14px] text-xs font-extrabold tracking-[0.2em] text-fg-3 transition-colors hover:border-accent hover:bg-surface-raised hover:text-fg-1"
      >
        <span aria-hidden className="text-[13px] leading-none text-accent">
          ←
        </span>
        All Games
      </Link>

      <span
        aria-hidden
        className="hidden h-px flex-1 bg-[linear-gradient(to_right,var(--color-border),transparent)] sm:block"
      />

      {showPager ? (
        <div className="flex items-stretch border border-border bg-surface max-sm:w-full">
          <PagerButton
            game={previous}
            dir="prev"
            number={seasonNumber === null ? null : seasonNumber - 1}
            listQuery={listQuery}
          />
          <span aria-hidden className="w-px bg-border" />
          <PagerButton
            game={next}
            dir="next"
            number={seasonNumber === null ? null : seasonNumber + 1}
            listQuery={listQuery}
          />
        </div>
      ) : null}
    </nav>
  )
}

function PagerButton({
  game,
  dir,
  number,
  listQuery,
}: {
  game: AdjacentGame | null
  dir: 'prev' | 'next'
  number: number | null
  listQuery: string
}) {
  const label = dir === 'prev' ? 'Prev' : 'Next'
  const arrow = dir === 'prev' ? '←' : '→'
  const box =
    dir === 'prev'
      ? 'min-h-11 flex-1 items-center gap-[11px] pl-[11px] pr-[13px]'
      : 'min-h-11 flex-1 items-center justify-end gap-[11px] pl-[13px] pr-[11px]'
  const stack =
    dir === 'prev' ? 'flex flex-col items-start gap-0.5' : 'flex flex-col items-end gap-0.5'

  if (!game) {
    // Game-title-edge placeholder: keeps the box's shape when there is no game
    // that way. Hidden from AT — the absence of a link is what tells a
    // screen-reader user the run ends here — and dropped one ramp step to
    // fg-5 so it reads as inert without falling under the 4.5:1 floor.
    return (
      <span aria-hidden className={`flex select-none ${box}`}>
        {dir === 'prev' ? <PagerArrow arrow={arrow} /> : null}
        <span className={stack}>
          <span className="text-xs font-bold tracking-[0.16em] text-fg-5">{label}</span>
          <span className="text-xs font-extrabold tracking-[0.1em] text-fg-5">—</span>
        </span>
        {dir === 'next' ? <PagerArrow arrow={arrow} /> : null}
      </span>
    )
  }

  const abbrev = abbreviateTeamName(game.opponentName)
  const value = number === null ? `vs ${abbrev}` : `Game ${number.toString()} · vs ${abbrev}`

  return (
    <Link
      href={gameHref(game.id, listQuery)}
      aria-label={`${dir === 'prev' ? 'Previous' : 'Next'} game — ${
        number === null ? '' : `game ${number.toString()} `
      }versus ${game.opponentName}`}
      className={`group flex transition-colors hover:bg-surface-raised ${box}`}
    >
      {dir === 'prev' ? <PagerArrow arrow={arrow} interactive /> : null}
      <span className={stack}>
        <span className="text-xs font-bold tracking-[0.16em] text-fg-4">{label}</span>
        <span className="whitespace-nowrap text-xs font-extrabold tracking-[0.1em] text-fg-2">
          {value}
        </span>
      </span>
      {dir === 'next' ? <PagerArrow arrow={arrow} interactive /> : null}
    </Link>
  )
}

// The prototype declares `transition:color` on this glyph without ever
// changing it; the accent-on-hover is the intent that transition implies, and
// it matches the accent arrow on the ALL GAMES chip.
function PagerArrow({ arrow, interactive }: { arrow: string; interactive?: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex-none text-[15px] font-black leading-none text-fg-4 ${
        interactive ? 'transition-colors group-hover:text-accent' : ''
      }`}
    >
      {arrow}
    </span>
  )
}

function gameHref(id: number, listQuery: string): string {
  return `/games/${id.toString()}${listQuery ? `?${listQuery}` : ''}`
}
