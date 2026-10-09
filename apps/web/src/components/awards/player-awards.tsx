'use client'

import { useState } from 'react'
import { AwardSymbol } from './award-symbol'
import type { PlayerAwardsView } from './awards-model'
import './player-awards.css'

interface PlayerAwardsProps {
  gamertag: string
  awards: PlayerAwardsView
}

/** Profile "Awards" trophy case — port of Awards Trophy Case.dc.html. */
export function PlayerAwards({ gamertag, awards }: PlayerAwardsProps) {
  const { items, span, totals } = awards
  const [selId, setSelId] = useState(() => items[0]?.id ?? '')
  const sel = items.find((i) => i.id === selId) ?? items[0]
  if (sel === undefined) return null

  return (
    <section className="pa" aria-label="Awards">
      <header className="pa-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 className="pa-title">
            <span className="pa-title-mark">▌</span>Awards
          </h2>
          <span className="pa-sub">
            Trophy case · {span} · player · {gamertag}
          </span>
        </div>
        <div className="pa-totals">
          {[
            [totals.trophies, 'Trophy', 'Trophies'] as const,
            [totals.banners, 'Banner', 'Banners'] as const,
            [totals.accolades, 'Accolade', 'Accolades'] as const,
          ]
            .filter(([n]) => n > 0)
            .map(([n, one, many], i) => (
              <span key={many}>
                {i > 0 && <span className="pa-dot">·</span>}
                <b>{n}</b> {n === 1 ? one : many}
              </span>
            ))}
        </div>
      </header>
      <div className="pa-rule" />
      <div className="pa-grid">
        {items.map((it) => {
          const on = it.id === sel.id
          return (
            <button
              key={it.id}
              type="button"
              className="pa-tile"
              aria-pressed={on}
              title={`${it.name} · ${it.when}`}
              onClick={() => {
                setSelId(it.id)
              }}
            >
              <div className="pa-tile-symbol">
                <div>
                  <AwardSymbol symbol={it.symbol} glyph={it.glyph} stat={it.stat} tier={it.tier} />
                </div>
              </div>
              <span className="pa-tile-text">
                <span className="pa-tile-name">{it.short}</span>
                <span className="pa-tile-season">{it.when}</span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="pa-detail" aria-live="polite">
        <div className="pa-detail-symbol">
          <div>
            <AwardSymbol symbol={sel.symbol} glyph={sel.glyph} stat={sel.stat} tier={sel.tier} />
          </div>
        </div>
        <div className="pa-detail-info">
          <span className="pa-detail-kind">{sel.kindLabel}</span>
          <span className="pa-detail-name">{sel.name}</span>
          <span className="pa-detail-basis">{sel.basis}</span>
        </div>
        <span className="pa-detail-meta">{sel.meta}</span>
      </div>
    </section>
  )
}
