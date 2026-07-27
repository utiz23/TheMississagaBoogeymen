import Link from 'next/link'
import { abbreviateTeamName } from '@/lib/format'

// Top bar of the game sheet — ALL GAMES back-link plus PREV/NEXT chips that
// name the adjacent opponent by abbreviation. Every href carries the games
// list query through so back-nav and paging state survive the round trip.

interface AdjacentGame {
  id: number
  opponentName: string
}

interface GameTopBarProps {
  gamesHref: string
  listQuery: string
  adjacent: {
    previous: AdjacentGame | null
    next: AdjacentGame | null
  }
}

export function GameTopBar({ gamesHref, listQuery, adjacent }: GameTopBarProps) {
  return (
    <nav
      aria-label="Game navigation"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 font-condensed text-[11px] font-bold uppercase tracking-[0.16em]"
    >
      <Link href={gamesHref} className="text-fg-4 transition-colors hover:text-fg-2">
        <span aria-hidden>←</span> All Games
      </Link>

      <div className="ml-auto flex items-center gap-5">
        <AdjacentChip game={adjacent.previous} dir="prev" listQuery={listQuery} />
        <AdjacentChip game={adjacent.next} dir="next" listQuery={listQuery} />
      </div>
    </nav>
  )
}

function AdjacentChip({
  game,
  dir,
  listQuery,
}: {
  game: AdjacentGame | null
  dir: 'prev' | 'next'
  listQuery: string
}) {
  if (!game) {
    return <span className="select-none text-fg-6">{dir === 'prev' ? '← Prev' : 'Next →'}</span>
  }

  const abbrev = abbreviateTeamName(game.opponentName)
  return (
    <Link
      href={gameHref(game.id, listQuery)}
      aria-label={`${dir === 'prev' ? 'Previous' : 'Next'} game — vs ${game.opponentName}`}
      className="group text-fg-4 transition-colors hover:text-fg-2"
    >
      {dir === 'prev' ? (
        <>
          <span aria-hidden>←</span> Prev ·{' '}
          <span className="text-fg-2 transition-colors group-hover:text-fg-1">{abbrev}</span>
        </>
      ) : (
        <>
          <span className="text-fg-2 transition-colors group-hover:text-fg-1">{abbrev}</span> · Next{' '}
          <span aria-hidden>→</span>
        </>
      )}
    </Link>
  )
}

function gameHref(id: number, listQuery: string): string {
  return `/games/${id.toString()}${listQuery ? `?${listQuery}` : ''}`
}
