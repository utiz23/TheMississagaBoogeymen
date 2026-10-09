'use client'

import { useState, useSyncExternalStore } from 'react'
import Image from 'next/image'
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
 * Build Locker v3 (Build Locker v3.dc.html; spec Part 4): an identity header
 * with the archetype mix, one tile per build, newest first, and a shared
 * detail panel for the selected one. The first tile starts open; clicking the
 * open tile closes it, as in the design. Medium / Small / Micro layouts follow
 * the v3 tier mockups.
 */
export function BuildLocker({ view, gamertag }: { view: BuildLockerView; gamertag: string }) {
  const [sel, setSel] = useState(0)
  // Micro accordion (Build Locker v3 Micro.dc.html): one group open at a time,
  // the first by default; tapping the open one closes it.
  const micro = useMicro()
  const [openGroup, setOpenGroup] = useState(0)
  const detail = sel >= 0 ? view.details[sel] : undefined
  return (
    <section className="bl" aria-label="Build Locker">
      <span className="bl-strip" aria-hidden />
      <div className="bl-head">
        <div className="bl-head-main">
          <h2 className="bl-title">
            <span className="bl-title-mark" aria-hidden>
              ▰
            </span>
            Build Locker
          </h2>
          <div className="bl-id">
            <span className="bl-avatar" aria-hidden>
              <svg viewBox="0 0 100 110" fill="currentColor">
                <circle cx="50" cy="32" r="21" />
                <path d="M 8 110 Q 8 66 50 66 Q 92 66 92 110 Z" />
              </svg>
            </span>
            <span className="bl-names">
              <span className="bl-persona">{view.persona ?? gamertag}</span>
              {view.persona !== null && <span className="bl-gamertag">{gamertag}</span>}
            </span>
            <span className="bl-totals">
              <Stat label="Builds" value={view.count} />
              <Stat label="GP" value={view.totalGp} />
              <Stat label="Title" value={view.titleName} className="bl-total-title" />
            </span>
          </div>
          <div className="bl-mix">
            {view.mix.map((m) => (
              <span key={m.arcName} className="bl-mix-item">
                {m.n > 1 && <span className="bl-mix-n">{m.n}×</span>}
                <ArcPill raw={m.archetypeRaw} name={m.arcName} initials={m.arcInitials} />
              </span>
            ))}
          </div>
        </div>
        <span className="bl-src">Newest first · from game sheets</span>
      </div>

      <div className="bl-tiles-wrap">
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
      </div>

      {detail !== undefined && (
        <div className="bl-detail">
          <div className="bl-detail-head">
            <span className="bl-detail-title">
              <span className="bl-detail-name">{detail.name}</span>
              <span className="bl-detail-meta">{detail.meta}</span>
            </span>
            {detail.note !== '' && (
              <span className="bl-detail-cmp">
                <span className="bl-detail-note">{detail.note}</span>
                <span className="bl-detail-updown">
                  <span data-sign="1">▲ {detail.up}</span>
                  <span data-sign="-1">▼ {detail.down}</span>
                </span>
              </span>
            )}
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
      )}
    </section>
  )
}

function Stat({
  label,
  value,
  className,
}: {
  label: string
  value: string | number
  className?: string
}) {
  return (
    <span className={['bl-stat', className ?? ''].join(' ').trim()}>
      <span className="bl-stat-l">{label}</span>
      <span className="bl-stat-v">{value}</span>
    </span>
  )
}

function ArcPill({ raw, name, initials }: { raw: string | null; name: string; initials: string }) {
  const archetype = buildClassToArchetype(raw)
  return archetype !== null ? (
    <ArchetypePillCompact archetype={archetype} />
  ) : (
    <span className="bl-arc-fallback" title={name}>
      {initials}
    </span>
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
  return (
    <button type="button" className="bl-tile" aria-pressed={selected} onClick={onSelect}>
      <span className="bl-row">
        <ArcPill raw={tile.archetypeRaw} name={tile.arcName} initials={tile.arcInitials} />
        <span className="bl-tag" data-current={tile.current}>
          {tile.current && <span className="bl-tag-dot" aria-hidden />}
          {tile.tag}
        </span>
      </span>
      <span className="bl-name-block">
        <span className="bl-name">{tile.arcName}</span>
        <span className="bl-body">{tile.body}</span>
      </span>
      <span className="bl-xfs">
        {tile.xf.map((x, i) => (
          <span
            key={`${String(i)}-${x.abbr}`}
            className="bl-xf"
            data-tier={x.tier ?? 'unknown'}
            title={x.title}
          >
            {x.src !== null ? (
              <Image src={x.src} alt={x.title} width={46} height={46} className="bl-xf-img" />
            ) : (
              <span className="bl-xf-abbr">{x.abbr}</span>
            )}
          </span>
        ))}
      </span>
      <span className="bl-foot">
        <span className="bl-foot-stats">
          <span className="bl-stat">
            <span className="bl-stat-l">GP</span>
            <span className="bl-foot-gp">{tile.gp}</span>
          </span>
          <span className="bl-stat">
            <span className="bl-stat-l">W–L–OTL</span>
            <span className="bl-foot-rec">{tile.record}</span>
          </span>
        </span>
        <span className="bl-chev" aria-hidden>
          {selected ? '▾' : '▸'}
        </span>
      </span>
    </button>
  )
}
