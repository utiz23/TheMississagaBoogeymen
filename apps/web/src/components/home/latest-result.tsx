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
      {/* plain img — EA CDN, not configurable in next/image remotePatterns */}
      <img
        src={logoUrl}
        alt={clubName}
        className="absolute inset-0 h-full w-full object-contain"
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      />
    </div>
  )
}

function ResultPill({ result }: { result: MatchResult }) {
  const styles: Record<string, string> = {
    WIN: 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
    LOSS: 'border border-red-500/40 bg-red-500/10 text-red-400',
    OTL: 'border border-orange-500/40 bg-orange-500/10 text-orange-400',
    DNF: 'border border-zinc-600/40 bg-zinc-800/40 text-zinc-500',
  }
  const labels: Record<string, string> = {
    WIN: 'WIN',
    LOSS: 'LOSS',
    OTL: 'OT LOSS',
    DNF: 'DNF',
  }
  const cls = styles[result] ?? 'border border-zinc-600/40 bg-zinc-800/40 text-zinc-500'
  const label = labels[result] ?? result

  return (
    <span
      className={`inline-flex items-center px-3 py-1 font-condensed text-sm font-bold uppercase tracking-wider ${cls}`}
    >
      {label}
    </span>
  )
}

function StripStat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="font-semibold uppercase tracking-wider text-zinc-600">{label}</span>{' '}
      <span className="tabular text-zinc-400">{value}</span>
    </span>
  )
}

export function LatestResult({ match, clubRecord }: LatestResultProps) {
  const scoreForColor = match.result === 'WIN' ? 'text-accent' : 'text-zinc-100'

  return (
    <Link
      href={`/games/${match.id.toString()}`}
      className="group block overflow-hidden border border-zinc-800 border-t-2 border-t-accent bg-surface transition-colors hover:bg-surface-raised"
    >
      {/* Header row */}
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-3">
        <span className="font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Latest Result
        </span>
        <span className="text-xs text-zinc-600">{formatMatchDate(match.playedAt)}</span>
      </div>

      {/* Main scoreboard grid */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-5 py-8 sm:gap-8 sm:px-8">
        {/* Left — our team */}
        <div className="flex flex-col items-center gap-2 text-center">
          <Image
            src="/images/bgm-logo.png"
            alt="BGM"
            width={64}
            height={64}
            className="h-14 w-14 object-contain sm:h-16 sm:w-16"
          />
          <span className="font-condensed text-2xl font-black uppercase text-zinc-100">
            {OUR_ABBREV}
          </span>
          {clubRecord !== null && (
            <span className="font-condensed text-sm font-semibold text-zinc-500">
              {formatRecord(clubRecord.wins, clubRecord.losses, clubRecord.otl)}
            </span>
          )}
        </div>

        {/* Center — score + result pill */}
        <div className="flex min-w-[160px] flex-col items-center gap-3 sm:min-w-[200px]">
          <div className="flex items-baseline gap-1 font-condensed font-black tabular leading-none">
            <span className={`text-6xl sm:text-7xl ${scoreForColor}`}>
              {match.scoreFor.toString()}
            </span>
            <span className="text-3xl text-zinc-700 sm:text-4xl">–</span>
            <span className="text-6xl text-zinc-500 sm:text-7xl">
              {match.scoreAgainst.toString()}
            </span>
          </div>
          <ResultPill result={match.result} />
        </div>

        {/* Right — opponent */}
        <div className="flex flex-col items-center gap-2 text-center">
          <OpponentLogo clubId={match.opponentClubId} clubName={match.opponentName} />
          <span className="font-condensed text-2xl font-black uppercase text-zinc-100">
            {abbreviateTeamName(match.opponentName)}
          </span>
        </div>
      </div>

      {/* Stats strip footer */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-zinc-800/60 px-5 py-3 text-xs text-zinc-500">
        <StripStat label="SOG" value={formatScore(match.shotsFor, match.shotsAgainst)} />
        <StripStat label="Hits" value={formatScore(match.hitsFor, match.hitsAgainst)} />
        {match.faceoffPct !== null && <StripStat label="FO%" value={formatPct(match.faceoffPct)} />}
        {match.timeOnAttack !== null && (
          <StripStat label="TOA" value={formatTOA(match.timeOnAttack)} />
        )}
      </div>
    </Link>
  )
}
