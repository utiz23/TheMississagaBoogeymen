'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

// LOADOUTS | STATS page mode — client state shared via context, NOT URL
// navigation: App Router has no shallow routing, and a toggle must never
// re-run the page's 15-query load. The URL mirrors the mode (?view=stats)
// through history.replaceState so deep links survive; the server page reads
// the param once to seed initialMode.

export type GameSheetMode = 'loadouts' | 'stats'

/** id of the region the tabs control — the page's main column adopts it. */
export const GAME_SHEET_PANEL_ID = 'game-sheet-panel'

/** Per-tab id, so the panel can point `aria-labelledby` at the ACTIVE tab. */
const tabId = (mode: GameSheetMode) => `game-sheet-tab-${mode}`

const MODES: GameSheetMode[] = ['loadouts', 'stats']
const MODE_LABEL: Record<GameSheetMode, string> = {
  loadouts: 'Loadouts',
  stats: 'Stats',
}

interface GameSheetModeValue {
  mode: GameSheetMode
  setMode: (mode: GameSheetMode) => void
  /**
   * False when no OCR loadout snapshots exist for the match. LOADOUTS then has
   * nothing to show, so the tab is disabled and `setMode('loadouts')` is a
   * no-op — the page is STATS-only.
   */
  loadoutsAvailable: boolean
}

const GameSheetModeContext = createContext<GameSheetModeValue | null>(null)

export function GameSheetModeProvider({
  initialMode,
  loadoutsAvailable = true,
  children,
}: {
  initialMode: GameSheetMode
  loadoutsAvailable?: boolean
  children: ReactNode
}) {
  const [mode, setModeState] = useState<GameSheetMode>(loadoutsAvailable ? initialMode : 'stats')

  const setMode = useCallback(
    (next: GameSheetMode) => {
      if (next === 'loadouts' && !loadoutsAvailable) return
      setModeState(next)
      // Mirror into ?view= for deep links; drop the param at the default so
      // copied URLs stay clean. Other params (list query) are preserved.
      const url = new URL(window.location.href)
      if (next === 'stats') url.searchParams.set('view', 'stats')
      else url.searchParams.delete('view')
      window.history.replaceState(null, '', url.toString())
    },
    [loadoutsAvailable],
  )

  const value = useMemo(
    () => ({ mode, setMode, loadoutsAvailable }),
    [mode, setMode, loadoutsAvailable],
  )
  return <GameSheetModeContext.Provider value={value}>{children}</GameSheetModeContext.Provider>
}

export function useGameSheetMode(): GameSheetModeValue {
  const ctx = useContext(GameSheetModeContext)
  if (ctx === null) {
    throw new Error('useGameSheetMode must be used inside <GameSheetModeProvider>')
  }
  return ctx
}

// Underline segmented control per the prototype sub-nav. role=tab semantics
// with the canonical roving-tabindex pattern (same template as box-score.tsx).
export function GameSheetModeTabs() {
  const { mode, setMode, loadoutsAvailable } = useGameSheetMode()
  const tablistRef = useRef<HTMLDivElement>(null)
  const enabled = (m: GameSheetMode) => m !== 'loadouts' || loadoutsAvailable

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // Only the enabled tabs take part in the roving pattern — arrowing onto a
    // disabled LOADOUTS would trap focus on a control that does nothing.
    const buttons = tablistRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]:not([aria-disabled="true"])',
    )
    if (!buttons || buttons.length === 0) return
    const focused = Array.from(buttons).findIndex((b) => b === document.activeElement)
    if (focused < 0) return

    let nextIdx: number | null = null
    if (e.key === 'ArrowRight') nextIdx = (focused + 1) % buttons.length
    else if (e.key === 'ArrowLeft') nextIdx = (focused - 1 + buttons.length) % buttons.length
    else if (e.key === 'Home') nextIdx = 0
    else if (e.key === 'End') nextIdx = buttons.length - 1

    if (nextIdx === null) return
    e.preventDefault()
    const nextMode = MODES.filter(enabled)[nextIdx]
    if (nextMode === undefined) return
    setMode(nextMode)
    // After React re-renders with the new tabIndex layout, move focus to the
    // now-active tab (canonical roving-tabindex pattern).
    requestAnimationFrame(() => {
      buttons[nextIdx]?.focus()
    })
  }

  return (
    <div
      ref={tablistRef}
      role="tablist"
      aria-label="Game sheet mode"
      onKeyDown={handleKey}
      className="flex gap-[22px] border-b border-border-subtle"
    >
      {MODES.map((m) => {
        const active = mode === m
        const isEnabled = enabled(m)
        return (
          <button
            key={m}
            id={tabId(m)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={GAME_SHEET_PANEL_ID}
            aria-disabled={!isEnabled}
            title={isEnabled ? undefined : 'No pre-game loadouts were captured for this match'}
            tabIndex={active ? 0 : -1}
            onClick={() => {
              setMode(m)
            }}
            className={`relative px-0.5 py-1.5 font-condensed text-[13px] font-extrabold uppercase tracking-[0.14em] transition-colors ${
              !isEnabled
                ? 'cursor-not-allowed text-fg-5'
                : active
                  ? 'text-fg-1'
                  : 'text-fg-3 hover:text-fg-2'
            }`}
          >
            {MODE_LABEL[m]}
            {active ? (
              <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The region the tabs control. Client-side because `aria-labelledby` has to
 * name the ACTIVE tab, which only the mode context knows; the children are
 * still server-rendered and pass straight through.
 */
export function GameSheetPanel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const { mode } = useGameSheetMode()
  return (
    <div
      id={GAME_SHEET_PANEL_ID}
      role="tabpanel"
      aria-labelledby={tabId(mode)}
      className={className}
    >
      {children}
    </div>
  )
}
