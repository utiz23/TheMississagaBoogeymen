import type { LineupRow } from '@eanhl/db/queries'
import {
  attributeBarGeometry,
  buildAttributeCompare,
  formatHand,
  splitBuild,
  type AttributeValue,
} from '@/lib/head-to-head'
import { CompareTable, DrawerKicker, DrawerShell, FullPlayerPageLink } from './drawer-shell'

// LOADOUTS drawer — the build card as a position head-to-head: bio compare
// strip, then the 5 attribute groups as two-valued tables. 3-up grid per the
// prototype review fix (5-up truncated every label at 1280). Boost/nerf bar
// geometry comes from lib/head-to-head (lifted from the donor expand panel).

interface DrawerLoadoutProps {
  posLabel: string
  bgmRow: LineupRow | null
  oppRow: LineupRow | null
  oppAbbrev: string
}

export function DrawerLoadout({ posLabel, bgmRow, oppRow, oppAbbrev }: DrawerLoadoutProps) {
  const groups = buildAttributeCompare(bgmRow?.attributes ?? null, oppRow?.attributes ?? null)
  return (
    <DrawerShell>
      <DrawerKicker
        posLabel={posLabel}
        bgmRow={bgmRow}
        oppRow={oppRow}
        trailing={
          <>
            {bgmRow !== null && !hasAttributes(bgmRow) ? (
              <MissingChip label="No BGM loadout captured" />
            ) : null}
            {oppRow !== null && !hasAttributes(oppRow) ? (
              <MissingChip label={`No ${oppAbbrev} loadout captured`} />
            ) : null}
          </>
        }
      />

      <BioCompareStrip bgmRow={bgmRow} oppRow={oppRow} oppAbbrev={oppAbbrev} />

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <CompareTable key={g.title} title={g.title} oppAbbrev={oppAbbrev}>
            {g.rows.map((r) => (
              <AttributeCompareRowView key={r.key} label={r.label} bgm={r.bgm} opp={r.opp} />
            ))}
          </CompareTable>
        ))}
      </div>

      <FullPlayerPageLink bgmRow={bgmRow} />
    </DrawerShell>
  )
}

function hasAttributes(row: LineupRow): boolean {
  return row.attributes !== null && Object.keys(row.attributes).length > 0
}

function MissingChip({ label }: { label: string }) {
  return (
    <span className="border border-dashed border-border px-1.5 py-0.5 font-condensed text-[9px] font-bold uppercase tracking-[0.12em] text-fg-4">
      {label}
    </span>
  )
}

// ─── Bio strip ───────────────────────────────────────────────────────────────

function bioCells(row: LineupRow | null): { build: string; hw: string; hand: string; lvl: string } {
  if (row === null) return { build: '—', hw: '—', hand: '—', lvl: '—' }
  const { build, ref } = splitBuild(row)
  const hwParts: string[] = []
  if (row.heightText) hwParts.push(row.heightText)
  if (row.weightLbs !== null) hwParts.push(`${row.weightLbs.toString()} lb`)
  const lvl =
    row.playerLevelNumber !== null
      ? `${row.playerPrestigeNumber !== null ? `P${row.playerPrestigeNumber.toString()}·` : ''}L${row.playerLevelNumber.toString()}`
      : '—'
  return {
    build: ref !== null ? `${build} · ${ref}` : build,
    hw: hwParts.length > 0 ? hwParts.join(' · ') : '—',
    hand: formatHand(row.handedness),
    lvl,
  }
}

