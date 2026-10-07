/**
 * Hardlight (futureB, T5): synthwave sun and perspective grid in the portrait,
 * plus a scan line and fine scanlines over the card. Port of PlayerCard.dc.html
 * fxFuturePortrait / fxFuture for `future: 'grid'`. Deterministic: no random.
 */

const HZ = 118
const VP = 120
const ZS = [10, 7, 5, 3.6, 2.6, 1.9, 1.4, 1.05, 0.8]
const zy = (z: number) => (HZ + 82 / z).toFixed(1)
const YS = ZS.map(zy).join(';')
const OPS = ZS.map((_, j) => Math.min(1, j / 3).toFixed(2)).join(';')
const STRIPES: readonly (readonly [number, number])[] = [
  [80, 1.5],
  [90, 2.5],
  [99, 3.5],
  [107, 4.5],
  [113, 4],
]
const V_LINES = Array.from({ length: 17 }, (_, i) => {
  const x = VP + (i - 8) * 34
  return { x1: VP + (x - VP) * 0.02, x2: x }
})

export function HardlightPortrait({ uid, animated }: { uid: string; animated: boolean }) {
  const gid = `${uid}-grid`
  return (
    <svg
      viewBox="0 0 240 200"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      <defs>
        <linearGradient id={`${gid}s`} x1={0} y1={0} x2={0} y2={1}>
          <stop offset={0} stopColor="#ffb08a" />
          <stop offset={0.45} stopColor="#e84131" />
          <stop offset={1} stopColor="#7a1a10" />
        </linearGradient>
        <linearGradient id={`${gid}f`} x1={0} y1={0} x2={0} y2={1}>
          <stop offset={0} stopColor="#fff" stopOpacity={0} />
          <stop offset={0.35} stopColor="#fff" stopOpacity={0.7} />
          <stop offset={1} stopColor="#fff" stopOpacity={1} />
        </linearGradient>
        <radialGradient id={`${gid}g`} cx={0.5} cy={0.5} r={0.5}>
          <stop offset={0} stopColor="#e84131" stopOpacity={0.55} />
          <stop offset={1} stopColor="#e84131" stopOpacity={0} />
        </radialGradient>
        <mask id={`${gid}m`}>
          <rect x={-40} y={HZ} width={320} height={90} fill={`url(#${gid}f)`} />
        </mask>
        <mask id={`${gid}b`}>
          <rect x={0} y={0} width={240} height={HZ} fill="#fff" />
          {STRIPES.map(([y, t]) => (
            <rect key={y} x={0} y={y} width={240} height={t} fill="#000" />
          ))}
        </mask>
      </defs>
      <ellipse cx={VP} cy={HZ} rx={150} ry={46} fill={`url(#${gid}g)`} />
      <circle
        cx={VP}
        cy={HZ - 2}
        r={60}
        fill={`url(#${gid}s)`}
        mask={`url(#${gid}b)`}
        opacity={0.92}
      />
      <rect x={-40} y={HZ} width={320} height={90} fill="#050306" />
      <g mask={`url(#${gid}m)`} opacity={0.85}>
        {V_LINES.map((v, i) => (
          <line
            key={`v${String(i)}`}
            x1={v.x1}
            y1={HZ + 1.6}
            x2={v.x2}
            y2={200}
            stroke="#e84131"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {Array.from({ length: 7 }, (_, i) =>
          animated ? (
            <line
              key={`h${String(i)}`}
              x1={-40}
              x2={280}
              y1={HZ}
              y2={HZ}
              stroke="#e84131"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            >
              <animate
                attributeName="y1"
                values={YS}
                dur="7s"
                begin={`${String(-i)}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="y2"
                values={YS}
                dur="7s"
                begin={`${String(-i)}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values={OPS}
                dur="7s"
                begin={`${String(-i)}s`}
                repeatCount="indefinite"
              />
            </line>
          ) : (
            <line
              key={`h${String(i)}`}
              x1={-40}
              x2={280}
              y1={zy(ZS[i + 2] ?? 1)}
              y2={zy(ZS[i + 2] ?? 1)}
              stroke="#e84131"
              strokeWidth={1}
              opacity={Math.min(1, (i + 2) / 3)}
              vectorEffect="non-scaling-stroke"
            />
          ),
        )}
      </g>
      <rect x={-40} y={HZ - 0.5} width={320} height={1.2} fill="#ff9b8e" />
      <rect
        x={-40}
        y={HZ - 3}
        width={320}
        height={6}
        fill="#e84131"
        opacity={0.35}
        style={{ filter: 'blur(2px)' }}
      />
    </svg>
  )
}

export function HardlightOverlay({ scan }: { scan: boolean }) {
  return (
    <div
      className="pcard-layer"
      style={{ inset: 0, zIndex: 8, borderRadius: '17px', overflow: 'hidden' }}
    >
      {scan && (
        <div
          className="pcard-layer"
          style={{
            left: 0,
            right: 0,
            top: 0,
            height: '9%',
            background:
              'linear-gradient(180deg, transparent, rgba(232,65,49,0.10) 80%, rgba(255,150,140,0.55) 100%)',
            animation: 'pcard-scan 6s linear infinite',
          }}
        />
      )}
      <div
        className="pcard-layer"
        style={{
          inset: 0,
          background:
            'repeating-linear-gradient(180deg, transparent 0 2px, rgba(255,255,255,0.025) 2px 3px)',
        }}
      />
    </div>
  )
}
