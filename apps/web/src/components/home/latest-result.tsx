import Link from 'next/link'
import Image from 'next/image'
import type { Match, MatchType } from '@eanhl/db'
import {
  formatMatchDate,
  formatMatchTime,
  formatRecord,
  abbreviateTeamName,
  formatTOA,
} from '@/lib/format'
import { OpponentCrest } from '@/components/ui/opponent-crest'
import { ResultPill } from '@/components/ui/result-pill'
import { DtwChip } from '@/components/home/dtw-chip'
import { buildPossessionEdge } from '@/lib/match-recap'

const OUR_NAME = 'Boogeymen'

const MATCH_TYPE_LABEL: Record<MatchType, string> = {
  // gameType5 / gameType10 are EA's competitive club-match codes (rank-counting).
  // Both render as "Club Match" — the gameMode field already disambiguates 6s vs 3s.
  gameType5: 'Club Match',
  gameType10: 'Club Match',
  club_private: 'Private Match',
}

interface LatestResultProps {
  match: Match
  clubRecord: { wins: number; losses: number; otl: number } | null
  /** EA crest asset ID for the opponent club. Null falls back to initial badge. */
  opponentCrestAssetId: string | null
  /** EA customKit.useBaseAsset flag for the opponent crest. */
  opponentCrestUseBaseAsset: string | null
  /** Aggregated faceoff totals + max player TOI for this match (used for OT detection). */
  faceoffs: {
    ourWins: number
    ourLosses: number
    oppWins: number
    oppLosses: number
    maxToiSeconds: number
  } | null
  /** Current season division placement (from EA clubs/seasonRank). */
  divisionName: string | null
}

