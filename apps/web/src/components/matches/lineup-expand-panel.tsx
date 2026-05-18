'use client'

import { useState, type MouseEvent } from 'react'
import Image from 'next/image'
import type { LineupRow } from '@eanhl/db/queries'
import { xFactorIconUrl } from '@/lib/xfactor-asset'
import { colorForPosition } from '@/lib/position-colors'

/**
 * In-row drill-down for a lineup slot: two `Build / X-Factors / Attributes`
 * columns (BGM left, opponent right) split by a thin center "Position
 * matchup" rail. Rendered as a child of the client `LineupRow` when its
 * `open` state is true.
 *
 * Client component — owns the per-row `expandedSide` state that drives the
 * Compare / Expand mode toggle. When a side is expanded, that PlayerColumn
 * takes the full panel width and the center rail + opposite column hide.
 * State resets each time the row re-opens (component remounts via parent).
 */

type ExpandedSide = 'bgm' | 'opp' | null

type Tier = 'Elite' | 'All Star' | 'Specialist'

interface AttributeGroup {
  title: string
  keys: readonly string[]
}

/**
 * 5-group attribute taxonomy that matches the in-game Loadout view screen.
 * Mirrors the schema comment in `packages/db/src/schema/player-loadout.ts`.
 */
const ATTRIBUTE_GROUPS: readonly AttributeGroup[] = [
  {
    title: 'Technique',
    keys: ['wrist_shot_accuracy', 'slap_shot_accuracy', 'speed', 'balance', 'agility'],
  },
  {
    title: 'Power',
    keys: ['wrist_shot_power', 'slap_shot_power', 'acceleration', 'puck_control', 'endurance'],
  },
  {
    title: 'Playstyle',
    keys: [
      'passing',
      'offensive_awareness',
      'body_checking',
      'stick_checking',
      'defensive_awareness',
    ],
  },
  { title: 'Tenacity', keys: ['hand_eye', 'strength', 'durability', 'shot_blocking'] },
  { title: 'Tactics', keys: ['deking', 'faceoffs', 'discipline', 'fighting_skill'] },
]

const ATTRIBUTE_LABELS: Readonly<Record<string, string>> = {
  wrist_shot_accuracy: 'Wrist Shot Acc',
  slap_shot_accuracy: 'Slap Shot Acc',
  speed: 'Speed',
  balance: 'Balance',
  agility: 'Agility',
  wrist_shot_power: 'Wrist Shot Pwr',
  slap_shot_power: 'Slap Shot Pwr',
  acceleration: 'Acceleration',
  puck_control: 'Puck Control',
  endurance: 'Endurance',
  passing: 'Passing',
  offensive_awareness: 'Off. Awareness',
  body_checking: 'Body Checking',
  stick_checking: 'Stick Checking',
  defensive_awareness: 'Def. Awareness',
  hand_eye: 'Hand-Eye',
  strength: 'Strength',
  durability: 'Durability',
  shot_blocking: 'Shot Blocking',
  deking: 'Deking',
  faceoffs: 'Faceoffs',
  discipline: 'Discipline',
  fighting_skill: 'Fighting Skill',
}

export function LineupExpandPanel({
  bgm,
  opp,
  position,
  bgmRef,
  oppRef,
}: {
  bgm: LineupRow | null
  opp: LineupRow | null
  position: string
  /** Reference player display, e.g. "Cole Caufield" — passed up from PlayerCard. */
  bgmRef: string | null
  oppRef: string | null
}) {
  const posColor = colorForPosition(position)
  const [expandedSide, setExpandedSide] = useState<ExpandedSide>(null)
  const isExpanded = expandedSide !== null
  // When a side is expanded the panel collapses to a single full-width column;
  // when not, the original 3-column compare grid renders.
  const containerClass = isExpanded
    ? 'border border-t-0 bg-[var(--color-surface)]'
    : 'grid grid-cols-1 border border-t-0 bg-[var(--color-surface)] md:grid-cols-[1fr_96px_1fr]'
  const showBgm = !isExpanded || expandedSide === 'bgm'
  const showOpp = !isExpanded || expandedSide === 'opp'
  return (
    <div
      className={containerClass}
      style={{ borderColor: `color-mix(in srgb, ${posColor} 40%, transparent)` }}
    >
      {showBgm ? (
        <PlayerColumn
          row={bgm}
          refPlayer={bgmRef}
          side="bgm"
          position={position}
          posColor={posColor}
          isExpanded={expandedSide === 'bgm'}
          onToggleExpand={() => {
            setExpandedSide((prev) => (prev === 'bgm' ? null : 'bgm'))
          }}
        />
      ) : null}
      {!isExpanded ? <CenterRail position={position} color={posColor} /> : null}
      {showOpp ? (
        <PlayerColumn
          row={opp}
          refPlayer={oppRef}
          side="opp"
          position={position}
          posColor={posColor}
          isExpanded={expandedSide === 'opp'}
          onToggleExpand={() => {
            setExpandedSide((prev) => (prev === 'opp' ? null : 'opp'))
          }}
        />
      ) : null}
    </div>
  )
}

