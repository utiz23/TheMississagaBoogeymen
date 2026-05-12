'use client'

import { useState, type ReactNode } from 'react'
import { SectionHeader } from '@/components/ui/section-header'

type TabId = 'with-without' | 'best-pairs' | 'matrix'

interface Tab {
  id: TabId
  label: string
  description: string
}

const TABS: Tab[] = [
  {
    id: 'matrix',
    label: 'Pair Win Matrix',
    description: 'Heatmap of pairwise win % when each duo appeared together',
  },
  {
    id: 'best-pairs',
    label: 'Best Pairs',
    description: 'Pair records ranked by goal differential',
  },
  {
    id: 'with-without',
    label: 'Team With / Without',
    description: 'Per-player team-record split — games with vs without each player',
  },
]

interface Props {
  /** Pre-rendered table content for each tab — server-rendered, swapped on
   *  click. Keeping them as `ReactNode` means tabs don't need to know table
   *  internals. */
  withWithout: ReactNode
  bestPairs: ReactNode
  matrix: ReactNode
}

/**
 * Tabbed Chemistry section. Three sub-tables (pair matrix, best pairs,
 * with/without) used to stack as separate `<ChemistrySection>` blocks; here
 * they share a single section header + tab bar so the page reads as one
 * coherent chemistry module instead of three.
 *
 * The Pair Win Matrix is the default tab — it's the most polished view and
 * the broadest answer to "how does this roster mesh." The other two are
 * deeper drilldowns surfaced on demand.
 */
export function ChemistrySection({ withWithout, bestPairs, matrix }: Props) {
  const [active, setActive] = useState<TabId>('matrix')
  // The lookup falls back to a hard-coded default rather than asserting non-null,
  // so a stale `active` value can never crash the component.
  const activeTab: Tab =
    TABS.find((t) => t.id === active) ?? {
      id: 'matrix',
      label: 'Pair Win Matrix',
      description: '',
    }

  return (
    <section className="space-y-3">
      <SectionHeader label="Chemistry" subtitle={activeTab.description} />
      {/* Chemistry view tabs — full-width segmented bar with a thick active
          accent underline. Sits visually like a sub-section header so it can't
          be missed when scanning down the page. */}
      <div
        role="tablist"
        aria-label="Chemistry view"
        className="inline-flex w-full overflow-hidden rounded-md border border-zinc-700 bg-surface"
      >
        {TABS.map((t) => {
          const isActive = t.id === active
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                setActive(t.id)
              }}
              className={[
                'flex-1 px-4 py-3 font-condensed text-sm font-bold uppercase tracking-[0.20em] transition-colors',
                'border-b-2 -mb-px',
                isActive
                  ? 'border-accent bg-[rgba(232,65,49,0.12)] text-zinc-50'
                  : 'border-transparent text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
              ].join(' ')}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {/* Render only the active tab's content. Mount/unmount on switch keeps
          per-table state (slider, sort) fresh — user re-enters with default
          view rather than a stale slider position. */}
      <div>
        {active === 'matrix' ? matrix : null}
        {active === 'best-pairs' ? bestPairs : null}
        {active === 'with-without' ? withWithout : null}
      </div>
    </section>
  )
}
