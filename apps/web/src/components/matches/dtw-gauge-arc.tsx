'use client'

import { useEffect, useRef } from 'react'

import { delayDurationVars, sweepNeedle, DTW_SWEEP_DELAY_MS, DTW_SWEEP_MS } from '@/lib/motion'

import { useReducedMotion } from './motion'

// The DtW arc gauge, split out of `dtw-gauge.tsx` so the needle sweep can be a
// client animation without shipping the module's contributor/coverage
// derivations to the browser. Geometry is unchanged from the static version
// (itself ported verbatim from the pre-revamp possession-edge component).
//
// Motion (Phase 12): one continuous front sweeps left→right — the accent
// segment fills to the reading, the opponent segment carries on to 100% — and
// the needle rides that front, landing without overshoot. Everything below
// renders at its FINAL value; motion is layered on top, so SSR, no-JS and
// reduced-motion all paint the correct gauge.

const CX = 120
const CY = 120
const R = 96
const NEEDLE_LEN = 86

export function DtwGaugeArc({ bgmPct }: { bgmPct: number }) {
  const clamped = Math.max(0, Math.min(100, bgmPct))
  // bgmPct=100 → 0° (right), bgmPct=0 → 180° (left)
  const angDeg = 180 - 1.8 * clamped
  const ang = (angDeg * Math.PI) / 180
  const splitX = (CX + R * Math.cos(ang)).toFixed(2)
  const splitY = (CY - R * Math.sin(ang)).toFixed(2)
  const tipX = (CX + NEEDLE_LEN * Math.cos(ang)).toFixed(2)
  const tipY = (CY - NEEDLE_LEN * Math.sin(ang)).toFixed(2)

  // Fixed per side, as the prototype draws it. This is one quantity split in
  // two, not two competing bars: the accent segment IS BGM's share, so muting
  // it when BGM trails would make a small red arc mean two different things.
  const bgmSeg = 'var(--color-accent)'
  const oppSeg = 'var(--opp-2)'

  // Segment durations are shares of one front, so the hand-off at the split
  // point is seamless rather than two fills that happen to abut.
  const bgmShare = clamped / 100
  const bgmMs = Math.round(DTW_SWEEP_MS * bgmShare)
  const oppMs = DTW_SWEEP_MS - bgmMs

  const needleRef = useRef<SVGLineElement | null>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const el = needleRef.current
    if (!el || reduced) return

    // The needle is DRAWN at its final angle, so the sweep runs from the
    // rotation that puts it back at 0% (pointing left) to no rotation at all.
    // Doing it this way means the resting frame — SSR, no-JS, reduced-motion —
    // is already correct and needs no separate final-state styling.
    const animation = sweepNeedle(el, angDeg - 180, 0, DTW_SWEEP_MS, DTW_SWEEP_DELAY_MS)
    return () => animation?.cancel()
  }, [angDeg, reduced])

  return (
    <svg viewBox="0 0 240 152" className="mx-auto block w-full max-w-[230px]" aria-hidden>
      <path
        d="M 24 120 A 96 96 0 0 1 216 120"
        fill="none"
        stroke="var(--color-charcoal)"
        strokeWidth={30}
      />
      <path
        className="gs-draw-arc"
        style={delayDurationVars(DTW_SWEEP_DELAY_MS, bgmMs)}
        pathLength={1}
        d={`M 24 120 A 96 96 0 0 1 ${splitX} ${splitY}`}
        fill="none"
        stroke={bgmSeg}
        strokeWidth={22}
      />
      <path
        className="gs-draw-arc"
        style={delayDurationVars(DTW_SWEEP_DELAY_MS + bgmMs, oppMs)}
        pathLength={1}
        d={`M ${splitX} ${splitY} A 96 96 0 0 1 216 120`}
        fill="none"
        stroke={oppSeg}
        strokeWidth={22}
      />
      <line x1={24} y1={120} x2={24} y2={130} stroke="var(--color-fg-5)" strokeWidth={1.2} />
      <line x1={120} y1={24} x2={120} y2={14} stroke="var(--color-fg-5)" strokeWidth={1.2} />
      <line x1={216} y1={120} x2={216} y2={130} stroke="var(--color-fg-5)" strokeWidth={1.2} />
      <TickLabel x={24} y={144} text="0%" />
      <TickLabel x={120} y={11} text="50" />
      <TickLabel x={216} y={144} text="100%" />
      <line
        ref={needleRef}
        x1={CX}
        y1={CY}
        x2={tipX}
        y2={tipY}
        stroke="var(--color-fg-1)"
        strokeWidth={3.5}
        strokeLinecap="round"
        style={{ transformBox: 'view-box', transformOrigin: `${String(CX)}px ${String(CY)}px` }}
      />
      <circle cx={CX} cy={CY} r={8} fill="var(--color-fg-1)" />
      <circle cx={CX} cy={CY} r={4} fill="var(--color-background)" />
    </svg>
  )
}

function TickLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      className="font-condensed"
      style={{
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: '0.1em',
        fill: 'var(--color-fg-4)',
      }}
    >
      {text}
    </text>
  )
}