function BioCompareStrip({
  bgmRow,
  oppRow,
  oppAbbrev,
}: {
  bgmRow: LineupRow | null
  oppRow: LineupRow | null
  oppAbbrev: string
}) {
  const bgm = bioCells(bgmRow)
  const opp = bioCells(oppRow)
  const label = 'font-condensed text-[9px] font-bold uppercase tracking-[0.16em] text-fg-4'
  const sideTag =
    'min-w-[30px] font-condensed text-[9px] font-extrabold uppercase tracking-[0.08em]'
  const cell =
    'truncate font-condensed text-[12px] font-bold uppercase tracking-[0.03em] tabular-nums'
  return (
    <div className="grid grid-cols-[auto_minmax(0,2fr)_minmax(0,1.4fr)_auto_auto] items-baseline gap-x-4 gap-y-1 border border-border bg-surface px-2.5 py-2">
      <span aria-hidden />
      <span className={label}>Build</span>
      <span className={label}>Ht / Wt</span>
      <span className={label}>Hand</span>
      <span className={label}>Level</span>

      <span className={`${sideTag} text-accent`}>BGM</span>
      <span className={`${cell} ${bgm.build === '—' ? 'text-fg-6' : 'text-fg-1'}`}>
        {bgm.build}
      </span>
      <span className={`${cell} text-fg-2`}>{bgm.hw}</span>
      <span className={`${cell} text-fg-2`}>{bgm.hand}</span>
      <span className={`${cell} text-fg-2`}>{bgm.lvl}</span>

      <span className={`${sideTag} [color:var(--opp)]`}>{oppAbbrev}</span>
      <span className={`${cell} ${opp.build === '—' ? 'text-fg-6' : 'text-fg-1'}`}>
        {opp.build}
      </span>
      <span className={`${cell} text-fg-2`}>{opp.hw}</span>
      <span className={`${cell} text-fg-2`}>{opp.hand}</span>
      <span className={`${cell} text-fg-2`}>{opp.lvl}</span>
    </div>
  )
}

// ─── Attribute rows ──────────────────────────────────────────────────────────

function attrValueTone(v: AttributeValue | null): string {
  if (v === null) return 'text-fg-6'
  const delta = v.delta ?? 0
  if (delta > 0) return 'text-win'
  if (delta < 0) return 'text-loss'
  return v.value >= 85 ? 'text-fg-1' : 'text-fg-2'
}

function attrTitle(label: string, v: AttributeValue | null): string | undefined {
  if (!v?.delta) return undefined
  const dir = v.delta > 0 ? 'boosted' : 'reduced'
  return `${label} ${dir} ${v.delta > 0 ? '+' : ''}${v.delta.toString()}`
}

function AttributeCompareRowView({
  label,
  bgm,
  opp,
}: {
  label: string
  bgm: AttributeValue | null
  opp: AttributeValue | null
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2">
      <span className="truncate font-condensed text-[10.5px] font-semibold uppercase tracking-[0.03em] text-fg-3">
        {label}
      </span>
      <span
        title={attrTitle(label, bgm)}
        className={`min-w-[30px] text-right font-condensed text-[12px] font-extrabold tabular-nums ${attrValueTone(bgm)}`}
      >
        {bgm !== null ? bgm.value : '—'}
      </span>
      <span
        title={attrTitle(label, opp)}
        className={`min-w-[30px] text-right font-condensed text-[12px] font-extrabold tabular-nums ${attrValueTone(opp)}`}
      >
        {opp !== null ? opp.value : '—'}
      </span>
      <span className="col-span-3 mt-0.5 flex flex-col gap-[2px] pb-1">
        <AttributeBar v={bgm} side="bgm" />
        <AttributeBar v={opp} side="opp" />
      </span>
    </div>
  )
}

/**
 * Two stacked 3px rails make the "two-value bar" the review asked for: BGM
 * on top in fg tones, opponent underneath riding `--opp`. Boost (win-green)
 * and nerf (striped loss-red beyond the value) overlays render on both.
 */
function AttributeBar({ v, side }: { v: AttributeValue | null; side: 'bgm' | 'opp' }) {
  const { baseWidth, boostWidth, nerfStart, nerfWidth } = attributeBarGeometry(v)
  const baseTone =
    v === null
      ? ''
      : side === 'opp'
        ? 'opacity-75 [background:var(--opp)]'
        : v.value >= 85
          ? 'bg-fg-1'
          : 'bg-fg-4'
  return (
    <span className="relative block h-[3px] w-full bg-border-subtle">
      <span
        className={`absolute left-0 top-0 block h-full ${baseTone}`}
        style={{ width: `${baseWidth.toString()}%` }}
      />
      {boostWidth > 0 ? (
        <span
          className="absolute top-0 block h-full bg-win [box-shadow:0_0_6px_rgba(34,197,94,0.5)]"
          style={{ left: `${baseWidth.toString()}%`, width: `${boostWidth.toString()}%` }}
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
