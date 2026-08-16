'use client'

import Image from 'next/image'
import type { LineupRow } from '@eanhl/db/queries'
import type { PlayerArchetype } from '@eanhl/db/schema'
import { ArchetypePillCompact } from '@/components/ui/archetype-pill'
import { PlayerSilhouette } from '@/components/home/player-card'
import { PlatformBadge, type PlatformInfo } from '@/components/ui/platform-badge'
import { xFactorIconUrl } from '@/lib/xfactor-asset'
import type { LineupPositionKey } from '@/lib/lineup-shape'
import type { GameSheetMode } from '@/components/matches/game-sheet-mode'

// One unified row template for the lineup module — both LOADOUTS and STATS
// modes render through this single shell (the prototype review's "unify the
// two row templates" fix). Grid mirrors the prototype's GRID_LOAD:
// POS cell · jersey # · avatar · identity · mode-dependent trailing · chevron.
//
// Type follows the prototype's 12px floor (`Game Sheet copy.dc.html` head
// comment: "everything that carries text now clears AA 4.5:1 at 12px"). The
// pre-port row ran 9–10.5px micro-labels, which is the single biggest reason
// it didn't read like the prototype.

// Slot keys live in `@/lib/lineup-shape` (the ladder is mode-dependent — 6s
// runs C/LW/RW/LD/RD/G, 3s runs C/W/D/G). Re-exported here so the module's
// existing `from './lineup-row'` imports keep working.
export type { LineupPositionKey }

export interface LineupStatTile {
  label: string
  value: string
  /**
   * Weight/size class per the prototype's `buildStatTiles()`:
   *   lead  — PTS, 27px/900
   *   base  — G/A, 20px/700
   *   dim   — SOG/HIT/BLK, 20px/600
   *   win/loss/zero — the ± tile's three states, 20px/700
   *   muted — CPU row, no data
   */
  tone: 'lead' | 'base' | 'dim' | 'win' | 'loss' | 'zero' | 'muted'
  /** Hidden below `sm` — interim narrow-width handling until the Phase 10 responsive pass. */
  collapsible?: boolean
}

export interface LineupSlotVM {
  position: LineupPositionKey
  /** Display label — box-score defence slots read "D" (EA has no L/R split). */
  posLabel: string
  /** False = no human dressed at this slot (EA AI). */
  human: boolean
  persona: string | null
  /** Gamertag when it differs from the persona line; null = shown once. */
  handle: string | null
  isCaptain: boolean
  jersey: number | null
  archetype: PlayerArchetype | null
  /** Raw build text fallback when the build doesn't map to a known archetype. */
  buildLabel: string | null
  /** Reference player behind a "Cole Caufield - Sniper" build — e.g. "C. Caufield". */
  buildRef: string | null
  /** "6'1" · 189 lb · L · P2·L37" subline for LOADOUTS mode. */
  physLine: string | null
  /** EA-authoritative console for this match. NULL when EA has no row. */
  platform: PlatformInfo | null
  xFactors: LineupRow['xFactors']
  statTiles: LineupStatTile[]
  /** True when a reviewed loadout snapshot (attributes) exists for this row. */
  hasLoadout: boolean
  expandable: boolean
}

interface LineupModuleRowProps {
  slot: LineupSlotVM
  mode: GameSheetMode
  isOpen: boolean
  panelId: string
  onToggle: () => void
}

const CPU_HATCH =
  'repeating-linear-gradient(135deg, var(--color-surface) 0, var(--color-surface) 8px, var(--color-background) 8px, var(--color-background) 10px)'

