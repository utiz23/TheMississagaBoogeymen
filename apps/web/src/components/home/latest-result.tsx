import Link from 'next/link'
import type { Match } from '@eanhl/db'
import Image from 'next/image'
import {
  formatMatchDate,
  formatRecord,
  abbreviateTeamName,
  formatTOA,
  opponentFaceoffPct,
} from '@/lib/format'
import { OpponentCrest } from '@/components/ui/opponent-crest'
import { BroadcastPanel } from '@/components/ui/broadcast-panel'
import { ResultPill } from '@/components/ui/result-pill'

const OUR_NAME = 'Boogeymen'

interface LatestResultProps {
  match: Match
  clubRecord: { wins: number; losses: number; otl: number } | null
  /** EA crest asset ID for the opponent club. Null falls back to initial badge. */
  opponentCrestAssetId: string | null
  /** EA customKit.useBaseAsset flag for the opponent crest. */
  opponentCrestUseBaseAsset: string | null
}

function SnapStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
        {label}
      </span>
      <span className="font-condensed text-sm font-bold tabular-nums text-zinc-300">{value}</span>
    </div>
  )
}

function MatchSnapshot({ match }: { match: Match }) {
  const foOurs =
    match.faceoffPct !== null ? Math.round(parseFloat(match.faceoffPct)).toString() : null
  const foOpponent = opponentFaceoffPct(match.faceoffPct)
  const foTheirs = foOpponent !== null ? Math.round(parseFloat(foOpponent)).toString() : null
  const toa = match.timeOnAttack !== null ? formatTOA(match.timeOnAttack) : null
  const showFO = foOurs !== null && foTheirs !== null

  return (
    <div className="border-t border-zinc-800/60 px-5 py-3 sm:px-8">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <SnapStat
          label="Shots"
          value={`${match.shotsFor.toString()} – ${match.shotsAgainst.toString()}`}
        />
        <SnapStat
          label="Hits"
          value={`${match.hitsFor.toString()} – ${match.hitsAgainst.toString()}`}
        />
        {showFO && <SnapStat label="FO%" value={`${foOurs} – ${foTheirs}`} />}
        {toa !== null && <SnapStat label="TOA" value={toa} />}
        <span className="ml-auto hidden font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-700 sm:inline">
          Boogeymen – Opp
        </span>
      </div>
    </div>
  )
}

export function LatestResult({
  match,
  clubRecord,
  opponentCrestAssetId,
  opponentCrestUseBaseAsset,
}: LatestResultProps) {
  const opponentAbbrev = abbreviateTeamName(match.opponentName)
  const ourScoreColor = match.result === 'WIN' ? 'text-accent' : 'text-zinc-100'
  const opponentScoreColor =
    match.result === 'LOSS' || match.result === 'OTL' ? 'text-red-300' : 'text-zinc-500'

  return (
    <Link
      href={`/games/${match.id.toString()}`}
      className="group block transition-[border-color,transform,background-color] hover:[&>div]:border-zinc-700"
    >
      <BroadcastPanel className="group-hover:bg-surface-raised">
        <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-3">
          <span className="font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Latest Result
          </span>
          <span className="font-condensed text-xs uppercase tracking-wider text-zinc-600">
            {formatMatchDate(match.playedAt)}
          </span>
        </div>

        <div className="grid gap-5 px-5 py-8 sm:px-8 sm:py-10 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          {/* Our side */}
          <div className="flex flex-col items-center justify-center gap-3 border border-zinc-800/70 bg-black/20 px-4 py-5 text-center lg:min-h-[18.5rem]">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border border-zinc-800 bg-black/20 sm:h-28 sm:w-28">
              <Image
                src="/images/bgm-logo.png"
                alt="Boogeymen"
                width={96}
                height={96}
                className="h-20 w-20 object-contain sm:h-24 sm:w-24"
              />
            </div>
            <span className="font-condensed text-3xl font-black uppercase tracking-[0.14em] text-zinc-100">
              {OUR_NAME}
            </span>
            {clubRecord !== null ? (
              <span className="font-condensed text-base font-semibold tabular-nums tracking-[0.12em] text-zinc-400">
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
              <span className="text-3xl text-zinc-700 sm:text-5xl">–</span>
              <span className={`text-[4.5rem] sm:text-[5.75rem] ${opponentScoreColor}`}>
                {match.scoreAgainst.toString()}
              </span>
            </div>
            <ResultPill result={match.result} size="md" />
            <div className="font-condensed text-xs font-medium uppercase tracking-[0.18em] text-zinc-600">
              Final
            </div>
          </div>

          {/* Opponent side */}
          <div className="flex flex-col items-center justify-center gap-3 border border-zinc-800/70 bg-black/20 px-4 py-5 text-center lg:min-h-[18.5rem]">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/50 sm:h-28 sm:w-28">
              <OpponentCrest
                crestAssetId={opponentCrestAssetId}
                useBaseAsset={opponentCrestUseBaseAsset}
                alt={match.opponentName}
                width={96}
                height={96}
                className="h-20 w-20 object-contain sm:h-24 sm:w-24"
                fallback={
                  <span
                    aria-hidden
                    className="font-condensed text-3xl font-black uppercase tracking-tight text-zinc-400 sm:text-4xl"
                  >
                    {opponentAbbrev.slice(0, 2)}
                  </span>
                }
              />
            </div>
            <span className="font-condensed text-3xl font-black uppercase tracking-[0.14em] text-zinc-100">
              {opponentAbbrev}
            </span>
          </div>
        </div>

        <MatchSnapshot match={match} />
      </BroadcastPanel>
    </Link>
  )
}
