import Link from 'next/link'
import type { ReactNode } from 'react'
import type { LineupRow } from '@eanhl/db/queries'

// Shared chrome for the two lineup drawers: the prototype's drawer frame
// (background well under the open row, static accent left edge — the edge
// wipe animates in Phase 12), the head-to-head kicker line, and the FULL
// PLAYER PAGE footer link. Columns are fixed BGM-left / opponent-right
// regardless of which roster is being browsed, matching the scorebug.

export function DrawerShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative border-b border-border-subtle bg-background">
      <span
        aria-hidden
        className="absolute bottom-0 left-0 top-0 w-[2px] bg-accent [box-shadow:0_0_8px_rgba(232,65,49,0.35)]"
      />
      <div className="flex flex-col gap-3.5 px-4 pb-4 pt-3.5">{children}</div>
    </div>
  )
}

/** Display identity for a drawer column — persona, then gamertag, then CPU. */
export function personaOf(row: LineupRow | null): string {
  if (row === null) return 'No opposite number'
  return row.playerNamePersona ?? row.player?.gamertag ?? row.gamertagSnapshot ?? 'CPU'
}

/**
 * "C HEAD-TO-HEAD · E. WANHG vs WHOOSAH" — names the matchup the tables
 * below compare, since the row above only identifies the tapped player.
 */
export function DrawerKicker({
  posLabel,
  bgmRow,
  oppRow,
  trailing,
}: {
  posLabel: string
  bgmRow: LineupRow | null
  oppRow: LineupRow | null
  trailing?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {/* h3 under the module's h2 — an open drawer is a section of its own, and
          without it the compare tables hang off the page outline. */}
      <h3 className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-condensed text-[10px] font-extrabold uppercase tracking-[0.2em] text-fg-3">
          {posLabel} head-to-head
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 font-condensed text-[12px] font-black uppercase tracking-[0.05em]">
          <span className="text-accent">{personaOf(bgmRow)}</span>
          <span className="text-[10px] font-bold text-fg-3">vs</span>
          <span className={oppRow ? '[color:var(--opp)]' : 'text-fg-3'}>{personaOf(oppRow)}</span>
        </span>
      </h3>
      {trailing}
    </div>
  )
}

/**
 * Real destination link — BGM players only (opponent persons have no
 * profile pages; the query docs forbid linking them).
 */
export function FullPlayerPageLink({ bgmRow }: { bgmRow: LineupRow | null }) {
  const player = bgmRow?.player ?? null
  if (player === null) return null
  return (
    <Link
      href={`/roster/${player.id.toString()}`}
      className="self-start font-condensed text-[10px] font-bold uppercase tracking-[0.12em] text-accent hover:underline"
    >
      Full player page · {player.gamertag} →
    </Link>
  )
}

/** Bordered mini-table used by both drawers for grouped compare rows. */
export function CompareTable({
  title,
  oppAbbrev,
  children,
}: {
  title: string
  oppAbbrev: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5 border border-border bg-surface px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2 border-b border-border-subtle pb-1.5">
        <span className="font-condensed text-[10px] font-bold uppercase tracking-[0.18em] text-fg-3">
          {title}
        </span>
        <span className="flex gap-2 font-condensed text-[9px] font-extrabold uppercase tracking-[0.08em]">
          <span className="min-w-[30px] text-right text-accent">BGM</span>
          <span className="min-w-[30px] text-right [color:var(--opp)]">{oppAbbrev}</span>
        </span>
      </div>
      {children}
    </div>
  )
}
