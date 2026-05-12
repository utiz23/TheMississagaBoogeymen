'use client'

import { useState } from 'react'

/**
 * Compact reskin of the match-detail-page <PossessionEdgeBar> gauge,
 * sized for the latest-result scoreboard.
 *
 * Adds a `?` help button that toggles a legend describing the four DtW bands:
 *  0–34  Bad        (red)
 *  35–54 Even       (orange)
 *  55–74 Good       (green)
 *  75+   Dominated  (blue)
 *
 * Gauge geometry (BGM red arc / OPP grey arc / white needle) is unchanged
 * from the existing match-detail component — same visual vocabulary, smaller.
 */
export function DtwChip({ bgmShare, bgmRaw }: { bgmShare: number; bgmRaw: number }) {
  const [open, setOpen] = useState(false)

  // Arc geometry — semi-circle from -180° (BGM) to 0° (OPP).
  const cx = 24
  const cy = 22
  const r = 18
  const strokeW = 4
  const clamped = Math.max(1, Math.min(99, bgmShare))
  const splitDeg = -((1 - clamped / 100) * 180)
  const needleRad = (((1 - clamped / 100) * -180) * Math.PI) / 180
  const needleX = cx + Math.cos(needleRad) * (r - 2)
  const needleY = cy + Math.sin(needleRad) * (r - 2)
  const arc = (start: number, end: number) => {
    const s = polar(cx, cy, r, start)
    const e = polar(cx, cy, r, end)
    return `M ${s.x.toString()} ${s.y.toString()} A ${r.toString()} ${r.toString()} 0 0 1 ${e.x.toString()} ${e.y.toString()}`
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <span
        className="inline-flex items-center gap-2 rounded-sm border border-accent/45 bg-accent/[0.08] px-2 py-1"
        title={`Deserve to Win: ${bgmRaw.toFixed(1)}`}
      >
        <svg viewBox="0 0 48 26" width="48" height="26" aria-hidden>
          <path
            d={arc(-180, 0)}
            fill="none"
            stroke="#0d1117"
            strokeWidth={strokeW + 2}
            strokeLinecap="butt"
          />
          <path
            d={arc(-180, splitDeg)}
            fill="none"
            stroke="#e84131"
            strokeWidth={strokeW}
            strokeLinecap="butt"
          />
          <path
            d={arc(splitDeg, 0)}
            fill="none"
            stroke="#3a3839"
            strokeWidth={strokeW}
            strokeLinecap="butt"
          />
          <line
            x1={cx}
            y1={cy}
            x2={needleX}
            y2={needleY}
            stroke="#ebebeb"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cy} r="2" fill="#ebebeb" />
          <circle cx={cx} cy={cy} r="1" fill="#0d1117" />
        </svg>
        <span className="flex flex-col leading-none">
          <span className="flex items-center gap-1.5">
            <span className="font-condensed text-[8.5px] font-bold uppercase tracking-[0.22em] text-fg-3">
              DtW
            </span>
            <button
              type="button"
              aria-expanded={open}
              aria-controls="dtw-legend"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setOpen((prev) => !prev)
              }}
              className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border font-condensed text-[9px] font-black leading-none transition-colors ${
                open
                  ? 'border-accent/60 bg-accent/[0.10] text-accent'
                  : 'border-fg-4/45 bg-background/40 text-fg-3 hover:border-fg-3 hover:text-fg-1'
              }`}
            >
              ?
            </button>
          </span>
          <span className="mt-0.5 font-condensed text-sm font-black tabular-nums text-accent">
            {bgmRaw.toFixed(1)}
          </span>
        </span>
      </span>

      {open && (
        <div
          id="dtw-legend"
          className="flex flex-wrap items-center justify-center gap-2.5 px-1 pt-0.5 font-condensed text-[8.5px] font-bold uppercase tracking-[0.18em]"
        >
          <Swatch color="#e84131" label="0–34 Bad" />
          <Swatch color="#f59e0b" label="35–54 Even" />
          <Swatch color="#10b981" label="55–74 Good" />
          <Swatch color="#38bdf8" label="75+ Dominated" />
        </div>
      )}
    </div>
  )
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="h-[7px] w-[7px] rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
      <span className="text-fg-4">{label}</span>
    </span>
  )
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180
  return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r }
}
