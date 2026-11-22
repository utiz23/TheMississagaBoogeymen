'use client'

import { useState } from 'react'
import {
  EXAMPLE_CAMRAZZ,
  EXAMPLE_LEHMANN,
  ZERO_GOALIE,
  ZERO_SKATER,
  goalieCanBeStar,
  scoreGoalieLine,
  scoreSkaterLine,
} from '@/lib/game-score-explainer'
import type { GoalieScoreInput, SkaterScoreInput } from '@/lib/match-recap'

type SkaterKey = keyof SkaterScoreInput
type GoalieKey = Exclude<keyof GoalieScoreInput, 'goalsAgainst'>

const SKATER_FIELDS: { key: SkaterKey; label: string; allowNegative?: boolean }[] = [
  { key: 'goals', label: 'Goals' },
  { key: 'assists', label: 'Assists' },
  { key: 'plusMinus', label: 'Plus / minus', allowNegative: true },
  { key: 'shots', label: 'Shots' },
  { key: 'takeaways', label: 'Takeaways' },
  { key: 'interceptions', label: 'Interceptions' },
  { key: 'blockedShots', label: 'Blocked shots' },
  { key: 'penaltiesDrawn', label: 'Penalties drawn' },
  { key: 'giveaways', label: 'Giveaways' },
  { key: 'pim', label: 'Penalty minutes' },
  { key: 'hits', label: 'Hits' },
  { key: 'faceoffWins', label: 'Faceoffs won' },
  { key: 'faceoffLosses', label: 'Faceoffs lost' },
]

const GOALIE_FIELDS: { key: GoalieKey; label: string }[] = [
  { key: 'shotsAgainst', label: 'Shots against' },
  { key: 'saves', label: 'Saves' },
  { key: 'breakawaySaves', label: 'Breakaway saves' },
  { key: 'penSaves', label: 'Penalty shot saves' },
  { key: 'despSaves', label: 'Desperation saves' },
  { key: 'pokechecks', label: 'Poke checks' },
]

const PART_NAMES: Record<string, string> = {
  'Penalty Min': 'PIM',
  'FO Net': 'Faceoffs',
  'Desp. Saves': 'Desperation saves',
  'Pen. Shot Saves': 'Penalty shot saves',
  'Win Bonus': 'Win',
}

function toNumber(raw: string): number {
  const v = Number.parseFloat(raw)
  return Number.isFinite(v) ? v : 0
}

function signed(x: number): string {
  return `${x < 0 ? '−' : '+'}${Math.abs(x).toFixed(2)}`
}

const inputClass =
  'w-full rounded-none border border-zinc-800 bg-background px-2.5 py-2 text-lg tabular-nums text-fg-1 focus:border-accent focus:outline-none'
const labelClass =
  'flex min-w-0 flex-col gap-1 font-condensed text-xs font-semibold uppercase tracking-wider text-fg-4'

