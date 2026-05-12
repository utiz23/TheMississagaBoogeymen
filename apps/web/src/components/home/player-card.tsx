import Link from 'next/link'
import Image from 'next/image'
import type { getRoster } from '@eanhl/db/queries'
import { formatPosition } from '@/lib/format'
import { NationalityFlag, PlatformIcon } from '@/components/player-meta-icons'
import './player-card.css'

export type RosterRow = Awaited<ReturnType<typeof getRoster>>[number]

/**
 * Structural shape required by `PlayerCard`. Both `getRoster` (home) and
 * `getEARoster` (depth chart) return rows that satisfy this — accepting it
 * as a structural type lets the same card render in both contexts.
 */
export interface PlayerCardData {
  playerId: number
  gamertag: string
  jerseyNumber: number | null
  playerName: string | null
  clientPlatform: string | null
  nationality: string | null
  position: string | null
  favoritePosition: string | null
  preferredPosition: string | null
  skaterWins: number | null
  skaterLosses: number | null
  skaterOtl: number | null
  goalieWins: number | null
  goalieLosses: number | null
  goalieOtl: number | null
  skaterGp: number
  goalieGp: number
  goals: number
  assists: number
  points: number
  savePct: string | null
  gaa: string | null
  archetype?: string | null
}

interface PlayerCardProps {
  player: PlayerCardData
  /**
   * True when this card is the active/center card in the carousel.
   * Activates the red top rule (otherwise dim grey at rest).
   */
  isActive?: boolean
  /**
   * True when the card represents a depth/reused slot in a depth chart.
   * Renders an amber outline + "DEPTH" pill in the top-right corner.
   */
  depth?: boolean
}

/**
 * Player card — refined-baseline port from the design bundle's
 * `components-card-carousel-v3.html` / `components-player-card.html`.
 *
 * Layout (top to bottom):
 *   ─ red top rule (3px) — grey at rest, accent on hover/active
 *   ─ jersey block (top-left, 88px wide, on #0a0a0a):
 *       number · position pill · record · win%
 *   ─ portrait area (silhouette + scan-line overlay)
 *   ─ name row (platform glyph + gamertag)
 *   ─ stats grid (4 cells, last cell `lead` styled accent)
 *   ─ identity row (flag · crest · spare)
 */
