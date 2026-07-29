'use client'

import Image from 'next/image'
import type { LineupRow } from '@eanhl/db/queries'
import type { PlayerArchetype } from '@eanhl/db/schema'
import { ArchetypePillCompact } from '@/components/ui/archetype-pill'
import { PlayerSilhouette } from '@/components/home/player-card'
import { colorForPosition } from '@/lib/position-colors'
import { xFactorIconUrl } from '@/lib/xfactor-asset'
import type { GameSheetMode } from '@/components/matches/game-sheet-mode'

// One unified row template for the lineup module — both LOADOUTS and STATS
// modes render through this single shell (the prototype review's "unify the
// two row templates" fix). Grid mirrors the prototype: POS cell · jersey # ·
// avatar · identity · mode-dependent trailing block · chevron. Rows stay
// ≤ ~60px so all six fit without scrolling.

export type LineupPositionKey = 'C' | 'LW' | 'RW' | 'LD' | 'RD' | 'G'

export interface LineupStatTile {
  label: string
  value: string
  /** 'lead' = the emphasized PTS-style tile; 'win'/'loss' colour the ± tile. */
  tone: 'lead' | 'base' | 'dim' | 'win' | 'loss' | 'muted'
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
  /** "6'1" · 189 lb · L · P2·L37" subline for LOADOUTS mode. */
  physLine: string | null
  xFactors: LineupRow['xFactors']
  /** Composite game score — null when no score entry exists for this player. */
  gs: number | null
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
  const posColor = colorForPosition(slot.position)

  const rowClass = `grid w-full min-h-[58px] grid-cols-[30px_30px_minmax(0,1fr)_auto_14px] items-center gap-x-2 border-b border-border-subtle border-l-2 py-[7px] pr-3 pl-2.5 text-left transition-colors sm:grid-cols-[34px_36px_40px_minmax(0,1fr)_auto_14px] sm:gap-x-2.5 sm:pr-3.5 sm:pl-3 ${
    isOpen
      ? 'border-l-accent bg-surface-raised [box-shadow:inset_2px_0_0_var(--color-accent)]'
      : 'border-l-transparent'
  } ${slot.expandable ? 'cursor-pointer hover:border-l-accent hover:bg-surface-raised' : ''}`

