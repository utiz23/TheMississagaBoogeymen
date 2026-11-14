import Link from 'next/link'
import { Panel } from '@/components/ui/panel'
import {
  FINALS_BOX_COUNT,
  roundName,
  clubFinalsOutcome,
  type SeriesPanelView,
} from '@/lib/club-finals-view'

// The round on the game page (CF3): the round's 7 boxes (W / L / empty) with this game marked, and
// the series score before and after it. Every value is a stored one (see lib/club-finals-view.ts).

interface SeriesPanelProps {
  view: SeriesPanelView
  round: number
  isFinal: boolean
  gameInRound: number
  badge: { roundWon: boolean; eliminated: boolean; finalWon: boolean }
  /** The games-list filters this sheet was opened from, kept on the links to the other games. */
  listQuery?: string
}

export function SeriesPanel({
  view,
  round,
  isFinal,
  gameInRound,
  badge,
  listQuery,
}: SeriesPanelProps) {
  const outcome = clubFinalsOutcome(badge)
  return (
    <section aria-label="Club Finals series">
      <Panel className="overflow-hidden">
        <div className="grid gap-4 p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-8 sm:p-5">
          <div className="flex items-end gap-5 sm:gap-6">
            <div>
              <p className={LABEL}>Series</p>
              <p className="font-condensed text-xs font-extrabold uppercase tracking-[0.18em] text-fg-2">
                {roundName(round, isFinal)}
              </p>
            </div>
          </div>

          <div>
            <ol
              className="flex gap-1.5 sm:gap-2"
              aria-label={`Round results up to game ${String(gameInRound)}`}
            >
              {view.cells.map((cell, i) => (
                <li key={i} className="flex flex-col items-center gap-1">
                  <Box cell={cell} index={i} listQuery={listQuery} />
                  <span
                    className={`font-condensed text-[9px] font-black uppercase tracking-[0.16em] ${
                      cell.current ? 'text-accent-readable' : 'text-transparent'
                    }`}
                    aria-hidden={!cell.current}
                  >
                    This game
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-1 font-condensed text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-5">
              First to 4 wins takes the round. 4 losses end the attempt.
              {outcome === 'round_won' ? ' This game won the round.' : ''}
              {outcome === 'final_won' ? ' This game won the final.' : ''}
              {outcome === 'eliminated' ? ' This game ended the attempt.' : ''}
            </p>
          </div>
        </div>
      </Panel>
    </section>
  )
}

const LABEL = 'font-condensed text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-5'

function Box({
  cell,
  index,
  listQuery,
}: {
  cell: SeriesPanelView['cells'][number]
  index: number
  listQuery: string | undefined
}) {
  const tone =
    cell.letter === 'W'
      ? 'border-emerald-600 bg-emerald-950/60 text-emerald-300'
      : cell.letter === 'L'
        ? 'border-rose-700 bg-rose-950/60 text-rose-300'
        : 'border-zinc-800 bg-zinc-950/40 text-fg-6'
  const ring = cell.current
    ? 'ring-2 ring-accent ring-offset-2 ring-offset-[#0e0d0d] shadow-[0_0_18px_rgba(232,65,49,0.45)]'
    : ''
  const size = 'flex h-10 w-10 items-center justify-center border font-condensed text-lg font-black'
  const label = `Game ${String(index + 1)} of ${String(FINALS_BOX_COUNT)}: ${
    cell.letter === 'W' ? 'win' : cell.letter === 'L' ? 'loss' : 'not played'
  }${cell.current ? ', this game' : ''}`
  const body = cell.letter ?? '–'
  if (cell.matchId !== null && !cell.current) {
    return (
      <Link
        prefetch
        href={`/games/${String(cell.matchId)}${listQuery ? `?${listQuery}` : ''}`}
        aria-label={label}
        className={`${size} ${tone} transition-colors hover:text-white sm:h-11 sm:w-11`}
      >
        {body}
      </Link>
    )
  }
  return (
    <span role="img" aria-label={label} className={`${size} ${tone} ${ring} sm:h-11 sm:w-11`}>
      {body}
    </span>
  )
}