export function PlayerCard({ player, isActive = false, depth = false }: PlayerCardProps) {
  const effectivePosition = player.preferredPosition ?? player.favoritePosition ?? player.position
  const isGoalie = effectivePosition === 'goalie'
  const posLabel = effectivePosition ? formatPosition(effectivePosition) : null
  const posClass = effectivePosition !== null ? positionClass(effectivePosition) : null

  // Jersey area: record + win%. Use the role's W-L-OTL.
  const eaW = isGoalie ? player.goalieWins : player.skaterWins
  const eaL = isGoalie ? player.goalieLosses : player.skaterLosses
  const eaOtl = isGoalie ? player.goalieOtl : player.skaterOtl
  const recordLine =
    eaW !== null && eaL !== null
      ? `${eaW.toString()}–${eaL.toString()}–${eaOtl !== null ? eaOtl.toString() : '0'}`
      : '—'
  const eaGames = (eaW ?? 0) + (eaL ?? 0) + (eaOtl ?? 0)
  const winPct =
    eaW !== null && eaL !== null && eaGames > 0
      ? `${((eaW / eaGames) * 100).toFixed(0)}% Win`
      : '—'

  // Stats row — role-gated. Last cell is the `lead` (accent-colored) stat.
  const statCells: Array<{ label: string; value: string; lead?: boolean }> = isGoalie
    ? [
        { label: 'GP', value: player.goalieGp.toString() },
        { label: 'SV%', value: player.savePct ?? '—' },
        { label: 'GAA', value: player.gaa ?? '—' },
        { label: 'W', value: player.goalieWins?.toString() ?? '—', lead: true },
      ]
    : [
        { label: 'GP', value: player.skaterGp.toString() },
        { label: 'G', value: player.goals.toString() },
        { label: 'A', value: player.assists.toString() },
        { label: 'PTS', value: player.points.toString(), lead: true },
      ]

  const classNames = ['hpc']
  if (isActive) classNames.push('hpc-active')
  if (depth) classNames.push('hpc-depth')

  return (
    <Link
      href={`/roster/${player.playerId.toString()}`}
      className={classNames.join(' ')}
      aria-label={`Show ${player.gamertag}`}
    >
      {depth ? <span className="hpc-depth-pill">DEPTH</span> : null}
      <div className="hpc-jersey">
        <span className="num">
          {player.jerseyNumber !== null ? player.jerseyNumber.toString() : '##'}
        </span>
        {posLabel !== null && (
          <span className={`pos${posClass !== null ? ` ${posClass}` : ''}`}>{posLabel}</span>
        )}
        <span className="rec">{recordLine}</span>
        <span className="pct">{winPct}</span>
      </div>

      <div className="hpc-portrait">
        <svg
          className="silh"
          viewBox="0 0 100 110"
          fill="currentColor"
          preserveAspectRatio="xMidYMax meet"
          aria-hidden
        >
          <circle cx="50" cy="32" r="21" />
          <path d="M 8 110 Q 8 66 50 66 Q 92 66 92 110 Z" />
        </svg>
        <div className="scan" aria-hidden />
      </div>

      <div className="hpc-name">
        <span className="platform" aria-hidden>
          <PlatformIcon platform={player.clientPlatform ?? null} />
        </span>
        <span
          className="gamertag"
          title={player.playerName ?? player.gamertag}
        >
          {player.playerName ?? player.gamertag}
        </span>
      </div>

      <div className="hpc-stats">
        {statCells.map((s) => (
          <div key={s.label} className={`s${s.lead === true ? ' lead' : ''}`}>
            <span className="l">{s.label}</span>
            <span className="v">{s.value}</span>
          </div>
        ))}
      </div>

      <div className="hpc-identity">
        <div className="cell flag">
          {player.nationality !== null ? <NationalityFlag code={player.nationality} /> : null}
        </div>
        <div className="cell crest">
          <Image
            src="/images/bgm-logo.png"
            alt="BGM"
            width={52}
            height={52}
          />
        </div>
        <div className="cell" aria-hidden />
      </div>
    </Link>
  )
}

/**
 * Map a position string to its bundle position-class. Mirrors the
 * docs/specs/position-colors.md palette — leftDefenseMen / rightDefenseMen
 * get distinct colors; generic defenseMen falls back to LD per spec.
 */
function positionClass(pos: string): string | null {
  switch (pos) {
    case 'center':
      return 'pos-c'
    case 'leftWing':
      return 'pos-lw'
    case 'rightWing':
      return 'pos-rw'
    case 'leftDefenseMen':
      return 'pos-ld'
    case 'rightDefenseMen':
      return 'pos-rd'
    case 'defenseMen':
      return 'pos-d'
    case 'goalie':
      return 'pos-g'
    default:
      return null
  }
}

/* ─── Re-exports for backward compat with existing consumers ────────────── */

interface StatBoxProps {
  label: string
  value: string
}

/** Standard stat tile (used by depth-chart, NOT by the carousel card). */
export function StatBox({ label, value }: StatBoxProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg border border-zinc-700/50 bg-zinc-800/50 py-1.5">
      <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-500">{label}</span>
      <span className="font-condensed text-[13px] font-black leading-none tabular text-zinc-200">
        {value}
      </span>
    </div>
  )
}

/** Featured stat tile — accent variant of StatBox. Used by depth-chart. */
export function StatBoxFeatured({ label, value }: StatBoxProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg border border-accent/30 bg-accent/10 py-1.5">
      <span className="text-[8px] font-bold uppercase tracking-widest text-accent/60">{label}</span>
      <span className="font-condensed text-[15px] font-black leading-none tabular text-accent">
        {value}
      </span>
    </div>
  )
}

export function PlayerSilhouette({
  className = '',
  sizeClass = 'h-[110px] w-[110px]',
}: {
  className?: string
  sizeClass?: string
}) {
  return (
    <svg
      viewBox="0 0 100 110"
      fill="currentColor"
      className={`${sizeClass} ${className}`}
      aria-hidden
    >
      <circle cx="50" cy="32" r="21" />
      <path d="M 8 110 Q 8 66 50 66 Q 92 66 92 110 Z" />
    </svg>
  )
}