  const cells = (
    <>
      {/* POS — coloured cell bleeding to the row edges */}
      <span
        className="-my-[7px] -ml-2.5 flex flex-col items-center justify-center gap-px self-stretch border sm:-ml-3"
        style={
          slot.human
            ? {
                borderColor: `color-mix(in srgb, ${posColor} 40%, transparent)`,
                background: `color-mix(in srgb, ${posColor} 10%, transparent)`,
              }
            : { borderColor: 'var(--color-border)' }
        }
      >
        <span className="font-condensed text-[9px] font-bold uppercase tracking-[0.14em] text-fg-3">
          Pos
        </span>
        {/* Label in fg-1, position colour carried by the cell's border + tint
            (Phase 10 de-rainbow): the raw palette is 2.5–2.6:1 on dark, and six
            saturated glyphs down one lineup fought the row content. */}
        <span
          className="font-condensed text-[19px] font-black uppercase leading-none tracking-[0.04em] tabular-nums"
          style={{ color: slot.human ? 'var(--color-fg-1)' : 'var(--color-fg-3)' }}
        >
          {slot.posLabel}
        </span>
      </span>

      {/* Jersey number */}
      <span className="flex flex-col items-center">
        <span className="font-condensed text-[9px] font-bold uppercase tracking-[0.1em] text-fg-3">
          #
        </span>
        <span
          className={`font-condensed text-[22px] font-black leading-[0.9] tracking-[-0.02em] tabular-nums ${
            slot.human && slot.jersey !== null ? 'text-fg-1' : 'text-fg-3'
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
            className={`whitespace-nowrap font-condensed text-[15px] font-black uppercase leading-none tracking-[0.03em] ${
              slot.human ? 'text-fg-1' : 'text-fg-3'
            }`}
          >
            {slot.persona ?? (slot.position === 'G' ? 'CPU Goalie' : 'CPU')}
          </span>
          {slot.handle !== null ? (
            <span className="truncate font-condensed text-[11px] font-semibold tracking-[0.02em] text-fg-3">
              {slot.handle}
            </span>
          ) : null}
          {slot.isCaptain ? (
            <span
              title="Captain"
              className="flex-none text-[12px] leading-none text-accent"
              aria-label="Captain"
            >
              ★
            </span>
          ) : null}
          {!slot.human ? (
            <span className="flex-none border border-dashed border-border px-1.5 py-0.5 font-condensed text-[9px] font-bold uppercase tracking-[0.14em] text-fg-3">
              No human dressed
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {slot.archetype !== null ? (
            <ArchetypePillCompact archetype={slot.archetype} />
          ) : slot.buildLabel !== null ? (
            <span className="border border-border bg-background px-2 py-[2px] font-condensed text-[10px] font-bold uppercase tracking-[0.06em] text-fg-2">
              {slot.buildLabel}
            </span>
          ) : null}
          {mode === 'loadouts' && slot.physLine !== null ? (
            <span className="whitespace-nowrap font-condensed text-[10px] font-semibold uppercase tracking-[0.08em] tabular-nums text-fg-3">
              {slot.physLine}
            </span>
          ) : null}
          {mode === 'stats' && slot.human && slot.gs !== null ? (
            <span
              className="whitespace-nowrap border border-border px-1.5 py-[2px] font-condensed text-[10px] font-extrabold uppercase tracking-[0.06em] tabular-nums text-fg-3"
              title="Composite game score"
            >
              GS {slot.gs.toFixed(2)}
            </span>
          ) : null}
          {!slot.human ? (
            <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-3">
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
          <span className="flex items-end justify-end gap-3">
            {slot.statTiles.map((tile) => (
              <StatTileView key={tile.label} tile={tile} />
            ))}
          </span>
        )}
      </span>

      {/* Chevron — persistent expand affordance */}
      <span
        aria-hidden
        className={`text-center font-condensed text-[13px] font-black leading-none transition-transform ${
          slot.expandable ? (isOpen ? 'rotate-90 text-accent' : 'text-fg-2') : 'invisible'
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
      onClick={onToggle}
      className={rowClass}
    >
      {cells}
    </button>
  )
}

// ─── Trailing blocks ─────────────────────────────────────────────────────────

const TILE_TONE_CLASS: Record<LineupStatTile['tone'], string> = {
  lead: 'text-[20px] font-black text-fg-1',
  base: 'text-[15px] font-bold text-fg-2',
  dim: 'text-[15px] font-semibold text-fg-3',
  win: 'text-[15px] font-bold text-win',
  loss: 'text-[15px] font-bold text-loss',
  // 'muted' is the no-data tile: the — glyph already says "nothing here",
  // so it reads lighter by WEIGHT, not by dropping under the contrast floor.
  muted: 'text-[15px] font-normal text-fg-3',
}

function StatTileView({ tile }: { tile: LineupStatTile }) {
  return (
    <span
      className={`flex-col items-center gap-0.5 ${tile.collapsible ? 'hidden sm:flex' : 'flex'} min-w-[26px]`}
    >
      <span className={`font-condensed leading-[0.9] tabular-nums ${TILE_TONE_CLASS[tile.tone]}`}>
        {tile.value}
      </span>
      <span className="font-condensed text-[9px] font-bold uppercase tracking-[0.1em] text-fg-3">
        {tile.label}
      </span>
    </span>
  )
}

/**
 * Up to three X-Factor tiles with the real branded icons (the prototype used
 * placeholder glyphs). Tier semantics ride on the icon art itself; the hover
 * tooltip carries name + tier for accessibility. Falls back to a tier-tinted
 * dot when no canonical icon exists.
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
              width={30}
              height={30}
              className="h-[30px] w-[30px] shrink-0"
            />
          )
        }
        return (
          <span
            key={xf.slotIndex}
            title={title}
            aria-label={title}
            className={`flex h-[30px] w-[30px] items-center justify-center rounded-full border ${xfFallbackTone(xf.tier)}`}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
          </span>
        )
      })}
    </span>
  )
}

function xfFallbackTone(tier: LineupRow['xFactors'][number]['tier']): string {
  switch (tier) {
    case 'Elite':
      return 'border-[rgba(232,65,49,0.40)] bg-[rgba(232,65,49,0.10)] text-accent'
    case 'All Star':
      return 'border-[rgba(235,235,235,0.30)] bg-[rgba(235,235,235,0.04)] text-fg-2'
    case 'Specialist':
      return 'border-[rgba(110,107,108,0.40)] bg-[rgba(235,235,235,0.02)] text-fg-3'
    default:
      return 'border-border bg-background text-fg-3'
  }
}