function CenterRail({ position, color }: { position: string; color: string }) {
  return (
    <div
      className="hidden flex-col items-center justify-center gap-3 border-x px-2 py-5 md:flex"
      style={{
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
      }}
    >
      <span
        className="font-condensed text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-6)]"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        Position matchup
      </span>
      <span
        className="font-condensed text-[32px] font-black tracking-[0.05em] tabular-nums"
        style={{ color }}
      >
        {position}
      </span>
      <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
        ↑ BGM
      </span>
      <span
        className="h-12 w-px"
        style={{ background: `color-mix(in srgb, ${color} 40%, transparent)` }}
        aria-hidden
      />
      <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-fg-5)]">
        OPP ↓
      </span>
    </div>
  )
}

function PlayerColumn({
  row,
  refPlayer,
  side,
  position,
  posColor,
  isExpanded,
  onToggleExpand,
}: {
  row: LineupRow | null
  refPlayer: string | null
  side: 'bgm' | 'opp'
  position: string
  posColor: string
  isExpanded: boolean
  onToggleExpand: () => void
}) {
  const borderClass = side === 'bgm' ? 'md:border-r md:border-[var(--color-border)]' : ''
  // Mirror the card-side convention: BGM column anchors left, opp column
  // anchors right. Text + inline-flex content inherits text-align so the
  // build label, X-Factor list, KV rows, and attribute group headers all
  // flow toward the appropriate side. In Expand mode the column takes the
  // full panel width so text-align bias still applies meaningfully (the
  // build header + 5-col grid honor it).
  const sideAlignClass = side === 'opp' ? 'text-right' : ''
  const mobileHeaderJustify = side === 'opp' ? 'justify-end' : ''
  const expandToggle = (
    <ExpandToggle
      side={side}
      isExpanded={isExpanded}
      onClick={(e) => {
        e.stopPropagation()
        onToggleExpand()
      }}
    />
  )
  // Mobile-only header: the desktop `CenterRail` is hidden on <md, so the
  // drill-down panel would otherwise lose its "which matchup is this?" anchor.
  // A small `Pos · C` strip per column keeps the context on phone widths.
  const mobilePositionHeader = (
    <div className={`mb-3 flex items-center gap-2 md:hidden ${mobileHeaderJustify}`}>
      <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-6)]">
        Pos
      </span>
      <span
        className="font-condensed text-[18px] font-black uppercase tracking-[0.08em] tabular-nums"
        style={{ color: posColor }}
      >
        {position}
      </span>
      <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--color-fg-5)]">
        {side === 'bgm' ? '↑ BGM' : 'OPP ↓'}
      </span>
    </div>
  )
  if (!row) {
    return (
      <div className={`relative px-5 py-5 ${borderClass} ${sideAlignClass}`}>
        {expandToggle}
        {mobilePositionHeader}
        <div className="font-condensed text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-5)]">
          No data captured for this slot.
        </div>
      </div>
    )
  }
  const buildLabel =
    row.buildClassCanonical?.split(' - ').pop() ?? row.buildClass ?? 'Unknown build'
  const xFactors = row.xFactors

  return (
    <div className={`relative px-5 py-5 ${borderClass} ${sideAlignClass}`}>
      {expandToggle}
      {mobilePositionHeader}
      <BuildBlock
        row={row}
        refPlayer={refPlayer}
        buildLabel={buildLabel}
        xFactors={xFactors}
        isExpanded={isExpanded}
      />
      <AttributeBlocks attributes={row.attributes} isExpanded={isExpanded} />
    </div>
  )
}

