import type { LineupRow } from '@eanhl/db/queries'
import {
  attributeBarGeometry,
  buildAttributeTables,
  formatHand,
  splitBuild,
  type AttributeValue,
} from '@/lib/head-to-head'
import { delayVar } from '@/lib/motion'
import { CountUp } from '@/components/matches/motion'
import { DrawerKicker, DrawerShell, DrawerTable, FullPlayerPageLink } from './drawer-shell'

// LOADOUTS drawer — one player's build card, matching the prototype: a bio
// strip (Height / Weight · Hand · Level │ Build) over the 5 attribute groups.
//
// Each attribute row carries the prototype's two columns: R (the rating with
// the X-Factor build applied) and Δ (points gained or lost against the base
// archetype), over a rating bar with boost/nerf overlays. Groups auto-fit at a
// 168px floor so the drawer sits 5-up at full width and reflows below that.

interface DrawerLoadoutProps {
  posLabel: string
  row: LineupRow | null
  side: 'bgm' | 'opp'
}

const ATTR_COLUMNS = [
  { label: 'R', title: "Rating — this player's attribute value with their X-Factor build applied" },
  { label: 'Δ', title: 'Change — points gained or lost versus the base archetype rating' },
]

export function DrawerLoadout({ posLabel, row, side }: DrawerLoadoutProps) {
  const groups = buildAttributeTables(row?.attributes ?? null)
  return (
    <DrawerShell>
      <DrawerKicker
        posLabel={posLabel}
        row={row}
        side={side}
        trailing={
          row !== null && !hasAttributes(row) ? <MissingChip label="No loadout captured" /> : null
        }
      />

      <BioStrip row={row} />

      <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(168px,1fr))]">
        {groups.map((g) => (
          <DrawerTable key={g.title} title={g.title} columns={ATTR_COLUMNS}>
            {g.rows.map((r) => (
              <AttributeRowView key={r.key} label={r.label} v={r.value} />
            ))}
          </DrawerTable>
        ))}
      </div>

      <FullPlayerPageLink bgmRow={side === 'bgm' ? row : null} />
    </DrawerShell>
  )
}

function hasAttributes(row: LineupRow): boolean {
  return row.attributes !== null && Object.keys(row.attributes).length > 0
}

function MissingChip({ label }: { label: string }) {
  return (
    <span className="border border-dashed border-border px-[7px] py-0.5 font-condensed text-[12px] font-bold uppercase leading-none tracking-[0.12em] text-fg-4">
      {label}
    </span>
  )
}

// ─── Bio strip ───────────────────────────────────────────────────────────────

/**
 * The prototype's bio strip: label-over-value cells in a row, with Build last
 * behind a rule and the reference player as a dimmed wide-tracked suffix
 * ("SNIPER · C. CAUFIELD").
 */
function BioStrip({ row }: { row: LineupRow | null }) {
  const hwParts: string[] = []
  if (row?.heightText) hwParts.push(row.heightText)
  if (row?.weightLbs != null) hwParts.push(`${row.weightLbs.toString()} lb`)
  const level =
    row?.playerLevelNumber != null
      ? `${row.playerPrestigeNumber !== null ? `P${row.playerPrestigeNumber.toString()}·` : ''}L${row.playerLevelNumber.toString()}`
      : '—'
  const { build, ref } = row !== null ? splitBuild(row) : { build: '—', ref: null }

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2.5 border border-border bg-surface px-2.5 py-2">
      <BioCell label="Height / Weight" value={hwParts.length > 0 ? hwParts.join(' · ') : '—'} />
      <BioCell label="Hand" value={row !== null ? formatHand(row.handedness) : '—'} />
      <BioCell label="Level" value={level} />
      <span className="flex flex-col gap-1 border-l border-border pl-4">
        <span className="font-condensed text-[12px] font-semibold uppercase tracking-[0.18em] text-fg-4">
          Build
        </span>
        <span
          className={`font-condensed text-[13px] font-bold uppercase ${
            build === '—' || build === 'Unknown build' ? 'text-fg-4' : 'text-fg-2'
          }`}
        >
          {build}
          {ref !== null ? (
            <span className="pl-[7px] text-[12px] font-semibold tracking-[0.14em] text-fg-5">
              · {ref}
            </span>
          ) : null}
        </span>
      </span>
    </div>
  )
}

