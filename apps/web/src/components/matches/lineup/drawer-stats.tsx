import type { LineupRow } from '@eanhl/db/queries'
import { buildStatSummary, buildStatTables, type HeadToHeadStatLine } from '@/lib/head-to-head'
import { DrawerShell, DrawerTable, FullPlayerPageLink } from './drawer-shell'

// STATS drawer — EA-backed, so it works for every match (LOADOUTS mode falls
// back here when no loadout snapshot exists). One player: their derived-rate
// summary strip, then the grouped category tables. No GS tile — the row above
// already shows it and the prototype review flagged the duplicate.

interface DrawerStatsProps {
  row: LineupRow | null
  stat: HeadToHeadStatLine | null
  side: 'bgm' | 'opp'
  /** True when rendered as the LOADOUTS-mode fallback — shows the provenance note. */
  loadoutFallback: boolean
}

export function DrawerStats({ row, stat, side, loadoutFallback }: DrawerStatsProps) {
  const summary = buildStatSummary(stat)
  const categories = buildStatTables(stat)
  return (
    <DrawerShell>
      {stat?.playerDnf ? (
        <span className="self-start border border-loss px-[7px] py-0.5 font-condensed text-[12px] font-bold uppercase leading-none tracking-[0.12em] text-loss">
          Left early · DNF
        </span>
      ) : null}

      {loadoutFallback ? (
        <p className="font-condensed text-[12px] font-semibold uppercase tracking-[0.12em] text-fg-4">
          No loadout captured · showing match stats
        </p>
      ) : null}
      {stat === null ? (
        <p className="font-condensed text-[12px] font-semibold uppercase tracking-[0.12em] text-fg-4">
          No match stats recorded for this player
        </p>
      ) : null}

      {/* Derived-rate strip */}
      <div className="flex flex-wrap gap-2">
        {summary.map((tile) => (
          <div
            key={tile.label}
            className="flex min-w-[96px] flex-1 flex-col items-start gap-1 border border-border bg-surface px-[13px] py-[9px]"
          >
            <span className="font-condensed text-[12px] font-bold uppercase leading-none tracking-[0.14em] text-fg-4">
              {tile.label}
            </span>
            <span
              className={`font-condensed text-[22px] font-black leading-none tabular-nums ${
                tile.muted ? 'text-fg-4' : 'text-fg-1'
              }`}
            >
              {tile.value}
            </span>
          </div>
        ))}
      </div>

      {/* Grouped category tables */}
      <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(168px,1fr))]">
        {categories.map((cat) => (
          <DrawerTable key={cat.title} title={cat.title}>
            {cat.rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-2">
                <span className="truncate font-condensed text-[12px] font-normal uppercase tracking-normal text-fg-4">
                  {r.label}
                </span>
                <span
                  className={`whitespace-nowrap text-right font-condensed text-[12px] font-extrabold tabular-nums ${
                    r.value === '—' ? 'text-fg-4' : 'text-fg-1'
                  }`}
                >
                  {r.value}
                </span>
              </div>
            ))}
          </DrawerTable>
        ))}
      </div>

      <FullPlayerPageLink bgmRow={side === 'bgm' ? row : null} />
    </DrawerShell>
  )
}
