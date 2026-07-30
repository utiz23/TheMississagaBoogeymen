import Image from 'next/image'
import type { Match } from '@eanhl/db'
import { OpponentCrest } from '@/components/ui/opponent-crest'
import { abbreviateTeamName, formatMatchDate, formatMatchTime } from '@/lib/format'
import { delayVar } from '@/lib/motion'

const OUR_ABBREV = 'BGM'
const OUR_NAME = 'Boogeymen'

// Scoreboard hero — prototype scorebug layout: meta strip (game # · date ·
// mode | FINAL/OT) → crest-flanked score row with per-side WIN/LOSS tags →
// series footer. BGM is always the left side (colour-rules invariant); the
// opponent side draws from the resolved --opp* vars set on the page root.
// Result state is carried by the side tags and the winner's glow, never by
// which colour is brighter.

interface HeroCardProps {
  match: Match
  opponentCrestAssetId: string | null
  opponentCrestUseBaseAsset: string | null
  /** Derived via wentToOvertime() — the schema has no OT column. */
  overtime: boolean
  meta: {
    seasonNumber: number | null
    meetingNumber: number | null
    /** Prior-meetings record vs this opponent; null (or total ≤ 1) hides the footer. */
    series: { wins: number; losses: number; otl: number; total: number } | null
  }
}

/** The scorebug settles first; the winner's number blooms after it. */
const SCORE_BLOOM_MS = 650

