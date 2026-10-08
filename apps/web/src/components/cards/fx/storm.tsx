/**
 * Storm (stormLive, mythic): rain and lightning footage behind the card,
 * drifting cloud, an electric rim with sparks, and blue arcs/cracks around the
 * shelf frame, stat row and footer. Port of PlayerCard.dc.html fxStormBg /
 * fxStorm / elecRim / fxArc* for the shipping config (strike mode 'random',
 * rimAlways, no flash, no bolt stills). `on` = motion allowed now; `strike`
 * comes from useStormStrike. The footage and rain mount only while `on`.
 */
import type { CardTheme } from '../card-theme-types'
import { VIDEO_FORMATS } from '../card-assets'
import {
  ARC_CRACKS,
  ARC_FOOT_BOLTS,
  ARC_FRAME_BOLTS,
  ARC_STAT_BOLTS,
  FRAME_POINTS,
} from './geometry'

type Art = NonNullable<CardTheme['art']>
type Arc = NonNullable<CardTheme['arc']>

/** Strike gate: fade in fast, out slow (prototype `gate` in 'random' mode). */
const gate = (strike: boolean, onOpacity: number, offOpacity: number) => ({
  opacity: strike ? onOpacity : offOpacity,
  transition: strike ? 'opacity 120ms' : 'opacity 600ms',
})

export function StormBg({ art, on, strike }: { art: Art; on: boolean; strike: boolean }) {
  return (
    <div className="pcard-layer" style={{ inset: 0, zIndex: -1 }}>
      {on && art.rain !== undefined && (
        <img
          src={art.rain}
          alt=""
          className="pcard-layer"
          style={{
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: strike ? 0.15 : 0.35,
            transition: 'opacity 400ms',
            mixBlendMode: 'screen',
          }}
        />
      )}
      {on && art.burst !== undefined && (
        <div style={{ position: 'absolute', inset: 0, ...gate(strike, 1, 0) }}>
          <video
            aria-hidden
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          >
            {VIDEO_FORMATS.map((ext) => (
              <source key={ext} src={`${art.burst ?? ''}.${ext}`} type={`video/${ext}`} />
            ))}
          </video>
          <div
            className="pcard-layer"
            style={{
              inset: 0,
              background:
                'linear-gradient(180deg, rgba(5,8,14,0.05) 0%, rgba(5,8,14,0.30) 40%, rgba(4,6,11,0.62) 66%, rgba(3,4,8,0.85) 100%), linear-gradient(90deg, rgba(5,8,14,0.35), transparent 30%, transparent 70%, rgba(5,8,14,0.35))',
            }}
          />
        </div>
      )}
    </div>
  )
}

const SPARKS: readonly (readonly [Record<string, string>, string])[] = [
  [{ top: '3px', left: '24%' }, '0s'],
  [{ top: '38%', right: '1px' }, '1.3s'],
  [{ bottom: '22%', left: '1px' }, '2.1s'],
  [{ bottom: '2px', right: '30%' }, '3.4s'],
  [{ top: '6px', right: '10%' }, '2.8s'],
]

export function StormOverlay({
  art,
  uid,
  on,
  strike,
}: {
  art: Art
  uid: string
  on: boolean
  strike: boolean
}) {
  const fid = `${uid}-elec`
  return (
    <div
      className="pcard-layer"
      style={{ inset: 0, zIndex: 8, borderRadius: '17px', overflow: 'hidden' }}
    >
      <div
        className="pcard-layer"
        style={{
          inset: '-20%',
          opacity: 0.6,
          mixBlendMode: 'screen',
          filter: 'blur(10px)',
          background:
            'radial-gradient(38% 22% at 28% 30%, rgba(120,140,185,0.32), transparent 70%), radial-gradient(34% 20% at 74% 22%, rgba(100,120,165,0.28), transparent 70%), radial-gradient(40% 20% at 60% 70%, rgba(80,96,140,0.22), transparent 70%)',
          animation: on ? 'hpcCloud 32s ease-in-out infinite alternate' : 'none',
        }}
      />
      {on && (
        <svg
          aria-hidden
          style={{
            position: 'absolute',
            inset: '2px',
            width: 'calc(100% - 4px)',
            height: 'calc(100% - 4px)',
            overflow: 'visible',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          <defs>
            <filter id={fid} x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.035 0.06"
                numOctaves={2}
                seed={1}
                result="n"
              >
                <animate
                  attributeName="seed"
                  values="1;4;7;2;9;5;3;8"
                  dur={art.jitter ?? '3.2s'}
                  calcMode="discrete"
                  repeatCount="indefinite"
                />
              </feTurbulence>
              <feDisplacementMap
                in="SourceGraphic"
                in2="n"
                scale={7}
                xChannelSelector="R"
                yChannelSelector="G"
                result="d"
              />
              <feGaussianBlur in="d" stdDeviation={2.2} result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="b" />
                <feMergeNode in="d" />
              </feMerge>
            </filter>
          </defs>
          <rect
            x={0}
            y={0}
            width="100%"
            height="100%"
            rx={15}
            fill="none"
            stroke="rgba(170,215,255,0.55)"
            strokeWidth={1}
            filter={`url(#${fid})`}
            style={{ animation: 'hpcZapFast 3.3s linear infinite' }}
          />
          <rect
            x={0}
            y={0}
            width="100%"
            height="100%"
            rx={15}
            fill="none"
            pathLength={1000}
            stroke="#eaf6ff"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeDasharray="90 910"
            filter={`url(#${fid})`}
            style={{ animation: 'hpcCurrent 2.6s linear infinite' }}
          />
          <rect
            x={0}
            y={0}
            width="100%"
            height="100%"
            rx={15}
            fill="none"
            pathLength={1000}
            stroke="#9fd2ff"
            strokeWidth={1.2}
            strokeLinecap="round"
            strokeDasharray="50 950"
            strokeDashoffset={-500}
            filter={`url(#${fid})`}
            style={{ animation: 'hpcCurrent 3.7s linear -1.4s infinite reverse' }}
          />
        </svg>
      )}
      {on &&
        SPARKS.map(([pos, delay]) => (
          <div
            key={delay}
            className="pcard-layer"
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#ffffff',
              boxShadow: '0 0 6px 2px rgba(200,232,255,0.95), 0 0 16px 5px rgba(111,182,255,0.6)',
              opacity: 0,
              zIndex: 3,
              animation: `hpcSparkFast 4.2s linear ${delay} infinite`,
              ...pos,
            }}
          />
        ))}
      <div
        className="pcard-layer"
        style={{
          inset: 0,
          borderRadius: '17px',
          boxShadow:
            'inset 0 0 36px 2px rgba(111,182,255,0.40), inset 0 0 10px 1px rgba(200,230,255,0.55), inset 0 0 2px 1px rgba(240,248,255,0.8)',
          ...(on ? gate(strike, 1, 0.3) : { opacity: 0.4 }),
        }}
      />
    </div>
  )
}

