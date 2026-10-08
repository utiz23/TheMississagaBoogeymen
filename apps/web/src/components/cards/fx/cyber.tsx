/**
 * Cyber (futureC, mythic): circuit traces with running current around the
 * shelf frame, stat row and footer, plus a masked current over the card.
 * Port of PlayerCard.dc.html fxTraceFrame / fxTraceStats / fxTraceFoot and the
 * fxFuture 'lab' branch. `on` = motion allowed now.
 */
import type { CSSProperties } from 'react'
import { FRAME_POINTS } from './geometry'

interface Traces {
  line: string
  hot: string
}

const svgBox: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: '100%',
  height: '100%',
  overflow: 'visible',
  pointerEvents: 'none',
}
const hotGlow = (hot: string) => ({ filter: `drop-shadow(0 0 3px ${hot})` })

export function TraceFrame({ traces, on }: { traces: Traces; on: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 240 200"
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: -1,
      }}
    >
      <polygon
        points={FRAME_POINTS}
        fill="rgba(10,6,22,0.35)"
        stroke={traces.line}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {on && (
        <polygon
          points={FRAME_POINTS}
          fill="none"
          pathLength={1000}
          stroke={traces.hot}
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeDasharray="60 940"
          vectorEffect="non-scaling-stroke"
          style={{ animation: 'hpcCurrent 7s linear infinite', ...hotGlow(traces.hot) }}
        />
      )}
    </svg>
  )
}

function Pad({
  cx,
  cy,
  hot,
  traces,
}: {
  cx: string
  cy: string | number
  hot: boolean
  traces: Traces
}) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={hot ? 3 : 2.4}
      fill={hot ? traces.hot : '#0a0616'}
      stroke={hot ? '#ffd6f6' : traces.line}
      strokeWidth={1}
      style={hot ? { filter: `drop-shadow(0 0 4px ${traces.hot})` } : undefined}
    />
  )
}

function Run({
  x1,
  y1,
  x2,
  y2,
  dur,
  delay,
  traces,
}: {
  x1: string
  y1: string | number
  x2: string
  y2: string | number
  dur: string
  delay: string
  traces: Traces
}) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      pathLength={1000}
      stroke={traces.hot}
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeDasharray="70 930"
      style={{ animation: `hpcCurrent ${dur} linear ${delay} infinite`, ...hotGlow(traces.hot) }}
    />
  )
}

export function TraceStats({ traces, on }: { traces: Traces; on: boolean }) {
  const line = { stroke: traces.line, strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const }
  return (
    <svg aria-hidden style={svgBox}>
      <line x1="0%" y1={0} x2="100%" y2={0} {...line} />
      <line x1="0%" y1="100%" x2="100%" y2="100%" {...line} />
      <line
        x1="75%"
        y1={0}
        x2="100%"
        y2={0}
        stroke={traces.hot}
        strokeWidth={1.2}
        style={hotGlow(traces.hot)}
      />
      {on && <Run x1="3%" y1={0} x2="97%" y2={0} dur="3.6s" delay="0s" traces={traces} />}
      {on && <Run x1="97%" y1="100%" x2="3%" y2="100%" dur="4.4s" delay="-1.8s" traces={traces} />}
      {[12.5, 37.5, 62.5, 87.5].map((x, i) => (
        <Pad key={`p${String(i)}`} cx={`${String(x)}%`} cy={0} hot={i === 3} traces={traces} />
      ))}
      {[16.67, 50, 83.33].map((x, i) => (
        <Pad key={`q${String(i)}`} cx={`${String(x)}%`} cy="100%" hot={false} traces={traces} />
      ))}
    </svg>
  )
}

export function TraceFoot({ traces }: { traces: Traces }) {
  return (
    <svg aria-hidden style={svgBox}>
      {[16.67, 50, 83.33].map((x) => (
        <line
          key={x}
          x1={`${String(x)}%`}
          y1={0}
          x2={`${String(x)}%`}
          y2={10}
          stroke={traces.line}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}

/** Masked current over the card plus the violet inner ring (fxFuture, 'lab'). */
export function CyberOverlay({ circuit, on }: { circuit: string; on: boolean }) {
  return (
    <div
      className="pcard-layer"
      style={{ inset: 0, zIndex: 8, borderRadius: '17px', overflow: 'hidden' }}
    >
      {on && (
        <div
          className="pcard-layer"
          style={{
            inset: 0,
            filter: 'drop-shadow(0 0 3px rgba(255,79,216,0.9))',
            background:
              'linear-gradient(115deg, transparent 42%, #ff4fd8 48%, #ffffff 50%, #ff4fd8 52%, transparent 58%)',
            backgroundSize: '300% 100%',
            WebkitMaskImage: circuit,
            maskImage: circuit,
            WebkitMaskSize: 'cover',
            maskSize: 'cover',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            animation: 'hpcTrace 5s linear infinite',
          }}
        />
      )}
      <div
        className="pcard-layer"
        style={{
          inset: 0,
          borderRadius: '17px',
          boxShadow:
            'inset 0 0 0 1px rgba(200,170,255,0.20), inset 0 0 26px rgba(150,100,255,0.22)',
        }}
      />
    </div>
  )
}
