import Link from 'next/link'
import Image from 'next/image'
import type { getRoster } from '@eanhl/db/queries'
import { formatPosition } from '@/lib/format'

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
   * Jersey number is not yet available in the data source — zone A shows
   * a "#" placeholder until that field is added.
   */
  winPct?: string | undefined
}

/**
 * Blueprint-faithful player card.
 *
 * Zone layout (matches PlayerCardBluePrint_2.png):
 *   TOP SECTION — A (info block, top-left) overlaid on B (silhouette)
 *   IDENTITY ROW — C (platform placeholder) + D (gamertag), centred
 *   STATS PANEL  — E–H (stats row) + I–J (meta row, K reserved)
 *
 * Goalie detection uses position === 'goalie' (not wins !== null — wins can
 * be 0 for non-goalies after aggregation, making the null check unreliable).
 *
 * H (PTS / W) always renders as the featured stat tile regardless of isActive.
 */
export function PlayerCard({ player, isActive = false, winPct }: PlayerCardProps) {
  const isGoalie = player.position === 'goalie'
  const posLabel = player.position ? formatPosition(player.position) : null

  // Zone A — win% display
  // For goalies, prefer personal win% when data exists; otherwise use team win%.
  const displayWinPct: string =
    isGoalie && player.wins !== null && player.losses !== null && player.wins + player.losses > 0
      ? `${((player.wins / (player.wins + player.losses)) * 100).toFixed(0)}%`
      : (winPct ?? '—')

  return (
    <Link
      href={`/roster/${player.playerId.toString()}`}
      className={[
        'group block w-56 overflow-hidden rounded-2xl border bg-zinc-950 transition-all duration-200',
        isActive
          ? 'border-zinc-600 shadow-[0_0_28px_rgba(225,29,72,0.20)]'
          : 'border-zinc-800 hover:border-zinc-600 hover:shadow-[0_0_18px_rgba(225,29,72,0.10)]',
      ].join(' ')}
    >
      {/* ── TOP SECTION: B (silhouette) with A (info) overlaid ──────────── */}
      <div className="relative h-[160px]">
        {/* Accent top bar */}
        <div
          className={[
            'absolute inset-x-0 top-0 h-1 transition-colors',
            isActive ? 'bg-accent' : 'bg-zinc-800 group-hover:bg-accent/50',
          ].join(' ')}
        />

        {/* B — Silhouette (fills the section, bottom-anchored) */}
        <div className="absolute inset-0 flex items-end justify-center overflow-hidden">
          <PlayerSilhouette className="text-zinc-800" />
        </div>

        {/* A — Info block anchored top-left; self-sized via absolute.
            Contents: # placeholder → position badge → win% */}
        <div className="absolute left-2 top-2 z-10 flex w-[62px] flex-col rounded-xl border border-zinc-700 bg-zinc-900/95 p-2">
          {/* Jersey number placeholder — real value not yet in data */}
          <div className="font-condensed text-[28px] font-black leading-none text-zinc-700">#</div>

          {/* Position badge */}
          {posLabel !== null ? (
            <span className="mt-1.5 inline-flex w-fit items-center rounded-full border border-zinc-600 px-1.5 py-0.5 font-condensed text-[9px] font-bold uppercase tracking-wider text-zinc-400">
              {posLabel}
            </span>
          ) : (
            <span className="mt-1.5 inline-block h-3.5 w-8 rounded-full bg-zinc-800" />
          )}

          {/* Win% — team win% for skaters, personal for goalies */}
          <div className="mt-2 font-condensed text-[11px] font-bold leading-none text-zinc-300">
            {displayWinPct}
          </div>
          <div className="text-[7px] uppercase tracking-wider text-zinc-600">WIN%</div>
        </div>
      </div>

      {/* ── C + D: Platform logo + Gamertag — centred across card ───────── */}
      <div className="flex items-center justify-center gap-2 px-3 py-2">
        {/* C — Platform placeholder (no platform field in DB yet) */}
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-zinc-700 bg-zinc-800 text-zinc-600">
          <ControllerIcon />
        </div>
        {/* D — Gamertag */}
        <span className="truncate font-condensed text-base font-black uppercase tracking-wide text-zinc-100 group-hover:text-zinc-50">
          {player.gamertag}
        </span>
      </div>

      {/* ── STATS + META PANEL ───────────────────────────────────────────── */}
      <div className="mx-2 mb-2 rounded-xl border border-zinc-800 bg-zinc-900 p-2">
        {/* E–H: role-gated stats.
            H (PTS for skaters / W for goalies) is always the featured tile. */}
        <div className="grid grid-cols-4 gap-1">
          <StatBox label="GP" value={player.gamesPlayed.toString()} />
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

        {/* I–K: meta row — I (Flag placeholder), J (Team Logo), K (reserved) */}
        <div className="mt-2 grid grid-cols-3 gap-2">
          {/* I — Country flag placeholder (no nationality field in DB yet) */}
          <div className="flex h-[40px] items-center justify-center rounded border border-zinc-700/60 bg-zinc-800/40">
            <FlagIcon className="text-zinc-600" />
          </div>
          {/* J — Team logo */}
          <div className="flex h-[40px] items-center justify-center overflow-hidden rounded border border-zinc-700/60 bg-zinc-800/40">
            <Image
              src="/images/bgm-logo.png"
              alt="BGM"
              width={24}
              height={24}
              className="object-contain opacity-60"
            />
          </div>
          {/* K — reserved for future content; intentionally empty */}
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
function StatBox({ label, value }: StatBoxProps) {
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
 * Always rendered with an accent tint background and larger value text
 * to communicate it is the headline number on the card.
 */
function StatBoxFeatured({ label, value }: StatBoxProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg border border-accent/30 bg-accent/10 py-1.5">
      <span className="text-[8px] font-bold uppercase tracking-widest text-accent/60">{label}</span>
      <span className="font-condensed text-[15px] font-black leading-none tabular text-accent">
        {value}
      </span>
    </div>
  )
}

function PlayerSilhouette({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 110"
      fill="currentColor"
      className={`h-[110px] w-[110px] ${className}`}
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