export function HeroCard({
  match,
  opponentCrestAssetId,
  opponentCrestUseBaseAsset,
  overtime,
  meta,
}: HeroCardProps) {
  const opponentAbbrev = abbreviateTeamName(match.opponentName)
  const ourWin = match.result === 'WIN'
  const oppWin = match.result === 'LOSS' || match.result === 'OTL'
  const dnf = match.result === 'DNF'

  // Losing/DNF scores stay muted but at fg-4, which clears the 3:1 large-text
  // bar these 60–88px numerals sit under (fg-5 was 1.95:1 — the Phase 10 sweep).
  const ourScoreCls = ourWin
    ? 'text-accent [text-shadow:0_0_14px_rgba(232,65,49,0.28)]'
    : 'text-fg-4'
  const oppScoreCls = oppWin
    ? '[color:var(--opp)] [text-shadow:0_0_14px_var(--opp-soft)]'
    : 'text-fg-4'

  // Motion (Phase 12): only the winning score blooms, once, after the hero has
  // settled. A DNF blooms nothing — there is no result to announce.
  const ourBloom = ourWin && !dnf ? 'gs-bloom-accent' : ''
  const oppBloom = oppWin && !dnf ? 'gs-bloom-opp' : ''

  return (
    <section className="gs-rise broadcast-panel-strong overflow-hidden font-condensed uppercase">
      <div className="ticker-strip" />

      {/* The page's h1. The scorebug below says all of this visually, but it
          says it across a dozen spans (two of which are hidden < sm), so the
          document heading is one plain sentence instead. */}
      <h1 className="sr-only">
        {OUR_NAME} {match.scoreFor.toString()}–{match.scoreAgainst.toString()} {match.opponentName}{' '}
        · {dnf ? 'Did not finish' : 'Final'}
        {overtime ? ' in overtime' : ''} · {formatMatchDate(match.playedAt)}
      </h1>

      {/* Scorebug header — meta left · game state right */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border-subtle px-4 py-2.5 sm:px-5">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold tracking-[0.18em] text-fg-3">
          {meta.seasonNumber !== null ? (
            <>
              <span className="text-fg-2">Game {meta.seasonNumber.toString()}</span>
              <MetaDivider />
            </>
          ) : null}
          <span>
            {formatMatchDate(match.playedAt)} · {formatMatchTime(match.playedAt)}
          </span>
          {match.gameMode ? (
            <>
              <MetaDivider />
              <span>{match.gameMode}</span>
            </>
          ) : null}
        </span>
        <span className="flex flex-none items-center gap-2.5">
          <span
            className={`text-xs font-black tracking-[0.2em] ${dnf ? 'text-fg-3' : 'text-fg-1'}`}
          >
            {dnf ? 'DNF' : 'Final'}
          </span>
          {overtime ? (
            <span className="border border-otl/40 bg-otl/10 px-2 py-0.5 text-[10px] font-extrabold tracking-[0.12em] text-otl">
              OT
            </span>
          ) : null}
        </span>
      </div>

      {/* Score row — BGM | score | opponent */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-6 sm:gap-5 sm:px-8 sm:py-7">
        {/* BGM side (always left) */}
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Image
            src="/images/bgm-logo.png"
            alt={OUR_NAME}
            width={66}
            height={66}
            priority
            className="h-12 w-12 flex-none object-contain [filter:drop-shadow(0_0_16px_rgba(232,65,49,0.28))] sm:h-[66px] sm:w-[66px]"
          />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-bold tracking-[0.24em] text-fg-3">{OUR_ABBREV}</span>
            <span className="hidden truncate text-[22px] font-black leading-[0.95] tracking-[0.03em] text-fg-1 sm:block lg:text-[30px]">
              {OUR_NAME}
            </span>
            <ResultTag side="bgm" result={match.result} />
          </div>
        </div>

        {/* Score */}
        <div className="flex flex-none items-baseline gap-2 sm:gap-5">
          <span
            className={`${ourBloom} text-6xl font-black leading-[0.82] tabular-nums sm:text-[88px] ${ourScoreCls}`}
            style={ourBloom ? delayVar(SCORE_BLOOM_MS) : undefined}
          >
            {match.scoreFor.toString()}
          </span>
          <span aria-hidden className="text-2xl font-normal leading-none text-fg-4 sm:text-[34px]">
            –
          </span>
          <span
            className={`${oppBloom} text-6xl font-black leading-[0.82] tabular-nums sm:text-[88px] ${oppScoreCls}`}
            style={oppBloom ? delayVar(SCORE_BLOOM_MS) : undefined}
          >
            {match.scoreAgainst.toString()}
          </span>
        </div>

        {/* Opponent side (always right) */}
        <div className="flex min-w-0 items-center justify-end gap-3 text-right sm:gap-4">
          <div className="flex min-w-0 flex-col items-end gap-1">
            <span className="text-xs font-bold tracking-[0.24em] text-fg-3">{opponentAbbrev}</span>
            <span className="hidden max-w-full truncate text-[22px] font-black leading-[0.95] tracking-[0.03em] text-fg-3 sm:block lg:text-[30px]">
              {match.opponentName}
            </span>
            <ResultTag side="opp" result={match.result} />
          </div>
          <div className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-full border bg-charcoal [border-color:var(--opp-line)] sm:h-[66px] sm:w-[66px]">
            <OpponentCrest
              crestAssetId={opponentCrestAssetId}
              useBaseAsset={opponentCrestUseBaseAsset}
              alt={match.opponentName}
              width={56}
              height={56}
              className="h-10 w-10 object-contain sm:h-14 sm:w-14"
              fallback={
                <span aria-hidden className="text-base font-black tracking-tight text-fg-3">
                  {opponentAbbrev.slice(0, 2)}
                </span>
              }
            />
          </div>
        </div>
      </div>

      {/* Series footer — prior meetings vs this opponent */}
      {meta.series !== null && meta.series.total > 1 && meta.meetingNumber !== null ? (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-border-subtle px-6 py-2 text-[11px]">
          <span className="font-semibold tracking-[0.18em] text-fg-3">
            {ordinal(meta.meetingNumber)} meeting vs {match.opponentName}
          </span>
          <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-fg-6" />
          <span className="font-bold tracking-[0.16em] text-fg-3">
            Season series{' '}
            <span className="tabular-nums text-accent">{meta.series.wins.toString()}</span>–
            <span className="tabular-nums text-fg-3">{meta.series.losses.toString()}</span>–
            <span className="tabular-nums text-otl">{meta.series.otl.toString()}</span>
          </span>
        </div>
      ) : null}
    </section>
  )
}

// Per-side result tag: the winner carries a coloured underline bar + coloured
// label (accent for BGM, --opp for the opponent); the loser reads as muted
// text. OTL keeps the amber convention; DNF renders no tags — the scorebug
// header already says DNF.
function ResultTag({ side, result }: { side: 'bgm' | 'opp'; result: Match['result'] }) {
  if (result === 'DNF') return null

  const won = side === 'bgm' ? result === 'WIN' : result !== 'WIN'
  if (won) {
    const bar =
      side === 'bgm'
        ? 'bg-accent [box-shadow:0_0_14px_rgba(232,65,49,0.2)]'
        : '[background:var(--opp)] [box-shadow:0_0_14px_var(--opp-soft)]'
    const label = side === 'bgm' ? 'text-accent' : '[color:var(--opp)]'
    return (
      <span className="flex items-center gap-2">
        <span aria-hidden className={`h-[3px] w-[26px] ${bar}`} />
        <span className={`text-[11px] font-black tracking-[0.22em] ${label}`}>Win</span>
      </span>
    )
  }

  const lostInOt = side === 'bgm' && result === 'OTL'
  return (
    <span
      className={`text-[11px] font-extrabold tracking-[0.22em] ${lostInOt ? 'text-otl' : 'text-fg-3'}`}
    >
      {lostInOt ? 'OTL' : 'Loss'}
    </span>
  )
}

function MetaDivider() {
  return <span aria-hidden className="h-[11px] w-px bg-border" />
}

function ordinal(n: number): string {
  const s = n.toString()
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 13) return `${s}th`
  switch (n % 10) {
    case 1:
      return `${s}st`
    case 2:
      return `${s}nd`
    case 3:
      return `${s}rd`
    default:
      return `${s}th`
  }
}
