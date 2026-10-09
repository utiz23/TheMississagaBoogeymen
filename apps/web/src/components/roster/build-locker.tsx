'use client'

import { useState, useSyncExternalStore } from 'react'
import { ArchetypePillCompact } from '@/components/ui/archetype-pill'
import { buildClassToArchetype } from '@/lib/match-recap'
import type { BuildGroupView, BuildLockerView, BuildTileView } from './build-locker-model'
import './build-locker.css'

/** The Micro tier (build-locker.css): attribute groups become an accordion. */
const MICRO_QUERY = '(max-width: 480px)'

function subscribeMicro(onChange: () => void) {
  const mq = window.matchMedia(MICRO_QUERY)
  mq.addEventListener('change', onChange)
  return () => {
    mq.removeEventListener('change', onChange)
  }
}

/** SSR (and hydration) render the plain grid; phones swap to the accordion after. */
function useMicro(): boolean {
  return useSyncExternalStore(
    subscribeMicro,
    () => window.matchMedia(MICRO_QUERY).matches,
    () => false,
  )
}

/**
 * Build Locker v2 (Build Locker v2.dc.html; spec Part 4): one tile per build,
 * newest first, and a shared detail panel for the selected one. The first
 * tile starts open; clicking the open tile closes it, as in the design.
 * Medium / Small / Micro layouts follow the Build Locker v3 tier mockups.
 */
export function BuildLocker({ view }: { view: BuildLockerView }) {
  const [sel, setSel] = useState(0)
  // Micro accordion (Build Locker v3 Micro.dc.html): one group open at a time,
  // the first by default; tapping the open one closes it.
  const micro = useMicro()
  const [openGroup, setOpenGroup] = useState(0)
  const detail = sel >= 0 ? view.details[sel] : undefined
  return (
    <section className="bl" aria-label="Build Locker">
      <div className="bl-head">
        <div className="bl-head-text">
          <h2 className="bl-title">
            <span className="bl-title-mark" aria-hidden>
              ▰
            </span>
            Build Locker
          </h2>
          <p className="bl-sub">
            Last {view.count === 1 ? 'build' : `${String(view.count)} builds`}
            <span className="bl-sub-src"> · newest first · from game sheets</span>
          </p>
        </div>
        <span className="bl-game">{view.titleName}</span>
      </div>

      <div className="bl-panel">
        <div className="bl-tiles">
          {view.tiles.map((t, i) => (
            <Tile
              key={`${String(i)}-${t.arcName}`}
              tile={t}
              selected={sel === i}
              onSelect={() => {
                setSel((s) => (s === i ? -1 : i))
              }}
            />
          ))}
        </div>

        {detail !== undefined && (
          <div className="bl-detail">
            <span className="bl-detail-rail" aria-hidden />
            <div className="bl-detail-body">
              <div className="bl-detail-head">
                <span className="bl-detail-title">
                  <span className="bl-detail-name">{detail.name}</span>
                  <span className="bl-detail-meta">{detail.meta}</span>
                </span>
                <span className="bl-detail-note">{detail.note}</span>
              </div>
              <div className="bl-groups">
                {detail.groups.map((g, gi) => (
                  <Group
                    key={g.name}
                    group={g}
                    accordion={micro}
                    open={!micro || openGroup === gi}
                    onToggle={() => {
                      setOpenGroup((o) => (o === gi ? -1 : gi))
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function Group({
  group: g,
  accordion,
  open,
  onToggle,
}: {
  group: BuildGroupView
  accordion: boolean
  open: boolean
  onToggle: () => void
}) {
  const score = (
    <span className="bl-group-score">
      <span className="bl-group-avg">{g.avg}</span>
      <span className="bl-delta" data-sign={g.dSign}>
        {g.dTxt}
      </span>
      {accordion && (
        <span className="bl-group-chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      )}
    </span>
  )
  return (
    <div className="bl-group">
      {accordion ? (
        <button type="button" className="bl-group-head" aria-expanded={open} onClick={onToggle}>
          <span className="bl-group-name">{g.name}</span>
          {score}
        </button>
      ) : (
        <div className="bl-group-head">
          <span className="bl-group-name">{g.name}</span>
          {score}
        </div>
      )}
      {open && (
        <div className="bl-group-body">
          {g.attrs.map((a) => (
            <div key={a.label} className="bl-attr" data-sign={a.dSign}>
              <span className="bl-attr-name">{a.label}</span>
              <span className="bl-attr-value">{a.v}</span>
              <span className="bl-delta" data-sign={a.dSign}>
                {a.dTxt}
              </span>
              <span className="bl-bar-wrap" aria-hidden>
                <span className="bl-bar">
                  <span className="bl-bar-base" style={{ width: `${String(a.baseW)}%` }} />
                  <span
                    className="bl-bar-seg"
                    style={{ left: `${String(a.segL)}%`, width: `${String(a.segW)}%` }}
                  />
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Tile({
  tile,
  selected,
  onSelect,
}: {
  tile: BuildTileView
  selected: boolean
  onSelect: () => void
}) {
  const archetype = buildClassToArchetype(tile.archetypeRaw)
  return (
    <button type="button" className="bl-tile" aria-pressed={selected} onClick={onSelect}>
      {tile.current && <span className="bl-current-strip" aria-hidden />}
      <span className="bl-row">
        {archetype !== null ? (
          <ArchetypePillCompact archetype={archetype} />
        ) : (
          <span className="bl-arc-fallback" title={tile.arcName}>
            {tile.arcInitials}
          </span>
        )}
        <span className="bl-tag" data-current={tile.current}>
          {tile.tag}
        </span>
      </span>
      <span className="bl-name">{tile.arcName}</span>
      <span className="bl-xfs">
        {tile.xf.map((x, i) => (
          <span
            key={`${String(i)}-${x.abbr}`}
            className="bl-xf"
            data-tier={x.tier ?? 'unknown'}
            title={x.title}
          >
            {x.abbr}
          </span>
        ))}
      </span>
      <span className="bl-bio">
        <span className="bl-bio-cell">
          <span className="bl-label">Ht / Wt</span>
          <span className="bl-bio-value">{tile.htwt}</span>
        </span>
        <span className="bl-bio-cell">
          <span className="bl-label">Hand</span>
          <span className="bl-bio-value">{tile.hand}</span>
        </span>
      </span>
      <span className="bl-foot">
        <span className="bl-gp">
          <span className="bl-gp-n">{tile.gp}</span>
          <span className="bl-gp-l">GP</span>
        </span>
        <span className="bl-record">{tile.record}</span>
      </span>
    </button>
  )
}
