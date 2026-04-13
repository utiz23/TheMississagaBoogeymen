import Image from 'next/image'
import Link from 'next/link'
import type { Match, MatchResult } from '@eanhl/db'
import {
  formatMatchDate,
  formatScore,
  formatTOA,
  formatPct,
  formatRecord,
  abbreviateTeamName,
} from '@/lib/format'

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

function ShieldPlaceholder() {
  return (
    <svg viewBox="0 0 48 56" fill="none" className="h-12 w-12 sm:h-14 sm:w-14" aria-hidden>
      <path
        d="M24 3L4 11v16c0 12.2 8.5 23.6 20 27 11.5-3.4 20-14.8 20-27V11L24 3z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        className="text-zinc-700"
      />
    </svg>
  )
}

function OpponentLogo({ clubId, clubName }: { clubId: string; clubName: string }) {
  const logoUrl = `https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/crests/t${clubId}.png`
  return (
    <div className="relative flex h-14 w-14 items-center justify-center sm:h-16 sm:w-16">
      <ShieldPlaceholder />
      {/* plain img — EA CDN, not configurable in next/image remotePatterns.
          onError omitted: this is a Server Component; the EA CDN URL never 404s
          (clubs without a custom crest receive the default NHL shield). */}
      <img src={logoUrl} alt={clubName} className="absolute inset-0 h-full w-full object-contain" />
    </div>
  )
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

function StripStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-800/70 bg-black/15 px-3 py-2">
      <span className="font-condensed text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
        {label}
      </span>
      <span className="font-condensed text-sm font-semibold tabular-nums text-zinc-300">
        {value}
      </span>
    </div>
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

      <div className="grid gap-5 px-5 py-6 sm:px-8 sm:py-8 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-zinc-800/70 bg-black/20 px-4 py-5 text-center lg:min-h-[16rem]">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border border-zinc-800 bg-black/20 sm:h-24 sm:w-24">
            <Image
              src="/images/bgm-logo.png"
              alt="BGM"
              width={88}
              height={88}
              className="h-16 w-16 object-contain sm:h-20 sm:w-20"
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

        <div className="flex min-w-0 flex-col items-center justify-center gap-4 px-2 py-2 text-center lg:min-w-[18rem]">
          <div className="font-condensed text-[11px] font-semibold uppercase tracking-[0.28em] text-zinc-600">
            Featured Scoreboard
          </div>
          <div className="flex items-baseline justify-center gap-2 font-condensed font-black tabular-nums leading-none sm:gap-3">
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

        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-zinc-800/70 bg-black/20 px-4 py-5 text-center lg:min-h-[16rem]">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border border-zinc-800 bg-black/20 sm:h-24 sm:w-24">
            <OpponentLogo clubId={match.opponentClubId} clubName={match.opponentName} />
          </div>
          <span className="font-condensed text-3xl font-black uppercase tracking-[0.14em] text-zinc-100">
            {opponentAbbrev}
          </span>
          <span className="max-w-[14rem] text-sm text-zinc-500">{match.opponentName}</span>
        </div>
      </div>

      <div className="border-t border-zinc-800/60 bg-black/10 px-5 py-3 sm:px-8">
        <div className="mb-2 font-condensed text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
          Match Snapshot
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <StripStat label="SOG" value={formatScore(match.shotsFor, match.shotsAgainst)} />
          <StripStat label="Hits" value={formatScore(match.hitsFor, match.hitsAgainst)} />
          {match.faceoffPct !== null && (
            <StripStat label="FO%" value={formatPct(match.faceoffPct)} />
          )}
          {match.timeOnAttack !== null && (
            <StripStat label="TOA" value={formatTOA(match.timeOnAttack)} />
          )}
        </div>
      </div>
    </Link>
  )
}
