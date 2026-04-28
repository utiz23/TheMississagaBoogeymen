import Link from 'next/link'
import Image from 'next/image'
import type { getRoster } from '@eanhl/db/queries'
import { formatPositionFull } from '@/lib/format'

export type RosterRow = Awaited<ReturnType<typeof getRoster>>[number]

interface PlayerCardProps {
  player: RosterRow
  /**
   * True when this card is the active/center card in the carousel.
   * Adds a glow shadow and accent border treatment.
   */
  isActive?: boolean
  /**
   * Club win% string (e.g. "54.2%") sourced from club aggregate stats.
   * Shown as the supporting line in zone A. Undefined renders "—".
   */
  winPct?: string | undefined
}

/**
 * Player card.
 *
 * Structure:
 *   Outer shell  bg-zinc-950, rounded-2xl
 *   ├─ Accent bar     absolute top-0 full-width z-30
 *   ├─ A block        absolute top-left z-20, bg-zinc-950 (matches shell)
 *   ├─ Top panel      mx-2 mt-2 rounded-2xl bg-zinc-900 — portrait + identity row
 *   └─ Stats panel    mx-2 mb-2 mt-1.5 rounded-2xl bg-zinc-900 — E–H + I–J
 *
 * Goalie detection: position === 'goalie' (wins can be 0, not null, for non-goalies).
 * H (PTS / W) is always the StatBoxFeatured tile — accent tint, larger value.
 */
