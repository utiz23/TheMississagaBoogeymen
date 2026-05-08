import Image from 'next/image'
import type { Match } from '@eanhl/db'
import { OpponentCrest } from '@/components/ui/opponent-crest'
import { ResultPill } from '@/components/ui/result-pill'
import { abbreviateTeamName, formatMatchDate, formatMatchTime } from '@/lib/format'

const OUR_ABBREV = 'BGM'

interface HeroCardProps {
  match: Match
  opponentCrestAssetId: string | null
  opponentCrestUseBaseAsset: string | null
  /** Optional context line bits — rendered as middots if any are present. */
  meta: {
    seasonNumber: number | null
    meetingNumber: number | null
    seriesSummary: string | null
  }
}

// Result-themed surfaces — restored from pre-renovation visual after user
// feedback. Typography, sizing, and the design-system <ResultPill> primitive
// stay from the renovation; the surface decoration goes back to per-result
// gradient + solid-color top bar.
const CARD_BG: Record<Match['result'], string> = {
  WIN: 'bg-[radial-gradient(circle_at_top,rgba(225,29,72,0.22),transparent_55%),linear-gradient(180deg,rgba(26,20,20,0.99),rgba(10,10,10,1))]',
  LOSS: 'bg-[linear-gradient(180deg,rgba(15,15,18,0.99),rgba(9,9,11,1))]',
  OTL: 'bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.10),transparent_50%),linear-gradient(180deg,rgba(20,18,14,0.99),rgba(10,10,10,1))]',
  DNF: 'bg-[linear-gradient(180deg,rgba(13,13,15,0.99),rgba(9,9,11,1))]',
}

const TOP_BAR: Record<Match['result'], string> = {
  WIN: 'bg-accent',
  LOSS: 'bg-zinc-700',
  OTL: 'bg-amber-500/80',
  DNF: 'bg-zinc-800',
}

export function HeroCard({
  match,
  opponentCrestAssetId,
  opponentCrestUseBaseAsset,
  meta,
}: HeroCardProps) {
  const opponentAbbrev = abbreviateTeamName(match.opponentName)

  const ourScoreColor =
    match.result === 'WIN'
      ? 'text-zinc-50'
      : match.result === 'OTL'
        ? 'text-zinc-400'
        : match.result === 'DNF'
          ? 'text-zinc-700'
          : 'text-zinc-500'
  const opponentScoreColor =
    match.result === 'WIN'
      ? 'text-zinc-600'
      : match.result === 'OTL'
        ? 'text-zinc-200'
        : match.result === 'DNF'
          ? 'text-zinc-700'
          : 'text-zinc-50'

  const metaParts: string[] = [formatMatchDate(match.playedAt), formatMatchTime(match.playedAt)]
  if (match.gameMode) metaParts.push(match.gameMode)
  if (meta.seasonNumber !== null) metaParts.push(`Game ${meta.seasonNumber.toString()}`)

  const meetingLine = meta.seriesSummary

  return (
    <div className={`overflow-hidden border border-zinc-800 ${CARD_BG[match.result]}`}>
      <div className={`h-1 w-full ${TOP_BAR[match.result]}`} />

      <div className="px-4 py-6 sm:px-8 sm:py-8">
        {/* Top row — date / mode / game-number meta strip */}
        <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 font-condensed text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">
          {metaParts.map((part, i) => (
            <span key={part} className="flex items-center gap-3">
              {i > 0 ? (
                <span aria-hidden className="text-zinc-700">
                  ·
                </span>
              ) : null}
              <span className={i === 2 ? 'text-zinc-300' : ''}>{part}</span>
            </span>
          ))}
        </div>

        {/* Scoreboard row — BGM | score | opponent */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
          {/* BGM side */}
          <TeamSide
            crest={
              <Image
                src="/images/bgm-logo.png"
                alt="BGM"
                width={64}
                height={64}
                className="h-14 w-14 sm:h-16 sm:w-16 object-contain"
              />
            }
            abbrev={OUR_ABBREV}
            name="Boogeymen"
          />

          {/* Score */}
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-baseline gap-2 font-condensed font-black tabular-nums leading-none">
              <span className={`text-5xl sm:text-7xl ${ourScoreColor}`}>
                {match.scoreFor.toString()}
              </span>
              <span className="pb-1 text-2xl text-zinc-700">–</span>
              <span className={`text-5xl sm:text-7xl ${opponentScoreColor}`}>
                {match.scoreAgainst.toString()}
              </span>
            </div>
            <ResultPill result={match.result} size="md" />
          </div>

          {/* Opponent side */}
          <TeamSide
            crest={
              <div className="flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center overflow-hidden rounded-full border border-zinc-800 bg-zinc-950/60">
                <OpponentCrest
                  crestAssetId={opponentCrestAssetId}
                  useBaseAsset={opponentCrestUseBaseAsset}
                  alt={match.opponentName}
                  width={56}
                  height={56}
                  className="h-12 w-12 sm:h-14 sm:w-14 object-contain"
                  fallback={
                    <span
                      aria-hidden
                      className="font-condensed text-base font-black uppercase tracking-tight text-zinc-400"
                    >
                      {opponentAbbrev.slice(0, 2)}
                    </span>
                  }
                />
              </div>
            }
            abbrev={opponentAbbrev}
            name={match.opponentName}
          />
        </div>

        {/* Meeting / series context */}
        {meetingLine !== null && meta.meetingNumber !== null ? (
          <div className="mt-6 flex items-center justify-center font-condensed text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
            <span>{meetingLine}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function TeamSide({
  crest,
  abbrev,
  name,
}: {
  crest: React.ReactNode
  abbrev: string
  name: string
}) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      {crest}
      <div className="flex flex-col items-center gap-0.5">
        <span className="font-condensed text-base sm:text-lg font-black uppercase tracking-[0.1em] text-zinc-100">
          {abbrev}
        </span>
        <span className="hidden sm:block max-w-[10rem] truncate font-condensed text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {name}
        </span>
      </div>
    </div>
  )
}
