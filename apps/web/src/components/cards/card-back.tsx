import Image from 'next/image'
import type { CardBack as CardBackModel, CardFront } from './card-model'
import type { CardLook } from './card-style'
import type { CardTheme } from './card-theme-types'
import { CardBadge } from './card-badge'

/** Back face — port of PlayerCard.dc.html L208–281: level, ledger, badges, source. */
export function CardBack({
  front,
  back,
  theme: th,
  look,
}: {
  front: CardFront
  back: CardBackModel
  theme: CardTheme
  look: CardLook
}) {
  const tk = th.tk
  const { ledger } = back
  const goalie = ledger.head.length === 6
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        border: look.border,
        borderRadius: '18px',
        background: look.cardBg,
        overflow: 'hidden',
        boxShadow: look.shadow,
        color: tk.ink,
        transform: 'rotateY(180deg)',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ height: '3px', background: look.ruleBg, flexShrink: 0 }} />
      <div
        style={{
          padding: '14px 16px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '11px',
          background: look.backHeadBg,
          borderBottom: `1px solid ${look.backHeadLine}`,
          boxShadow: look.backHeadSh,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span
            style={{
              fontSize: '36px',
              fontWeight: 900,
              lineHeight: 0.85,
              color: look.backNum,
              textShadow: look.numShadow,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.03em',
            }}
          >
            {front.jersey}
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: '20px',
              fontWeight: 900,
              textTransform: 'uppercase',
              lineHeight: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {front.name}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: '3px' }}
          >
            {look.pips.map((pip, i) => (
              <span
                key={i}
                style={{
                  height: '3px',
                  borderRadius: '1px',
                  background: pip,
                  boxShadow: look.barGlow,
                }}
              />
            ))}
          </div>
          <span
            style={{
              fontSize: '9px',
              fontWeight: 700,
              letterSpacing: '0.2em',
              color: look.backSubC,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            LEVEL {front.level} / 10
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px 16px' }}>
        <div
          style={{
            padding: '9px 10px 4px',
            background: look.ledgerBg,
            boxShadow: look.ledgerSh,
            border: look.ledgerBorder,
            clipPath: look.ledgerClip,
            borderRadius: look.plateR,
            display: 'grid',
            columnGap: '6px',
            gridTemplateColumns: goalie
              ? '60px auto auto auto auto auto'
              : '60px repeat(4, minmax(0, 1fr))',
            fontVariantNumeric: 'tabular-nums',
            alignItems: 'center',
          }}
        >
          {ledger.head.map((h, i) => (
            <span
              key={`h${String(i)}`}
              style={{
                fontSize: '9px',
                fontWeight: 700,
                letterSpacing: '0.16em',
                color: i === ledger.leadCol ? look.ledgerLead : tk.backHead,
                textAlign: 'right',
                paddingBottom: '6px',
                borderBottom: `1px solid ${look.ledgerHeadLine}`,
              }}
            >
              {h}
            </span>
          ))}
          {ledger.rows.map((row, ri) => {
            const last = ri === ledger.rows.length - 1
            const bb = last ? '0' : look.ledgerRowLine
            return [
              <span
                key={`r${String(ri)}`}
                style={{
                  fontSize: '10.5px',
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  lineHeight: 1.1,
                  whiteSpace: 'nowrap',
                  padding: '5px 0',
                  borderBottom: bb,
                }}
              >
                {row.label}
              </span>,
              ...row.cells.map((cell, ci) => {
                const col = ci + 1
                const lead = col === ledger.leadCol
                return (
                  <span
                    key={`r${String(ri)}c${String(ci)}`}
                    style={{
                      fontSize: goalie && col === 2 ? '11.5px' : '14px',
                      fontWeight: last || lead ? 900 : 700,
                      color: lead ? look.ledgerLead : last ? tk.ink : tk.sv,
                      textAlign: 'right',
                      whiteSpace: 'nowrap',
                      padding: '5px 0',
                      borderBottom: bb,
                    }}
                  >
                    {cell}
                  </span>
                )
              }),
            ]
          })}
        </div>
      </div>

      <div
        style={{
          marginTop: 'auto',
          padding: '0 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '7px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span
            style={{
              fontSize: '9px',
              fontWeight: 700,
              letterSpacing: '0.24em',
              color: tk.backLabel,
              lineHeight: 1,
            }}
          >
            BADGES
          </span>
          <span
            style={{
              fontSize: '9px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: tk.backFoot,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {back.badges.earned} / {back.badges.pool} earned
          </span>
        </div>
        {back.badges.top.length > 0 ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-around',
              alignItems: 'flex-end',
              gap: '6px',
              paddingBottom: '2px',
            }}
          >
            {back.badges.top.map((b) => (
              <div
                key={b.familyId}
                style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}
              >
                <CardBadge badge={b} size={30} labelSize={7.5} labelColor={tk.badgeLabel} />
              </div>
            ))}
          </div>
        ) : (
          <span
            style={{
              fontSize: '10px',
              color: tk.backFoot,
              letterSpacing: '0.04em',
              padding: '10px 0 12px',
            }}
          >
            No badges earned yet.
          </span>
        )}
      </div>
      <div
        style={{
          padding: '6px 16px 8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.2em', color: tk.backFoot }}
        >
          {back.source}
        </span>
        <Image
          src="/images/bgm-logo.png"
          alt="BGM"
          width={26}
          height={26}
          style={{ width: '26px', height: '26px', objectFit: 'contain', opacity: 0.7 }}
        />
      </div>
      {th.innerRim !== undefined && (
        <div
          className="pcard-layer"
          style={{ inset: '4px', border: `1px solid ${th.innerRim}`, borderRadius: '14px' }}
        />
      )}
      {th.gloss === true && (
        <div
          className="pcard-layer"
          style={{
            inset: 0,
            borderRadius: '17px',
            background:
              'linear-gradient(100deg, transparent 60%, rgba(255,255,255,0.05) 72%, transparent 80%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -1px 0 rgba(0,0,0,0.4)',
          }}
        />
      )}
    </div>
  )
}
