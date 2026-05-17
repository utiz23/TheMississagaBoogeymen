'use client'

import { useMemo, useState } from 'react'
import type { MatchFaceoffDotRow, MatchFaceoffZoneSummaryRow } from '@eanhl/db/queries'
import { SectionHeader } from '@/components/ui/section-header'
import { RinkSvg } from '@/components/branding/rink'
import { formatPeriodLabel, periodsToShow } from '@/lib/period-label'

/**
 * Faceoff Map — inline rink visualization of per-dot face-off win counts
 * from the post-game Faceoff Map OCR screen. Rendered below the Action
 * Tracker Map on the match detail page.
 *
 * Dots are positioned at fixed, regulation-rink coordinates (extracted
 * from RinkSvg's pre-drawn face-off circles) — no per-match calibration.
 * Each dot shows two side-by-side flag chips: the away win count (left,
 * AWAY_COLOR) and the home win count (right, HOME_COLOR), mimicking the
 * EA in-game treatment.
 *
 * BGM↔home/away resolution happens here via bgmWasHome, mirroring
 * ActionTrackerMap's color/side handling. When OCR couldn't read a dot
 * the flag renders an em-dash so the user can distinguish "unread" from
 * "zero".
 */

interface FaceoffMapProps {
  dots: MatchFaceoffDotRow[]
  zones: MatchFaceoffZoneSummaryRow[]
  /** Whether BGM had home ice. Drives flag color mapping. */
  bgmWasHome?: boolean | null
  /** OCR-extracted BGM team color hex (e.g. "#ce202f"). */
  bgmColor?: string | null
  /** OCR-extracted opponent team color hex. */
  oppColor?: string | null
  /** Opponent display label (used in the zone-summary header). */
  opponentLabel: string
}

// Defaults applied per TEAM (not per side) so BGM keeps its brand red even
// when bgm_was_home flips, and even when the OCR colour-extractor hasn't
// produced a per-match hex yet. Match values from the DB override these.
const BGM_FALLBACK = '#ce202f'
const OPP_FALLBACK = '#233f94'

const VIEW_W = 2405
const VIEW_H = 1025

const DOT_IDS = [
  'lz_top',
  'lz_bot',
  'lnz_top',
  'lnz_bot',
  'center',
  'rnz_top',
  'rnz_bot',
  'rz_top',
  'rz_bot',
] as const

// Canonical face-off dot positions, pulled directly from
// apps/web/src/components/branding/rink.tsx where the same nine circles are
// drawn for the rink visualization (DOT fill, r=12). Independent of any
// per-match spatial calibration — face-off positions are fixed.
const DOT_POSITIONS: Record<(typeof DOT_IDS)[number], { x: number; y: number }> = {
  lz_top: { x: 374.5, y: 248.42 },
  lz_bot: { x: 374.5, y: 776.42 },
  lnz_top: { x: 962.5, y: 248.5 },
  lnz_bot: { x: 962.5, y: 770.15 },
  center: { x: 1202.5, y: 512.5 },
  rnz_top: { x: 1444.89, y: 248.5 },
  rnz_bot: { x: 1444.89, y: 770.15 },
  rz_top: { x: 2030.5, y: 248.5 },
  rz_bot: { x: 2030.5, y: 785.17 },
}

type PeriodFilter = 'all' | number

interface DotWins {
  awayWins: number | null
  homeWins: number | null
}

