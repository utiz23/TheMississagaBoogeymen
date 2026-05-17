'use client'

import { useId, type ReactNode, type KeyboardEvent } from 'react'

/**
 * Lineup ladder row — controlled client component. The shared `LineupLadder`
 * wrapper owns the `openPosition` state and passes `isOpen` + `onToggle` per
 * row so only one row can be expanded at a time.
 *
 * Mirrors the row-level expand pattern from `scoresheet.tsx`. Cards become
 * clickable buttons (Enter / Space) with `aria-expanded` + `aria-controls`
 * so screen readers announce the state change.
 */

interface LineupRowProps {
  bgmCard: ReactNode
  oppCard: ReactNode
  positionBadge: ReactNode
  expandPanel: ReactNode
  /** When false the row is rendered static (CPU goalie row — nothing to expand). */
  expandable: boolean
  isOpen: boolean
  onToggle: () => void
}

export function LineupRow({
  bgmCard,
  oppCard,
  positionBadge,
  expandPanel,
  expandable,
  isOpen,
  onToggle,
}: LineupRowProps) {
  const panelId = useId()

  const handleToggle = () => {
    if (!expandable) return
    onToggle()
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!expandable) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onToggle()
    }
  }

  const cardWrapperProps = expandable
    ? {
        role: 'button' as const,
        tabIndex: 0,
        'aria-expanded': isOpen,
        'aria-controls': panelId,
        onClick: handleToggle,
        onKeyDown: onKey,
        className:
          'cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]',
      }
    : { className: '' }

  return (
    <div data-open={isOpen ? 'true' : 'false'} className="group">
      <div className="grid grid-cols-1 items-stretch md:grid-cols-[1fr_96px_1fr]">
        <div {...cardWrapperProps}>{bgmCard}</div>
        {positionBadge}
        <div {...cardWrapperProps}>{oppCard}</div>
      </div>
      {expandable && isOpen ? <div id={panelId}>{expandPanel}</div> : null}
    </div>
  )
}
