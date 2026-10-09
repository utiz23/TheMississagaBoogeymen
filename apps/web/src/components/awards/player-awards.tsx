'use client'

import { useState } from 'react'
import { AwardSymbol } from './award-symbol'
import type { AwardItem, AwardKind } from './awards-model'
import './player-awards.css'

/** Tiles shown before "Show all" — two desktop rows, four phone rows. */
const COLLAPSED = 8

const LEGEND: { kind: AwardKind; label: string }[] = [
  { kind: 'record', label: 'Season record' },
  { kind: 'alltime', label: 'All-time record' },
  { kind: 'milestone', label: 'Milestone' },
]

interface PlayerAwardsProps {
  gamertag: string
  /** The player's titles, e.g. "NHL 22–NHL 27". */
  span: string
  items: readonly AwardItem[]
}

/** Profile "Awards" trophy case — port of Awards Trophy Case.dc.html. */
export function PlayerAwards({ gamertag, span, items }: PlayerAwardsProps) {
  const [selId, setSelId] = useState(() => items[0]?.id ?? '')
  const [expanded, setExpanded] = useState(false)
  const sel = items.find((i) => i.id === selId) ?? items[0]
  if (sel === undefined) return null

  const present = new Set(items.map((i) => i.kind))
  const shown = expanded ? items : items.slice(0, COLLAPSED)

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
          <span>
            <b>{items.length}</b> Accolades
          </span>
        </div>
      </header>
      <div className="pa-rule" />
      <div className="pa-grid">
        {shown.map((it) => {
          const on = it.id === sel.id
          return (
            <button
              key={it.id}
              type="button"
              className="pa-tile"
              aria-pressed={on}
              title={`${it.name} · ${it.season}`}
              onClick={() => {
                setSelId(it.id)
              }}
            >
              <div className="pa-tile-symbol">
                <div>
                  <AwardSymbol kind={it.kind} glyph={it.glyph} stat={it.stat} tier={it.tier} />
                </div>
              </div>
              <span className="pa-tile-text">
                <span className="pa-tile-name">{it.short}</span>
                <span className="pa-tile-season">{it.season}</span>
              </span>
            </button>
          )
        })}
      </div>
      {items.length > COLLAPSED && (
        <button
          type="button"
          className="pa-more"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((e) => !e)
          }}
        >
          {expanded ? 'Show fewer' : `Show all ${String(items.length)} awards`}
        </button>
      )}
      <div className="pa-detail" aria-live="polite">
        <div className="pa-detail-symbol">
          <div>
            <AwardSymbol kind={sel.kind} glyph={sel.glyph} stat={sel.stat} tier={sel.tier} />
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
