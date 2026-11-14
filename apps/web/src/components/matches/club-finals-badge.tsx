import type { ClubFinalsBadge } from '@eanhl/db/queries'
import {
  clubFinalsBanner,
  clubFinalsLabel,
  clubFinalsOutcome,
  clubFinalsOutcomeText,
  clubFinalsRoundHeader,
  clubFinalsRunScore,
  clubFinalsSeriesScore,
  clubFinalsShortLabel,
  type FinalsOutcome,
} from '@/lib/club-finals-view'

// Club Finals marks for a game (CF1, look in CF3). Everything shown is a stored value from the
// worker's derive (migration 0083): nothing is worked out here (the words live in
// lib/club-finals-view.ts). A game with no row gets no badge at all.

const CHIP =
  'inline-flex items-center whitespace-nowrap border px-2 py-0.5 font-condensed text-[10px] font-bold uppercase tracking-[0.16em]'

const OUTCOME_TITLE: Record<FinalsOutcome, string> = {
  final_won: 'The 4th win of the final',
  round_won: 'The 4th win of the round',
  eliminated: 'The 4th loss of the round: the attempt ends here',
}

/** Compact header of a game card: the Club Finals tag, "R4 · G5" and the series score after the game. */
export function ClubFinalsChips({ badge }: { badge: ClubFinalsBadge }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span
        className="bg-accent-strong px-2 py-0.5 font-condensed text-[10px] font-black uppercase tracking-[0.2em] text-white"
        title={clubFinalsLabel(badge)}
      >
        Club Finals
      </span>
      <span
        className={`${CHIP} border-accent/60 bg-accent/10 text-accent-readable`}
        title={clubFinalsLabel(badge)}
      >
        {clubFinalsShortLabel(badge)}
      </span>
      {badge.isFinal ? (
        <span
          className={`${CHIP} border-fg-1/60 bg-fg-1/10 text-fg-1`}
          title="Round 4 is the final"
        >
          The Final
        </span>
      ) : null}
      <span
        className="font-condensed text-sm font-black uppercase tabular-nums tracking-[0.06em] text-fg-1"
        title="Round record after this game (wins–losses). 4 wins win the round; 4 losses end the attempt."
      >
        <span className="mr-1.5 text-[10px] font-bold tracking-[0.16em] text-fg-4">Series</span>
        {clubFinalsSeriesScore(badge)}
      </span>
    </div>
  )
}

/**
 * The mark of a game that decided something, as a full-width bar at the foot of a game card: an
 * eliminating loss, a round-winning win, a won final. Nothing for any other game.
 */
export function ClubFinalsOutcomeBar({ badge }: { badge: ClubFinalsBadge }) {
  const outcome = clubFinalsOutcome(badge)
  if (outcome === null) return null
  const tone =
    outcome === 'eliminated'
      ? 'border-accent bg-accent-strong text-white'
      : outcome === 'final_won'
        ? 'border-emerald-300 bg-emerald-500 text-emerald-950'
        : 'border-emerald-600 bg-emerald-900/80 text-emerald-100'
  return (
    <div
      className={`flex items-center justify-between gap-3 border-t px-4 py-2 font-condensed text-xs font-black uppercase tracking-[0.2em] ${tone}`}
      title={OUTCOME_TITLE[outcome]}
    >
      <span>{clubFinalsOutcomeText(outcome)}</span>
      {outcome === 'eliminated' ? (
        <span className="text-[11px] font-bold tabular-nums tracking-[0.14em] opacity-90">
          Run ends {clubFinalsRunScore(badge)}
        </span>
      ) : null}
    </div>
  )
}

/**
 * Banner over a game sheet's scoreboard: "CLUB FINALS · ROUND 4 · GAME 5". The final is the
 * strongest version: a solid red band.
 */
export function ClubFinalsStrip({ badge }: { badge: ClubFinalsBadge }) {
  const { kicker, title, final } = clubFinalsBanner(badge)
  const outcome = clubFinalsOutcome(badge)
  const shell = final
    ? 'border-b border-accent bg-accent-strong text-white shadow-[0_0_28px_rgba(232,65,49,0.3)]'
    : 'border-b border-accent/50 bg-[linear-gradient(90deg,rgba(232,65,49,0.26),rgba(232,65,49,0.07)_65%,transparent)] text-fg-1'
  const sub = final ? 'text-white/85' : 'text-fg-3'
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 font-condensed uppercase sm:px-5 ${shell}`}
      role="note"
      aria-label={`${kicker} ${title}`}
    >
      <span className="flex items-baseline gap-2.5">
        <span
          className={`text-xs font-extrabold tracking-[0.24em] ${final ? 'text-white/90' : 'text-accent-readable'}`}
        >
          {kicker}
        </span>
        <span
          className={`font-black leading-none tracking-[0.08em] ${final ? 'text-lg sm:text-xl' : 'text-sm sm:text-base'}`}
        >
          {title}
        </span>
      </span>
      <span className={`text-xs font-bold tabular-nums tracking-[0.18em] ${sub}`}>
        Series {clubFinalsSeriesScore(badge)}
      </span>
      <span className={`text-xs font-semibold tabular-nums tracking-[0.18em] ${sub}`}>
        Attempt {String(badge.attempt)} · {clubFinalsRunScore(badge)}
      </span>
      {outcome !== null ? (
        <span
          title={OUTCOME_TITLE[outcome]}
          className={`${CHIP} ${
            outcome === 'eliminated'
              ? 'border-white/70 bg-black/40 text-white'
              : final
                ? 'border-white/70 bg-white/15 text-white'
                : 'border-emerald-600 bg-emerald-950/70 text-emerald-300'
          }`}
        >
          {clubFinalsOutcomeText(outcome)}
        </span>
      ) : null}
    </div>
  )
}

/** A header in the games list where a Club Finals round starts: "ATTEMPT 4 · ROUND 2". */
export function ClubFinalsRoundDivider({ badge }: { badge: ClubFinalsBadge }) {
  return (
    <div
      className="flex items-center gap-3 md:col-span-2 xl:col-span-3"
      role="separator"
      aria-label={`Club Finals, ${clubFinalsRoundHeader(badge)}`}
    >
      <span className="h-5 w-1 bg-accent" aria-hidden />
      <span className="font-condensed text-[11px] font-black uppercase tracking-[0.24em] text-accent-readable">
        Club Finals
      </span>
      <span
        className={`font-condensed text-sm font-black uppercase tracking-[0.14em] ${
          badge.isFinal ? 'text-fg-1' : 'text-fg-2'
        }`}
      >
        {clubFinalsRoundHeader(badge)}
      </span>
      <span
        aria-hidden
        className="h-px flex-1 bg-[linear-gradient(to_right,rgba(232,65,49,0.55),transparent)]"
      />
    </div>
  )
}
