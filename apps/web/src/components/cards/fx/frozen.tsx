/**
 * Frozen (mythic): snow, twinkles and frost breath over the card, and the ice
 * panel behind name/stats/footer. Port of PlayerCard.dc.html fxFrost and
 * fxIcePanel. `on` = motion allowed for this card right now.
 */
import { cardAsset } from '../card-assets'
import { RIME_POINTS } from './geometry'

const GRAIN =
  'url("data:image/svg+xml,' +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='4'/><feColorMatrix values='0 0 0 0 0.92 0 0 0 0 0.97 0 0 0 0 1 0 0 0 1.6 -0.55'/></filter><rect width='100%' height='100%' filter='url(%23g)'/></svg>",
  ).replace('%2523', '%23') +
  '")'
const EDGE = 'radial-gradient(120% 110% at 50% 45%, transparent 42%, #000 92%)'
const CRACK_MASK = 'radial-gradient(120% 110% at 50% 45%, rgba(0,0,0,0.35) 30%, #000 85%)'

export function FrostOverlay({ on }: { on: boolean }) {
  if (!on) return null
  return (
    <div
      className="pcard-layer"
      style={{ inset: 0, zIndex: 8, borderRadius: '17px', overflow: 'hidden' }}
    >
      <div
        className="pcard-layer"
        style={{
          inset: 0,
          opacity: 0.7,
          background:
            'radial-gradient(circle at 20px 30px, rgba(240,250,255,0.9) 0 1px, transparent 1.6px), radial-gradient(circle at 90px 110px, rgba(240,250,255,0.7) 0 1.2px, transparent 1.8px)',
          backgroundSize: '120px 170px, 150px 200px',
          animation: 'hpcSnowA 11s linear infinite',
        }}
      />
      <div
        className="pcard-layer"
        style={{
          inset: 0,
          opacity: 0.45,
          filter: 'blur(0.6px)',
          background:
            'radial-gradient(circle at 60px 40px, rgba(220,242,252,0.9) 0 1.8px, transparent 2.6px)',
          backgroundSize: '110px 230px',
          animation: 'hpcSnowB 16s linear infinite',
        }}
      />
      <div
        className="pcard-layer"
        style={{
          inset: 0,
          mixBlendMode: 'screen',
          background:
            'radial-gradient(circle at 22% 12%, rgba(255,255,255,0.95) 0 1px, rgba(200,235,250,0.4) 2px, transparent 5px), radial-gradient(circle at 78% 30%, rgba(255,255,255,0.9) 0 1px, rgba(200,235,250,0.35) 2px, transparent 5px)',
          animation: 'hpcTwinkle 3.6s ease-in-out infinite',
        }}
      />
      <div
        className="pcard-layer"
        style={{
          inset: 0,
          mixBlendMode: 'screen',
          background:
            'radial-gradient(circle at 62% 8%, rgba(255,255,255,0.95) 0 1px, rgba(200,235,250,0.4) 2px, transparent 5px), radial-gradient(circle at 12% 44%, rgba(255,255,255,0.8) 0 1px, transparent 4px)',
          animation: 'hpcTwinkle 4.8s ease-in-out 1.7s infinite',
        }}
      />
      <div
        className="pcard-layer"
        style={{
          inset: 0,
          borderRadius: '17px',
          boxShadow:
            'inset 0 0 46px 4px rgba(210,240,252,0.55), inset 0 0 14px 2px rgba(235,248,253,0.65), inset 0 0 2px 1px rgba(255,255,255,0.8)',
          animation: 'hpcFrostBreath 5s ease-in-out infinite',
        }}
      />
    </div>
  )
}

/** Static frost rim the template draws for `frost` themes (z 7, under the effects). */
export function FrostRim() {
  return (
    <>
      <div
        className="pcard-layer"
        style={{
          inset: 0,
          borderRadius: '17px',
          boxShadow:
            'inset 0 0 28px rgba(200,235,250,0.16), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.5)',
          zIndex: 7,
        }}
      />
      <div
        className="pcard-layer"
        style={{
          inset: '4px',
          border: '1px solid rgba(212,238,248,0.14)',
          borderRadius: '14px',
          zIndex: 7,
        }}
      />
    </>
  )
}

/** Ice panel behind the name, stats and footer (inside the shelf). */
export function IcePanel({ uid, on }: { uid: string; on: boolean }) {
  const gid = `${uid}-rime`
  return (
    <div aria-hidden className="pcard-layer" style={{ inset: 0, zIndex: -1, borderRadius: '12px' }}>
      <div
        className="pcard-layer"
        style={{
          inset: 0,
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow:
            'inset 0 0 22px rgba(220,240,252,0.32), inset 0 0 6px rgba(235,248,255,0.45), inset 0 0 1px rgba(255,255,255,0.6)',
          background:
            'radial-gradient(50% 45% at 0% 100%, rgba(230,246,255,0.32), transparent 70%), radial-gradient(50% 45% at 100% 100%, rgba(230,246,255,0.32), transparent 70%), radial-gradient(40% 34% at 0% 0%, rgba(230,246,255,0.20), transparent 70%), radial-gradient(40% 34% at 100% 0%, rgba(230,246,255,0.20), transparent 70%)',
        }}
      />
      <div
        className="pcard-layer"
        style={{
          inset: 0,
          borderRadius: '12px',
          backgroundImage: GRAIN,
          backgroundSize: '160px 160px',
          opacity: 0.8,
          WebkitMaskImage: EDGE,
          maskImage: EDGE,
        }}
      />
      <div
        className="pcard-layer"
        style={{
          inset: 0,
          borderRadius: '12px',
          backgroundImage: `url("${cardAsset('ice-cracks.avif')}")`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          mixBlendMode: 'screen',
          opacity: 0.8,
          filter: 'saturate(0) brightness(1.15) contrast(1.3)',
          WebkitMaskImage: CRACK_MASK,
          maskImage: CRACK_MASK,
          animation: on ? 'hpcTwinkle 7s ease-in-out infinite' : 'none',
        }}
      />
      <svg
        viewBox="0 0 240 12"
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          left: '10px',
          right: '10px',
          top: 0,
          width: 'calc(100% - 20px)',
          height: '12px',
          overflow: 'visible',
        }}
      >
        <defs>
          <linearGradient id={gid} x1={0} y1={0} x2={0} y2={1}>
            <stop offset={0} stopColor="#f4fbff" stopOpacity={0.9} />
            <stop offset={1} stopColor="#cdeaf7" stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon
          points={RIME_POINTS}
          fill={`url(#${gid})`}
          style={{ filter: 'drop-shadow(0 0 2px rgba(200,235,250,0.6))' }}
        />
      </svg>
    </div>
  )
}

/** Diamond "gem" between stat cells on shelf themes. */
export function StatGem() {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: '50%',
        width: '5px',
        height: '5px',
        transform: 'translate(-50%, -50%) rotate(45deg)',
        background: '#eaf7fc',
        boxShadow: '0 0 6px 1px rgba(200,235,250,0.8)',
      }}
    />
  )
}
