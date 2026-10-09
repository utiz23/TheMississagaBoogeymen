import type { getEARoster } from '@eanhl/db/queries'
import { PlayerCard } from '@/components/cards/player-card'
import { PlayerCardCompact } from '@/components/cards/player-card-compact'
import { cardFromRosterRow, type CardSummaryInput } from '@/components/cards/card-adapters'
import './depth-chart.css'

type RosterRow = Awaited<ReturnType<typeof getEARoster>>[number]

/**
 * One depth-chart slot. A player has a card at every position they play
 * (lib/depth-chart-build.ts); `isDepth` marks every card except their main
 * position (most games).
 */
export interface DepthSlot {
  player: RosterRow
  isDepth: boolean
  /** Card tier/theme/featured badge; absent = tier 1 (not computed yet). */
  card?: CardSummaryInput | undefined
}

export interface DepthChartProps {
  forwards: { lw: DepthSlot | null; c: DepthSlot | null; rw: DepthSlot | null }[]
  defense: { ld: DepthSlot | null; rd: DepthSlot | null }[]
  goalies: (DepthSlot | null)[]
  /** Header scope line (e.g. "Boogeymen · NHL 26 · Season Totals · 22-skater pool"). */
  scopeLabel?: string | undefined
}

const GOALIE_SLOT_LABELS = ['Starter', 'Backup', '3rd String']
const goalieSlotLabel = (i: number) => GOALIE_SLOT_LABELS[i] ?? `${String(i + 1)}th String`

export function DepthChart({ forwards, defense, goalies, scopeLabel }: DepthChartProps) {
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
            Main<span className="long"> position</span>
          </span>
          <span className="pip dup">
            <i />
            Depth<span className="long"> · also plays</span>
          </span>
        </div>
        <div className="meta">
          <span>
            <b>{String(skaterCount)}</b> <span className="long">Skaters</span>
            <span className="short">SK</span>
          </span>
          <span className="dot">·</span>
          <span>
            <b>{String(goalieCount)}</b> <span className="long">Goalies</span>
            <span className="short">G</span>
          </span>
        </div>
      </header>

      <div className="dc-ticker" />

      {/* ─── Forwards + Defense ──────────────────────────────────────────── */}
      <div className="dc-section-bar skaters">
        <h3>
          <span className="accent">▌</span>Forwards{' '}
          <span className="count">
            {String(forwards.length * 3)}
            <span className="long"> SLOTS</span>
          </span>
        </h3>
        <div className="rule" />
        <h3>
          <span className="accent">▌</span>Defense{' '}
          <span className="count">
            {String(defense.length * 2)}
            <span className="long"> SLOTS</span>
          </span>
        </h3>
        <div className="rule" />
        <span className="units">Placement · GP at position</span>
      </div>

      <div className="dc-skaters-scroll">
        <div className="dc-skaters">
          {/* Header row (dc-* classes: responsive hooks, see depth-chart.css) */}
          <span className="dc-corner" />
          <span className="col-head">LW</span>
          <span className="col-head">C</span>
          <span className="col-head">RW</span>
          <span className="dc-gap" />
          <span />
          <span className="col-head">LD</span>
          <span className="col-head">RD</span>

          {/* Skater rows: rail + 3 forwards + gap + rail/empty + 2 defense */}
          {Array.from({ length: Math.max(forwards.length, defense.length) }).map((_, i) => {
            const fwd = forwards[i] ?? { lw: null, c: null, rw: null }
            const pair = defense[i] ?? null
            return (
              <RowGroup
                key={i}
                rowIndex={i}
                lineLabel="Line"
                pairLabel={pair ? 'Pair' : null}
                fwd={fwd}
                def={pair}
              />
            )
          })}
        </div>
      </div>

      {/* ─── Goalies ─────────────────────────────────────────────────────── */}
      <div className="dc-section-bar goalies">
        <h3>
          <span className="accent">▌</span>Goalies{' '}
          <span className="count">
            {String(goalieSlots.length)}
            <span className="long"> SLOTS</span>
          </span>
        </h3>
        <div className="rule" />
        <span className="units">
          Order · GP<span className="long"> at goalie</span>
        </span>
      </div>

      <div className="dc-goalies-scroll">
        <div className="dc-goalies" style={{ gridTemplateColumns: goalieGridTemplate }}>
          <span />
          {goalieSlots.map((_, i) => (
            <span key={i} className="col-head">
              {goalieSlotLabel(i)}
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
        <span aria-hidden />
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
      <span className="dc-gap" />
      {def !== null && pairLabel !== null ? (
        <>
          <RowRail label={pairLabel} num={lineNum} className="dc-pair-rail" />
          <SlotCell slot={def.ld} positionLabel="LD" />
          <SlotCell slot={def.rd} positionLabel="RD" />
        </>
      ) : (
        <>
          <span className="dc-pair-rail" />
          <span />
          <span />
        </>
      )}
    </>
  )
}

function RowRail({ label, num, className }: { label: string; num: string; className?: string }) {
  return (
    <div className={className === undefined ? 'dc-row-rail' : `dc-row-rail ${className}`}>
      <span className="lbl">{label}</span>
      <span className="num">{num}</span>
    </div>
  )
}

function SlotCell({ slot, positionLabel }: { slot: DepthSlot | null; positionLabel: string }) {
  if (slot === null) return <OpenSlot positionLabel={positionLabel} />
  const card = cardFromRosterRow(slot.player, slot.card, positionLabel)
  const href = `/roster/${String(slot.player.playerId)}`
  // Full card on desktop; the compact sizes take over per tier (depth-chart.css
  // shows exactly one of the four — no JS, so the server renders them all).
  return (
    <div className="dc-card">
      <div className="dc-full">
        <PlayerCard card={card} context="list" href={href} />
      </div>
      <div className="dc-compact dc-compact-m">
        <PlayerCardCompact card={card.front} size="medium" href={href} />
      </div>
      <div className="dc-compact dc-compact-s">
        <PlayerCardCompact card={card.front} size="small" href={href} />
      </div>
      <div className="dc-compact dc-compact-xs">
        <PlayerCardCompact card={card.front} size="micro" href={href} />
      </div>
      {slot.isDepth ? <span className="dc-depth-pill">DEPTH</span> : null}
    </div>
  )
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
