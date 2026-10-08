import { Badge } from '@/components/badges/badge'
import { PlayerCard } from './player-card'
import type { CardViewModel } from './card-model'
import type { LockerView } from './locker-model'

/** Progress tab: level, next-tier requirement, tier track and card history. */
export function LockerProgressTab({ card, view }: { card: CardViewModel; view: LockerView }) {
  const req = view.requirement
  return (
    <div className="clk-progress">
      <div className="clk-progress-card">
        <PlayerCard card={{ ...card, back: null }} context="hero" />
      </div>
      <div className="clk-stack">
        <section className="clk-block" aria-label="Level">
          <div className="clk-spread">
            <span className="clk-label">LEVEL · {view.tierLabel}</span>
            <span className="clk-level">
              {view.level}
              <small> / 10</small>
            </span>
          </div>
          <div className="clk-pips" aria-hidden>
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} className="clk-pip" data-on={i < view.level} />
            ))}
          </div>
          <p className="clk-note">{view.levelNote}</p>
        </section>

        <section className="clk-block" aria-label="Next tier">
          <div className="clk-spread">
            <span className="clk-label">{req.title}</span>
            <span className="clk-count">{req.count}</span>
          </div>
          {req.pct !== null && (
            <span className="clk-bar">
              <span style={{ width: `${String(req.pct)}%` }} />
            </span>
          )}
          <p className="clk-note">{req.note}</p>
          {view.rows.map((r) => (
            <div key={r.familyId} className="clk-row" data-done={r.done} data-locked={r.locked}>
              <span className="clk-row-badge">
                <Badge
                  familyId={r.familyId}
                  shape={r.shape}
                  theme={r.theme}
                  frame="single"
                  size={28}
                />
              </span>
              <span className="clk-row-name">{r.short}</span>
              <span className="clk-bar">
                <span style={{ width: `${String(r.pct)}%` }} />
              </span>
              <span className="clk-row-val">{r.value}</span>
            </div>
          ))}
        </section>

        <section className="clk-block" aria-label="Tier track">
          <span className="clk-label">TIER TRACK</span>
          <div className="clk-track">
            {view.track.map((s) => (
              <div key={s.tier} className="clk-step" data-state={s.state}>
                <span className="clk-step-n">T{s.tier}</span>
                <span className="clk-step-label">{s.label}</span>
                <span className="clk-step-theme">{s.theme}</span>
                {s.note !== null && <span className="clk-step-theme">{s.note}</span>}
              </div>
            ))}
          </div>
        </section>

        <section className="clk-block" aria-label="History">
          <span className="clk-label">HISTORY</span>
          {view.history.length === 0 ? (
            <p className="clk-note">{view.historyEmpty}</p>
          ) : (
            <ol className="clk-hist-list">
              {view.history.map((h, i) => (
                <li key={`${h.date}-${String(i)}`} className="clk-hist">
                  <span className="clk-hist-date">{h.date}</span>
                  <span className="clk-hist-text">{h.text}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}
