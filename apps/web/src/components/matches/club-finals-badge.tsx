import type { ClubFinalsBadge } from '@eanhl/db/queries'

// Club Finals marks for a game (CF1). Everything shown is a stored value from the worker's derive
// (migration 0083): nothing is worked out here. A game with no row gets no badge at all.

const CHIP =
  'inline-flex items-center whitespace-nowrap border px-2 py-0.5 font-condensed text-[10px] font-bold uppercase tracking-[0.16em]'
const CHIP_ACCENT = `${CHIP} border-accent/50 bg-accent/10 text-accent-readable`
const CHIP_PLAIN = `${CHIP} border-border bg-surface-raised text-fg-3`
const CHIP_MARK = `${CHIP} border-zinc-600 bg-zinc-900 text-fg-1`

/** "Club Finals · Round 4 · Game 5". */
export function clubFinalsLabel(badge: Pick<ClubFinalsBadge, 'round' | 'gameInRound'>): string {
  return `Club Finals · Round ${String(badge.round)} · Game ${String(badge.gameInRound)}`
}

/** Round record after the game, e.g. "1–4". */
export function clubFinalsSeriesScore(
  badge: Pick<ClubFinalsBadge, 'roundWinsAfter' | 'roundLossesAfter'>,
): string {
  return `${String(badge.roundWinsAfter)}–${String(badge.roundLossesAfter)}`
}

function marks(badge: ClubFinalsBadge): { key: string; text: string; title: string }[] {
  const out: { key: string; text: string; title: string }[] = []
  if (badge.isFinal) out.push({ key: 'final', text: 'Final', title: 'Round 4 is the final' })
  if (badge.finalWon) {
    out.push({ key: 'finalwon', text: 'Final won', title: 'The 4th win of the final' })
  }
  if (badge.roundWon) {
    out.push({ key: 'roundwon', text: 'Round won', title: 'The 4th win of the round' })
  }
  if (badge.eliminated) {
    out.push({
      key: 'elim',
      text: 'Eliminated',
      title: 'The 4th loss of the round: the attempt ends here',
    })
  }
  return out
}

/** Compact chips for a game card: label, series score, marks. */
export function ClubFinalsChips({ badge }: { badge: ClubFinalsBadge }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={CHIP_ACCENT}>{clubFinalsLabel(badge)}</span>
      <span
        className={CHIP_PLAIN}
        title="Round record after this game (wins–losses). 4 wins win the round; 4 losses end the attempt."
      >
        Series {clubFinalsSeriesScore(badge)}
      </span>
      {marks(badge).map((m) => (
        <span key={m.key} className={CHIP_MARK} title={m.title}>
          {m.text}
        </span>
      ))}
    </div>
  )
}

/** Strip for the game page's scoreboard: the same facts, one row, plus the attempt record. */
export function ClubFinalsStrip({ badge }: { badge: ClubFinalsBadge }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border-subtle bg-accent/5 px-4 py-2 sm:px-5">
      <span className="text-xs font-extrabold tracking-[0.18em] text-accent-readable">
        {clubFinalsLabel(badge)}
      </span>
      <span className="text-xs font-bold tracking-[0.18em] text-fg-2">
        Series {clubFinalsSeriesScore(badge)}
      </span>
      <span className="text-xs font-semibold tracking-[0.18em] text-fg-4">
        Attempt {String(badge.attempt)} · {String(badge.attemptWinsAfter)}–
        {String(badge.attemptLossesAfter)}
      </span>
      {marks(badge).map((m) => (
        <span key={m.key} className={CHIP_MARK} title={m.title}>
          {m.text}
        </span>
      ))}
    </div>
  )
}