export function FaceoffMap({
  dots,
  zones,
  bgmWasHome,
  bgmColor,
  oppColor,
  opponentLabel,
}: FaceoffMapProps) {
  const bgmIsHome = bgmWasHome !== false
  // Resolve per-team colours first, then assign to home/away by which
  // side BGM played. Keeps BGM = red, opp = navy regardless of bgmWasHome,
  // which matches user intuition ("BGM is always red on our site").
  const bgmResolved = bgmColor ?? BGM_FALLBACK
  const oppResolved = oppColor ?? OPP_FALLBACK
  const HOME_COLOR = bgmIsHome ? bgmResolved : oppResolved
  const AWAY_COLOR = bgmIsHome ? oppResolved : bgmResolved

  const maxPeriodSeen = useMemo(() => {
    let m = 3
    for (const d of dots) {
      if (d.periodNumber !== -1 && d.periodNumber > m) m = d.periodNumber
    }
    return m
  }, [dots])

  const periodList = useMemo(() => periodsToShow(maxPeriodSeen), [maxPeriodSeen])

  const periodHasData = useMemo(() => {
    const set = new Set<number>()
    for (const d of dots) if (d.periodNumber !== -1) set.add(d.periodNumber)
    return set
  }, [dots])

  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all')

  const visibleDots = useMemo<Map<string, DotWins>>(() => {
    if (periodFilter === 'all') {
      // Sum per dot across all per-period rows (skipping the -1 aggregate
      // rows so we don't double-count). NULLs are treated as 0 for the
      // purposes of summing; whether to render '—' for the resulting "0"
      // is decided per-dot below.
      const acc = new Map<string, DotWins>()
      for (const d of dots) {
        if (d.periodNumber === -1) continue
        const entry = acc.get(d.dotId) ?? { awayWins: 0, homeWins: 0 }
        entry.awayWins = (entry.awayWins ?? 0) + (d.awayWins ?? 0)
        entry.homeWins = (entry.homeWins ?? 0) + (d.homeWins ?? 0)
        acc.set(d.dotId, entry)
      }
      return acc
    }
    const acc = new Map<string, DotWins>()
    for (const d of dots) {
      if (d.periodNumber !== periodFilter) continue
      acc.set(d.dotId, { awayWins: d.awayWins, homeWins: d.homeWins })
    }
    return acc
  }, [dots, periodFilter])

  const visibleZones = useMemo(() => {
    const rows = zones.filter((z) => {
      if (periodFilter === 'all') return z.periodNumber === -1 || true
      return z.periodNumber === periodFilter
    })
    // When showing 'all', prefer the EA aggregate row (periodNumber = -1)
    // when it exists; otherwise sum per-period rows.
    if (periodFilter === 'all') {
      const aggregate = zones.filter((z) => z.periodNumber === -1)
      if (aggregate.length > 0) return aggregate
      // Sum: oz/dz wins+total per side, recompute overall pct from totals.
      const byteamSide = new Map<
        'home' | 'away',
        {
          ozWins: number
          ozTotal: number
          dzWins: number
          dzTotal: number
        }
      >()
      for (const z of zones) {
        if (z.periodNumber === -1) continue
        const acc = byteamSide.get(z.teamSide) ?? {
          ozWins: 0,
          ozTotal: 0,
          dzWins: 0,
          dzTotal: 0,
        }
        acc.ozWins += z.offensiveZoneWins ?? 0
        acc.ozTotal += z.offensiveZoneTotal ?? 0
        acc.dzWins += z.defensiveZoneWins ?? 0
        acc.dzTotal += z.defensiveZoneTotal ?? 0
        byteamSide.set(z.teamSide, acc)
      }
      const out: MatchFaceoffZoneSummaryRow[] = []
      for (const [side, acc] of byteamSide) {
        const totalWins = acc.ozWins + acc.dzWins
        const totalAll = acc.ozTotal + acc.dzTotal
        const pct = totalAll > 0 ? ((totalWins / totalAll) * 100).toFixed(2) : null
        out.push({
          id: 0,
          matchId: 0,
          periodNumber: -1,
          periodLabel: 'All Periods',
          teamSide: side,
          overallWinPct: pct,
          offensiveZoneWins: acc.ozWins,
          offensiveZoneTotal: acc.ozTotal,
          defensiveZoneWins: acc.dzWins,
          defensiveZoneTotal: acc.dzTotal,
          source: 'ocr',
          ocrExtractionId: null,
          reviewStatus: 'reviewed',
        })
      }
      return out
    }
    return rows
  }, [zones, periodFilter])

  if (dots.length === 0 && zones.length === 0) {
    return null
  }

  // For the "all" view, if a dot ended up with 0/0 wins purely because
  // every period had NULL values, render em-dashes. Otherwise render 0.
  const allDotsUnread = (dotId: string): { away: boolean; home: boolean } => {
    if (periodFilter !== 'all') {
      const entry = visibleDots.get(dotId)
      return {
        away: entry?.awayWins == null,
        home: entry?.homeWins == null,
      }
    }
    let awayHas = false
    let homeHas = false
    for (const d of dots) {
      if (d.periodNumber === -1) continue
      if (d.dotId !== dotId) continue
      if (d.awayWins != null) awayHas = true
      if (d.homeWins != null) homeHas = true
    }
    return { away: !awayHas, home: !homeHas }
  }

  const oppAbbr = abbreviateTeam(opponentLabel)
  const bgmLabel = 'BGM'
  const homeLabel = bgmIsHome ? bgmLabel : oppAbbr
  const awayLabel = bgmIsHome ? oppAbbr : bgmLabel

  return (
    <section className="space-y-3">
      <SectionHeader label="Faceoff Map" subtitle="Post-game OCR · per-dot win counts" />
      <PeriodBar periodList={periodList} periodHasData={periodHasData} value={periodFilter} onChange={setPeriodFilter} />
      <ZoneSummary
        zones={visibleZones}
        bgmIsHome={bgmIsHome}
        bgmColor={HOME_COLOR}
        oppColor={AWAY_COLOR}
        homeLabel={homeLabel}
        awayLabel={awayLabel}
      />
      <div
        className="relative w-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 pb-2 pt-3.5"
        style={{ aspectRatio: `${String(VIEW_W)} / ${String(VIEW_H)}` }}
      >
        <RinkSvg className="block h-full w-full" />
        <svg
          viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
          preserveAspectRatio="xMidYMid meet"
          className="pointer-events-none absolute inset-0 block h-full w-full"
          aria-hidden
        >
          {DOT_IDS.map((dotId) => {
            const pos = DOT_POSITIONS[dotId]
            const wins = visibleDots.get(dotId)
            const unread = allDotsUnread(dotId)
            return (
              <DotFlags
                key={dotId}
                cx={pos.x}
                cy={pos.y}
                awayLabel={unread.away ? '—' : String(wins?.awayWins ?? 0)}
                homeLabel={unread.home ? '—' : String(wins?.homeWins ?? 0)}
                awayColor={AWAY_COLOR}
                homeColor={HOME_COLOR}
              />
            )
          })}
        </svg>
      </div>
    </section>
  )
}

