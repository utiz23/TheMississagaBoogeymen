import type { getEARoster } from '@eanhl/db/queries'
import { PlayerCard } from '@/components/home/player-card'
import './depth-chart.css'

type RosterRow = Awaited<ReturnType<typeof getEARoster>>[number]

/**
 * One depth-chart slot. `isDepth` flags slots filled by a player whose role
 * class (forward / defense / goalie) doesn't match the slot, OR a player
 * already placed in the same role earlier in the chart.
 */
export interface DepthSlot {
  player: RosterRow
  isDepth: boolean
}

export interface DepthChartProps {
  forwards: { lw: DepthSlot | null; c: DepthSlot | null; rw: DepthSlot | null }[]
  defense: { ld: DepthSlot | null; rd: DepthSlot | null }[]
  goalies: (DepthSlot | null)[]
  /** Header scope line (e.g. "Boogeymen · NHL 26 · Season Totals · 22-skater pool"). */
  scopeLabel?: string | undefined
  /** Footer sheet identifier. */
  sheetCode?: string | undefined
}

const FORWARD_LINE_LABELS = ['Line', 'Line', 'Line', 'Line']
const DEFENSE_PAIR_LABELS = ['Pair', 'Pair', 'Pair']
const GOALIE_SLOT_LABELS = ['Starter', 'Backup', '3rd String', '4th String', '5th String']

export function DepthChart({
  forwards,
  defense,
  goalies,
  scopeLabel,
  sheetCode = 'BGM/RST/0010',
}: DepthChartProps) {
  const skaterCount = countDistinctPlayers([
    ...forwards.flatMap((l) => [l.lw, l.c, l.rw]),
    ...defense.flatMap((p) => [p.ld, p.rd]),
  ])
  const goalieCount = countDistinctPlayers(goalies)

  const goalieSlots = goalies.length === 0 ? [null] : goalies
  const goalieGridTemplate = `var(--rail-w) repeat(${String(goalieSlots.length)}, var(--card-w))`

  return (
    <section className="dc-module">
      <header className="dc-head">
        <div className="title">
          <h2>
            <span className="accent">▌</span>Depth Chart
          </h2>
          {scopeLabel ? <span className="scope">{scopeLabel}</span> : null}
        </div>
        <div className="legend">
          <span className="pip">
            <i />
            Primary slot
          </span>
          <span className="pip dup">
            <i />
            Depth · reused
          </span>
        </div>
        <div className="meta">
          <span>
            <b>{String(skaterCount)}</b> Skaters
          </span>
          <span className="dot">·</span>
          <span>
            <b>{String(goalieCount)}</b> Goalies
          </span>
          <span className="dot">·</span>
          <span>
            Sheet <b>{sheetCode}</b>
          </span>
        </div>
      </header>

      <div className="dc-ticker" />

      {/* ─── Forwards + Defense ──────────────────────────────────────────── */}
      <div className="dc-section-bar">
        <h3>
          <span className="accent">▌</span>Forwards <span className="count">12 SLOTS</span>
        </h3>
        <div className="rule" />
        <h3>
          <span className="accent">▌</span>Defense <span className="count">6 SLOTS</span>
        </h3>
        <div className="rule" />
        <span className="units">Placement · GP at position</span>
      </div>

      <div className="dc-skaters-scroll">
        <div className="dc-skaters">
          {/* Header row */}
          <span />
          <span className="col-head">LW</span>
          <span className="col-head">C</span>
          <span className="col-head">RW</span>
          <span />
          <span />
          <span className="col-head">LD</span>
          <span className="col-head">RD</span>

          {/* 4 skater rows: rail + 3 forwards + gap + rail/empty + 2 defense */}
          {Array.from({ length: 4 }).map((_, i) => {
            const fwd = forwards[i] ?? { lw: null, c: null, rw: null }
            const pair = defense[i] ?? null
            return (
              <RowGroup
                key={i}
                rowIndex={i}
                lineLabel={FORWARD_LINE_LABELS[i] ?? 'Line'}
                pairLabel={pair ? (DEFENSE_PAIR_LABELS[i] ?? 'Pair') : null}
                fwd={fwd}
                def={pair}
              />
            )
          })}
        </div>
      </div>

      {/* ─── Goalies ─────────────────────────────────────────────────────── */}
      <div className="dc-section-bar">
        <h3>
          <span className="accent">▌</span>Goalies{' '}
          <span className="count">{`${String(goalieSlots.length)} SLOTS`}</span>
        </h3>
        <div className="rule" />
        <span className="units">Order · GP at goalie</span>
      </div>

      <div className="dc-goalies-scroll">
        <div className="dc-goalies" style={{ gridTemplateColumns: goalieGridTemplate }}>
          <span />
          {GOALIE_SLOT_LABELS.slice(0, goalieSlots.length).map((label) => (
            <span key={label} className="col-head">
              {label}
            </span>
          ))}

          <RowRail label="Goalies" num="G" />
          {goalieSlots.map((slot, i) => (
            <SlotCell key={i} slot={slot} positionLabel="G" />
          ))}
        </div>
      </div>

      <footer className="dc-foot">
        <span>
          Source <b>EA NHL · Boogeymen</b>
        </span>
        <span className="center">— Depth Chart · Season Totals —</span>
        <span>
          Sheet <b>{sheetCode}</b>
        </span>
      </footer>
    </section>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function RowGroup({
  rowIndex,
  lineLabel,
  pairLabel,
  fwd,
  def,
}: {
  rowIndex: number
  lineLabel: string
  pairLabel: string | null
  fwd: { lw: DepthSlot | null; c: DepthSlot | null; rw: DepthSlot | null }
  def: { ld: DepthSlot | null; rd: DepthSlot | null } | null
}) {
  const lineNum = String(rowIndex + 1)
  return (
    <>
      <RowRail label={lineLabel} num={lineNum} />
      <SlotCell slot={fwd.lw} positionLabel="LW" />
      <SlotCell slot={fwd.c} positionLabel="C" />
      <SlotCell slot={fwd.rw} positionLabel="RW" />
      <span />
      {def !== null && pairLabel !== null ? (
        <>
          <RowRail label={pairLabel} num={lineNum} />
          <SlotCell slot={def.ld} positionLabel="LD" />
          <SlotCell slot={def.rd} positionLabel="RD" />
        </>
      ) : (
        <>
          <span />
          <span />
          <span />
        </>
      )}
    </>
  )
}

function RowRail({ label, num }: { label: string; num: string }) {
  return (
    <div className="dc-row-rail">
      <span className="lbl">{label}</span>
      <span className="num">{num}</span>
    </div>
  )
}

function SlotCell({
  slot,
  positionLabel,
}: {
  slot: DepthSlot | null
  positionLabel: string
}) {
  if (slot === null) return <OpenSlot positionLabel={positionLabel} />
  return <PlayerCard player={slot.player} depth={slot.isDepth} />
}

function OpenSlot({ positionLabel }: { positionLabel: string }) {
  return (
    <div className="dc-empty" aria-label={`Open slot — ${positionLabel}`}>
      <svg viewBox="0 0 100 110" fill="currentColor" aria-hidden>
        <circle cx="50" cy="32" r="21" />
        <path d="M 8 110 Q 8 66 50 66 Q 92 66 92 110 Z" />
      </svg>
      <span>Open Slot</span>
    </div>
  )
}

function countDistinctPlayers(slots: (DepthSlot | null)[]): number {
  const seen = new Set<number>()
  for (const s of slots) {
    if (s !== null) seen.add(s.player.playerId)
  }
  return seen.size
}