export function ScoreCalculator() {
  const [mode, setMode] = useState<'skater' | 'goalie'>('skater')
  const [skater, setSkater] = useState<SkaterScoreInput>(EXAMPLE_CAMRAZZ)
  const [goalie, setGoalie] = useState<GoalieScoreInput>(EXAMPLE_LEHMANN)
  const [skaterWon, setSkaterWon] = useState(true)
  const [goalieWon, setGoalieWon] = useState(true)

  const shotsAgainst = Math.max(0, goalie.shotsAgainst ?? 0)
  const rawSaves = Math.max(0, goalie.saves ?? 0)
  const tooManySaves = rawSaves > shotsAgainst
  const saves = Math.min(rawSaves, shotsAgainst)
  const goalieLine: GoalieScoreInput = {
    ...goalie,
    shotsAgainst,
    saves,
    goalsAgainst: shotsAgainst - saves,
  }

  const result =
    mode === 'skater' ? scoreSkaterLine(skater, skaterWon) : scoreGoalieLine(goalieLine, goalieWon)
  const shown = result.parts.filter((p) => Math.abs(p.contribution) > 0.0001)

  let warning: string | null = null
  if (mode === 'goalie') {
    if (tooManySaves) warning = 'Saves can’t be more than shots against.'
    else if (shotsAgainst === 0) warning = 'No shots faced: this goalie can’t be a star.'
    else if (!goalieCanBeStar(goalieLine))
      warning = 'Save % under .900: this goalie can’t be a star.'
  }

  function clear() {
    if (mode === 'skater') {
      setSkater(ZERO_SKATER)
      setSkaterWon(false)
    } else {
      setGoalie(ZERO_GOALIE)
      setGoalieWon(false)
    }
  }

  const tabClass = (active: boolean) =>
    `px-4 py-2 font-condensed text-sm font-bold uppercase tracking-widest ${
      active ? 'bg-accent text-white' : 'text-fg-3 hover:text-fg-1'
    }`

  return (
    <div className="rounded-none border border-zinc-800 bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="inline-flex border border-zinc-800" role="group" aria-label="Player type">
          <button
            type="button"
            aria-pressed={mode === 'skater'}
            className={tabClass(mode === 'skater')}
            onClick={() => {
              setMode('skater')
            }}
          >
            Skater
          </button>
          <button
            type="button"
            aria-pressed={mode === 'goalie'}
            className={tabClass(mode === 'goalie')}
            onClick={() => {
              setMode('goalie')
            }}
          >
            Goalie
          </button>
        </div>
        <button
          type="button"
          onClick={clear}
          className="border border-zinc-800 px-3 py-1.5 text-sm text-fg-2 hover:border-accent"
        >
          Clear
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4">
        {mode === 'skater' ? (
          <>
            {SKATER_FIELDS.map((f) => (
              <label key={f.key} htmlFor={`gs-s-${f.key}`} className={labelClass}>
                {f.label}
                <input
                  id={`gs-s-${f.key}`}
                  type="number"
                  inputMode="numeric"
                  min={f.allowNegative === true ? undefined : 0}
                  value={skater[f.key]}
                  onChange={(e) => {
                    const v = toNumber(e.target.value)
                    setSkater((s) => ({ ...s, [f.key]: v }))
                  }}
                  className={inputClass}
                />
              </label>
            ))}
            <label
              htmlFor="gs-s-win"
              className="flex items-center gap-2 self-end pb-2.5 text-sm text-fg-1"
            >
              <input
                id="gs-s-win"
                type="checkbox"
                checked={skaterWon}
                onChange={(e) => {
                  setSkaterWon(e.target.checked)
                }}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              Team won
            </label>
          </>
        ) : (
          <>
            {GOALIE_FIELDS.map((f) => (
              <label key={f.key} htmlFor={`gs-g-${f.key}`} className={labelClass}>
                {f.label}
                <input
                  id={`gs-g-${f.key}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={goalie[f.key] ?? 0}
                  onChange={(e) => {
                    const v = toNumber(e.target.value)
                    setGoalie((g) => ({ ...g, [f.key]: v }))
                  }}
                  className={inputClass}
                />
              </label>
            ))}
            <label
              htmlFor="gs-g-win"
              className="flex items-center gap-2 self-end pb-2.5 text-sm text-fg-1"
            >
              <input
                id="gs-g-win"
                type="checkbox"
                checked={goalieWon}
                onChange={(e) => {
                  setGoalieWon(e.target.checked)
                }}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              Team won
            </label>
          </>
        )}
      </div>

      <div
        className="flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-zinc-800 bg-surface-raised px-4 py-4"
        aria-live="polite"
      >
        <div className="font-condensed text-5xl font-black leading-none tabular-nums text-fg-1">
          {result.total < 0 ? '−' : ''}
          {Math.abs(result.total).toFixed(2)}
          <span className="ml-1.5 text-sm tracking-widest text-fg-4">GS</span>
        </div>
        <div className="min-w-0 flex-[1_1_260px] text-sm text-fg-3">
          {shown.length > 0
            ? shown
                .map((p) => `${PART_NAMES[p.label] ?? p.label} ${signed(p.contribution)}`)
                .join(' · ')
            : 'Nothing entered yet.'}
          {mode === 'goalie' ? (
            <span className="block text-fg-4">Goals against: {goalieLine.goalsAgainst}</span>
          ) : null}
          {warning !== null ? <span className="block text-amber-400">{warning}</span> : null}
        </div>
      </div>
    </div>
  )
}
