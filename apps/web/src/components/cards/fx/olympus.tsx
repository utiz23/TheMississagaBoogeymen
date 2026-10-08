/**
 * Maximus (olympus, mythic): light rays and halo in the portrait, gold motes,
 * gilded double rim and a travelling gild sheen over the card. Port of
 * PlayerCard.dc.html fxPortrait / fxOlympus. `on` = motion allowed now.
 */

const RAY_MASK = 'linear-gradient(180deg, #000 0%, rgba(0,0,0,0.5) 40%, transparent 70%)'
const RIM_MASK = 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)'

export function OlympusPortrait({ on }: { on: boolean }) {
  return (
    <div className="pcard-layer" style={{ inset: 0, overflow: 'hidden' }}>
      <div
        className="pcard-layer"
        style={{
          left: '-60%',
          right: '-60%',
          top: '-10%',
          height: '220%',
          transformOrigin: '50% 0%',
          mixBlendMode: 'screen',
          opacity: 0.9,
          background:
            'repeating-conic-gradient(from 180deg at 50% 0%, rgba(255,250,230,0.85) 0deg 2deg, transparent 2deg 11deg)',
          WebkitMaskImage: RAY_MASK,
          maskImage: RAY_MASK,
          animation: on ? 'hpcRays 14s ease-in-out infinite alternate' : 'none',
        }}
      />
      <div
        className="pcard-layer"
        style={{
          left: '50%',
          top: '34px',
          width: '120px',
          height: '120px',
          marginLeft: '-60px',
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(255,248,220,0.95) 0%, rgba(255,226,140,0.45) 40%, transparent 70%)',
          animation: on ? 'hpcHalo 6s ease-in-out infinite' : 'none',
        }}
      />
    </div>
  )
}

export function OlympusOverlay({ on }: { on: boolean }) {
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
            background:
              'radial-gradient(circle at 30px 40px, rgba(214,164,52,0.95) 0 1px, rgba(255,214,120,0.4) 1.6px, transparent 2.6px), radial-gradient(circle at 100px 140px, rgba(214,164,52,0.8) 0 1.3px, rgba(255,214,120,0.35) 2px, transparent 3px)',
            backgroundSize: '130px 230px, 170px 260px',
            animation: 'hpcMotes 18s linear infinite',
          }}
        />
      )}
      <div
        className="pcard-layer"
        style={{
          inset: '5px',
          borderRadius: '13px',
          border: '1px solid rgba(184,137,42,0.45)',
          boxShadow: 'inset 0 0 0 1px rgba(255,248,225,0.6)',
        }}
      />
      <div
        className="pcard-layer"
        style={{
          inset: 0,
          borderRadius: '17px',
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(90,60,10,0.35), inset 0 0 24px rgba(214,164,52,0.22)',
        }}
      />
      {on && (
        <div
          className="pcard-layer"
          style={{
            inset: 0,
            borderRadius: '17px',
            padding: '6px',
            mixBlendMode: 'overlay',
            background:
              'linear-gradient(110deg, transparent 40%, rgba(255,236,170,0.3) 50%, transparent 60%)',
            backgroundSize: '300% 100%',
            WebkitMask: RIM_MASK,
            WebkitMaskComposite: 'xor',
            mask: RIM_MASK,
            maskComposite: 'exclude',
            animation: 'hpcGild 7s ease-in-out infinite',
          }}
        />
      )}
    </div>
  )
}

/** Greek-key band under the portrait (front) or the back header. */
export function MeanderBand({ image, back }: { image: string; back: boolean }) {
  return (
    <div
      style={{
        margin: back ? '8px 12px 0' : '6px 12px 0',
        height: '12px',
        backgroundImage: image,
        backgroundRepeat: 'repeat-x',
        backgroundPosition: 'center',
        opacity: 0.9,
        flexShrink: back ? 0 : undefined,
      }}
    />
  )
}
