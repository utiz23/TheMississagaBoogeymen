'use client'

import { useId, useState } from 'react'
import type { PlayerScoreEntry } from '@/lib/match-recap'
import { performerKey } from '@/lib/match-recap'
import { PerformerRow } from './performer-row'

// The ranked performer ladder for the rail. This replaced a wide 10-column
// table hidden behind a disclosure (the old `show-all-player-scores.tsx`); the
// prototype folds that table and the three star cards into ONE list — ranks 1-3
// always visible, the rest
// behind SHOW ALL, every row on the same template. It owns both pieces of
// interaction state (which rows are visible, which one is expanded) because the
// prototype allows only one open breakdown at a time across the whole ladder.

interface PerformerScoreListProps {
  entries: PlayerScoreEntry[]
  /** `performerKey` → season delta, for the rows that have one. */
  deltas: Record<string, number>
  opponentLabel: string
}

const VISIBLE = 3

export function PerformerScoreList({ entries, deltas, opponentLabel }: PerformerScoreListProps) {
  const [showAll, setShowAll] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const idBase = useId()

  if (entries.length === 0) return null

  const restId = `${idBase}-rest`
  const hasRest = entries.length > VISIBLE

  const renderRow = (entry: PlayerScoreEntry, index: number) => {
    const key = performerKey(entry)
    const rowKey = `${key}#${index.toString()}`
    return (
      <PerformerRow
        key={rowKey}
        entry={entry}
        rank={index + 1}
        opponentLabel={opponentLabel}
        vsSeasonAvg={deltas[key] ?? null}
        expanded={openKey === rowKey}
        panelId={`${idBase}-${index.toString()}`}
        onToggle={() => {
          setOpenKey((prev) => (prev === rowKey ? null : rowKey))
        }}
      />
    )
  }

  return (
    <div>
      {entries.slice(0, VISIBLE).map(renderRow)}

      {hasRest ? (
        <>
          {/* Kept mounted so `aria-controls` always resolves, and so an open
              breakdown survives a collapse/expand of the ladder. */}
          <div id={restId} hidden={!showAll}>
            {entries.slice(VISIBLE).map((entry, i) => renderRow(entry, i + VISIBLE))}
          </div>

          <button
            type="button"
            aria-expanded={showAll}
            aria-controls={restId}
            onClick={() => {
              setShowAll((v) => !v)
            }}
            className="group/cta mx-3.5 mb-3.5 mt-2.5 flex w-[calc(100%-28px)] items-center justify-center gap-[7px] border border-border bg-charcoal px-3 py-2.5 transition-colors hover:border-accent hover:bg-[var(--color-accent-soft)]"
          >
            <span className="font-condensed text-[12px] font-extrabold uppercase tracking-[0.16em] text-fg-2 transition-colors group-hover/cta:text-accent">
              {showAll ? 'Show top 3 only' : `Show all ${entries.length.toString()} players`}
            </span>
            {/* Glyph, so sized by eye rather than to the 12px label beside it. */}
            <span
              aria-hidden
              className={`gs-chevron inline-block font-condensed text-[14px] leading-none text-fg-2 group-hover/cta:text-accent ${
                showAll ? 'rotate-180' : ''
              }`}
            >
              ⌄
            </span>
          </button>
        </>
      ) : null}
    </div>
  )
}