export function LatestResult({
  match,
  clubRecord,
  opponentCrestAssetId,
  opponentCrestUseBaseAsset,
  faceoffs,
  divisionName,
}: LatestResultProps) {
  const opponentAbbrev = abbreviateTeamName(match.opponentName)
  const matchTypeLabel = MATCH_TYPE_LABEL[match.matchType]
  const edge = buildPossessionEdge(match)
  // OT detection — regulation is 60 minutes total ice time. If any player on
  // either side logged > 3600 seconds, the game went to overtime.
  const wentToOvertime = faceoffs !== null && faceoffs.maxToiSeconds > 3600
  const metaParts: string[] = []
  if (match.gameMode !== null) metaParts.push(match.gameMode.toUpperCase())
  metaParts.push(matchTypeLabel)

  return (
    <Link
      href={`/games/${match.id.toString()}`}
      className="group block transition-transform hover:-translate-y-0.5"
    >
      <p className="mb-3 font-condensed text-[11px] font-bold uppercase tracking-[0.28em] text-fg-4">
        Latest Game
      </p>
      <div
        className="relative overflow-hidden border border-border"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(232,65,49,0.20), transparent 55%), linear-gradient(180deg, rgba(50,48,49,0.96), rgba(26,24,25,0.99))',
        }}
      >
        {/* Top red ticker */}
        <div
          aria-hidden
          className="h-1 w-full"
          style={{
            background:
              'linear-gradient(90deg, rgba(120,30,22,1) 0%, rgba(232,65,49,0.95) 50%, rgba(120,30,22,1) 100%)',
          }}
        />

        {/* Status row: FINAL pill + meta + date/time */}
        <div className="flex items-center justify-between border-b border-border/60 bg-background/40 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-accent/45 bg-accent/[0.12] px-2 py-[3px] font-condensed text-[10px] font-extrabold uppercase tracking-[0.22em] text-accent">
              <span
                aria-hidden
                className="h-[5px] w-[5px] animate-pulse rounded-full bg-accent"
                style={{ boxShadow: '0 0 8px rgba(232,65,49,0.8)' }}
              />
              Final
            </span>
            <span className="font-condensed text-[10.5px] font-bold uppercase tracking-[0.22em] text-fg-3">
              {metaParts.join(' · ')}
            </span>
          </div>
          <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-fg-4">
            {formatMatchDate(match.playedAt)} · {formatMatchTime(match.playedAt)}
          </span>
        </div>

        {/* Body: team | center | team */}
        <div className="grid grid-cols-1 items-center gap-5 px-7 py-6 sm:grid-cols-[1fr_auto_1fr] sm:gap-x-3.5">
          {/* Our side */}
          <TeamSide isUs name={OUR_NAME} record={clubRecord} placement={divisionName}>
            <Image
              src="/images/bgm-logo.png"
              alt="Boogeymen"
              width={64}
              height={64}
              className="h-14 w-14 object-contain"
            />
          </TeamSide>

          {/* Center */}
          <div className="flex min-w-[280px] flex-col items-center gap-3">
            <div className="flex items-end gap-3.5 font-condensed font-black leading-[0.85] tabular-nums">
              <span
                className="text-[5rem] sm:text-[6rem] text-fg-1"
                style={{ textShadow: '0 0 18px rgba(232,65,49,0.18)' }}
              >
                {match.scoreFor.toString()}
              </span>
              <span className="pb-3 text-5xl text-border-subtle">–</span>
              <span className="text-[5rem] sm:text-[6rem] text-fg-4">
                {match.scoreAgainst.toString()}
              </span>
            </div>
            <ResultPill result={match.result} size="md" />
            <PeriodScores />
            {edge !== null && <DtwChip bgmShare={edge.bgmShare} bgmRaw={edge.bgmRaw} />}
            <span className="font-condensed text-[10.5px] font-semibold uppercase tracking-[0.32em] text-fg-4">
              3 Periods · {wentToOvertime ? 'OT' : 'No OT'}
            </span>
          </div>

          {/* Opponent side */}
          <TeamSide name={match.opponentName} record={null} placement={null}>
            <OpponentCrest
              crestAssetId={opponentCrestAssetId}
              useBaseAsset={opponentCrestUseBaseAsset}
              alt={match.opponentName}
              width={64}
              height={64}
              className="h-14 w-14 object-contain"
              fallback={
                <span
                  aria-hidden
                  className="font-condensed text-2xl font-black uppercase tracking-tight text-fg-3"
                >
                  {opponentAbbrev.slice(0, 2)}
                </span>
              }
            />
          </TeamSide>
        </div>

        {/* Bottom 4-cell stat strip */}
        <StatStrip match={match} faceoffs={faceoffs} />
      </div>
    </Link>
  )
}

function TeamSide({
  isUs = false,
  name,
  record,
  placement,
  children,
}: {
  isUs?: boolean
  name: string
  record: { wins: number; losses: number; otl: number } | null
  placement: string | null
  children: React.ReactNode
}) {
  // Render the record + placement on a single line (bundle pattern: "14-4-2 · 1ST").
  // Either piece may be missing — emit only what we have.
  const recordLine = record !== null ? formatRecord(record.wins, record.losses, record.otl) : null
  const standingPieces: string[] = []
  if (recordLine !== null) standingPieces.push(recordLine)
  if (placement !== null) standingPieces.push(placement.toUpperCase())

  return (
    <div className="flex flex-col items-center gap-2.5">
      <div
        className="relative flex h-20 w-20 items-center justify-center rounded-full border bg-background/70"
        style={{
          borderColor: isUs ? 'rgba(232,65,49,0.5)' : 'rgba(73,71,72,0.6)',
          background:
            'radial-gradient(circle at 50% 30%, rgba(232,65,49,0.10), transparent 60%), rgba(26,24,25,0.7)',
          boxShadow: isUs ? '0 0 22px rgba(232,65,49,0.18)' : 'none',
        }}
      >
        {children}
      </div>
      <span
        className="font-condensed text-lg font-black uppercase tracking-[0.1em]"
        style={{ color: isUs ? '#ebebeb' : '#d4d2d3' }}
      >
        {isUs ? name : abbreviateTeamName(name)}
      </span>
      {standingPieces.length > 0 && (
        <span className="font-condensed text-[11px] font-semibold uppercase tracking-[0.18em] tabular-nums text-fg-4">
          {standingPieces.join(' · ')}
        </span>
      )}
    </div>
  )
}