function ExpandToggle({
  side: _side,
  isExpanded,
  onClick,
}: {
  side: 'bgm' | 'opp'
  isExpanded: boolean
  onClick: (e: MouseEvent<HTMLButtonElement>) => void
}) {
  const label = isExpanded ? 'Compare' : 'Expand'
  const activeBg = isExpanded
    ? 'bg-[rgba(232,65,49,0.10)] text-[var(--color-accent)] border-[rgba(232,65,49,0.4)]'
    : 'text-[var(--color-fg-4)] hover:text-[var(--color-accent)] hover:border-[rgba(232,65,49,0.4)] border-[var(--color-border)]'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute right-4 top-4 z-10 inline-flex items-center border bg-[var(--color-background)] px-3 py-1.5 font-condensed text-[10.5px] font-bold uppercase tracking-[0.14em] ${activeBg}`}
      aria-pressed={isExpanded}
    >
      {label}
    </button>
  )
}

function BuildBlock({
  row,
  refPlayer,
  buildLabel,
  xFactors,
  isExpanded,
}: {
  row: LineupRow
  refPlayer: string | null
  buildLabel: string
  xFactors: LineupRow['xFactors']
  isExpanded: boolean
}) {
  if (isExpanded) {
    return (
      <BuildBlockExpanded
        row={row}
        refPlayer={refPlayer}
        buildLabel={buildLabel}
        xFactors={xFactors}
      />
    )
  }
  return (
    <div className="border-b border-[var(--color-border)] pb-4">
      <div className="font-condensed text-[9.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-5)]">
        Build
      </div>
      <div className="mt-1 font-condensed text-[18px] font-black uppercase tracking-[0.04em] text-[var(--color-fg-1)]">
        {buildLabel}
      </div>
      {refPlayer ? (
        <div className="mt-0.5 font-condensed text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-fg-5)]">
          Reference build · {refPlayer}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-4 font-condensed text-[11px] font-bold tabular-nums tracking-[0.04em] text-[var(--color-fg-3)]">
        <KvBlock k="Height" v={row.heightText ?? '—'} />
        <KvBlock k="Weight" v={row.weightLbs !== null ? `${String(row.weightLbs)} lb` : '—'} />
        <KvBlock k="Hand" v={formatHand(row.handedness)} />
        <KvBlock
          k="Level"
          v={row.playerLevelNumber !== null ? String(row.playerLevelNumber) : '—'}
          title="EASHL player progression level (separate from the in-game NHL player's overall rating)"
        />
      </div>
      {xFactors.length > 0 ? (
        <div className="mt-4 flex flex-col gap-1">
          {xFactors.map((xf) => (
            <XFactorListRow
              key={xf.slotIndex}
              canonicalName={xf.canonicalName}
              rawName={xf.name}
              tier={xf.tier as Tier | null}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Expand-mode build header: BUILD label + reference player at the top, then
 * a side-by-side row with KVs (Height/Weight/Hand/Level) and the new
 * horizontal X-Factor tiles. Uses the full panel width since the opposite
 * column + center rail are hidden in expand mode.
 */
function BuildBlockExpanded({
  row,
  refPlayer,
  buildLabel,
  xFactors,
}: {
  row: LineupRow
  refPlayer: string | null
  buildLabel: string
  xFactors: LineupRow['xFactors']
}) {
  return (
    <div className="border-b border-[var(--color-border)] pb-5 pr-32">
      <div className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-5)]">
        Build
      </div>
      <div className="mt-1 font-condensed text-[28px] font-black uppercase leading-tight tracking-[0.04em] text-[var(--color-fg-1)]">
        {buildLabel}
      </div>
      {refPlayer ? (
        <div className="mt-0.5 font-condensed text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-fg-5)]">
          Reference build · {refPlayer}
        </div>
      ) : null}
      <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
        <div className="flex flex-wrap gap-5 font-condensed text-[13px] font-bold tabular-nums tracking-[0.04em] text-[var(--color-fg-3)]">
          <KvBlock k="Height" v={row.heightText ?? '—'} />
          <KvBlock k="Weight" v={row.weightLbs !== null ? `${String(row.weightLbs)} lb` : '—'} />
          <KvBlock k="Hand" v={formatHand(row.handedness)} />
          <KvBlock
            k="Level"
            v={row.playerLevelNumber !== null ? String(row.playerLevelNumber) : '—'}
            title="EASHL player progression level (separate from the in-game NHL player's overall rating)"
          />
        </div>
        <div className="flex-1">
          <XFactorRowHorizontal xFactors={xFactors} />
        </div>
      </div>
    </div>
  )
}

function KvBlock({ k, v, title }: { k: string; v: string; title?: string }) {
  return (
    <div className="flex flex-col gap-[2px]" title={title}>
      <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--color-fg-6)]">
        {k}
      </span>
      <span className="font-condensed text-[12px] font-bold text-[var(--color-fg-2)]">{v}</span>
    </div>
  )
}

function formatHand(h: string | null): string {
  if (!h) return '—'
  const t = h.trim().toLowerCase()
  if (t === 'r' || t.startsWith('right')) return 'Right'
  if (t === 'l' || t.startsWith('left')) return 'Left'
  return h
}

/**
 * Expand-mode X-Factor row: three tiles laid out horizontally, big icons,
 * name + tier word stacked below each. No tier-rail bars glyph — Expand
 * mode trades the dense Compare-mode rail for a magazine-style tile.
 */
function XFactorRowHorizontal({ xFactors }: { xFactors: LineupRow['xFactors'] }) {
  if (xFactors.length === 0) return null
  return (
    <div className="flex flex-wrap items-stretch gap-3">
      {xFactors.map((xf) => {
        const display = xf.canonicalName
          ? xf.canonicalName.replace(/_/g, ' ').replace(/Plus$/, '+')
          : xf.name
        const iconUrl = xFactorIconUrl(xf.canonicalName, xf.tier as Tier | null)
        return (
          <div
            key={xf.slotIndex}
            className="flex min-w-[110px] flex-1 flex-col items-center gap-1.5 border border-[var(--color-border-subtle)] bg-[rgba(58,56,57,0.30)] px-3 py-3"
          >
            {iconUrl ? (
              <Image
                src={iconUrl}
                alt=""
                width={40}
                height={40}
                className="h-10 w-10"
                aria-hidden
              />
            ) : (
              <span className="h-10 w-10" aria-hidden />
            )}
            <span className="text-center font-condensed text-[12.5px] font-bold uppercase tracking-[0.04em] text-[var(--color-fg-1)]">
              {display}
            </span>
            <span
              className={`font-condensed text-[10px] font-bold uppercase tracking-[0.2em] ${tierWordTone(xf.tier as Tier | null)}`}
            >
              {xf.tier ?? 'Unknown'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function XFactorListRow({
  canonicalName,
  rawName,
  tier,
}: {
  canonicalName: string | null
  rawName: string
  tier: Tier | null
}) {
  const display = canonicalName ? canonicalName.replace(/_/g, ' ').replace(/Plus$/, '+') : rawName
  const iconUrl = xFactorIconUrl(canonicalName, tier)
  return (
    <div className="grid grid-cols-[24px_1fr_auto_auto] items-center gap-2 border-b border-[rgba(58,56,57,0.5)] py-1 last:border-b-0">
      {iconUrl ? (
        <Image
          src={iconUrl}
          alt=""
          width={22}
          height={22}
          className="h-[22px] w-[22px]"
          aria-hidden
        />
      ) : (
        <span className="h-[22px] w-[22px]" aria-hidden />
      )}
      <span className="font-condensed text-[12px] font-bold uppercase tracking-[0.04em] text-[var(--color-fg-2)]">
        {display}
      </span>
      <XFactorTierRail tier={tier} />
      <span
        className={`font-condensed text-[9.5px] font-bold uppercase tracking-[0.2em] ${tierWordTone(tier)}`}
      >
        {tier ?? 'Unknown'}
      </span>
    </div>
  )
}

function XFactorTierRail({ tier }: { tier: Tier | null }) {
  const lit = tier === 'Elite' ? 3 : tier === 'All Star' ? 2 : tier === 'Specialist' ? 1 : 0
  const litColor =
    tier === 'Elite'
      ? 'bg-[var(--color-accent)] [box-shadow:0_0_6px_rgba(232,65,49,0.6)]'
      : tier === 'All Star'
        ? 'bg-[var(--color-fg-2)]'
        : 'bg-[var(--color-fg-4)]'
  return (
    <span className="flex items-center gap-[2px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`inline-block h-[9px] w-[3px] ${i < lit ? litColor : 'bg-[var(--color-border)]'}`}
        />
      ))}
    </span>
  )
}

function tierWordTone(tier: Tier | null): string {
  switch (tier) {
    case 'Elite':
      return 'text-[var(--color-accent)]'
    case 'All Star':
      return 'text-[var(--color-fg-2)]'
    case 'Specialist':
      return 'text-[var(--color-fg-4)]'
    default:
      return 'text-[var(--color-fg-5)]'
  }
}

function AttributeBlocks({
  attributes,
  isExpanded,
}: {
  attributes: LineupRow['attributes']
  isExpanded: boolean
}) {
  if (!attributes || Object.keys(attributes).length === 0) {
    return (
      <div className="mt-4 font-condensed text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-fg-5)]">
        No attribute data captured.
      </div>
    )
  }
  const gridCols = isExpanded
    ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'
    : 'grid-cols-1 md:grid-cols-2'
  return (
    <div className={`mt-4 grid gap-x-4 gap-y-3 ${gridCols}`}>
      {ATTRIBUTE_GROUPS.map((g, idx) => (
        <div
          key={g.title}
          className={
            !isExpanded && idx === ATTRIBUTE_GROUPS.length - 1 ? 'md:col-span-2' : undefined
          }
        >
          <div className="mb-1 border-b border-[var(--color-border-subtle)] pb-1 font-condensed text-[9.5px] font-bold uppercase tracking-[0.22em] text-[var(--color-fg-4)]">
            {g.title}
          </div>
          <div className="flex flex-col gap-1">
            {g.keys.map((k) => (
              <AttributeRow
                key={k}
                label={ATTRIBUTE_LABELS[k] ?? k}
                value={attributes[k] ?? null}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function AttributeRow({
  label,
  value,
}: {
  label: string
  value: { value: number; delta: number | null } | null
}) {
  const hasValue = value !== null
  const v = value?.value ?? 0
  const delta = value?.delta ?? null
  const boosted = delta !== null && delta > 0
  const downgraded = delta !== null && delta < 0
  // Bar geometry:
  //   - Neutral base width  = (value − max(0, delta)). For a +3 boost on 95
  //     this means the base bar fills 0..92 in neutral tone, then a green
  //     overlay fills 92..95. The two segments visually flow together.
  //   - Nerf overlay (delta < 0) extends BEYOND the current value to where
  //     the rating would have sat without the nerf — striped red marker
  //     from `v` to `v - delta` (delta is negative here, so `v - delta > v`).
  const baseWidth = hasValue ? Math.max(0, Math.min(100, v - Math.max(0, delta ?? 0))) : 0
  const boostWidth = boosted ? Math.max(0, Math.min(100, delta ?? 0)) : 0
  const nerfStart = downgraded ? Math.min(100, v) : 0
  const nerfWidth = downgraded ? Math.max(0, Math.min(100 - nerfStart, Math.abs(delta ?? 0))) : 0
  const baseTone = !hasValue
    ? 'bg-transparent'
    : v >= 85
      ? 'bg-[var(--color-fg-1)]'
      : 'bg-[var(--color-fg-4)]'
  const nameTone = !hasValue
    ? 'text-[var(--color-fg-5)]'
    : v >= 85
      ? 'text-[var(--color-fg-1)]'
      : 'text-[var(--color-fg-3)]'
  const valTone = boosted
    ? 'text-[var(--color-win)]'
    : downgraded
      ? 'text-[var(--color-loss)]'
      : !hasValue
        ? 'text-[var(--color-fg-5)]'
        : v >= 85
          ? 'text-[var(--color-fg-1)]'
          : 'text-[var(--color-fg-2)]'
  const deltaTone = boosted
    ? 'text-[var(--color-win)]'
    : downgraded
      ? 'text-[var(--color-loss)]'
      : 'text-[var(--color-fg-6)]'
  const deltaText = delta === null ? '·' : delta > 0 ? `+${delta}` : `${delta}`

  return (
    <div className="grid grid-cols-[1fr_36px_28px] items-center gap-1">
      <span
        className={`font-condensed text-[11px] font-semibold uppercase tracking-[0.04em] ${nameTone}`}
      >
        {label}
      </span>
      <span
        className={`text-right font-condensed text-[12px] font-extrabold tabular-nums ${valTone}`}
      >
        {hasValue ? v : '—'}
      </span>
      <span className={`text-right font-condensed text-[10px] font-bold tabular-nums ${deltaTone}`}>
        {deltaText}
      </span>
      <span className="relative col-span-3 mt-0.5 block h-[3px] w-full bg-[var(--color-border-subtle)]">
        <span
          className={`absolute left-0 top-0 block h-full ${baseTone}`}
          style={{ width: `${baseWidth}%` }}
        />
        {boostWidth > 0 ? (
          <span
            className="absolute top-0 block h-full bg-[var(--color-win)] [box-shadow:0_0_6px_rgba(34,197,94,0.5)]"
            style={{ left: `${baseWidth}%`, width: `${boostWidth}%` }}
            aria-label={`boosted +${String(delta)}`}
          />
        ) : null}
        {nerfWidth > 0 ? (
          <span
            className="absolute top-0 block h-full bg-[var(--color-loss)] opacity-80 [background-image:repeating-linear-gradient(135deg,transparent_0,transparent_2px,rgba(0,0,0,0.25)_2px,rgba(0,0,0,0.25)_3px)]"
            style={{ left: `${nerfStart}%`, width: `${nerfWidth}%` }}
            aria-label={`reduced ${String(delta)}`}
          />
        ) : null}
      </span>
    </div>
  )
}
