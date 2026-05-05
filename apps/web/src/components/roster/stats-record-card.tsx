'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'

type Tab = 'season' | 'game-log'

interface Props {
  seasonTable: ReactNode
  gameLog: ReactNode
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'season', label: 'Season-by-Season' },
  { key: 'game-log', label: 'Game Log' },
]

export function StatsRecordCard({ seasonTable, gameLog }: Props) {
  const [active, setActive] = useState<Tab>('season')

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-condensed text-sm font-bold uppercase tracking-[0.2em] text-zinc-100">
          Stats Record
        </h2>
        <p className="text-[11px] text-zinc-500">
          Career history and per-game appearances.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-zinc-800">
        {TABS.map((t) => {
          const isActive = t.key === active
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => { setActive(t.key) }}
              className={[
                'border-b-2 px-3 py-2 font-condensed text-xs font-bold uppercase tracking-[0.16em] transition-colors',
                isActive
                  ? 'border-accent text-accent'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300',
              ].join(' ')}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {active === 'season' && seasonTable}
      {active === 'game-log' && gameLog}
    </section>
  )
}
