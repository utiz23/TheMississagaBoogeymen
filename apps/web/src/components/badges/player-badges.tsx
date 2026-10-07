'use client'

import { useMemo, useState } from 'react'
import { BADGE_LADDERS, BADGE_MAX_LEVEL } from '@eanhl/db/cards'
import type { BadgeFamilyId } from '@eanhl/db/cards'
import { Badge } from './badge'
import {
  badgeVisual,
  buildBadgeBoard,
  defaultSelection,
  formatCount,
  themeLabel,
  type BadgeRowInput,
  type BadgeRowView,
} from './badge-board'
import './player-badges.css'

const LOCK_FILTER = 'grayscale(1) brightness(0.55)'
const LOCK_OPACITY = 0.35
const LEVELS = Array.from({ length: BADGE_MAX_LEVEL }, (_, i) => i + 1)
const THEME_CHUNKS = Array.from({ length: BADGE_MAX_LEVEL / 3 }, (_, t) =>
  LEVELS.slice(t * 3, t * 3 + 3),
)

function BadgeAt({ row, level, size }: { row: BadgeRowView; level: number; size: number }) {
  const v = badgeVisual(level)
  return (
    <Badge familyId={row.family.id} shape={row.shape} theme={v.theme} frame={v.frame} size={size} />
  )
}

interface PlayerBadgesProps {
  gamertag: string
  rows: readonly BadgeRowInput[]
}

/** Profile "Badges" section — port of Player Badges.dc.html (marker = frame step, locked = dim). */
export function PlayerBadges({ gamertag, rows }: PlayerBadgesProps) {
  const board = useMemo(() => buildBadgeBoard(rows), [rows])
  const [selId, setSelId] = useState<BadgeFamilyId>(() => defaultSelection(board))
  const [hover, setHover] = useState<number | null>(null)
  const [pin, setPin] = useState<number | null>(null)

  const sel = board.rows.find((r) => r.family.id === selId) ?? board.rows[0]
  if (sel === undefined) return null

  const ladder = BADGE_LADDERS[sel.family.id]
  const level = sel.progress.level
  const focus = hover ?? pin
  const focusAt = focus === null ? 0 : (ladder[focus - 1] ?? 0)
  const headLabel =
    focus === null
      ? sel.themeLabel
      : `${themeLabel(focus)} · LVL ${String(focus)} · ${formatCount(focusAt)} ${sel.family.unit} · ${focus <= level ? 'Unlocked' : 'Locked'}`
  const headDim = focus === null && sel.locked

  const pick = (id: BadgeFamilyId) => {
    setSelId(id)
    setPin(null)
    setHover(null)
  }

  return (
    <section className="pb" aria-label="Badges">
      <header className="pb-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 className="pb-title">
            <span className="pb-title-mark">▌</span>Badges
          </h2>
          <span className="pb-sub">Career milestones · player · {gamertag}</span>
        </div>
        <div className="pb-totals">
          <span>
            <b>{board.unlocked}</b> / {board.total} Unlocked
          </span>
          <span className="pb-dot">·</span>
          <span>
            <b>{board.levels}</b> / {board.maxLevels} Levels
          </span>
        </div>
      </header>
      <div className="pb-rule" />
      <div className="pb-body">
        <div className="pb-list">
          {board.groups.map((g) => (
            <div key={g.group.id}>
              <div className="pb-group">
                <span>{g.group.name}</span>
                <span className="pb-group-line" />
                <span className="pb-group-count">
                  {g.unlocked}/{g.members.length}
                </span>
              </div>
              {g.members.map((r) => (
                <button
                  key={r.family.id}
                  type="button"
                  className="pb-row"
                  data-selected={r.family.id === sel.family.id}
                  data-locked={r.locked}
                  onClick={() => {
                    pick(r.family.id)
                  }}
                >
                  <span
                    className="pb-row-badge"
                    style={r.locked ? { opacity: LOCK_OPACITY, filter: LOCK_FILTER } : undefined}
                  >
                    <BadgeAt row={r} level={r.progress.level} size={30} />
                  </span>
                  <span className="pb-row-text">
                    <span className="pb-row-name">{r.family.short}</span>
                    <span className="pb-row-theme">{r.themeLabel}</span>
                  </span>
                  <span className="pb-row-lvl">
                    {r.progress.level}
                    <span>/30</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="pb-detail">
          <div className="pb-detail-head">
            <div
              style={
                headDim
                  ? { flex: 'none', opacity: LOCK_OPACITY, filter: LOCK_FILTER }
                  : { flex: 'none' }
              }
            >
              <BadgeAt row={sel} level={focus ?? level} size={76} />
            </div>
            <div className="pb-detail-info">
              <div className="pb-detail-top">
                <span className="pb-detail-name">{sel.family.name}</span>
                <span className="pb-detail-lvl">
                  LVL <b>{level}</b> / 30
                </span>
              </div>
              <span className="pb-detail-label">{headLabel}</span>
              <div className="pb-bar">
                <div style={{ width: `${(sel.progress.pct * 100).toFixed(1)}%` }} />
              </div>
              <div className="pb-detail-progress">
                <span>{sel.progressText}</span>
                <span>{sel.remainingText}</span>
              </div>
            </div>
          </div>
          <div className="pb-ladder">
            {THEME_CHUNKS.map((chunk) => (
              <div key={chunk[0]} className="pb-theme">
                {chunk.map((n) => {
                  const done = n <= level
                  const current = n === level + 1
                  const at = ladder[n - 1] ?? 0
                  return (
                    <button
                      key={n}
                      type="button"
                      className="pb-cell"
                      data-current={current}
                      aria-pressed={pin === n}
                      title={`LVL ${String(n)} · ${themeLabel(n)} · ${formatCount(at)} ${sel.family.unit}`}
                      onMouseEnter={() => {
                        setHover(n)
                      }}
                      onMouseLeave={() => {
                        setHover(null)
                      }}
                      onClick={() => {
                        setPin((p) => (p === n ? null : n))
                      }}
                    >
                      <span
                        style={{
                          opacity: done ? 1 : current ? 0.6 : LOCK_OPACITY,
                          filter: done ? 'none' : current ? 'grayscale(0.6)' : LOCK_FILTER,
                        }}
                      >
                        <BadgeAt row={sel} level={n} size={52} />
                      </span>
                      <span
                        className="pb-cell-at"
                        style={{ color: done ? '#fafafa' : current ? '#e84131' : '#52525b' }}
                      >
                        {formatCount(at)}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <footer className="pb-foot">
        <span>Source EA NHL · Boogeymen</span>
        <span>Sheet BGM/BDG/0028</span>
      </footer>
    </section>
  )
}
