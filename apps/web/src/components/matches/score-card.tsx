import Link from 'next/link'
import Image from 'next/image'
import type { Match } from '@eanhl/db'
import { OpponentCrest } from '@/components/ui/opponent-crest'
import { Panel } from '@/components/ui/panel'
import { ResultPill } from '@/components/ui/result-pill'
import {
  abbreviateTeamName,
  formatMatchTime,
  formatTOA,
} from '@/lib/format'
import { buildPossessionEdge } from '@/lib/match-recap'

const OUR_ABBREV = 'BGM'

const GAME_MODE_PILL: Record<string, string> = {
  '6s': 'border-violet-500/80 bg-violet-950/50 text-violet-300',
  '3s': 'border-sky-600/50 bg-sky-900/30 text-sky-400',
}

interface ScoreCardProps {
  match: Match
  opponentCrestAssetId: string | null
  opponentCrestUseBaseAsset: string | null
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

  const gameModeClass = match.gameMode !== null
    ? (GAME_MODE_PILL[match.gameMode] ?? 'border-zinc-700 bg-zinc-900/70 text-zinc-400')
    : null

  return (
    <Link
      href={`/games/${match.id.toString()}`}
      className="group block transition-transform hover:-translate-y-0.5"
    >
      <Panel hoverable className="overflow-hidden">
      <div className="h-[3px] w-full bg-gradient-to-r from-rose-900 via-accent to-rose-900" />

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
            <ResultPill result={match.result} size="sm" />
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
      </Panel>
    </Link>
  )
}
