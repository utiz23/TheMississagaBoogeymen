import Link from 'next/link'
import Image from 'next/image'
import type { getEARoster } from '@eanhl/db/queries'
import { StatBox, StatBoxFeatured, PlayerSilhouette } from '@/components/home/player-card'
import { formatPosition, formatSavePct } from '@/lib/format'
import { PositionPill } from '@/components/matches/position-pill'
import { NationalityFlag, PlatformIcon } from '@/components/player-meta-icons'

type RosterRow = Awaited<ReturnType<typeof getEARoster>>[number]

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DepthChartProps {
  forwards: { lw: RosterRow | null; c: RosterRow | null; rw: RosterRow | null }[]
  defense: { ld: RosterRow | null; rd: RosterRow | null }[]
  goalies: (RosterRow | null)[]
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function DepthChart({ forwards, defense, goalies }: DepthChartProps) {
  return (
    <div className="space-y-10">
      {/* Forwards + Defense side by side on desktop */}
      <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-8">
        <ForwardsBlock forwards={forwards} />
        <DefenseBlock defense={defense} />
      </div>
      <GoalieBlock goalies={goalies} />
    </div>
  )
}

// ─── Forwards ─────────────────────────────────────────────────────────────────

const FORWARD_LINE_LABELS = ['Line 1', 'Line 2', 'Line 3', 'Line 4']

function ForwardsBlock({ forwards }: { forwards: DepthChartProps['forwards'] }) {
  return (
    <section>
      <h2 className="mb-3 font-condensed text-xs font-bold uppercase tracking-widest text-zinc-600">
        Forwards
      </h2>

      <div className="overflow-x-auto">
        {/* Column headers — plain text, no box */}
        <div className="mb-2 grid grid-cols-[4rem_11rem_11rem_11rem] gap-2">
          <div />
          {(['LW', 'C', 'RW'] as const).map((label) => (
            <div
              key={label}
              className="text-center font-condensed text-xs font-bold uppercase tracking-widest text-zinc-500"
            >
              {label}
            </div>
          ))}
        </div>

        {/* Lines — spacing only, no dividers */}
        <div className="space-y-3">
          {forwards.map((line, i) => (
            <div key={i} className="grid grid-cols-[4rem_11rem_11rem_11rem] items-start gap-2">
              <div className="flex items-center justify-end pr-2 pt-4">
                <span className="font-condensed text-xs font-bold uppercase tracking-widest text-zinc-600">
                  {FORWARD_LINE_LABELS[i]}
                </span>
              </div>
              <SlotCell player={line.lw} positionLabel="LW" />
              <SlotCell player={line.c} positionLabel="C" />
              <SlotCell player={line.rw} positionLabel="RW" />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Defense ──────────────────────────────────────────────────────────────────

const DEFENSE_PAIR_LABELS = ['Pair 1', 'Pair 2', 'Pair 3']

function DefenseBlock({ defense }: { defense: DepthChartProps['defense'] }) {
  return (
    <section>
      <h2 className="mb-3 font-condensed text-xs font-bold uppercase tracking-widest text-zinc-600">
        Defense
      </h2>

      <div className="overflow-x-auto">
        {/* Column headers */}
        <div className="mb-2 grid grid-cols-[4rem_11rem_11rem] gap-2">
          <div />
          {(['LD', 'RD'] as const).map((label) => (
            <div
              key={label}
              className="text-center font-condensed text-xs font-bold uppercase tracking-widest text-zinc-500"
            >
              {label}
            </div>
          ))}
        </div>

        {/* Pairs */}
        <div className="space-y-3">
          {defense.map((pair, i) => (
            <div key={i} className="grid grid-cols-[4rem_11rem_11rem] items-start gap-2">
              <div className="flex items-center justify-end pr-2 pt-4">
                <span className="font-condensed text-xs font-bold uppercase tracking-widest text-zinc-600">
                  {DEFENSE_PAIR_LABELS[i]}
                </span>
              </div>
              <SlotCell player={pair.ld} positionLabel="LD" />
              <SlotCell player={pair.rd} positionLabel="RD" />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Goalies ──────────────────────────────────────────────────────────────────

const GOALIE_SLOT_LABELS = ['Starter', 'Backup', '3rd String', '4th String', '5th String']

function GoalieBlock({ goalies }: { goalies: DepthChartProps['goalies'] }) {
  // Only render actual goalies — no empty placeholders beyond the first slot.
  const slots = goalies.length === 0 ? [null] : goalies
  const count = slots.length
  const gridTemplate = `repeat(${count.toString()}, 11rem)`

  return (
    <section>
      <h2 className="mb-3 font-condensed text-xs font-bold uppercase tracking-widest text-zinc-600">
        Goalies
      </h2>

      <div className="overflow-x-auto">
        {/* Slot labels — only as many as there are real slots */}
        <div className="mb-2 gap-2" style={{ display: 'grid', gridTemplateColumns: gridTemplate }}>
          {GOALIE_SLOT_LABELS.slice(0, count).map((label) => (
            <div
              key={label}
              className="text-center font-condensed text-xs font-bold uppercase tracking-widest text-zinc-500"
            >
              {label}
            </div>
          ))}
        </div>

        {/* Slots */}
        <div className="gap-2" style={{ display: 'grid', gridTemplateColumns: gridTemplate }}>
          {slots.map((player, i) => (
            <SlotCell key={i} player={player} positionLabel="G" />
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Slot cell ────────────────────────────────────────────────────────────────

function SlotCell({ player, positionLabel }: { player: RosterRow | null; positionLabel: string }) {
  if (player === null) return <OpenSlot positionLabel={positionLabel} />
  return <RosterPlayerCard player={player} positionLabel={positionLabel} />
}

// ─── RosterPlayerCard ─────────────────────────────────────────────────────────
//
// Mirrors the PlayerCard design language from the home carousel.
// Scaled to w-44 (11rem grid columns). Zone A shows team W-L-OTL for all
// players (team record when that player appeared). Stats panel is role-aware:
// goalie slots show GP/W/SV%/GAA; skater slots show GP/G/A/PTS.

function RosterPlayerCard({ player, positionLabel }: { player: RosterRow; positionLabel: string }) {
  const effectivePosition = player.preferredPosition ?? player.favoritePosition ?? player.position
  const posLabel = effectivePosition ? formatPosition(effectivePosition) : null
  const isGoalie = positionLabel === 'G'

  const eaW = isGoalie ? player.goalieWins : player.skaterWins
  const eaL = isGoalie ? player.goalieLosses : player.skaterLosses
  const eaOtl = isGoalie ? player.goalieOtl : player.skaterOtl

  const recordLine =
    eaW !== null && eaL !== null
      ? `${eaW.toString()}–${eaL.toString()}–${eaOtl !== null ? eaOtl.toString() : '—'}`
      : '—–—–—'

  const eaGames = (eaW ?? 0) + (eaL ?? 0) + (eaOtl ?? 0)
  const winPct: string =
    eaW !== null && eaL !== null && eaGames > 0
      ? `${((eaW / eaGames) * 100).toFixed(0)}%`
      : '—'

  return (
    <Link
      href={`/roster/${player.playerId.toString()}`}
      className="broadcast-panel-soft group relative block w-44 overflow-hidden rounded-2xl transition-all duration-300 hover:-translate-y-1 hover:border-zinc-600 hover:shadow-[0_0_32px_rgba(225,29,72,0.22)]"
      aria-label={`${player.gamertag} — ${positionLabel}`}
    >
      {/* Accent top bar */}
      <div className="absolute inset-x-0 top-0 z-30 h-1 bg-zinc-800 transition-colors group-hover:bg-accent" />

      {/* Zone A — flush top-left */}
      <div className="absolute left-0 top-0 z-20 flex w-[60px] flex-col rounded-br-2xl bg-zinc-950 px-2 pb-3 pt-4">
        <div className="font-condensed text-[25px] font-black leading-none text-zinc-600">
          {player.jerseyNumber !== null ? `#${player.jerseyNumber.toString()}` : '##'}
        </div>
        {posLabel !== null ? (
          <div className="mt-1">
            <PositionPill label={posLabel} position={effectivePosition} isGoalie={isGoalie} />
          </div>
        ) : (
          <span className="mt-1 inline-block h-2.5 w-7 rounded bg-zinc-800" />
        )}
        <div className="mt-1.5 font-condensed text-[10px] font-semibold leading-none text-zinc-500">
          {recordLine}
        </div>
        <div className="mt-1.5 font-condensed text-[11px] font-bold leading-none text-zinc-300">
          {winPct}
        </div>
      </div>

      {/* Top panel — portrait + identity row */}
      <div className="relative mx-2 mt-2 overflow-hidden rounded-2xl bg-zinc-900">
        <div className="relative flex h-[127px] items-end justify-center">
          <PlayerSilhouette className="text-zinc-800" sizeClass="h-[86px] w-[86px]" />
        </div>
        <div className="flex items-center justify-center gap-2 border-t border-zinc-800/60 px-3 py-2">
          <div
            title={player.gamertag}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-zinc-700 bg-zinc-800/80 text-zinc-500"
          >
            <PlatformIcon platform={player.clientPlatform ?? null} />
          </div>
          <span className="truncate font-condensed text-sm font-black uppercase tracking-wide text-zinc-100 group-hover:text-zinc-50">
            {player.playerName?.split(' ').at(-1) ?? player.gamertag}
          </span>
        </div>
      </div>

      {/* Stats panel */}
      <div className="mx-2 mb-2 mt-1.5 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-2">
        <div className="grid grid-cols-4 gap-1">
          {positionLabel === 'G' ? (
            <>
              <StatBox label="GP" value={player.goalieGp.toString()} />
              <StatBox label="W" value={player.goalieWins?.toString() ?? '—'} />
              <StatBox label="SV%" value={formatSavePct(player.savePct)} />
              <StatBoxFeatured label="GAA" value={player.gaa ?? '—'} />
            </>
          ) : (
            <>
              <StatBox label="GP" value={player.skaterGp.toString()} />
              <StatBox label="G" value={player.goals.toString()} />
              <StatBox label="A" value={player.assists.toString()} />
              <StatBoxFeatured label="PTS" value={player.points.toString()} />
            </>
          )}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <div className="flex h-[34px] items-center justify-center">
            <NationalityFlag code={player.nationality ?? null} />
          </div>
          <div className="flex h-[34px] items-center justify-center overflow-hidden rounded-lg border border-zinc-700/60 bg-zinc-800/40">
            <Image
              src="/images/bgm-logo.png"
              alt="BGM"
              width={20}
              height={20}
              className="h-6 w-6 object-contain opacity-60"
            />
          </div>
          <div />
        </div>
      </div>
    </Link>
  )
}

// ─── Open slot placeholder ────────────────────────────────────────────────────

function OpenSlot({ positionLabel }: { positionLabel: string }) {
  return (
    <div
      className="flex min-h-[290px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-zinc-800"
      aria-label={`Open slot — ${positionLabel}`}
    >
      <PlayerSilhouette className="text-zinc-900" sizeClass="h-[70px] w-[70px]" />
      <span className="font-condensed text-xs font-bold uppercase tracking-widest text-zinc-700">
        Open Slot
      </span>
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────