function DotFlags({
  cx,
  cy,
  awayLabel,
  homeLabel,
  awayColor,
  homeColor,
}: {
  cx: number
  cy: number
  awayLabel: string
  homeLabel: string
  awayColor: string
  homeColor: string
}) {
  const W = 70
  const H = 78
  const GAP = 6
  return (
    <g transform={`translate(${String(cx)}, ${String(cy)})`}>
      {/* Away flag — left of the dot. */}
      <g transform={`translate(${String(-W - GAP / 2)}, ${String(-H / 2)})`}>
        <polygon
          points={`0,0 ${String(W)},0 ${String(W)},${String(H * 0.7)} ${String(W / 2)},${String(H)} 0,${String(H * 0.7)}`}
          fill={awayColor}
          stroke="rgba(255,255,255,0.55)"
          strokeWidth={1.5}
        />
        <text
          x={W / 2}
          y={H * 0.42}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="system-ui, sans-serif"
          fontSize={42}
          fontWeight={800}
          fill="white"
        >
          {awayLabel}
        </text>
      </g>
      {/* Home flag — right of the dot. */}
      <g transform={`translate(${String(GAP / 2)}, ${String(-H / 2)})`}>
        <polygon
          points={`0,0 ${String(W)},0 ${String(W)},${String(H * 0.7)} ${String(W / 2)},${String(H)} 0,${String(H * 0.7)}`}
          fill={homeColor}
          stroke="rgba(255,255,255,0.55)"
          strokeWidth={1.5}
        />
        <text
          x={W / 2}
          y={H * 0.42}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="system-ui, sans-serif"
          fontSize={42}
          fontWeight={800}
          fill="white"
        >
          {homeLabel}
        </text>
      </g>
    </g>
  )
}

