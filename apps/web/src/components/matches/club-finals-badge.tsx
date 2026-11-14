import type { ClubFinalsBadge } from '@eanhl/db/queries'
import {
  clubFinalsBanner,
  clubFinalsCardLabel,
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

// Tag shape of the games-list card (same size as the 6S / 3S mode tag, so the top row keeps one height).
const TAG =
  'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] @max-[24rem]:px-2 @max-[22rem]:tracking-[0.1em]'

/**
 * The Club Finals tags of a game card, for the card's top row next to the 6S / 3S tag: the Club
 * Finals tag, "R4 · G5" ("Final · G5" in the final), the series score and the mark of a game that
 * decided something (round won, eliminated, final won). Renders as a fragment: the card owns the
 * row. On a narrow card (the card is a container) the word "Series" and the run score drop out (they
 * stay in the hover title) so the row stays one line.
 */
export function ClubFinalsTags({ badge }: { badge: ClubFinalsBadge }) {
  const outcome = clubFinalsOutcome(badge)
  const outcomeTone =
    outcome === 'eliminated'
      ? 'border-accent bg-accent-strong text-white'
      : outcome === 'final_won'
        ? 'border-emerald-300 bg-emerald-500 text-emerald-950'
        : 'border-emerald-600 bg-emerald-900/80 text-emerald-100'
  return (
    <>
      <span
        className={`${TAG} border-accent bg-accent-strong font-black text-white`}
        title={clubFinalsLabel(badge)}
      >
        Finals
      </span>
      <span
        className={`${TAG} ${
          badge.isFinal
            ? 'border-fg-1/60 bg-fg-1/10 text-fg-1'
            : 'border-accent/60 bg-accent/10 text-accent-readable'
        }`}
        title={clubFinalsLabel(badge)}
      >
        {clubFinalsCardLabel(badge)}
      </span>
      <span
        className={`${TAG} border-zinc-700 bg-zinc-900/70 tabular-nums text-fg-1 @max-[19rem]:hidden`}
        title="Round record after this game (wins–losses). 4 wins win the round; 4 losses end the attempt."
      >
        <span className="mr-1.5 text-fg-4 @max-[34rem]:hidden">Series</span>
        {clubFinalsSeriesScore(badge)}
      </span>
      {outcome !== null ? (
        <span
          className={`${TAG} font-black ${outcomeTone}`}
          title={`${OUTCOME_TITLE[outcome]}${outcome === 'eliminated' ? `. Run ends ${clubFinalsRunScore(badge)}` : ''}`}
        >
          {clubFinalsOutcomeText(outcome)}
          {outcome === 'eliminated' ? (
            <span className="ml-1.5 tabular-nums opacity-90 @max-[34rem]:hidden">
              {clubFinalsRunScore(badge)}
            </span>
          ) : null}
        </span>
      ) : null}
    </>
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