export function LineupModuleRow({ slot, mode, isOpen, panelId, onToggle }: LineupModuleRowProps) {
  // `group` drives the chevron's hover state (the prototype's
  // `.lu-row:hover .chev-cta` rule); `gs-hover-row` supplies the shared
  // colour transition so hover resolves rather than snaps. Focus ring is
  // inset — a row spans the panel's full width, so an outset ring would be
  // clipped by the panel's own `overflow-hidden`.
  //
  // `select-text` because this is a <button>, and browsers suppress text
  // selection inside buttons whatever `user-select` computes to — a drag
  // across a row selected nothing, so gamertags and builds couldn't be
  // copied. Clicking still toggles; only dragging now selects.
  // `border-b-*` (bottom colour only), NOT `border-border-subtle` (all four
  // sides). This row also sets its own `border-l` colour below; an all-sides
  // colour here is a same-specificity collision with it, resolved only by
  // Tailwind's output order. It happens to render correctly — side-specific
  // utilities are emitted after all-sides ones — but pinning the side makes
  // the left rule's accent independent of that ordering. Same defect class as
  // the box score's TOT rule.
  const rowClass = `group gs-hover-row select-text grid w-full min-h-[58px] grid-cols-[30px_34px_minmax(0,1fr)_auto_19px] items-center gap-x-[9px] border-b border-b-border-subtle border-l-2 py-[7px] pr-3 pl-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:grid-cols-[34px_40px_40px_minmax(0,1fr)_auto_19px] sm:gap-x-[11px] sm:pr-3.5 sm:pl-3 ${
    isOpen
      ? 'border-l-accent bg-surface-raised [box-shadow:inset_2px_0_0_var(--color-accent)]'
      : 'border-l-transparent'
  } ${slot.expandable ? 'cursor-pointer hover:border-l-accent hover:bg-surface-raised' : ''}`

  const cells = (
    <>
      {/* POS — cell bleeding to the row edges. Single neutral tint per the
          prototype's de-rainbowed POS_COLOR; the letter carries it too. */}
      <span
        className="-my-[7px] -ml-2.5 flex flex-col items-center justify-center gap-px self-stretch border sm:-ml-3"
        style={
          slot.human
            ? {
                borderColor: 'color-mix(in srgb, var(--pos-neutral) 40%, transparent)',
                background: 'color-mix(in srgb, var(--pos-neutral) 10%, transparent)',
              }
            : { borderColor: 'var(--color-border)' }
        }
      >
        <span className="font-condensed text-[12px] font-bold uppercase leading-none tracking-[0.14em] text-fg-4">
          Pos
        </span>
        <span
          className="font-condensed text-[19px] font-black uppercase leading-none tracking-[0.04em] tabular-nums"
          style={{ color: slot.human ? 'var(--pos-neutral)' : 'var(--color-fg-4)' }}
        >
          {slot.posLabel}
        </span>
      </span>

      {/* Jersey number */}
      <span className="flex flex-col items-center">
        <span className="font-condensed text-[12px] font-bold uppercase leading-none tracking-[0.1em] text-fg-4">
          #
        </span>
        <span
          className={`font-condensed text-[26px] font-black leading-[0.85] tracking-[-0.02em] tabular-nums ${
            slot.human && slot.jersey !== null ? 'text-fg-1' : 'text-fg-4'
          }`}
        >
          {slot.jersey !== null ? slot.jersey.toString() : '—'}
        </span>
      </span>

      {/* Avatar */}
      <span
        className={`hidden h-10 w-10 items-end justify-center overflow-hidden rounded-full border sm:flex ${
          slot.human
            ? 'border-border [background:radial-gradient(circle_at_top,rgba(232,65,49,0.14),transparent_55%),linear-gradient(180deg,rgba(50,48,49,0.9),rgba(26,24,25,1))]'
            : 'border-border bg-[rgba(35,33,34,0.55)] opacity-80'
        }`}
        aria-hidden
      >
        <PlayerSilhouette sizeClass="h-7 w-[26px]" className="text-fg-6" />
      </span>

      {/* Identity */}
      <span className="flex min-w-0 flex-col gap-[5px]">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className={`whitespace-nowrap font-condensed text-[16px] font-black uppercase leading-none tracking-[0.03em] ${
              slot.human ? 'text-fg-1' : 'text-fg-4'
            }`}
          >
            {slot.persona ?? (slot.position === 'G' ? 'CPU Goalie' : 'CPU')}
          </span>
          {slot.handle !== null ? (
            <span className="truncate font-condensed text-[12px] font-semibold tracking-[0.02em] text-fg-3">
              {slot.handle}
            </span>
          ) : null}
          {/* EA-authoritative console — restored from the pre-revamp player
              card, which is the only place it has ever been surfaced. */}
          {slot.platform !== null ? <PlatformBadge platform={slot.platform} size={13} /> : null}
          {slot.isCaptain ? (
            // Static accent mark, deliberately not a loop — the prototype's
            // `.leader-star` is a resting glow, and a pulsing star next to a
            // name would be the one thing moving on a settled page.
            //
            // 16px against 12px neighbouring text on purpose. ★ isn't in
            // Barlow, so it falls back to a symbol font whose glyph sits small
            // and thin inside its em box: at a matched 12px it measures TALLER
            // than the gamertag by ink (10px vs 8px) and still reads smaller.
            // ~1.33× is where it optically matches the text beside it.
            <span
              title="Room leader"
              className="flex-none text-[16px] leading-none text-accent [text-shadow:0_0_5px_rgba(232,65,49,0.16)]"
              aria-label="Room leader"
            >
              ★
            </span>
          ) : null}
          {!slot.human ? (
            <span className="flex-none border border-dashed border-border px-[7px] py-0.5 font-condensed text-[12px] font-bold uppercase leading-none tracking-[0.14em] text-fg-4">
              No human dressed
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-[9px] gap-y-1">
          {slot.archetype !== null ? (
            <ArchetypePillCompact archetype={slot.archetype} />
          ) : slot.buildLabel !== null ? (
            <span className="border border-border bg-background px-2 py-[3px] font-condensed text-[12px] font-bold uppercase leading-none tracking-[0.08em] text-fg-2">
              {slot.buildLabel}
            </span>
          ) : null}
          {/* Reference-player suffix — the prototype's build format is
              "SNIPER · C. CAUFIELD". The pill alone drops the ref entirely. */}
          {mode === 'loadouts' && slot.buildRef !== null ? (
            <span className="whitespace-nowrap font-condensed text-[12px] font-semibold uppercase tracking-[0.14em] text-fg-5">
              · {slot.buildRef}
            </span>
          ) : null}
          {mode === 'loadouts' && slot.physLine !== null ? (
            <span className="whitespace-nowrap font-condensed text-[12px] font-semibold uppercase tracking-[0.08em] tabular-nums text-fg-5">
              {slot.physLine}
            </span>
          ) : null}
          {!slot.human ? (
            <span className="font-condensed text-[12px] font-semibold uppercase tracking-[0.1em] text-fg-5">
              EA AI · no tracked data
            </span>
          ) : null}
        </span>
      </span>

      {/* Trailing — X-Factor tiles (loadouts) or stat tiles (stats) */}
      <span className="flex items-center justify-end gap-2">
        {mode === 'loadouts' ? (
          <XFactorTiles xFactors={slot.xFactors} />
        ) : (
          <span className="flex items-end justify-end gap-[15px]">
            {slot.statTiles.map((tile) => (
              <StatTileView key={tile.label} tile={tile} />
            ))}
          </span>
        )}
      </span>

      {/* Chevron — the prototype's boxed affordance (review P1 #5: the bare
          glyph read as decoration and the rows looked static). Hovering
          anywhere on the row lights it accent, so the whole row reads as the
          control it is (`.lu-row:hover .chev-cta`). */}
      <span
        aria-hidden
        className={`gs-chevron inline-flex h-[19px] w-[19px] flex-none items-center justify-center border font-condensed text-[12px] font-extrabold leading-none transition-colors ${
          slot.expandable
            ? isOpen
              ? 'rotate-90 border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-accent'
              : 'border-border bg-background text-fg-3 group-hover:border-accent group-hover:bg-[var(--color-accent-soft)] group-hover:text-accent'
            : 'invisible'
        }`}
      >
        ▸
      </span>
    </>
  )

  if (!slot.expandable) {
    return (
      <div className={rowClass} style={!slot.human ? { background: CPU_HATCH } : undefined}>
        {cells}
      </div>
    )
  }
  return (
    <button
      type="button"
      aria-expanded={isOpen}
      aria-controls={panelId}
      onClick={() => {
        // A drag that ends inside the button still fires a click, so selecting
        // a gamertag would also toggle the drawer under it. A plain click has
        // already collapsed any selection by the time click fires (mousedown
        // does that), so a LIVE selection here means the pointer was dragging,
        // not clicking. Keyboard activation never sets one.
        const selection = window.getSelection()
        if (selection !== null && !selection.isCollapsed && selection.toString().trim() !== '') {
          return
        }
        onToggle()
      }}
      className={rowClass}
    >
      {cells}
    </button>
  )
}

// ─── Trailing blocks ─────────────────────────────────────────────────────────

// Sizes/weights straight off the prototype's `buildStatTiles()`. PTS carries
// the row at 27px/900; everything else sits at 20px and separates by weight
// (700 for the counting stats you scan for, 600 for the supporting ones).
const TILE_TONE_CLASS: Record<LineupStatTile['tone'], string> = {
  lead: 'text-[27px] font-black text-fg-1',
  base: 'text-[20px] font-bold text-fg-2',
  dim: 'text-[20px] font-semibold text-fg-3',
  win: 'text-[20px] font-bold text-win',
  loss: 'text-[20px] font-bold text-loss',
  zero: 'text-[20px] font-bold text-fg-5',
  // 'muted' is the no-data tile: the — glyph already says "nothing here",
  // so it reads lighter by WEIGHT, not by dropping under the contrast floor.
  // (The prototype used fg-6 here, which this palette documents as a hairline
  // colour rather than a text one.)
  muted: 'text-[20px] font-semibold text-fg-4',
}

function StatTileView({ tile }: { tile: LineupStatTile }) {
  return (
    <span
      className={`flex-col items-center gap-0.5 ${tile.collapsible ? 'hidden sm:flex' : 'flex'} min-w-[24px]`}
    >
      <span className={`font-condensed leading-[0.9] tabular-nums ${TILE_TONE_CLASS[tile.tone]}`}>
        {tile.value}
      </span>
      <span className="font-condensed text-[12px] font-bold uppercase leading-none tracking-[0.1em] text-fg-4">
        {tile.label}
      </span>
    </span>
  )
}

/**
 * Tier → fallback dot colour, used only when an X-Factor has no canonical icon.
 * Fixed by EA's own asset naming (see `lib/xfactor-asset`): Elite red, All Star
 * blue, Specialist gold — the same mapping the branded PNGs already encode.
 */
function xfTierColor(tier: LineupRow['xFactors'][number]['tier']): string {
  switch (tier) {
    case 'Elite':
      return 'var(--color-accent)'
    case 'All Star':
      return '#3AB7FF'
    case 'Specialist':
      return '#E0A150'
    default:
      return 'var(--color-fg-4)'
  }
}

/**
 * Up to three X-Factor icons. No frame: the branded PNGs are already tier-
 * coloured diamonds, so a tinted box around them was saying the same thing
 * twice and boxing in art that reads better at size. Tier stays in the art +
 * the hover title.
 */
function XFactorTiles({ xFactors }: { xFactors: LineupRow['xFactors'] }) {
  if (xFactors.length === 0) return null
  return (
    <span className="hidden items-center gap-1.5 sm:flex">
      {xFactors.map((xf) => {
        const displayName = xf.canonicalName
          ? xf.canonicalName.replace(/_/g, ' ').replace(/Plus$/, '+')
          : xf.name
        const title = xf.tier ? `${displayName} — ${xf.tier}` : displayName
        const iconUrl = xFactorIconUrl(xf.canonicalName, xf.tier)
        if (iconUrl) {
          return (
            <Image
              key={xf.slotIndex}
              src={iconUrl}
              alt={title}
              title={title}
              width={46}
              height={46}
              className="h-[46px] w-[46px] shrink-0"
            />
          )
        }
        return (
          <span
            key={xf.slotIndex}
            title={title}
            aria-label={title}
            className="inline-flex h-[46px] w-[46px] flex-none items-center justify-center"
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: xfTierColor(xf.tier) }}
              aria-hidden
            />
          </span>
        )
      })}
    </span>
  )
}
