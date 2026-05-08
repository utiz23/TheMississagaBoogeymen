import Link from 'next/link'
import type { PlayerCareerSeasonRow } from '@eanhl/db/queries'
import { Panel } from '@/components/ui/panel'

// ─── Public component ─────────────────────────────────────────────────────────

interface Props {
  seasons: PlayerCareerSeasonRow[]
  selectedRole: 'skater' | 'goalie'
}

/**
 * Unified career-by-season table for the player profile page. Shows one row
 * per game title where the selected role has GP > 0. Each row is tagged with
 * a Source badge so users know whether the numbers come from EA's live API
 * (`source='ea'`) or hand-reviewed historical screenshots (`source='historical'`).
 *
 * Rows arrive pre-sorted newest-title-first from `getPlayerCareerSeasons`
 * (NHL 26 → NHL 22 in the current schema).
 */
export function CareerSeasonsTable({ seasons, selectedRole }: Props) {
  const filtered = seasons.filter((row) =>
    selectedRole === 'skater' ? row.skaterGp > 0 : row.goalieGp > 0,
  )

  if (filtered.length === 0) {
    return (
      <Panel className="flex min-h-[8rem] items-center justify-center">
        <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
          No career data for {selectedRole} role yet.
        </p>
      </Panel>
    )
  }

  return selectedRole === 'skater' ? (
    <SkaterTable rows={filtered} />
  ) : (
    <GoalieTable rows={filtered} />
  )
}

// ─── Skater table ─────────────────────────────────────────────────────────────

