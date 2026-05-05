import Link from 'next/link'
import Image from 'next/image'
import type { Match, MatchResult } from '@eanhl/db'
import { OpponentCrest } from '@/components/ui/opponent-crest'
import {
  abbreviateTeamName,
  formatMatchTime,
  formatTOA,
} from '@/lib/format'
import { buildPossessionEdge } from '@/lib/match-recap'

const OUR_ABBREV = 'BGM'

const CARD_STYLES: Record<MatchResult, { bg: string; border: string; hoverBorder: string }> = {
  WIN: {
    bg: 'bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.10),transparent_50%),linear-gradient(180deg,rgba(13,20,15,0.99),rgba(10,10,10,1))]',
    border: 'border-emerald-900/50',
    hoverBorder: 'hover:border-emerald-700/50',
  },
  LOSS: {
    bg: 'bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.07),transparent_50%),linear-gradient(180deg,rgba(18,13,13,0.99),rgba(10,10,10,1))]',
    border: 'border-rose-900/40',
    hoverBorder: 'hover:border-rose-800/50',
  },
  OTL: {
    bg: 'bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.10),transparent_45%),linear-gradient(180deg,rgba(20,18,14,0.99),rgba(10,10,10,1))]',
    border: 'border-amber-900/40',
    hoverBorder: 'hover:border-amber-800/60',
  },
  DNF: {
    bg: 'bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.07),transparent_50%),linear-gradient(180deg,rgba(18,13,13,0.99),rgba(10,10,10,1))]',
    border: 'border-rose-900/40',
    hoverBorder: 'hover:border-rose-800/50',
  },
}

const RESULT_PILL_CONFIG: Record<MatchResult, { label: string; className: string }> = {
  WIN: {
    label: 'WIN',
    className: 'border-emerald-500/50 bg-emerald-900/30 text-emerald-400',
  },
  LOSS: {
    label: 'LOSS',
    className: 'border-rose-600/50 bg-rose-900/20 text-rose-400',
  },
  OTL: {
    label: 'OTL',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
  DNF: {
    label: 'DNF Loss',
    className: 'border-rose-600/50 bg-rose-900/20 text-rose-400',
  },
}

const GAME_MODE_PILL: Record<string, string> = {
  '6s': 'border-violet-500/80 bg-violet-950/50 text-violet-300',
  '3s': 'border-sky-600/50 bg-sky-900/30 text-sky-400',
}

interface ScoreCardProps {
  match: Match
  opponentCrestAssetId: string | null
  opponentCrestUseBaseAsset: string | null
}

function ResultPill({ result }: { result: MatchResult }) {
  const config = RESULT_PILL_CONFIG[result]
  return (
    <span
      className={`inline-flex items-center rounded border px-3 py-1 font-condensed text-xs font-bold uppercase tracking-[0.2em] ${config.className}`}
    >
      {config.label}
    </span>
  )
}

function SnapStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
        {label}
      </span>
      <span className="font-condensed text-sm font-bold tabular-nums text-zinc-300">{value}</span>
    </div>
  )
}

function DtWStat({ bgmRaw }: { bgmRaw: number | null }) {
  const color =
    bgmRaw === null ? 'text-zinc-600' :
    bgmRaw >= 60 ? 'text-teal-400' :
    bgmRaw >= 52 ? 'text-emerald-400' :
    bgmRaw >= 45 ? 'text-amber-400' :
    'text-rose-400'
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">DtW</span>
      <span className={`font-condensed text-sm font-bold tabular-nums ${color}`}>
        {bgmRaw !== null ? bgmRaw.toFixed(1) : '—'}
      </span>
    </div>
  )
}

/** Two-tone us/them stat — our number bright, opponent number dimmed. */
function SplitStat({ label, us, them }: { label: string; us: string; them: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
        {label}
      </span>
      <span className="font-condensed text-sm tabular-nums">
        <span className="font-black text-zinc-100">{us}</span>
        <span className="font-medium text-zinc-600">–{them}</span>
      </span>
    </div>
  )
}

