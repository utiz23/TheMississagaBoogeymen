import Image from 'next/image'
import { NationalityFlag, PlatformIcon } from '@/components/player-meta-icons'
import type { CardFront as CardFrontModel } from './card-model'
import type { CardLook, resolveFx } from './card-style'
import type { CardTheme } from './card-theme-types'
import { CardBadge } from './card-badge'
import { HardlightOverlay, HardlightPortrait } from './fx/hardlight'

type CardFx = ReturnType<typeof resolveFx>

const GLOSS =
  'linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.04) 36%, transparent 36.4%), linear-gradient(100deg, transparent 60%, rgba(255,255,255,0.05) 72%, transparent 80%)'

/** Front face — port of PlayerCard.dc.html L57–206 (levelStyle 'back': no front pips). */
export function CardFront({
  card,
  theme: th,
  look,
  fx,
  uid,
  hover,
}: {
  card: CardFrontModel
  theme: CardTheme
  look: CardLook
  fx: CardFx
  uid: string
  hover: boolean
}) {
  const tk = th.tk
  const plate = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    height: '60px',
    background: look.plateBg,
    clipPath: look.plateClip,
    boxShadow: look.plateSh,
    borderRadius: look.plateR,
  } as const
  const footSep = look.footSeps ? (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: '10px',
        bottom: '10px',
        width: '1px',
        background: tk.line,
      }}
    />
  ) : null
  return (
    <div
      style={{
        position: 'relative',
        width: '264px',
        border: look.border,
        borderRadius: '18px',
        background: look.cardBg,
        overflow: 'hidden',
        boxShadow: look.shadow,
        color: '#ebebeb',
        isolation: 'isolate',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transition: 'border-color 240ms ease, box-shadow 240ms ease',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: '3px',
          zIndex: 10,
          background: look.ruleBg,
          transition: 'background 240ms ease',
        }}
      />
      {fx.pulse && (
        <div
          className="pcard-layer"
          style={{
            left: 0,
            right: 0,
            top: 0,
            height: '3px',
            zIndex: 11,
            boxShadow: `0 0 12px 1px ${th.pulse ?? 'rgba(232,65,49,0.85)'}`,
            animation: 'pcard-pulse 2.4s ease-in-out infinite',
          }}
        />
      )}

      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 5,
          width: '88px',
          padding: '18px 14px 16px',
          background: th.jersey,
          boxShadow: look.jerseyEdge,
          borderBottomRightRadius: '18px',
          clipPath: look.jerseyClip,
          display: 'flex',
          flexDirection: 'column',
          gap: '7px',
        }}
      >
        <span
          style={{
            fontSize: '40px',
            fontWeight: 900,
            lineHeight: 0.9,
            color: th.num,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.03em',
            textShadow: look.numShadow,
          }}
        >
          {card.jersey}
        </span>
        {card.position !== null && (
          <span
            style={{
              alignSelf: 'flex-start',
              fontSize: '13px',
              fontWeight: 800,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              padding: '3px 8px',
              borderRadius: '3px',
              border: `1px solid ${look.posBorder}`,
              background: look.posBg,
              color: look.posColor,
              lineHeight: 1.3,
            }}
          >
            {card.position}
          </span>
        )}
        <span
          style={{
            marginTop: '6px',
            fontSize: '13px',
            fontWeight: 600,
            lineHeight: 1.3,
            color: tk.rec,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {card.record}
        </span>
        <span style={{ fontSize: '14px', color: tk.pct, fontWeight: 700, lineHeight: 1.3 }}>
          {card.winPct}
        </span>
      </div>

      <div
        style={{
          margin: '12px 12px 0',
          height: '196px',
          borderRadius: '14px',
          position: 'relative',
          overflow: 'hidden',
          background: th.portrait,
          clipPath: look.portraitClip,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.03)',
        }}
      >
        {card.role === 'goalie' && (
          <div
            style={{
              position: 'absolute',
              bottom: '-46px',
              left: '50%',
              width: '220px',
              height: '96px',
              marginLeft: '-110px',
              border: '2px solid rgba(235,235,235,0.07)',
              borderRadius: '50%',
              background: 'rgba(38,89,207,0.05)',
            }}
          />
        )}
        {fx.grid && <HardlightPortrait uid={uid} animated={fx.gridAnimated} />}
        <svg
          viewBox="0 0 100 110"
          fill="currentColor"
          preserveAspectRatio="xMidYMax meet"
          aria-hidden
          style={{
            width: look.silhSize,
            height: look.silhSize,
            color: th.silh,
            position: 'relative',
          }}
        >
          <circle cx="50" cy="32" r="21" />
          <path d="M 8 110 Q 8 66 50 66 Q 92 66 92 110 Z" />
        </svg>
        <div
          style={{ position: 'absolute', inset: 0, background: look.scanBg, pointerEvents: 'none' }}
        />
        <span
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            fontSize: '10px',
            fontWeight: 800,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            padding: '3px 7px',
            borderRadius: '3px',
            border: `1px solid ${look.chip.b}`,
            background: look.chip.bg,
            color: look.chip.c,
            lineHeight: 1.2,
          }}
        >
          {look.chipText}
        </span>
      </div>

      <div
        style={{
          margin: look.panelM,
          position: 'relative',
          isolation: 'isolate',
          background: look.shelfBg,
          borderRadius: look.shelfR,
          boxShadow: look.shelfSh,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            padding: look.namePad,
          }}
        >
          <span
            className="pcard-platform"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '24px',
              height: '24px',
              flexShrink: 0,
            }}
          >
            <PlatformIcon platform={card.platform} />
          </span>
          <span
            style={{
              fontSize: '19px',
              fontWeight: 900,
              color: tk.ink,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: 1.25,
              textShadow: look.nameShadow,
            }}
          >
            {card.name}
          </span>
        </div>

        <div
          style={{
            margin: look.statM,
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: look.plateGap,
            borderTop: look.statRule,
            borderBottom: look.statRule,
            padding: look.statPad,
          }}
        >
          {card.stats.map((stat, i) => {
            const s = look.stats[i]
            if (s === undefined) return null
            return (
              <div
                key={stat.label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '3px',
                  position: 'relative',
                  padding: s.pad,
                  background: s.bg,
                  clipPath: s.clip,
                  boxShadow: s.sh,
                  borderRadius: look.plateR,
                }}
              >
                {s.sep && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: '6px',
                      bottom: '6px',
                      width: '1px',
                      background: tk.line,
                    }}
                  />
                )}
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: s.lc,
                    lineHeight: 1.4,
                  }}
                >
                  {stat.label}
                </span>
                <span
                  style={{
                    fontSize: s.fs,
                    fontWeight: 900,
                    color: s.vc,
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1,
                    textShadow: s.ts,
                  }}
                >
                  {stat.value}
                </span>
              </div>
            )
          })}
        </div>

        <div
          style={{
            display: 'grid',
            position: 'relative',
            gridTemplateColumns: 'repeat(3, 1fr)',
            alignItems: 'center',
            gap: look.plateGap,
            padding: look.footPad,
          }}
        >
          <div className="pcard-flag" style={plate}>
            <NationalityFlag code={card.nationality} />
          </div>
          <div style={plate}>
            {footSep}
            <Image
              src="/images/bgm-logo.png"
              alt="BGM"
              width={52}
              height={52}
              style={{ width: '52px', height: '52px', objectFit: 'contain', opacity: 0.9 }}
            />
          </div>
          <div style={plate}>
            {footSep}
            {card.badge !== null && (
              <CardBadge badge={card.badge} size={34} labelSize={8.5} labelColor={tk.badgeLabel} />
            )}
          </div>
        </div>
      </div>

      {th.edition !== undefined && (
        <span
          style={{
            position: 'absolute',
            bottom: '7px',
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: '8px',
            fontWeight: 700,
            letterSpacing: '0.32em',
            color: tk.edition,
            lineHeight: 1,
          }}
        >
          {th.edition}
        </span>
      )}
      {th.gloss === true && (
        <div
          className="pcard-layer"
          style={{
            inset: 0,
            borderRadius: '17px',
            background: GLOSS,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -1px 0 rgba(0,0,0,0.4)',
            zIndex: 7,
          }}
        />
      )}
      {th.bevel === true && (
        <>
          <div
            className="pcard-layer"
            style={{
              inset: 0,
              borderRadius: '17px',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(0,0,0,0.7), inset 1px 0 0 rgba(255,255,255,0.06), inset -1px 0 0 rgba(0,0,0,0.5)',
              zIndex: 7,
            }}
          />
          <div
            className="pcard-layer"
            style={{
              inset: '4px',
              border: '1px solid rgba(212,212,216,0.10)',
              borderRadius: '14px',
              zIndex: 7,
            }}
          />
        </>
      )}
      {th.innerRim !== undefined && (
        <div
          className="pcard-layer"
          style={{
            inset: '4px',
            border: `1px solid ${th.innerRim}`,
            borderRadius: '14px',
            zIndex: 7,
          }}
        />
      )}
      {fx.foil && (
        <div
          className="pcard-layer"
          style={{
            inset: 0,
            zIndex: 8,
            mixBlendMode: 'screen',
            background: `linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.10) 44%, ${th.foilTint ?? 'rgba(232,65,49,0.14)'} 50%, rgba(255,255,255,0.08) 56%, transparent 70%)`,
            backgroundSize: '250% 100%',
            animation: 'pcard-foil 5.5s linear infinite',
          }}
        />
      )}
      {fx.grid && <HardlightOverlay scan={fx.scan} />}
      {fx.sweep && (
        <div className="pcard-layer" style={{ inset: 0, zIndex: 9, overflow: 'hidden' }}>
          <div
            style={{
              position: 'absolute',
              top: '-10%',
              bottom: '-10%',
              left: 0,
              width: '45%',
              background:
                'linear-gradient(100deg, transparent, rgba(255,255,255,0.09) 50%, transparent)',
              transform: `translateX(${hover ? '330%' : '-130%'}) skewX(-14deg)`,
              transition: hover ? 'transform 900ms ease' : 'none',
            }}
          />
        </div>
      )}
    </div>
  )
}
