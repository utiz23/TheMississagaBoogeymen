'use client'

import { useState, type ReactNode } from 'react'
import { LineupRow } from './lineup-row'

/**
 * Shared open-state owner for the 6-row lineup ladder. Only one row may
 * be expanded at a time — opening another row closes the previous one.
 *
 * Each item carries pre-rendered server JSX (cards + position badge + expand
 * panel). The wrapper itself stays a thin client shell so server-rendered
 * children remain cacheable.
 */

export interface LineupLadderItem {
  position: string
  bgmCard: ReactNode
  oppCard: ReactNode
  positionBadge: ReactNode
  mobileMatchupStrip?: ReactNode
  expandPanel: ReactNode
  expandable: boolean
}

export function LineupLadder({ items }: { items: LineupLadderItem[] }) {
  const [openPosition, setOpenPosition] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => {
        const isOpen = openPosition === item.position
        const onToggle = () => {
          setOpenPosition((prev) => (prev === item.position ? null : item.position))
        }
        return (
          <LineupRow
            key={item.position}
            bgmCard={item.bgmCard}
            oppCard={item.oppCard}
            positionBadge={item.positionBadge}
            mobileMatchupStrip={item.mobileMatchupStrip}
            expandPanel={item.expandPanel}
            expandable={item.expandable}
            isOpen={isOpen}
            onToggle={onToggle}
          />
        )
      })}
    </div>
  )
}
