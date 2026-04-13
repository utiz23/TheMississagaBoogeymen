import Image from 'next/image'
import Link from 'next/link'
import type { Match, MatchResult } from '@eanhl/db'
import { formatMatchDate, formatRecord, abbreviateTeamName } from '@/lib/format'

const OUR_ABBREV = 'BGM'

interface LatestResultProps {
  match: Match
  clubRecord: { wins: number; losses: number; otl: number } | null
}

const RESULT_PILL_CONFIG: Record<MatchResult, { label: string; className: string }> = {
  WIN: {
    label: 'WIN',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  },
  LOSS: {
    label: 'LOSS',
    className: 'border-red-500/40 bg-red-500/10 text-red-400',
  },
  OTL: {
    label: 'OT LOSS',
    className: 'border-orange-500/40 bg-orange-500/10 text-orange-300',
  },
  DNF: {
    label: 'DNF',
    className: 'border-zinc-600/40 bg-zinc-800/40 text-zinc-500',
  },
}

function ResultPill({ result }: { result: MatchResult }) {
  const config = RESULT_PILL_CONFIG[result]

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full border px-4 py-1.5 font-condensed text-sm font-bold uppercase tracking-[0.22em] ${config.className}`}
    >
      {config.label}
    </span>
  )
}

export function LatestResult({ match, clubRecord }: LatestResultProps) {
  const opponentAbbrev = abbreviateTeamName(match.opponentName)
  const ourScoreColor = match.result === 'WIN' ? 'text-accent' : 'text-zinc-100'
  const opponentScoreColor =
    match.result === 'LOSS' || match.result === 'OTL' ? 'text-red-300' : 'text-zinc-500'

  return (
    <Link
      href={`/games/${match.id.toString()}`}
      className="group block overflow-hidden border border-zinc-800 bg-[radial-gradient(circle_at_top,rgba(190,24,24,0.16),transparent_42%),linear-gradient(180deg,rgba(24,24,27,0.98),rgba(10,10,10,0.98))] transition-[border-color,transform,background-color] hover:border-zinc-700 hover:bg-surface-raised"
    >
      <div className="h-1 w-full bg-gradient-to-r from-red-900 via-red-600 to-red-900" />

      <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-3">
        <span className="font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Latest Result
        </span>
        <span className="text-xs text-zinc-600">{formatMatchDate(match.playedAt)}</span>
      </div>

      <div className="grid gap-5 px-5 py-8 sm:px-8 sm:py-10 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
        {/* Our side */}
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-zinc-800/70 bg-black/20 px-4 py-5 text-center lg:min-h-[18.5rem]">
          <div className="flex h-24 w-24 items-center justify-center rounded-full border border-zinc-800 bg-black/20 sm:h-28 sm:w-28">
            <Image
              src="/images/bgm-logo.png"
              alt="BGM"
              width={96}
              height={96}
              className="h-20 w-20 object-contain sm:h-24 sm:w-24"
            />
          </div>
          <span className="font-condensed text-3xl font-black uppercase tracking-[0.14em] text-zinc-100">
            {OUR_ABBREV}
          </span>
          {clubRecord !== null ? (
            <span className="font-condensed text-base font-semibold tracking-[0.12em] text-zinc-400">
              {formatRecord(clubRecord.wins, clubRecord.losses, clubRecord.otl)}
            </span>
          ) : null}
        </div>

        {/* Score */}
        <div className="flex min-w-0 flex-col items-center justify-center gap-4 px-2 py-2 text-center lg:min-w-[18rem]">
          <div className="font-condensed text-[11px] font-semibold uppercase tracking-[0.28em] text-zinc-600">
            Featured Scoreboard
          </div>
          <div className="flex items-center justify-center gap-2 font-condensed font-black tabular-nums leading-none sm:gap-3">
            <span className={`text-[4.5rem] sm:text-[5.75rem] ${ourScoreColor}`}>
              {match.scoreFor.toString()}
            </span>
            <span className="text-3xl text-zinc-700 sm:text-5xl">-</span>
            <span className={`text-[4.5rem] sm:text-[5.75rem] ${opponentScoreColor}`}>
              {match.scoreAgainst.toString()}
            </span>
          </div>
          <ResultPill result={match.result} />
          <div className="font-condensed text-xs font-medium uppercase tracking-[0.18em] text-zinc-600">
            Final
          </div>
        </div>

        {/* Opponent side */}
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-zinc-800/70 bg-black/20 px-4 py-5 text-center lg:min-h-[18.5rem]">
          {/* Initial-badge fallback — opponent-specific without an external image */}
          <div
            role="img"
            aria-label={match.opponentName}
            className="flex h-24 w-24 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/50 sm:h-28 sm:w-28"
          >
            <span
              aria-hidden
              className="font-condensed text-3xl font-black uppercase tracking-tight text-zinc-400 sm:text-4xl"
            >
              {opponentAbbrev.slice(0, 2)}
            </span>
          </div>
          <span className="font-condensed text-3xl font-black uppercase tracking-[0.14em] text-zinc-100">
            {opponentAbbrev}
          </span>
          {/* TODO: replace W-L-OTL placeholder with real opponent record once
              the data pipeline supports fetching opponent club stats. */}
          <span className="font-condensed text-base font-semibold tracking-[0.12em] text-zinc-600">
            W-L-OTL
          </span>
        </div>
      </div>

      {/* TODO: restore Match Snapshot once the final stat set and presentation
          are decided. All candidate fields (SOG, Hits, FO%, TOA, PIM) are stored
          in the match row; the section just needs to be re-enabled and styled. */}
    </Link>
  )
}
