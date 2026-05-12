'use client'

import { useState, type ReactNode } from 'react'
import { SectionHeader } from '@/components/ui/section-header'

type SourceId = 'club' | 'card'

interface SourceTab {
  id: SourceId
  label: string
  description: string
}

const SOURCES: SourceTab[] = [
  {
    id: 'club',
    label: 'Club-scoped',
    description: 'What each member produced wearing the BGM crest — CLUBS → MEMBERS captures',
  },
  {
    id: 'card',
    label: 'Player-card',
    description: 'Season totals from each player’s stat-card screen — may include other clubs',
  },
]

interface Props {
  /** Pre-rendered Skater + Goalie tables from the club-scoped (CLUBS → MEMBERS) source. */
  clubScoped: ReactNode
  /** Pre-rendered Skater + Goalie tables from the player-card (per-player career screen) source. */
  playerCard: ReactNode
  /** Title name for the section subtitle, e.g. "NHL 25". */
  titleName: string
}

/**
 * Archive Career Stats — single section with a Source toggle (Club-scoped vs
 * Player-card) instead of stacking four tables (skater + goalie per source).
 * Mirrors the Skaters/Goalies tab pattern on the home page leaders section.
 *
 * Source tabs swap between the two reviewed-import datasets we keep distinct
 * because they describe different scopes: club-scoped is "BGM-only," card
 * data may include the player's games for other clubs in the same title.
 */
export function CareerStatsSection({ clubScoped, playerCard, titleName }: Props) {
  const [active, setActive] = useState<SourceId>('club')
  // Fallback values rather than asserting non-null so a stale `active` state
  // can't crash the render.
  const activeSource: SourceTab =
    SOURCES.find((s) => s.id === active) ?? {
      id: 'club',
      label: 'Club-scoped',
      description: '',
    }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeader
          label="Career Stats"
          subtitle={`${titleName} · ${activeSource.description}`}
        />
        <div
          role="tablist"
          aria-label="Career stats source"
          className="inline-flex items-center gap-1.5"
        >
          {SOURCES.map((s) => {
            const isActive = s.id === active
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  setActive(s.id)
                }}
                className={[
                  'rounded-full border px-3 py-1 font-condensed text-[11px] font-bold uppercase tracking-[0.18em] transition-colors',
                  isActive
                    ? 'border-[rgba(232,65,49,0.85)] bg-[rgba(232,65,49,0.10)] text-[#e84131]'
                    : 'border-zinc-800 bg-surface text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
                ].join(' ')}
              >
                {s.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="module-frame divide-y divide-zinc-800/60">
        {active === 'club' ? clubScoped : playerCard}
      </div>
    </section>
  )
}
