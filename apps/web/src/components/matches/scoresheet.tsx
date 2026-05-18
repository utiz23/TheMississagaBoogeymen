'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import type { Scoresheet, ScoresheetSide, SkaterRow, GoalieRow } from '@/lib/match-recap'
import { formatPosition, formatPositionFull } from '@/lib/format'
import { PositionPill } from './position-pill'
import { OpponentCrest } from '@/components/ui/opponent-crest'
import { Panel } from '@/components/ui/panel'
import { SectionHeader } from '@/components/ui/section-header'

interface ScoresheetProps {
  scoresheet: Scoresheet
  opponentCrestAssetId: string | null
  opponentCrestUseBaseAsset: string | null
  opponentName: string
}

export function ScoresheetSection({
  scoresheet,
  opponentCrestAssetId,
  opponentCrestUseBaseAsset,
  opponentName,
}: ScoresheetProps) {
  const { bgm, opponent } = scoresheet
  const bgmEmpty = bgm.skaters.length === 0 && bgm.goalies.length === 0
  const oppEmpty = opponent.skaters.length === 0 && opponent.goalies.length === 0
  if (bgmEmpty && oppEmpty) return null

  return (
    <section className="space-y-3">
      <SectionHeader label="Scoresheet" />

      <div className="space-y-6">
        {!bgmEmpty ? <TeamSide side={bgm} crest={<BgmCrest />} /> : null}
        {!oppEmpty ? (
          <TeamSide
            side={opponent}
            crest={
              <OpponentCrest
                crestAssetId={opponentCrestAssetId}
                useBaseAsset={opponentCrestUseBaseAsset}
                alt={opponentName}
                width={24}
                height={24}
                className="h-6 w-6 object-contain"
              />
            }
          />
        ) : null}
      </div>
    </section>
  )
}

function TeamSide({ side, crest }: { side: ScoresheetSide; crest: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 font-condensed text-xs font-bold uppercase tracking-widest text-zinc-300">
        {crest}
        <span>{side.teamLabel}</span>
        {side.isBgm ? (
          <span className="border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-condensed text-[9px] font-bold uppercase tracking-widest text-accent">
            BGM
          </span>
        ) : null}
      </h3>

      <div className="space-y-3">
        {side.skaters.length > 0 ? <SkaterTable rows={side.skaters} isBgm={side.isBgm} /> : null}
        {side.goalies.length > 0 ? <GoalieTable rows={side.goalies} isBgm={side.isBgm} /> : null}
      </div>
    </div>
  )
}

function BgmCrest() {
  return (
    <Image
      src="/images/bgm-logo.png"
      alt="BGM"
      width={24}
      height={24}
      className="h-6 w-6 object-contain"
    />
  )
}

// ─── Skater table ─────────────────────────────────────────────────────────────

// BGM accent: rgba(195,67,83,0.14) matches the center position color
const BGM_HEADER_STYLE = { backgroundColor: 'rgba(195,67,83,0.14)' }