export function ScoreCard({
  match,
  opponentCrestAssetId,
  opponentCrestUseBaseAsset,
}: ScoreCardProps) {
  const opponentAbbrev = abbreviateTeamName(match.opponentName)
  const cardStyles = CARD_STYLES[match.result]

  const ourScoreColor =
    match.result === 'WIN' ? 'text-zinc-50' :
    match.result === 'OTL' ? 'text-zinc-400' :
    'text-zinc-500'
  const opponentScoreColor =
    match.result === 'WIN' ? 'text-zinc-600' :
    match.result === 'OTL' ? 'text-zinc-200' :
    'text-zinc-50'

  const toa = match.timeOnAttack !== null ? formatTOA(match.timeOnAttack) : null

  const possEdge = buildPossessionEdge(match)
  const dtw = possEdge !== null ? possEdge.bgmRaw : null

  const isPrivate = match.matchType === 'club_private'
  const totalShots = match.shotsFor + match.shotsAgainst
  const shotShare = totalShots > 0 ? match.shotsFor / totalShots : null
  // Quality pill is suppressed on DNF — stats are incomplete/misleading
  const qualityLabel =
    match.result !== 'DNF' && shotShare !== null && shotShare >= 0.65 ? 'Dominated' :
    match.result !== 'DNF' && shotShare !== null && shotShare <= 0.35 ? 'Outshot' :
    null

  const topBarColor =
    match.result === 'WIN' ? 'bg-emerald-500' :
    match.result === 'OTL' ? 'bg-amber-500/80' :
    'bg-rose-600'

  const gameModeClass = match.gameMode !== null
    ? (GAME_MODE_PILL[match.gameMode] ?? 'border-zinc-700 bg-zinc-900/70 text-zinc-400')
    : null

  return (
    <Link
      href={`/games/${match.id.toString()}`}
      className={`group block overflow-hidden border ${cardStyles.border} ${cardStyles.bg} transition-[border-color,transform] hover:-translate-y-0.5 ${cardStyles.hoverBorder}`}
    >
      <div className={`h-1 w-full ${topBarColor}`} />

      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-1.5">
          {gameModeClass !== null && (
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${gameModeClass}`}>
              {match.gameMode}
            </span>
          )}
          {isPrivate && (
            <span className="rounded-full border border-zinc-600/50 bg-zinc-800/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
              Private
            </span>
          )}
          {qualityLabel !== null && (
            <span
              className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                qualityLabel === 'Dominated'
                  ? 'border-emerald-600/50 bg-emerald-900/30 text-emerald-400'
                  : 'border-rose-700/50 bg-rose-900/20 text-rose-400'
              }`}
            >
              {qualityLabel}
            </span>
          )}
        </div>
        <span className="text-xs text-zinc-600">{formatMatchTime(match.playedAt)}</span>
      </div>

      <div className="px-4 pb-5">
        <p className="truncate font-condensed text-xl font-bold uppercase tracking-[0.08em] text-zinc-100">
          vs {match.opponentName}
        </p>

        <div className="mt-5 grid grid-cols-[56px_minmax(0,1fr)_56px] items-center gap-4">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/50">
              <Image
                src="/images/bgm-logo.png"
                alt="Boogeymen"
                width={40}
                height={40}
                className="h-10 w-10 object-contain opacity-80"
              />
            </div>
            <span className="font-condensed text-base font-black uppercase tracking-[0.1em] text-zinc-200">
              {OUR_ABBREV}
            </span>
          </div>

          <div className="flex min-w-0 flex-col items-center gap-3 text-center">
            <div className="flex items-end justify-center gap-2 font-condensed font-black tabular-nums leading-none">
              <span className={`text-5xl ${ourScoreColor}`}>{match.scoreFor.toString()}</span>
              <span className="pb-1 text-2xl text-zinc-700">-</span>
              <span className={`text-5xl ${opponentScoreColor}`}>{match.scoreAgainst.toString()}</span>
            </div>
            <ResultPill result={match.result} />
          </div>

          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/50">
              <OpponentCrest
                crestAssetId={opponentCrestAssetId}
                useBaseAsset={opponentCrestUseBaseAsset}
                alt={match.opponentName}
                width={40}
                height={40}
                className="h-10 w-10 object-contain"
                fallback={
                  <span
                    aria-hidden
                    className="font-condensed text-lg font-black uppercase tracking-tight text-zinc-400"
                  >
                    {opponentAbbrev.slice(0, 2)}
                  </span>
                }
              />
            </div>
            <span className="font-condensed text-base font-black uppercase tracking-[0.1em] text-zinc-200">
              {opponentAbbrev}
            </span>
          </div>
        </div>

        {/* Stat row: SOG · TOA · Hits · DtW */}
        <div className="mt-4 flex items-start justify-between border-t border-zinc-800/70 pt-3">
          <SplitStat
            label="SOG"
            us={match.shotsFor.toString()}
            them={match.shotsAgainst.toString()}
          />
          <SnapStat label="TOA" value={toa ?? '—'} />
          <SplitStat
            label="Hits"
            us={match.hitsFor.toString()}
            them={match.hitsAgainst.toString()}
          />
          <DtWStat bgmRaw={dtw} />
        </div>
      </div>
    </Link>
  )
}
