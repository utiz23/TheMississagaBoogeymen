'use client'

import { useState } from 'react'
import { AwardSymbol } from './award-symbol'
import type { AwardKind, PlayerAwardsView } from './awards-model'
import './player-awards.css'

const LEGEND: { kind: AwardKind; label: string }[] = [
  { kind: 'trophy', label: 'Club trophy' },
  { kind: 'banner', label: 'Championship banner' },
  { kind: 'record', label: 'Season record' },
  { kind: 'alltime', label: 'All-time record' },
  { kind: 'milestone', label: 'Milestone' },
]

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

  const present = new Set(items.map((i) => i.kind))

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
      <footer className="pa-foot">
        <div className="pa-legend">
          {LEGEND.filter((l) => present.has(l.kind)).map((l) => (
            <span key={l.kind}>
              <span className={`pa-key pa-key-${l.kind}`} />
              {l.label}
            </span>
          ))}
        </div>
        <div className="pa-source">
          <span>Source EA NHL + club archive · Boogeymen</span>
          <span>Sheet BGM/AWD/0028</span>
        </div>
      </footer>
    </section>
  )
}