function StatStrip({
  match,
  faceoffs,
}: {
  match: Match
  faceoffs: { ourWins: number; ourLosses: number; oppWins: number; oppLosses: number } | null
}) {
  const toa = match.timeOnAttack !== null ? formatTOA(match.timeOnAttack) : null

  // FO% computed from aggregated player_match_stats / opponent_player_match_stats
  // (match.faceoff_pct from EA payloads is null in production).
  const foOurs =
    faceoffs !== null && faceoffs.ourWins + faceoffs.ourLosses > 0
      ? Math.round((faceoffs.ourWins / (faceoffs.ourWins + faceoffs.ourLosses)) * 100).toString()
      : null
  const foTheirs =
    faceoffs !== null && faceoffs.oppWins + faceoffs.oppLosses > 0
      ? Math.round(
          (faceoffs.oppWins / (faceoffs.oppWins + faceoffs.oppLosses)) * 100,
        ).toString()
      : null
  const showFO = foOurs !== null && foTheirs !== null

  // The first stat is highlighted (red) when we lead in shots — small but
  // recognisable broadcast tell. Falls back to neutral when even/behind.
  const shotsDom = match.shotsFor > match.shotsAgainst

  return (
    <div className="grid grid-cols-2 border-t border-border/60 bg-background/50 sm:grid-cols-4">
      <StatCell
        label="Shots"
        a={match.shotsFor.toString()}
        b={match.shotsAgainst.toString()}
        dom={shotsDom}
      />
      <StatCell
        label="Hits"
        a={match.hitsFor.toString()}
        b={match.hitsAgainst.toString()}
      />
      {showFO ? (
        <StatCell label="FO%" a={foOurs} b={foTheirs} />
      ) : (
        <StatCell label="FO%" a="—" b="—" muted />
      )}
      <StatCell label="TOA" a={toa ?? '—'} solo />
    </div>
  )
}

/**
 * Per-period score grid (P1 / P2 / P3). Currently renders blank placeholders —
 * the EA raw payload includes period scores but our pipeline doesn't yet
 * extract them onto the matches table. Shape is in place so wiring is a
 * one-prop change once the schema lands.
 */
function PeriodScores() {
  return (
    <div className="flex items-center gap-2">
      {(['P1', 'P2', 'P3'] as const).map((label) => (
        <div
          key={label}
          className="flex min-w-[36px] flex-col items-center rounded-sm border border-border/50 bg-background/40 px-2.5 py-1"
        >
          <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.18em] text-fg-4">
            {label}
          </span>
          <span className="flex gap-1.5 font-condensed text-[13px] font-extrabold tabular-nums leading-tight">
            <span className="text-fg-1">—</span>
            <span className="text-fg-4">—</span>
          </span>
        </div>
      ))}
    </div>
  )
}

function StatCell({
  label,
  a,
  b,
  dom = false,
  solo = false,
  muted = false,
}: {
  label: string
  a: string
  b?: string
  dom?: boolean
  solo?: boolean
  muted?: boolean
}) {
  return (
    <div className="flex items-center gap-2.5 border-r border-border/40 px-4 py-3 last:border-r-0">
      <span className="min-w-[44px] font-condensed text-[9.5px] font-semibold uppercase tracking-[0.22em] text-fg-4">
        {label}
      </span>
      <span className="flex items-baseline gap-1.5 font-condensed leading-none tabular-nums">
        <span
          className={`text-lg font-black ${
            muted ? 'text-fg-5' : dom ? 'text-accent' : 'text-fg-1'
          }`}
        >
          {a}
        </span>
        {b !== undefined && !solo && (
          <>
            <span className="text-base font-normal text-border-subtle">·</span>
            <span className={`text-base font-bold ${muted ? 'text-fg-5' : 'text-fg-3'}`}>{b}</span>
          </>
        )}
      </span>
    </div>
  )
}