// ─── Period filter bar ───────────────────────────────────────────────────────

function PeriodBar({
  periodList,
  periodHasData,
  value,
  onChange,
}: {
  periodList: readonly number[]
  periodHasData: Set<number>
  value: PeriodFilter
  onChange: (v: PeriodFilter) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
      <span className="font-condensed text-[9px] font-bold uppercase tracking-[0.22em] text-[var(--color-fg-5)]">
        Period
      </span>
      <div className="inline-flex divide-x divide-[var(--color-border)] border border-[var(--color-border)] bg-[var(--color-background)]">
        <SegBtn active={value === 'all'} onClick={() => onChange('all')} label="All" />
        {periodList.map((n) => {
          const enabled = periodHasData.has(n)
          return (
            <SegBtn
              key={n}
              active={value === n}
              onClick={() => { if (enabled) onChange(n) }}
              label={formatPeriodLabel(n)}
              disabled={!enabled}
            />
          )
        })}
      </div>
    </div>
  )
}

function SegBtn({
  active,
  onClick,
  label,
  disabled = false,
}: {
  active: boolean
  onClick: () => void
  label: string
  disabled?: boolean
}) {
  const base =
    'inline-flex items-center gap-1.5 px-2.5 py-1.5 font-condensed text-[10.5px] font-bold uppercase tracking-[0.14em] whitespace-nowrap transition-colors'
  const tone = disabled
    ? 'cursor-not-allowed text-[var(--color-fg-6)] opacity-50'
    : active
      ? 'bg-[rgba(232,65,49,0.10)] text-[var(--color-accent)]'
      : 'text-[var(--color-fg-4)] hover:text-[var(--color-fg-2)]'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-disabled={disabled || undefined}
      className={`${base} ${tone}`}
    >
      {label}
    </button>
  )
}

// ─── Zone summary strip ──────────────────────────────────────────────────────

function ZoneSummary({
  zones,
  bgmIsHome,
  bgmColor,
  oppColor,
  homeLabel,
  awayLabel,
}: {
  zones: MatchFaceoffZoneSummaryRow[]
  bgmIsHome: boolean
  bgmColor: string
  oppColor: string
  homeLabel: string
  awayLabel: string
}) {
  if (zones.length === 0) return null
  const home = zones.find((z) => z.teamSide === 'home')
  const away = zones.find((z) => z.teamSide === 'away')

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <SideStat label={awayLabel} color={oppColor} isBgm={!bgmIsHome} zone={away ?? null} />
      <SideStat label={homeLabel} color={bgmColor} isBgm={bgmIsHome} zone={home ?? null} />
    </div>
  )
}

function SideStat({
  label,
  color,
  isBgm,
  zone,
}: {
  label: string
  color: string
  isBgm: boolean
  zone: MatchFaceoffZoneSummaryRow | null
}) {
  const pct = zone?.overallWinPct
  const oz =
    zone?.offensiveZoneTotal != null
      ? `${String(zone.offensiveZoneWins ?? 0)}/${String(zone.offensiveZoneTotal)}`
      : '—'
  const dz =
    zone?.defensiveZoneTotal != null
      ? `${String(zone.defensiveZoneWins ?? 0)}/${String(zone.defensiveZoneTotal)}`
      : '—'
  return (
    <div className="flex items-center justify-between border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3" style={{ backgroundColor: color }} aria-hidden />
        <span className="font-condensed text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-fg-2)]">
          {label}
          {isBgm ? <span className="ml-1 text-[var(--color-accent)]">·</span> : null}
        </span>
      </div>
      <div className="flex items-center gap-4 font-condensed text-[11px] uppercase tracking-[0.12em] tabular-nums text-[var(--color-fg-3)]">
        <Stat label="Overall" value={pct ? `${String(pct)}%` : '—'} />
        <Stat label="OZ" value={oz} />
        <Stat label="DZ" value={dz} />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-[9px] tracking-[0.22em] text-[var(--color-fg-5)]">{label}</span>
      <span className="text-[var(--color-fg-1)]">{value}</span>
    </span>
  )
}

function abbreviateTeam(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'OPP'
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase()
  return words
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')
}