function BioCell({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="font-condensed text-[12px] font-semibold uppercase tracking-[0.18em] text-fg-4">
        {label}
      </span>
      <span
        className={`font-condensed text-[13px] font-semibold uppercase tabular-nums ${
          value === '—' ? 'text-fg-4' : 'text-fg-2'
        }`}
      >
        {value}
      </span>
    </span>
  )
}

// ─── Attribute rows ──────────────────────────────────────────────────────────

function attrValueTone(v: AttributeValue | null): string {
  if (v === null) return 'text-fg-4'
  const delta = v.delta ?? 0
  if (delta > 0) return 'text-win'
  if (delta < 0) return 'text-loss'
  return v.value >= 85 ? 'text-fg-1' : 'text-fg-2'
}

function AttributeRowView({ label, v }: { label: string; v: AttributeValue | null }) {
  const delta = v?.delta ?? 0
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2">
      <span
        title={label}
        className="truncate font-condensed text-[12px] font-normal uppercase tracking-normal text-fg-4"
      >
        {label}
      </span>
      {/* R-value spin-up — the numbers climb as the bars grow, so the pair
          lands as one event. Prototype timing: 700ms, ease-out cubic (which is
          what CountUp already uses). CountUp renders the resting text as its
          initial HTML, so no-JS and reduced-motion both show the final value. */}
      <span
        className={`min-w-[26px] text-right font-condensed text-[12px] font-extrabold tabular-nums ${attrValueTone(v)}`}
      >
        {v !== null ? (
          <CountUp value={v.value} durationMs={700}>
            {v.value.toString()}
          </CountUp>
        ) : (
          '—'
        )}
      </span>
      {/* Δ blank at zero rather than "0" — the prototype used a `·` glyph here
          and its own review called that cryptic. Nothing = no change. */}
      <span
        title={
          delta !== 0
            ? `${label} ${delta > 0 ? 'boosted' : 'reduced'} ${delta > 0 ? '+' : ''}${delta.toString()}`
            : undefined
        }
        className={`min-w-[20px] text-right font-condensed text-[12px] font-bold tabular-nums ${
          delta > 0 ? 'cursor-help text-win' : delta < 0 ? 'cursor-help text-loss' : 'text-fg-5'
        }`}
      >
        {delta > 0 ? `+${delta.toString()}` : delta < 0 ? delta.toString() : ''}
      </span>
      <span className="col-span-3 mt-0.5 pb-1">
        <AttributeBar v={v} />
      </span>
    </div>
  )
}

/**
 * Rating rail with the boost (win-green) and nerf (striped loss-red beyond the
 * current value) overlays the prototype drew.
 *
 * Motion: every fill grows left-to-right as the drawer lands (the prototype's
 * `.bcast-bar`), and a boosted segment flares once behind it (`.bar-boost`).
 * The drawer mounts on open, so these replay on each expand — which is the
 * whole point of the cue. `gs-flare-drop` rather than `gs-flare-accent`: it
 * animates `filter`, so it doesn't fight the resting box-shadow the boost
 * segment already carries, and it can share an element that is also growing.
 */
function AttributeBar({ v }: { v: AttributeValue | null }) {
  const { baseWidth, boostWidth, nerfStart, nerfWidth } = attributeBarGeometry(v)
  const baseTone = v === null ? '' : v.value >= 85 ? 'bg-fg-1' : 'bg-fg-4'
  return (
    <span className="relative block h-[3px] w-full bg-border-subtle">
      <span
        className={`gs-grow-x absolute left-0 top-0 block h-full ${baseTone}`}
        style={{ width: `${baseWidth.toString()}%` }}
      />
      {boostWidth > 0 ? (
        <span
          className="gs-flare-drop absolute top-0 block h-full bg-win [box-shadow:0_0_6px_rgba(34,197,94,0.5)]"
          style={{
            left: `${baseWidth.toString()}%`,
            width: `${boostWidth.toString()}%`,
            ...delayVar(320),
          }}
        />
      ) : null}
      {nerfWidth > 0 ? (
        <span
          className="absolute top-0 block h-full bg-loss opacity-80 [background-image:repeating-linear-gradient(135deg,transparent_0,transparent_2px,rgba(0,0,0,0.25)_2px,rgba(0,0,0,0.25)_3px)]"
          style={{ left: `${nerfStart.toString()}%`, width: `${nerfWidth.toString()}%` }}
        />
      ) : null}
    </span>
  )
}