function SkaterTable({ rows, isBgm = false }: { rows: SkaterRow[]; isBgm?: boolean }) {
  return (
    <Panel className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-zinc-800" style={isBgm ? BGM_HEADER_STYLE : undefined}>
            <Th align="left" wide>
              Player
            </Th>
            <Th>G</Th>
            <Th>A</Th>
            <Th>PTS</Th>
            <Th>+/-</Th>
            <Th>SOG</Th>
            <Th hideOnMobile>Hits</Th>
            <Th hideOnMobile>Blks</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {rows.map((row) => (
            <SkaterRowEl key={row.rowKey} row={row} isBgm={isBgm} />
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

function SkaterRowEl({ row, isBgm }: { row: SkaterRow; isBgm: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const positionLabel = row.position ? formatPosition(row.position) : null
  const positionFull = row.position ? formatPositionFull(row.position) : null
  const pmColor =
    row.plusMinus > 0 ? 'text-emerald-400' : row.plusMinus < 0 ? 'text-rose-400' : 'text-zinc-400'
  const pmLabel = row.plusMinus > 0 ? `+${row.plusMinus.toString()}` : row.plusMinus.toString()
  const defenseSide = row.position === 'defenseMen' ? (isBgm ? 'left' : 'right') : null

  return (
    <>
      <tr
        className="group cursor-pointer transition-colors hover:bg-surface-raised focus:bg-surface-raised focus:outline-none"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => {
          setExpanded((v) => !v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
      >
        <td className="py-2 pl-4 pr-2 text-sm">
          <div className="flex items-start gap-2">
            <span
              className={`mt-1 shrink-0 text-zinc-500 transition-colors transition-transform group-hover:text-zinc-300 ${expanded ? 'rotate-90' : ''}`}
            >
              ▸
            </span>
            <div className="min-w-0">
              <PlayerNameCell
                playerId={row.playerId}
                gamertag={row.gamertag}
                dnf={row.dnf}
                isGuest={row.isGuest}
              />
              {positionLabel !== null && positionFull !== null && row.position !== null ? (
                <div className="mt-0.5 flex items-center gap-1.5">
                  <PositionPill
                    label={positionLabel}
                    position={row.position}
                    isGoalie={false}
                    side={isBgm ? 'bgm' : 'opp'}
                    defenseSide={defenseSide}
                  />
                  <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-600">
                    {positionFull}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </td>
        <Td>{row.goals.toString()}</Td>
        <Td>{row.assists.toString()}</Td>
        <Td featured>{row.points.toString()}</Td>
        <Td>
          <span className={pmColor}>{pmLabel}</span>
        </Td>
        <Td>{row.shots.toString()}</Td>
        <Td hideOnMobile>{row.hits.toString()}</Td>
        <Td hideOnMobile>{row.blocks.toString()}</Td>
      </tr>
      {expanded ? (
        <tr className="bg-zinc-900/40 border-l-2 border-accent/30">
          <td colSpan={8} className="px-4 py-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-condensed text-lg font-semibold text-zinc-100">
                    {row.gamertag}
                  </h4>
                  <p className="text-sm text-zinc-500">Per-match breakdown</p>
                </div>
                {row.playerId !== null ? (
                  <Link
                    href={`/roster/${row.playerId.toString()}`}
                    className="font-condensed text-sm font-bold uppercase tracking-wide text-accent hover:text-accent/80"
                    onClick={(e) => {
                      e.stopPropagation()
                    }}
                  >
                    View player profile
                  </Link>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <DetailStat label="Score" value={row.score.toFixed(2)} />
                <DetailStat
                  label="Shot On Net %"
                  value={
                    row.shotAttempts > 0
                      ? `${((row.shots / row.shotAttempts) * 100).toFixed(0)}%`
                      : '—'
                  }
                  tooltip={
                    row.shotAttempts > 0 && row.shots > row.shotAttempts
                      ? 'Can exceed 100% — EA credits deflection goals as shots without recording a shot attempt.'
                      : undefined
                  }
                />
                <DetailStat
                  label="Shooting %"
                  value={
                    row.shots > 0 ? `${((row.goals / row.shots) * 100).toFixed(0)}%` : '—'
                  }
                />
                <DetailStat
                  label="Pass %"
                  value={row.passPct !== null ? `${row.passPct.toFixed(0)}%` : '—'}
                />
                <DetailStat
                  label="FO %"
                  value={
                    row.faceoffWins + row.faceoffLosses > 0
                      ? `${((row.faceoffWins / (row.faceoffWins + row.faceoffLosses)) * 100).toFixed(0)}%`
                      : '—'
                  }
                />
                <DetailStat
                  label="Possession"
                  value={row.possessionSeconds > 0 ? row.possessionSeconds.toString() : '—'}
                />
              </div>
              <DetailGroup
                title="Shooting"
                stats={[
                  ['Shots / Attempts', `${row.shots.toString()}/${row.shotAttempts.toString()}`],
                  [
                    'Shot On Net %',
                    row.shotAttempts > 0
                      ? `${((row.shots / row.shotAttempts) * 100).toFixed(1)}%`
                      : '—',
                  ],
                  [
                    'Shooting %',
                    row.shots > 0 ? `${((row.goals / row.shots) * 100).toFixed(1)}%` : '—',
                  ],
                  ['Deflections', row.deflections.toString()],
                ]}
              />
              <DetailGroup
                title="Passing & Possession"
                stats={[
                  [
                    'Passes / Attempts',
                    `${row.passCompletions.toString()}/${row.passAttempts.toString()}`,
                  ],
                  ['Pass %', row.passPct !== null ? `${row.passPct.toFixed(1)}%` : '—'],
                  ['Saucer Passes', row.saucerPasses.toString()],
                  ['Possession', row.possessionSeconds.toString()],
                ]}
              />
              <DetailGroup
                title="Faceoffs"
                stats={[
                  [
                    'FO W/L',
                    row.faceoffRecord ?? '—',
                    'Centerman takes all team faceoffs in EASHL — this is the team total.',
                  ],
                  [
                    'FO %',
                    row.faceoffWins + row.faceoffLosses > 0
                      ? `${((row.faceoffWins / (row.faceoffWins + row.faceoffLosses)) * 100).toFixed(0)}%`
                      : '—',
                  ],
                ]}
              />
              <DetailGroup
                title="Special Teams"
                stats={[
                  ['PPG', row.ppGoals.toString()],
                  ['SHG', row.shGoals.toString()],
                ]}
              />
              <DetailGroup
                title="Discipline"
                stats={[
                  ['PIM', row.pim.toString()],
                  ['Penalties Drawn', row.penaltiesDrawn.toString()],
                ]}
              />
              <DetailGroup
                title="Defense"
                stats={[
                  ['Hits', row.hits.toString()],
                  ['Blocks', row.blocks.toString()],
                ]}
              />
              <DetailGroup
                title="Turnovers"
                stats={[
                  ['Takeaways', row.takeaways.toString()],
                  ['Giveaways', row.giveaways.toString()],
                  ['Interceptions', row.interceptions.toString()],
                ]}
              />
              <DetailGroup title="Workload" stats={[['TOI', row.toi ?? '—']]} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

// ─── Goalie table ─────────────────────────────────────────────────────────────

function GoalieTable({ rows, isBgm = false }: { rows: GoalieRow[]; isBgm?: boolean }) {
  return (
    <Panel className="overflow-x-auto">
      <table className="w-full min-w-[480px]">
        <thead>
          <tr className="border-b border-zinc-800" style={isBgm ? BGM_HEADER_STYLE : undefined}>
            <Th align="left" wide>
              Goalie
            </Th>
            <Th>SV</Th>
            <Th>GA</Th>
            <Th>SV%</Th>
            <Th>SA</Th>
            <Th>TOI</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {rows.map((row) => (
            <GoalieRowEl key={row.rowKey} row={row} />
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

function GoalieRowEl({ row }: { row: GoalieRow }) {
  return (
    <tr className="group transition-colors hover:bg-surface-raised">
      <td className="py-2.5 pl-4 pr-2 text-sm">
        <div className="flex items-center gap-2">
          <PositionPill
            label="G"
            position="goalie"
            isGoalie={true}
            side={row.playerId !== null ? 'bgm' : 'opp'}
          />
          <PlayerNameCell
            playerId={row.playerId}
            gamertag={row.gamertag}
            dnf={row.dnf}
            isGuest={row.isGuest}
          />
        </div>
      </td>
      <Td>{row.saves.toString()}</Td>
      <Td>{row.goalsAgainst.toString()}</Td>
      <Td featured>{row.savePctFormatted}</Td>
      <Td>{row.shotsAgainst.toString()}</Td>
      <Td>{row.toi ?? '—'}</Td>
    </tr>
  )
}

function DetailGroup({
  title,
  stats,
}: {
  title: string
  stats: ReadonlyArray<readonly [string, string] | readonly [string, string, string]>
}) {
  return (
    <Panel className="p-3">
      <h5 className="mb-2 font-condensed text-xs font-bold uppercase tracking-widest text-zinc-400">
        {title}
      </h5>
      <div className="grid gap-2 sm:grid-cols-2">
        {stats.map(([label, value, tooltip]) => (
          <DetailStat key={label} label={label} value={value} tooltip={tooltip} />
        ))}
      </div>
    </Panel>
  )
}

function DetailStat({
  label,
  value,
  tooltip,
}: {
  label: string
  value: string
  tooltip?: string | undefined
}) {
  return (
    <div className="border border-zinc-800 bg-zinc-900/50 px-3 py-2" title={tooltip}>
      <div className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
        {label}
        {tooltip ? (
          <span className="ml-1 text-zinc-600" aria-hidden>
            ⓘ
          </span>
        ) : null}
      </div>
      <div className="mt-1 font-condensed text-lg font-bold tabular-nums text-zinc-100">
        {value}
      </div>
    </div>
  )
}

// ─── Name cell ────────────────────────────────────────────────────────────────
//
// BGM rows render an internal Link to /roster/[id]; opponent rows render a
// plain span (no profile surface exists for them). isGuest renders a small
// "GUEST" pill alongside the gamertag for opponent drop-ins.

function PlayerNameCell({
  playerId,
  gamertag,
  dnf,
  isGuest,
}: {
  playerId: number | null
  gamertag: string
  dnf: boolean
  isGuest: boolean
}) {
  const inner = (
    <>
      <span className="truncate max-w-[10rem]">{gamertag}</span>
      {isGuest ? <GuestBadge /> : null}
      {dnf ? <DnfBadge /> : null}
    </>
  )

  if (playerId !== null) {
    return (
      <Link
        href={`/roster/${playerId.toString()}`}
        className="flex items-center gap-2 font-condensed font-semibold uppercase tracking-wide text-zinc-200 group-hover:text-accent"
      >
        {inner}
      </Link>
    )
  }
  return (
    <span className="flex items-center gap-2 font-condensed font-semibold uppercase tracking-wide text-zinc-300">
      {inner}
    </span>
  )
}

// ─── Cell helpers ─────────────────────────────────────────────────────────────

function Th({
  children,
  align = 'right',
  hideOnMobile = false,
  wide = false,
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
  hideOnMobile?: boolean
  wide?: boolean
}) {
  const baseClasses =
    'py-2 font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500'
  const alignClass = align === 'left' ? 'text-left' : 'text-right'
  const widthClass = wide ? 'pl-4 pr-2' : 'px-2'
  const hideClass = hideOnMobile ? 'hidden sm:table-cell' : ''
  return <th className={`${baseClasses} ${alignClass} ${widthClass} ${hideClass}`}>{children}</th>
}

function Td({
  children,
  hideOnMobile = false,
  featured = false,
}: {
  children: React.ReactNode
  hideOnMobile?: boolean
  featured?: boolean
}) {
  const hideClass = hideOnMobile ? 'hidden sm:table-cell' : ''
  const colorClass = featured ? 'text-zinc-50 font-bold' : 'text-zinc-300'
  return (
    <td
      className={`px-2 py-2.5 text-right font-condensed text-sm tabular-nums ${colorClass} ${hideClass}`}
    >
      {children}
    </td>
  )
}

function DnfBadge() {
  return (
    <span
      title="Did not finish"
      className="border border-[rgba(232,65,49,0.50)] bg-[rgba(58,56,57,0.40)] px-1.5 py-0.5 font-condensed text-[9px] font-bold uppercase tracking-widest text-[#9a9798]"
    >
      DNF
    </span>
  )
}

function GuestBadge() {
  return (
    <span
      title="Drop-in player (guest)"
      className="border border-amber-700/40 bg-amber-900/30 px-1.5 py-0.5 font-condensed text-[9px] font-bold uppercase tracking-widest text-amber-400/80"
    >
      Guest
    </span>
  )
}
