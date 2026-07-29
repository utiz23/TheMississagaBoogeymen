import type { BoxScoreGroup, BoxScoreRow } from '@/lib/match-recap'
import { abbreviateTeamName } from '@/lib/format'

// Rail module — team head-to-head. Restyled to the prototype: one bordered
// section, a flat row rhythm inside grouped dividers, and a center-divider
// share bar per row (BGM grows leftward from the divider, opponent rightward,
// divider position = share of the pair's total). Winner takes the saturated
// tone on its side; the loser's bar stays present but faded, so the row is
// readable as a duel rather than two independent bars.
//
// No FULL HEAD-TO-HEAD link: the prototype links one, but this app has no
// per-opponent route to land on (`/games`, `/roster`, `/stats` only). The plan
// says link only if a destination exists — so it is omitted, not stubbed.

interface TeamStatsProps {
  rows: BoxScoreGroup[]
  opponentName: string
}

export function TeamStats({ rows, opponentName }: TeamStatsProps) {
  if (rows.length === 0) return null

  const oppAbbrev = abbreviateTeamName(opponentName)

  return (
    <section>
      <div className="border border-border bg-surface">
        <div className="flex flex-col gap-2 px-3.5 pb-2.5 pt-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-condensed text-[11px] font-extrabold uppercase tracking-[0.18em] text-fg-4">
              <span aria-hidden className="pr-1 text-accent">
                ▰
              </span>
              Team Stats
            </h2>
            <p className="font-condensed text-[10px] uppercase tracking-[0.12em] text-fg-5">
              Head to head · bar = share of total
            </p>
          </div>
          {/* Side labels — the bars are colour-coded, but colour alone must
              not carry the BGM/opponent split. */}
          <div className="flex items-baseline justify-between border-t border-border-subtle pt-2 font-condensed text-[10px] font-extrabold uppercase tracking-[0.16em]">
            <span className="text-accent">BGM</span>
            <span className="[color:var(--opp)]">{oppAbbrev}</span>
          </div>
        </div>

        <div className="flex flex-col gap-3.5 px-3.5 pb-3.5">
          {rows.map((group) => (
            <Group key={group.title} group={group} />
          ))}
        </div>
      </div>
    </section>
  )
}

function Group({ group }: { group: BoxScoreGroup }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <div className="h-px flex-1 bg-border-subtle" />
        <h3 className="font-condensed text-[10px] font-bold uppercase tracking-[0.18em] text-fg-4">
          {group.title}
        </h3>
        <div className="h-px flex-1 bg-border-subtle" />
      </div>
      <div className="flex flex-col gap-2.5">
        {group.rows.map((row) => (
          <Row key={row.label} row={row} />
        ))}
      </div>
      {group.footnote ? (
        <p className="text-[10px] leading-snug text-fg-5">{group.footnote}</p>
      ) : null}
    </div>
  )
}

function Row({ row }: { row: BoxScoreRow }) {
  const { winner, bgmPct, oppPct, comparable } = rowGeometry(row)
  const unit = timeUnit(row)

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        <span
          className={`min-w-[38px] font-condensed text-[13px] font-extrabold tabular-nums ${
            winner === 'bgm' ? 'text-accent' : 'text-fg-4'
          }`}
        >
          {row.us}
        </span>
        <span className="text-center font-condensed text-[10px] font-semibold uppercase leading-tight tracking-[0.08em] text-fg-4">
          {row.label}
          {unit !== null ? (
            <span
              className="ml-1 align-middle font-condensed text-[9px] font-bold tracking-[0.12em] text-fg-6"
              title="Minutes and seconds"
            >
              {unit}
            </span>
          ) : null}
          {row.polarity === 'lower-better' ? (
            <span
              className="ml-1 align-middle font-condensed text-[9px] font-bold tracking-[0.12em] text-fg-6"
              title="Lower is better"
            >
              ↓ BETTER
            </span>
          ) : null}
        </span>
        <span
          className={`min-w-[38px] text-right font-condensed text-[13px] font-extrabold tabular-nums ${
            winner === 'opp' ? '[color:var(--opp)]' : 'text-fg-4'
          }`}
        >
          {row.them ?? '—'}
        </span>
      </div>

      {comparable ? (
        <div aria-hidden className="flex h-[5px] overflow-hidden bg-background">
          {/* The two shares sum to 100%, so each gives up 1px to the divider —
              otherwise the track overflows by 2px and clips the opponent tail. */}
          <span
            className="flex flex-none justify-end overflow-hidden"
            style={{ width: `calc(${bgmPct.toFixed(1)}% - 1px)` }}
          >
            <span
              className="h-full w-full"
              style={{
                background: winner === 'bgm' ? 'var(--color-accent)' : 'rgba(232,65,49,0.30)',
              }}
            />
          </span>
          <span className="w-[2px] flex-none bg-surface" />
          <span
            className="flex-none overflow-hidden"
            style={{ width: `calc(${oppPct.toFixed(1)}% - 1px)` }}
          >
            <span
              className="h-full w-full"
              style={{ background: winner === 'opp' ? 'var(--opp)' : 'var(--opp-line)' }}
            />
          </span>
        </div>
      ) : null}
    </div>
  )
}

// ─── Share geometry ───────────────────────────────────────────────────────────

interface RowGeometry {
  winner: 'bgm' | 'opp' | null
  bgmPct: number
  oppPct: number
  /** False when there is nothing honest to compare — no bar is drawn. */
  comparable: boolean
}

const NOT_COMPARABLE: RowGeometry = { winner: null, bgmPct: 0, oppPct: 0, comparable: false }

/**
 * Share of the pair's total, so the two segments always meet at a divider
 * whose position IS the split. Rows with no opponent value (or a 0–0 pair)
 * draw no bar rather than a full-width one that would read as domination.
 */
function rowGeometry(row: BoxScoreRow): RowGeometry {
  if (row.them === null) return NOT_COMPARABLE
  const ours = parseStat(row.us)
  const theirs = parseStat(row.them)
  const total = ours + theirs
  if (total <= 0) return NOT_COMPARABLE
  const lowerBetter = row.polarity === 'lower-better'
  const winner = ours === theirs ? null : ours > theirs !== lowerBetter ? 'bgm' : 'opp'
  return {
    winner,
    bgmPct: (ours / total) * 100,
    oppPct: (theirs / total) * 100,
    comparable: true,
  }
}

/** `M:SS` marker for the clock rows (Possession, Time on Attack). */
function timeUnit(row: BoxScoreRow): string | null {
  const isClock = (v: string | null) => v !== null && /^\d+:\d{2}$/.test(v)
  return isClock(row.us) || isClock(row.them) ? 'M:SS' : null
}

function parseStat(value: string | null): number {
  if (!value) return 0
  if (value.includes('/')) return parseFloat(value.split('/')[0] ?? '0') || 0
  if (value.includes(':')) {
    const [m, s] = value.split(':')
    return parseInt(m ?? '0', 10) * 60 + (parseInt(s ?? '0', 10) || 0)
  }
  const cleaned = value.replace('%', '')
  const parsed = parseFloat(cleaned)
  if (Number.isNaN(parsed)) return 0
  return parsed
}
