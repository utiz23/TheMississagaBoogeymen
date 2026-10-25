import Link from 'next/link'
import { formatScore } from '@/lib/format'
import type { ScoreChip } from '@/lib/news/display'

const TONE = {
  WIN: { border: 'border-win', text: 'text-win', letter: 'W' },
  LOSS: { border: 'border-loss', text: 'text-loss', letter: 'L' },
  OTL: { border: 'border-otl', text: 'text-otl', letter: 'OTL' },
} as const

/** The night's games as chips; each links to the game page. No facts ⇒ no chips. */
export function ScoreChips({ chips }: { chips: ScoreChip[] }) {
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((g) => {
        const tone = TONE[g.result]
        return (
          <Link
            prefetch
            key={g.matchId}
            href={`/games/${String(g.matchId)}`}
            className={`border-l-4 ${tone.border} bg-surface px-3 py-1.5 font-condensed text-sm text-fg-2 hover:bg-surface-raised`}
          >
            <b className={tone.text}>{tone.letter}</b> {formatScore(g.scoreFor, g.scoreAgainst)}{' '}
            {g.opponentName}
            {g.shots !== null && (
              <span className="text-fg-5">
                {' '}
                · shots {formatScore(g.shots.for, g.shots.against)}
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}
