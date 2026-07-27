import type { LineupRow } from '@eanhl/db/queries'
import { buildStatCategories, buildStatSummary, type HeadToHeadStatLine } from '@/lib/head-to-head'
import { CompareTable, DrawerKicker, DrawerShell, FullPlayerPageLink } from './drawer-shell'

// STATS drawer — EA-backed, so it works for every match (the LOADOUTS mode
// falls back here when no loadout snapshot exists). Summary strip = the
// tapped player's derived rates (no GS tile — the row already shows it and
// the prototype review flagged the duplicate). Category tables are
// two-valued BGM|OPP so the drill-down stays a head-to-head.

interface DrawerStatsProps {
  posLabel: string
  bgmRow: LineupRow | null
  oppRow: LineupRow | null
  bgmStat: HeadToHeadStatLine | null
  oppStat: HeadToHeadStatLine | null
  /** Which side the tapped row belongs to — picks the summary strip's player. */
  tappedSide: 'bgm' | 'opp'
  /** True when rendered as the LOADOUTS-mode fallback — shows the provenance note. */
  loadoutFallback: boolean
  oppAbbrev: string
}

export function DrawerStats({
  posLabel,
  bgmRow,
  oppRow,
  bgmStat,
  oppStat,
  tappedSide,
  loadoutFallback,
  oppAbbrev,
}: DrawerStatsProps) {
  const tappedStat = tappedSide === 'bgm' ? bgmStat : oppStat
  const summary = buildStatSummary(tappedStat)
  const categories = buildStatCategories(bgmStat, oppStat)
  return (
    <DrawerShell>
      <DrawerKicker
        posLabel={posLabel}
        bgmRow={bgmRow}
        oppRow={oppRow}
        trailing={
          tappedStat?.playerDnf ? (
            <span className="border border-loss px-1.5 py-0.5 font-condensed text-[9px] font-bold uppercase tracking-[0.12em] text-loss">
              Left early · DNF
            </span>
          ) : null
        }
      />

      {loadoutFallback ? (
        <p className="font-condensed text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
          No loadout captured · showing match stats
        </p>
      ) : null}
      {tappedStat === null ? (
        <p className="font-condensed text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
          No match stats recorded for this player
        </p>
      ) : null}

      {/* Tapped player's derived-rate strip */}
      <div className="flex flex-wrap gap-2">
        {summary.map((tile) => (
          <div
            key={tile.label}
            className="flex min-w-[88px] flex-1 flex-col items-start gap-1 border border-border bg-surface px-3 py-2"
          >
            <span className="font-condensed text-[9.5px] font-bold uppercase tracking-[0.14em] text-fg-4">
              {tile.label}
            </span>
            <span
              className={`font-condensed text-[20px] font-black leading-none tabular-nums ${
                tile.muted ? 'text-fg-6' : 'text-fg-1'
              }`}
            >
              {tile.value}
            </span>
          </div>
        ))}
      </div>

      {/* Grouped category tables, two-valued */}
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {categories.map((cat) => (
          <CompareTable key={cat.title} title={cat.title} oppAbbrev={oppAbbrev}>
            {cat.rows.map((r) => (
              <div key={r.label} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-2">
                <span className="truncate font-condensed text-[10.5px] font-semibold uppercase tracking-[0.03em] text-fg-3">
                  {r.label}
                </span>
                <span
                  className={`min-w-[30px] text-right font-condensed text-[12px] font-extrabold tabular-nums ${
                    r.bgm === '—' ? 'text-fg-6' : 'text-fg-1'
                  }`}
                >
                  {r.bgm}
                </span>
                <span
                  className={`min-w-[30px] text-right font-condensed text-[12px] font-extrabold tabular-nums ${
                    r.opp === '—' ? 'text-fg-6' : 'text-fg-1'
                  }`}
                >
                  {r.opp}
                </span>
              </div>
            ))}
          </CompareTable>
        ))}
      </div>

      <FullPlayerPageLink bgmRow={bgmRow} />
    </DrawerShell>
  )
}
