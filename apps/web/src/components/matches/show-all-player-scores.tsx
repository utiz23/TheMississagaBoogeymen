'use client'

import { useId, useState } from 'react'
import type { PlayerScoreEntry } from '@/lib/match-recap'
import { performerKey } from '@/lib/match-recap'
import { PerformerRow } from './star-card'

// The ranked performer ladder for the rail. This file used to be a wide
// 10-column table hidden behind a disclosure; the prototype folds that table
// and the three star cards into ONE list — ranks 1-3 always visible, the rest
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
            className="flex w-full items-center justify-center gap-2 border-t border-border px-3.5 py-2.5 transition-colors hover:bg-surface-raised"
          >
            <span className="font-condensed text-[10px] font-extrabold uppercase tracking-[0.16em] text-accent">
              {showAll ? 'Show top 3 only' : `Show all ${entries.length.toString()} players`}
            </span>
            <span
              aria-hidden
              className={`font-condensed text-[10px] leading-none text-accent transition-transform ${
                showAll ? 'inline-block rotate-180' : 'inline-block'
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
