/**
 * Inferno (mythic): rising embers behind the card, a turning rune sigil in the
 * portrait, a flickering heat rim and a gild sheen. Port of PlayerCard.dc.html
 * fxInfernoBg / fxInfernoPortrait / fxInferno. The embers footage is a muted
 * looping video (was a 3.3 MB GIF), mounted only while motion runs.
 */
import { VIDEO_FORMATS } from '../card-assets'

const fadeUp = (a: string, b: string) => ({
  WebkitMaskImage: `linear-gradient(0deg, #000 ${a}, transparent ${b})`,
  maskImage: `linear-gradient(0deg, #000 ${a}, transparent ${b})`,
})
const RIM_MASK = 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)'

export function InfernoBg({ embers, on }: { embers: string | undefined; on: boolean }) {
  return (
    <div
      className="pcard-layer"
      style={{ inset: 0, zIndex: -1, overflow: 'hidden', borderRadius: '17px' }}
    >
      {on && embers !== undefined && (
        <video
          aria-hidden
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="pcard-layer"
          style={{
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center bottom',
            mixBlendMode: 'screen',
            opacity: 0.32,
            ...fadeUp('10%', '80%'),
          }}
        >
          {VIDEO_FORMATS.map((ext) => (
            <source key={ext} src={`${embers}.${ext}`} type={`video/${ext}`} />
          ))}
        </video>
      )}
    </div>
  )
}

function Ring({ r, sw, stroke, dash }: { r: number; sw: number; stroke: string; dash?: string }) {
  return (
    <circle
      cx={120}
      cy={90}
      r={r}
      fill="none"
      stroke={stroke}
      strokeWidth={sw}
      strokeDasharray={dash}
    />
  )
}

export function InfernoPortrait({ on }: { on: boolean }) {
  const spin = (dur: string, reverse: boolean) => ({
    transformOrigin: '120px 90px',
    transformBox: 'view-box' as const,
    animation: on ? `hpcSpin ${dur} linear infinite${reverse ? ' reverse' : ''}` : 'none',
  })
  return (
    <div className="pcard-layer" style={{ inset: 0, overflow: 'hidden' }}>
      <svg
        viewBox="0 0 240 196"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: 0.6,
          filter: 'drop-shadow(0 0 3px rgba(255,90,20,0.5))',
        }}
      >
        <g style={spin('48s', false)}>
          <Ring r={80} sw={1} stroke="rgba(255,120,40,0.40)" />
          <Ring r={72} sw={5} stroke="rgba(255,140,60,0.60)" dash="2 5 9 4 1 7 4 6" />
          <Ring r={64} sw={1} stroke="rgba(255,120,40,0.35)" />
        </g>
        <g style={spin('30s', true)}>
          <Ring r={56} sw={2} stroke="rgba(255,170,90,0.45)" dash="1 4" />
          <path
            d="M120 40 L163 115 L77 115 Z"
            fill="none"
            stroke="rgba(255,120,40,0.30)"
            strokeWidth={1}
          />
        </g>
      </svg>
    </div>
  )
}

export function InfernoOverlay({ on }: { on: boolean }) {
  return (
    <div
      className="pcard-layer"
      style={{ inset: 0, zIndex: 8, borderRadius: '17px', overflow: 'hidden' }}
    >
      <div
        className="pcard-layer"
        style={{
          inset: 0,
          borderRadius: '17px',
          boxShadow:
            'inset 0 0 26px 1px rgba(255,80,20,0.22), inset 0 0 8px 1px rgba(255,140,60,0.22), inset 0 0 2px 1px rgba(255,200,160,0.35)',
          animation: on ? 'hpcFlicker 2.6s linear infinite' : 'none',
        }}
      />
      {on && (
        <div
          className="pcard-layer"
          style={{
            inset: 0,
            borderRadius: '17px',
            padding: '2px',
            mixBlendMode: 'screen',
            opacity: 0.55,
            background:
              'linear-gradient(110deg, transparent 45%, rgba(255,190,120,0.8) 50%, transparent 55%)',
            backgroundSize: '300% 100%',
            WebkitMask: RIM_MASK,
            WebkitMaskComposite: 'xor',
            mask: RIM_MASK,
            maskComposite: 'exclude',
            animation: 'hpcGild 4s linear infinite',
          }}
        />
      )}
    </div>
  )
}