function Bolt({
  points,
  arc,
  on,
  dur,
  delay,
  width,
}: {
  points: string
  arc: Arc
  on: boolean
  dur: string
  delay: string
  width: number
}) {
  const animation = on ? `hpcJolt ${dur} linear ${delay} infinite` : 'none'
  return (
    <>
      <polyline
        points={points}
        fill="none"
        stroke={arc.glow}
        strokeWidth={width * 4}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={{ filter: 'blur(2px)', opacity: on ? 0 : 0.25, animation }}
      />
      <polyline
        points={points}
        fill="none"
        stroke={arc.core}
        strokeWidth={width}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={{ opacity: on ? 0 : 0.35, animation }}
      />
    </>
  )
}

function ArcSvg({
  viewBox,
  zIndex,
  arc,
  hit,
  children,
}: {
  viewBox: string
  zIndex: number
  arc: Arc
  hit: boolean
  children: React.ReactNode
}) {
  return (
    <svg
      aria-hidden
      viewBox={viewBox}
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex,
        filter: hit ? `brightness(1.6) drop-shadow(0 0 6px ${arc.glow})` : 'none',
        transition: 'filter 200ms',
      }}
    >
      {children}
    </svg>
  )
}

const FRAME_BOLT_TIMING: readonly (readonly [string, string, number])[] = [
  ['2.8s', '0s', 1.1],
  ['3.7s', '-1.3s', 1],
  ['5.1s', '-3.2s', 0.9],
]

/** Arcs around the shelf frame, plus the frame cracks (prototype fxArcFrame + fxArcCracks). */
export function ArcFrame({ arc, on, strike }: { arc: Arc; on: boolean; strike: boolean }) {
  const hit = on && strike
  return (
    <>
      <ArcSvg viewBox="0 0 240 200" zIndex={-1} arc={arc} hit={hit}>
        <polygon
          points={FRAME_POINTS}
          fill={arc.fill}
          stroke={arc.line}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {ARC_FRAME_BOLTS.map((points, i) => {
          const [dur, delay, width] = FRAME_BOLT_TIMING[i] ?? ['3s', '0s', 1]
          return (
            <Bolt
              key={points}
              points={points}
              arc={arc}
              on={on}
              dur={dur}
              delay={delay}
              width={width}
            />
          )
        })}
      </ArcSvg>
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
        {ARC_CRACKS.map(([points, d]) => {
          const st = {
            opacity: hit ? 1 : on ? undefined : 0.45,
            transition: hit ? 'opacity 80ms' : 'opacity 600ms',
            animation: on && !hit ? `hpcJolt 6s linear ${String(-d)}s infinite` : 'none',
          }
          return (
            <g key={points}>
              <polyline
                points={points}
                fill="none"
                stroke="#6fb6ff"
                strokeWidth={3.5}
                strokeLinejoin="miter"
                vectorEffect="non-scaling-stroke"
                style={{ filter: 'blur(2px)', ...st }}
              />
              <polyline
                points={points}
                fill="none"
                stroke="#eef6ff"
                strokeWidth={1}
                strokeLinejoin="miter"
                vectorEffect="non-scaling-stroke"
                style={{ filter: 'drop-shadow(0 0 2px rgba(150,205,255,0.95))', ...st }}
              />
            </g>
          )
        })}
      </svg>
    </>
  )
}

export function ArcStats({ arc, on, strike }: { arc: Arc; on: boolean; strike: boolean }) {
  return (
    <ArcSvg viewBox="0 0 240 60" zIndex={0} arc={arc} hit={on && strike}>
      {ARC_STAT_BOLTS.map((points, i) => (
        <Bolt
          key={points}
          points={points}
          arc={arc}
          on={on}
          dur={`${String(2.2 + i * 0.9)}s`}
          delay={`${String(-i * 0.7)}s`}
          width={0.9}
        />
      ))}
      <line
        x1={6}
        y1={60}
        x2={234}
        y2={60}
        stroke={arc.line}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </ArcSvg>
  )
}

export function ArcFoot({ arc, on, strike }: { arc: Arc; on: boolean; strike: boolean }) {
  return (
    <ArcSvg viewBox="0 0 240 60" zIndex={0} arc={arc} hit={on && strike}>
      {ARC_FOOT_BOLTS.map((points, i) => (
        <Bolt
          key={points}
          points={points}
          arc={arc}
          on={on}
          dur={`${String(3 + i * 1.1)}s`}
          delay={`${String(-i * 1.4)}s`}
          width={0.9}
        />
      ))}
    </ArcSvg>
  )
}
