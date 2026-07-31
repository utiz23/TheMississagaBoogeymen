import Link from 'next/link'
import type { ReactNode } from 'react'
import type { LineupRow } from '@eanhl/db/queries'

// Shared chrome for the two lineup drawers: the prototype's drawer frame
// (background well under the open row, accent left edge that wipes top-down as
// the drawer lands), the subject kicker line, and the FULL PLAYER PAGE footer
// link.
//
// The drawer shows ONE player — the row you tapped. It briefly carried a
// two-column BGM-vs-opponent compare; that's been retired, so the team switch
// is the only thing that decides whose numbers you're reading.
//
// Motion (Phase 12): the panel reveals by clip-path rather than height, so the
// rows below it never animate their position — the drawer wipes down over its
// own already-laid-out box. Inner blocks then assemble in a short stagger.

export function DrawerShell({ children }: { children: ReactNode }) {
  return (
    <div className="gs-drawer-in relative border-b border-border-subtle bg-background">
      <span
        aria-hidden
        className="gs-grow-y gs-drawer-edge absolute bottom-0 left-0 top-0 w-[2px] bg-accent [box-shadow:0_0_8px_rgba(232,65,49,0.35)]"
      />
      {/* gs-drawer-blocks staggers its DIRECT children in CSS. Wrapping each
          child in a per-item element would have been the obvious way to carry
          a delay, but it would also re-parent them out of this flex column and
          break any child that sizes itself against it. */}
      <div className="gs-drawer-blocks flex flex-col gap-3.5 px-4 pb-4 pt-3.5">{children}</div>
    </div>
  )
}

/** Display identity for a drawer column — persona, then gamertag, then CPU. */
export function personaOf(row: LineupRow | null): string {
  if (row === null) return 'No opposite number'
  return row.playerNamePersona ?? row.player?.gamertag ?? row.gamertagSnapshot ?? 'CPU'
}

/**
 * "RW · SILKY" — names the subject of the tables below. The row above scrolls
 * out from under a long drawer, so the panel still has to say whose it is.
 */
export function DrawerKicker({
  posLabel,
  row,
  side,
  trailing,
}: {
  posLabel: string
  row: LineupRow | null
  /** Tints the name to match the team switch. */
  side: 'bgm' | 'opp'
  trailing?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {/* h3 under the module's h2 — an open drawer is a section of its own, and
          without it the tables hang off the page outline. */}
      <h3 className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-condensed text-[12px] font-extrabold uppercase tracking-[0.2em] text-fg-4">
          {posLabel}
        </span>
        <span
          className={`min-w-0 font-condensed text-[13px] font-black uppercase tracking-[0.05em] ${
            side === 'bgm' ? 'text-accent' : '[color:var(--opp)]'
          }`}
        >
          {personaOf(row)}
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
      className="inline-flex min-h-[44px] items-center self-start font-condensed text-[12px] font-bold uppercase tracking-[0.12em] text-accent hover:underline"
    >
      Full player page · {player.gamertag} →
    </Link>
  )
}

/**
 * Bordered mini-table used by both drawers. `columns` are the optional column
 * heads the loadout tables carry (the prototype's R / Δ pair); the stats
 * tables are plain key/value and pass none.
 */
export function DrawerTable({
  title,
  columns,
  children,
}: {
  title: string
  columns?: { label: string; title: string }[]
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5 border border-border bg-surface px-2.5 py-[9px]">
      <div className="flex items-baseline justify-between gap-2 border-b border-border-subtle pb-[5px]">
        <span className="font-condensed text-[12px] font-semibold uppercase tracking-[0.18em] text-fg-4">
          {title}
        </span>
        {columns ? (
          <span className="flex gap-2 font-condensed text-[12px] font-extrabold uppercase tracking-[0.06em] text-fg-4">
            {columns.map((c) => (
              <span
                key={c.label}
                title={c.title}
                className="min-w-[26px] cursor-help text-right last:min-w-[20px]"
              >
                {c.label}
              </span>
            ))}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  )
}
