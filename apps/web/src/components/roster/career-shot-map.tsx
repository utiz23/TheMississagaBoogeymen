'use client'

import { useState } from 'react'
import type { PlayerCareerShotRow } from '@eanhl/db/queries'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'

interface CareerShotMapProps {
  events: PlayerCareerShotRow[]
}

type Filter = 'all' | 'shot' | 'goal' | 'hit' | 'penalty' | 'faceoff'

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All',
  shot: 'Shots',
  goal: 'Goals',
  hit: 'Hits',
  penalty: 'Penalties',
  faceoff: 'Faceoffs',
}

/**
 * Per-player career rink map. Aggregates all positioned events for the player
 * across reviewed matches. Hides itself if fewer than 5 positioned events
 * exist (avoids a sparse-dot rendering that's not informative). Filterable
 * client-side by event type.
 */
export function CareerShotMap({ events }: CareerShotMapProps) {
  const [filter, setFilter] = useState<Filter>('all')

  if (events.length < 5) return null

  const filtered = filter === 'all' ? events : events.filter((e) => e.eventType === filter)

  // Available filters: only show ones with at least one matching event.
  const counts: Record<Filter, number> = {
    all: events.length,
    shot: 0,
    goal: 0,
    hit: 0,
    penalty: 0,
    faceoff: 0,
  }
  for (const e of events) {
    if (e.eventType in counts) counts[e.eventType as Filter]++
  }

  return (
    <section className="space-y-3">
      <SectionHeader
        label="Career Shot Map"
        subtitle="All positioned events across reviewed matches"
      />
      <Panel className="overflow-hidden px-2 py-3">
        <div className="mb-3 flex flex-wrap gap-2 px-2">
          {(['all', 'shot', 'goal', 'hit', 'penalty', 'faceoff'] as const).map((f) => {
            if (f !== 'all' && counts[f] === 0) return null
            const active = filter === f
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-sm px-2 py-1 font-condensed text-[11px] uppercase tracking-wider transition-colors ${
                  active
                    ? 'border border-accent bg-accent/15 text-accent'
                    : 'border border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {FILTER_LABELS[f]} ({String(counts[f])})
              </button>
            )
          })}
        </div>
        <div className="relative w-full">
          <svg
            viewBox="-110 -50 220 100"
            preserveAspectRatio="xMidYMid meet"
            className="block h-auto w-full"
            role="img"
            aria-label="Career shot map"
          >
            <RinkBackground />
            {filtered.map((e) => (
              <CareerMarker key={e.eventId} event={e} />
            ))}
          </svg>
        </div>
      </Panel>
    </section>
  )
}

function RinkBackground() {
  return (
    <g>
      <rect x="-100" y="-42.5" width="200" height="85" rx="28" ry="28" fill="#0c1218" stroke="#374151" strokeWidth="0.6" />
      <line x1="0" y1="-42.5" x2="0" y2="42.5" stroke="#7f1d1d" strokeWidth="0.5" />
      <line x1="-25" y1="-42.5" x2="-25" y2="42.5" stroke="#2563eb" strokeWidth="0.5" />
      <line x1="25" y1="-42.5" x2="25" y2="42.5" stroke="#2563eb" strokeWidth="0.5" />
      <circle cx="0" cy="0" r="0.6" fill="#3b82f6" />
      <circle cx="0" cy="0" r="9" fill="none" stroke="#3b82f6" strokeWidth="0.3" opacity="0.5" />
      {[
        [-69, -22],
        [-69, 22],
        [69, -22],
        [69, 22],
      ].map(([cx, cy]) => (
        <g key={`fo-${String(cx)}-${String(cy)}`}>
          <circle cx={cx} cy={cy} r="0.6" fill="#7f1d1d" />
          <circle cx={cx} cy={cy} r="6" fill="none" stroke="#7f1d1d" strokeWidth="0.3" opacity="0.4" />
        </g>
      ))}
      <line x1="-89" y1="-32" x2="-89" y2="32" stroke="#7f1d1d" strokeWidth="0.4" />
      <line x1="89" y1="-32" x2="89" y2="32" stroke="#7f1d1d" strokeWidth="0.4" />
    </g>
  )
}

function CareerMarker({ event }: { event: PlayerCareerShotRow }) {
  const x = Number(event.x)
  const y = Number(event.y)
  // Color by event type; smaller markers than the single-match map since
  // career maps usually have many more points clustered.
  let fill = '#6b7280'
  let size = 2
  if (event.eventType === 'goal') {
    fill = '#ef4444'
    size = 3
  } else if (event.eventType === 'shot') {
    fill = '#9ca3af'
  } else if (event.eventType === 'hit') {
    fill = '#3b82f6'
  } else if (event.eventType === 'penalty') {
    fill = '#f59e0b'
  } else if (event.eventType === 'faceoff') {
    fill = '#e5e7eb'
    size = 1.5
  }

  const tooltip = `${event.eventType.toUpperCase()} · vs ${event.opponentName} · ${event.periodLabel ?? ''} ${event.clock ?? ''}`

  return (
    <g>
      <title>{tooltip}</title>
      <circle cx={x} cy={y} r={size} fill={fill} fillOpacity="0.75" stroke="#111827" strokeWidth="0.2" />
    </g>
  )
}