export function PlayerCard({ player, isActive = false, winPct }: PlayerCardProps) {
  const isGoalie = player.position === 'goalie'
  const posLabel = player.position ? formatPositionFull(player.position) : null

  // Zone A — win% line: personal for goalies when data exists, club win% otherwise
  const displayWinPct: string =
    isGoalie && player.wins !== null && player.losses !== null && player.wins + player.losses > 0
      ? `${((player.wins / (player.wins + player.losses)) * 100).toFixed(0)}%`
      : (winPct ?? '—')

  return (
    <Link
      href={`/roster/${player.playerId.toString()}`}
      className={[
        'group relative block w-56 overflow-hidden rounded-2xl border bg-zinc-950 transition-all duration-300',
        isActive
          ? 'border-zinc-600 shadow-[0_0_28px_rgba(225,29,72,0.20)]'
          : 'border-zinc-800 hover:-translate-y-1 hover:border-zinc-600 hover:shadow-[0_0_32px_rgba(225,29,72,0.22)]',
      ].join(' ')}
    >
      {/* ── Accent top bar — spans full card width, above everything ────── */}
      <div
        className={[
          'absolute inset-x-0 top-0 z-30 h-1 transition-colors',
          isActive ? 'bg-accent' : 'bg-zinc-800 group-hover:bg-accent',
        ].join(' ')}
      />

      {/* ── A — flush top-left on card shell, no visible box ────────────── */}
      <div className="absolute left-0 top-0 z-20 flex w-[72px] flex-col rounded-br-2xl bg-zinc-950 px-3 pb-3 pt-4">
        {/* Jersey number placeholder — data not yet in source */}
        <div
          className={[
            'font-condensed text-[32px] font-black leading-none',
            isActive ? 'text-zinc-400' : 'text-zinc-600',
          ].join(' ')}
        >
          ##
        </div>

        {/* Position pill */}
        {posLabel !== null ? (
          <span className="mt-1 inline-flex items-center rounded-sm bg-zinc-800 px-1.5 py-0.5 font-condensed text-[9px] font-bold uppercase tracking-widest text-zinc-400">
            {posLabel}
          </span>
        ) : (
          <span className="mt-1 inline-block h-2.5 w-7 rounded bg-zinc-800" />
        )}

        {/* W–L–OTL record */}
        <div className="mt-1.5 font-condensed text-[10px] font-semibold leading-none text-zinc-500">
          {isGoalie && player.wins !== null && player.losses !== null
            ? `${player.wins.toString()}–${player.losses.toString()}–—`
            : '—–—–—'}
        </div>

        <div className="mt-1.5 font-condensed text-[11px] font-bold leading-none text-zinc-300">
          {displayWinPct}
        </div>
      </div>

      {/* ── TOP PANEL — one grey container: portrait (B) + identity row (C+D) */}
      <div className="relative mx-2 mt-2 overflow-hidden rounded-2xl bg-zinc-900">
        {/* B — Portrait / silhouette area */}
        <div className="relative flex h-[162px] items-end justify-center">
          <PlayerSilhouette className="text-zinc-800" />
        </div>

        {/* C + D — Identity row inside the top panel */}
        <div className="flex items-center justify-center gap-2 border-t border-zinc-800/60 px-3 py-2">
          {/* C — Platform placeholder */}
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-zinc-700 bg-zinc-800/80 text-zinc-500">
            <ControllerIcon />
          </div>
          {/* D — Gamertag */}
          <span className="truncate font-condensed text-base font-black uppercase tracking-wide text-zinc-100 group-hover:text-zinc-50">
            {player.gamertag}
          </span>
        </div>
      </div>

      {/* ── STATS PANEL — E–H (stats) + I–J (meta) ───────────────────────── */}
      <div className="mx-2 mb-2 mt-1.5 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-2">
        {/* E–H: role-gated stats. H (PTS / W) is always the featured tile. */}
        <div className="grid grid-cols-4 gap-1">
          <StatBox label="GP" value={(isGoalie ? player.goalieGp : player.skaterGp).toString()} />
          {isGoalie ? (
            <>
              <StatBox label="SV%" value={player.savePct ?? '—'} />
              <StatBox label="GAA" value={player.gaa ?? '—'} />
              <StatBoxFeatured label="W" value={player.wins?.toString() ?? '—'} />
            </>
          ) : (
            <>
              <StatBox label="G" value={player.goals.toString()} />
              <StatBox label="A" value={player.assists.toString()} />
              <StatBoxFeatured label="PTS" value={player.points.toString()} />
            </>
          )}
        </div>

        {/* I–K: meta row — I (flag), J (team logo), K (reserved) */}
        <div className="mt-2 grid grid-cols-3 gap-2">
          {/* I — Country flag placeholder */}
          <div className="flex h-[40px] items-center justify-center rounded-lg border border-zinc-700/60 bg-zinc-800/40">
            <FlagIcon className="text-zinc-600" />
          </div>
          {/* J — Team logo */}
          <div className="flex h-[40px] items-center justify-center overflow-hidden rounded-lg border border-zinc-700/60 bg-zinc-800/40">
            <Image
              src="/images/bgm-logo.png"
              alt="BGM"
              width={24}
              height={24}
              className="object-contain opacity-60"
            />
          </div>
          {/* K — reserved for future content */}
          <div />
        </div>
      </div>
    </Link>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface StatBoxProps {
  label: string
  value: string
}

/** Standard stat tile (E, F, G). */
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

/**
 * Featured stat tile (H — PTS / W).
 * Accent tint background + larger value text — permanently distinct.
 */
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
      {/* Head */}
      <circle cx="50" cy="32" r="21" />
      {/* Body arc */}
      <path d="M 8 110 Q 8 66 50 66 Q 92 66 92 110 Z" />
    </svg>
  )
}

function ControllerIcon() {
  return (
    <svg viewBox="0 0 14 10" fill="currentColor" className="h-2.5 w-2.5" aria-hidden>
      <rect
        x="1"
        y="1"
        width="12"
        height="8"
        rx="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <rect x="3.5" y="4" width="1.2" height="3" rx="0.5" />
      <rect x="2.9" y="4.6" width="2.4" height="1.2" rx="0.5" />
      <circle cx="9.5" cy="4.5" r="0.8" />
      <circle cx="11" cy="5.8" r="0.8" />
    </svg>
  )
}

function FlagIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 10" fill="none" className={`h-3 w-3.5 ${className}`} aria-hidden>
      <rect x="0.5" y="0.5" width="13" height="9" rx="1" stroke="currentColor" strokeWidth="1" />
      <line x1="0.5" y1="3.5" x2="13.5" y2="3.5" stroke="currentColor" strokeWidth="0.8" />
      <line x1="0.5" y1="6.5" x2="13.5" y2="6.5" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  )
}