function SkaterTable({ rows }: { rows: PlayerCareerSeasonRow[] }) {
  return (
    <Panel className="overflow-x-auto">
      <table className="w-full min-w-[820px]">
        <thead>
          <tr className="border-b border-zinc-800 bg-surface-raised">
            <th className="py-2 pl-4 pr-2 text-left font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Season
            </th>
            <SkaterHeader label="GP" />
            <SkaterHeader label="G" />
            <SkaterHeader label="A" />
            <SkaterHeader label="PTS" />
            <SkaterHeader label="P/GP" />
            <SkaterHeader label="+/-" />
            <SkaterHeader label="SOG" />
            <SkaterHeader label="SHT%" />
            <SkaterHeader label="HITS" />
            <SkaterHeader label="PIM" />
            <SkaterHeader label="TA" />
            <SkaterHeader label="GV" />
            <th className="py-2 pl-2 pr-4 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Source
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <SkaterRow key={row.gameTitleId} row={row} />
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

function SkaterHeader({ label }: { label: string }) {
  return (
    <th className="px-2 py-2 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
      {label}
    </th>
  )
}

function SkaterRow({ row }: { row: PlayerCareerSeasonRow }) {
  // Derive shot-on-net% inline. PlayerCareerSeasonRow does not include a
  // precomputed shotPct field — when shots=0 there can be no goals either,
  // so SHT% is meaningless and rendered as em dash.
  const shtPct = row.shots > 0 ? `${((row.goals / row.shots) * 100).toFixed(2)}%` : '—'
  // P/GP is also derived (no precomputed pointsPerGame on the row).
  const pPerGp = row.skaterGp > 0 ? (row.points / row.skaterGp).toFixed(2) : '—'

  return (
    <tr className="border-b border-zinc-800/60 transition-colors hover:bg-surface-raised">
      <td className="py-2.5 pl-4 pr-2">
        <Link
          href={`/stats?title=${row.gameTitleSlug}`}
          className="font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-200 transition-colors hover:text-accent"
        >
          {row.gameTitleName}
        </Link>
      </td>
      <SkaterCell>{row.skaterGp.toString()}</SkaterCell>
      <SkaterCell>{row.goals.toString()}</SkaterCell>
      <SkaterCell>{row.assists.toString()}</SkaterCell>
      <SkaterCell>{row.points.toString()}</SkaterCell>
      <SkaterCell>{pPerGp}</SkaterCell>
      <PlusMinusCell value={row.plusMinus} />
      <SkaterCell>{row.shots.toString()}</SkaterCell>
      <SkaterCell>{shtPct}</SkaterCell>
      <SkaterCell>{row.hits.toString()}</SkaterCell>
      <SkaterCell>{row.pim.toString()}</SkaterCell>
      <SkaterCell>{row.takeaways.toString()}</SkaterCell>
      <SkaterCell>{row.giveaways.toString()}</SkaterCell>
      <td className="py-2.5 pl-2 pr-4 text-right">
        <SourceBadge source={row.source} />
      </td>
    </tr>
  )
}

function SkaterCell({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-2 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-300">
      {children}
    </td>
  )
}

function PlusMinusCell({ value }: { value: number }) {
  const colorClass = value > 0 ? 'text-emerald-400' : value < 0 ? 'text-rose-400' : 'text-zinc-400'
  const display = value > 0 ? `+${value.toString()}` : value.toString()
  return (
    <td className={`px-2 py-2.5 text-right font-condensed text-sm tabular-nums ${colorClass}`}>
      {display}
    </td>
  )
}

// ─── Goalie table ─────────────────────────────────────────────────────────────

function GoalieTable({ rows }: { rows: PlayerCareerSeasonRow[] }) {
  return (
    <Panel className="overflow-x-auto">
      <table className="w-full min-w-[560px]">
        <thead>
          <tr className="border-b border-zinc-800 bg-surface-raised">
            <th className="py-2 pl-4 pr-2 text-left font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Season
            </th>
            <SkaterHeader label="GP" />
            <SkaterHeader label="W" />
            <SkaterHeader label="L" />
            <SkaterHeader label="OTL" />
            <SkaterHeader label="SV%" />
            <SkaterHeader label="GAA" />
            <SkaterHeader label="SO" />
            <th className="py-2 pl-2 pr-4 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Source
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <GoalieRow key={row.gameTitleId} row={row} />
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

function GoalieRow({ row }: { row: PlayerCareerSeasonRow }) {
  // SV% comes back as a 0-100 numeric string ("74.00"). Render with %% suffix.
  // GAA arrives as a pre-formatted string (e.g. "2.85") OR null. Historical
  // rows often have null GAA because TOI was not captured in the screenshot
  // import — we display "—" in that case so the gap is visible to viewers.
  return (
    <tr className="border-b border-zinc-800/60 transition-colors hover:bg-surface-raised">
      <td className="py-2.5 pl-4 pr-2">
        <Link
          href={`/stats?title=${row.gameTitleSlug}`}
          className="font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-200 transition-colors hover:text-accent"
        >
          {row.gameTitleName}
        </Link>
      </td>
      <SkaterCell>{row.goalieGp.toString()}</SkaterCell>
      <SkaterCell>{row.wins !== null ? row.wins.toString() : '—'}</SkaterCell>
      <SkaterCell>{row.losses !== null ? row.losses.toString() : '—'}</SkaterCell>
      <SkaterCell>{row.otl !== null ? row.otl.toString() : '—'}</SkaterCell>
      <SkaterCell>{row.savePct !== null ? `${row.savePct}%` : '—'}</SkaterCell>
      <SkaterCell>{row.gaa ?? '—'}</SkaterCell>
      <SkaterCell>{row.shutouts !== null ? row.shutouts.toString() : '—'}</SkaterCell>
      <td className="py-2.5 pl-2 pr-4 text-right">
        <SourceBadge source={row.source} />
      </td>
    </tr>
  )
}

// ─── Source badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: 'ea' | 'historical' }) {
  if (source === 'ea') {
    return (
      <span className="inline-flex items-center border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-condensed text-[9px] font-bold uppercase tracking-[0.18em] text-accent">
        EA
      </span>
    )
  }
  return (
    <span className="inline-flex items-center border border-zinc-700 bg-zinc-800/50 px-1.5 py-0.5 font-condensed text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
      Archive
    </span>
  )
}
