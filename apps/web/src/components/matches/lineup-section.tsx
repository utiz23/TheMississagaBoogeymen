import Image from 'next/image'
import Link from 'next/link'
import type { LineupRow, MatchLineups } from '@eanhl/db/queries'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'
import { xFactorIconUrl, tierLabel, type XFactorTier } from '@/lib/xfactor-asset'

interface LineupSectionProps {
  lineups: MatchLineups
  opponentLabel: string
}

const ROSTER_SIZE = 6
const ICON_PX = 40

/**
 * "Rich" lineup section — sits below the existing compact LineupCard on
 * the match page. Mirrors the same 2-column 6-on-6 structure but
 * dedicates a row beneath each player to render their X-Factor PNG
 * icons (Elite=Red, All Star=Blue, Specialist=Gold per the EA asset
 * naming convention).
 *
 * Falls back to a text pill when an X-Factor's canonical name didn't
 * resolve at promoter time — keeps the section robust to OCR variants
 * the normalizer doesn't yet cover.
 */
export function LineupSection({ lineups, opponentLabel }: LineupSectionProps) {
  const bgm = lineups.bgm
  const opp = lineups.opponent
  if (bgm.length === 0 && opp.length === 0) return null

  return (
    <section className="space-y-3">
      <SectionHeader
        label="Lineups · Detailed"
        subtitle="X-Factors rendered from EA's in-game iconography"
      />
      <Panel className="px-4 py-4">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <TeamColumn
            label="BGM"
            accentClass="text-[#ce202f]"
            ghostFillTo={ROSTER_SIZE}
            rows={bgm}
            side="home"
          />
          <TeamColumn
            label={opponentLabel}
            accentClass="text-[#7d8db0]"
            ghostFillTo={ROSTER_SIZE}
            rows={opp}
            side="away"
          />
        </div>
      </Panel>
    </section>
  )
}

function TeamColumn({
  label,
  accentClass,
  rows,
  ghostFillTo,
  side,
}: {
  label: string
  accentClass: string
  rows: LineupRow[]
  ghostFillTo: number
  side: 'home' | 'away'
}) {
  const ghostsNeeded = Math.max(0, ghostFillTo - rows.length)
  return (
    <div>
      <h3
        className={`mb-2 font-condensed text-xs font-bold uppercase tracking-widest ${accentClass}`}
      >
        {label}
      </h3>
      <ul className="space-y-2">
        {rows.map((row) => (
          <PlayerRow key={row.snapshotId} row={row} side={side} />
        ))}
        {Array.from({ length: ghostsNeeded }).map((_, i) => (
          <GhostRow key={`ghost-${String(i)}`} />
        ))}
      </ul>
    </div>
  )
}

function PlayerRow({ row, side }: { row: LineupRow; side: 'home' | 'away' }) {
  const accentClass = side === 'home' ? 'text-[#ce202f]' : 'text-[#7d8db0]'
  const gamertag = row.player?.gamertag ?? row.gamertagSnapshot ?? '?'

  const nameNode = row.player ? (
    <Link
      href={`/roster/${String(row.player.id)}`}
      className="font-semibold text-zinc-100 hover:text-accent"
    >
      {gamertag}
    </Link>
  ) : (
    <span className="font-semibold text-zinc-200" title="Unresolved gamertag">
      {gamertag}
    </span>
  )

  return (
    <li className="grid grid-cols-[2.5rem_1fr] items-start gap-3 border border-zinc-900 bg-zinc-950 px-3 py-2.5">
      <span
        className={`font-condensed text-[11px] font-bold uppercase tracking-widest ${accentClass}`}
      >
        {row.position ?? '—'}
      </span>
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 truncate text-sm">
          {row.isCaptain ? (
            <span title="Captain" className="text-yellow-400">
              ★
            </span>
          ) : null}
          {nameNode}
          {row.playerNumber !== null ? (
            <span className="font-condensed text-[11px] tabular-nums text-zinc-500">
              #{row.playerNumber}
            </span>
          ) : null}
          {row.playerNamePersona ? (
            <span className="truncate text-xs text-zinc-500" title={row.playerNamePersona}>
              {row.playerNamePersona}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 font-condensed text-[10px] uppercase tracking-wider text-zinc-500">
          <span className="truncate">{row.buildClass ?? 'Unknown build'}</span>
          {row.playerLevelNumber !== null ? (
            <span className="tabular-nums text-zinc-600">L{row.playerLevelNumber}</span>
          ) : null}
        </div>
        {row.xFactors.length > 0 ? <XFactorRow xFactors={row.xFactors} /> : null}
      </div>
    </li>
  )
}

function XFactorRow({
  xFactors,
}: {
  xFactors: LineupRow['xFactors']
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {xFactors.map((xf) => (
        <XFactorIcon
          key={xf.slotIndex}
          name={xf.name}
          canonicalName={xf.canonicalName}
          tier={xf.tier as XFactorTier | null}
        />
      ))}
    </div>
  )
}

/**
 * Render a single X-Factor as a PNG icon when canonical name + tier are
 * available; otherwise fall back to a labeled text pill (same component
 * the compact LineupCard uses).
 */
function XFactorIcon({
  name,
  canonicalName,
  tier,
}: {
  name: string
  canonicalName: string | null
  tier: XFactorTier | null
}) {
  const url = xFactorIconUrl(canonicalName, tier)
  const displayName = canonicalName ? canonicalName.replace(/_/g, ' ') : name
  const title = `${displayName}${tier ? ` — ${tierLabel(tier)}` : ''}`

  if (url) {
    return (
      <Image
        src={url}
        alt={title}
        title={title}
        width={ICON_PX}
        height={ICON_PX}
        className="select-none"
        unoptimized
      />
    )
  }
  // Fallback: text pill, neutral tier color since we couldn't classify.
  return (
    <span
      className="inline-flex items-center border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-condensed text-[9px] font-semibold uppercase tracking-widest text-zinc-400"
      title={title}
    >
      {name}
    </span>
  )
}

function GhostRow() {
  return (
    <li className="grid grid-cols-[2.5rem_1fr] items-center gap-3 border border-dashed border-zinc-900 px-3 py-3">
      <span className="font-condensed text-[11px] font-bold uppercase tracking-widest text-zinc-700">
        —
      </span>
      <div className="font-condensed text-[10px] uppercase tracking-wider text-zinc-700">
        CPU / Empty
      </div>
    </li>
  )
}
