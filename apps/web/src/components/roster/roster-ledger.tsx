'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { PlayerArchetype } from '@eanhl/db/schema'
import { PLAYER_ARCHETYPES } from '@eanhl/db/schema'
import { ArchetypePillCompact } from '@/components/ui/archetype-pill'
import { formatPosition } from '@/lib/format'
import './roster-ledger.css'

export interface RosterLedgerRow {
  playerId: number
  gamertag: string
  position: string | null
  favoritePosition: string | null
  jerseyNumber: number | null
  archetype?: string | null
  goals: number
  assists: number
  points: number
  skaterGp: number
  goalieGp: number
  goalieWins: number | null
  goalieGoalsAgainst: number | null
  savePct: string | null
  gaa: string | null
}

function asArchetype(value: string | null | undefined): PlayerArchetype | null {
  if (value === null || value === undefined) return null
  return (PLAYER_ARCHETYPES as readonly string[]).includes(value)
    ? (value as PlayerArchetype)
    : null
}

export interface RosterLedgerRecord {
  wins: number
  losses: number
  otl: number
}

export type RecentResult = 'WIN' | 'LOSS' | 'OTL' | 'DNF'

/** Per-player time-series captured from the last N matches (chronological,
 *  oldest first). Drives the sparkline mini-charts inside each leader tile. */
export interface PlayerSparkline {
  /** Points scored per game. Used by the Points-Leader tile sparkline. */
  points: number[]
  /** Goals scored per game. Used by the Goals-Leader tile sparkline. */
  goals: number[]
  /** Save % per game (0–100). Used by the Goalie SV% tile sparkline. */
  savePct: number[]
}

interface Props {
  rows: RosterLedgerRow[]
  record: RosterLedgerRecord | null
  /** Scope tag rendered in the header for "Current" view. */
  scopeLabel: string
  /** Career-aggregated rows across every game title. Enables the All-Time tab. */
  allTimeRows?: RosterLedgerRow[] | undefined
  /** Career team record across every game title. Required to enable All-Time. */
  allTimeRecord?: RosterLedgerRecord | null | undefined
  /** Scope tag rendered in the header for "All Time" view. */
  allTimeScopeLabel?: string | undefined
  /** Footer date range (e.g. "2025-09 → 2026-05"). */
  dateRange?: string | undefined
  /** Footer date range when All Time is selected (e.g. "2022-09 → 2026-05"). */
  allTimeDateRange?: string | undefined
  /** Footer sheet identifier. */
  sheetCode?: string | undefined
  /** Optional updated-X-ago freshness label. */
  freshness?: string | undefined
  /** Last N team match results (newest last) — drives the Record-tile sparkline. */
  recordSparkline?: RecentResult[] | undefined
  /** Per-player sparkline series, keyed by playerId. */
  sparklines?: Record<number, PlayerSparkline> | undefined
}

type Scope = 'current' | 'alltime'

export function RosterLedger({
  rows,
  record,
  scopeLabel,
  allTimeRows,
  allTimeRecord,
  allTimeScopeLabel,
  dateRange,
  allTimeDateRange,
  sheetCode = 'BGM/LDR/0001',
  freshness,
  recordSparkline,
  sparklines,
}: Props) {
  const allTimeReady =
    Array.isArray(allTimeRows) && allTimeRows.length > 0 && allTimeRecord !== undefined
  const [scope, setScope] = useState<Scope>('current')
  const effectiveScope: Scope = scope === 'alltime' && allTimeReady ? 'alltime' : 'current'

  const activeRows = effectiveScope === 'alltime' && allTimeRows ? allTimeRows : rows
  const activeRecord = effectiveScope === 'alltime' ? allTimeRecord ?? null : record
  const activeScopeLabel =
    effectiveScope === 'alltime' && allTimeScopeLabel ? allTimeScopeLabel : scopeLabel
  const activeDateRange =
    effectiveScope === 'alltime' && allTimeDateRange ? allTimeDateRange : dateRange

  const skaters = activeRows.filter((r) => r.skaterGp > 0)
  const goalies = activeRows.filter((r) => r.goalieGp > 0 && r.savePct !== null)

  const pointsSorted = useMemo(
    () => [...skaters].sort((a, b) => b.points - a.points),
    [skaters],
  )
  const goalsSorted = useMemo(
    () => [...skaters].sort((a, b) => b.goals - a.goals),
    [skaters],
  )
  const svPctSorted = useMemo(
    () =>
      [...goalies].sort(
        (a, b) => parseFloat(b.savePct ?? '0') - parseFloat(a.savePct ?? '0'),
      ),
    [goalies],
  )

  const ptsLeader = pointsSorted[0] ?? null
  const ptsRunnerUp = pointsSorted[1] ?? null
  const goalsLeader = goalsSorted[0] ?? null
  const goalsRunnerUp = goalsSorted[1] ?? null
  const svLeader = svPctSorted[0] ?? null

  const teamGoals = skaters.reduce((acc, r) => acc + r.goals, 0)

  const recordTotal = activeRecord
    ? activeRecord.wins + activeRecord.losses + activeRecord.otl
    : 0
  const winPct =
    activeRecord && recordTotal > 0
      ? formatHockeyPct(activeRecord.wins / Math.max(1, recordTotal))
      : null
  const recBars =
    activeRecord && recordTotal > 0
      ? {
          w: (activeRecord.wins / recordTotal) * 100,
          l: (activeRecord.losses / recordTotal) * 100,
          o: (activeRecord.otl / recordTotal) * 100,
        }
      : { w: 0, l: 0, o: 0 }

  const ptsSpark = ptsLeader ? sparklines?.[ptsLeader.playerId]?.points : undefined
  const goalsSpark = goalsLeader ? sparklines?.[goalsLeader.playerId]?.goals : undefined
  const svSpark = svLeader ? sparklines?.[svLeader.playerId]?.savePct : undefined

  return (
    <section className="rl-frame">
      <div className="rl-notch tl" />
      <div className="rl-notch tr" />
      <div className="rl-notch bl" />
      <div className="rl-notch br" />

      <header className="rl-head">
        <h2>
          <span className="acc">▌</span>
          Roster Ledger
          <span className="scope">{activeScopeLabel}</span>
        </h2>
        <div className="rl-right-meta">
          {freshness ? (
            <span className="rl-live">
              <span className="pip" />
              <b>LIVE</b>
              <span>· {freshness}</span>
            </span>
          ) : null}
          <div className="rl-toggle" role="tablist" aria-label="Scope toggle">
            <button
              type="button"
              className={effectiveScope === 'current' ? 'active' : ''}
              role="tab"
              aria-selected={effectiveScope === 'current'}
              onClick={() => {
                setScope('current')
              }}
            >
              <span className="num">01</span>Current
            </button>
            <span className="sep" />
            <button
              type="button"
              className={effectiveScope === 'alltime' ? 'active' : ''}
              role="tab"
              aria-selected={effectiveScope === 'alltime'}
              disabled={!allTimeReady}
              title={
                allTimeReady ? 'Career totals across every game title' : 'No all-time data yet'
              }
              onClick={() => {
                if (allTimeReady) setScope('alltime')
              }}
            >
              <span className="num">02</span>All Time
            </button>
          </div>
        </div>
      </header>

      <div className="rl-ticker" />

      <div className="rl-row">
        {/* RECORD */}
        <div className="rl-tile">
          <div className="label">
            <span className="acc-bar" />
            Record
            <span className="idx">01</span>
          </div>
          {activeRecord ? (
            <>
              <div className="rl-record-row">
                <div className="grp w">
                  <span className="num">{formatCount(activeRecord.wins)}</span>
                  <span className="k">W</span>
                </div>
                <div className="grp l">
                  <span className="num">{formatCount(activeRecord.losses)}</span>
                  <span className="k">L</span>
                </div>
                <div className="grp o">
                  <span className="num">{formatCount(activeRecord.otl)}</span>
                  <span className="k">OTL</span>
                </div>
              </div>
              <div className="rl-record-foot">
                <div className="rl-record-bar">
                  <i className="w" style={{ width: `${recBars.w.toFixed(1)}%` }} />
                  <i className="l" style={{ width: `${recBars.l.toFixed(1)}%` }} />
                  <i className="o" style={{ width: `${recBars.o.toFixed(1)}%` }} />
                </div>
                <span className="rl-record-pct">
                  <b>{winPct ?? '—'}</b>
                </span>
              </div>
              {recordSparkline && recordSparkline.length > 0 ? (
                <RecordSparkline results={recordSparkline} />
              ) : null}
            </>
          ) : (
            <p className="rl-empty">No completed games yet.</p>
          )}
        </div>

        {/* POINTS LEADER */}
        <LeaderTile
          label="Points Leader"
          idx="02"
          leader={ptsLeader}
          unit="PTS"
          valueOf={(r) => r.points}
          format={(v) => formatCount(v)}
          renderFoot={(r) => (
            <>
              <span>
                <b>
                  {formatCount(r.goals)}G · {formatCount(r.assists)}A
                </b>
              </span>
              {ptsRunnerUp ? (
                <DeltaPill diff={r.points - ptsRunnerUp.points} vsLabel="vs #2" />
              ) : null}
              {ptsSpark && ptsSpark.length > 0 ? (
                <Sparkline values={ptsSpark} kind="positive" />
              ) : null}
            </>
          )}
        />

        {/* GOALS LEADER */}
        <LeaderTile
          label="Goals Leader"
          idx="03"
          leader={goalsLeader}
          unit="G"
          valueOf={(r) => r.goals}
          format={(v) => formatCount(v)}
          renderFoot={(r) => (
            <>
              <span>
                <b>
                  {teamGoals > 0
                    ? `${Math.round((r.goals / teamGoals) * 100).toString()}%`
                    : '—'}
                </b>{' '}
                of team
              </span>
              {goalsRunnerUp ? (
                <DeltaPill diff={r.goals - goalsRunnerUp.goals} vsLabel="vs #2" />
              ) : null}
              {goalsSpark && goalsSpark.length > 0 ? (
                <Sparkline values={goalsSpark} kind="positive" />
              ) : null}
            </>
          )}
        />

        {/* GOALIE SV% */}
        <div className="rl-tile">
          <div className="label">
            <span className="acc-bar" />
            Goalie SV%
            <span className="idx">04</span>
          </div>
          {svLeader ? (
            <>
              <Link href={`/roster/${String(svLeader.playerId)}`} className="rl-lead-line">
                <span className="seat">
                  {svLeader.jerseyNumber != null ? `#${String(svLeader.jerseyNumber)}` : '#—'}
                </span>
                <span className="name">{svLeader.gamertag}</span>
                <span className="pos">{positionTag(svLeader, /* goalie */ true)}</span>
              </Link>
              <div className="rl-lead-stat">
                <span className="big">{formatSavePct(svLeader.savePct)}</span>
                <span className="unit">SV%</span>
              </div>
              <div className="rl-lead-foot rl-goalie-foot">
                <span className="gaa">
                  <span className="gaa-k">GAA</span>{' '}
                  <b>{formatGaa(svLeader.gaa)}</b>
                </span>
                <span className="delta eq">{formatCount(svLeader.goalieGp)} GP</span>
                {svSpark && svSpark.length > 0 ? (
                  <Sparkline values={svSpark} kind="positive" />
                ) : null}
              </div>
            </>
          ) : (
            <p className="rl-empty">No qualifying goalies yet.</p>
          )}
        </div>
      </div>

      <footer className="rl-foot">
        <span>
          Source <b>EA NHL · Boogeymen</b> · Sheet <b>{sheetCode}</b>
        </span>
        <span className="right">
          <span>
            {activeDateRange ? (
              <>
                <b>{activeDateRange}</b> · <span className="dot">●</span> updated{' '}
                <b>{freshness ?? 'just now'}</b>
              </>
            ) : (
              <>
                <span className="dot">●</span> updated <b>{freshness ?? 'just now'}</b>
              </>
            )}
          </span>
        </span>
      </footer>
    </section>
  )
}

// ─── Leader tile (Points / Goals) ───────────────────────────────────────────

function LeaderTile({
  label,
  idx,
  leader,
  unit,
  valueOf,
  format,
  renderFoot,
}: {
  label: string
  idx: string
  leader: RosterLedgerRow | null
  unit: string
  valueOf: (r: RosterLedgerRow) => number
  format: (v: number) => string
  renderFoot: (r: RosterLedgerRow) => React.ReactNode
}) {
  return (
    <div className="rl-tile">
      <div className="label">
        <span className="acc-bar" />
        {label}
        <span className="idx">{idx}</span>
      </div>
      {leader ? (
        <>
          <Link href={`/roster/${String(leader.playerId)}`} className="rl-lead-line">
            <span className="seat">
              {leader.jerseyNumber != null ? `#${String(leader.jerseyNumber)}` : '#—'}
            </span>
            <span className="name">{leader.gamertag}</span>
            <span className="pos">{positionTag(leader)}</span>
          </Link>
          {(() => {
            const arch = asArchetype(leader.archetype)
            return arch !== null ? (
              <div className="rl-lead-arch">
                <ArchetypePillCompact archetype={arch} />
              </div>
            ) : null
          })()}
          <div className="rl-lead-stat">
            <span className="big">{format(valueOf(leader))}</span>
            <span className="unit">{unit}</span>
          </div>
          <div className="rl-lead-foot">{renderFoot(leader)}</div>
        </>
      ) : (
        <p className="rl-empty">No qualifying skaters yet.</p>
      )}
    </div>
  )
}

function DeltaPill({ diff, vsLabel }: { diff: number; vsLabel: string }) {
  const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : 'eq'
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±'
  const v = Math.abs(diff)
  return (
    <span className={`delta ${cls}`}>
      {sign}
      {formatCount(v)} {vsLabel}
    </span>
  )
}

// ─── Sparkline primitives ───────────────────────────────────────────────────

/** Generic numeric sparkline — column heights normalized to the series max.
 *  Heights snap above a 12% floor so a zero-game still shows a hint. */
function Sparkline({
  values,
  kind = 'positive',
}: {
  values: number[]
  kind?: 'positive'
}) {
  if (values.length === 0) return null
  const max = Math.max(...values, 0.001)
  const minHeight = 12 // %
  return (
    <span className={`spark spark-${kind}`} aria-hidden>
      {values.map((v, i) => {
        const pct = max > 0 ? Math.max(minHeight, (v / max) * 100) : minHeight
        return <i key={i} style={{ height: `${pct.toFixed(0)}%` }} />
      })}
    </span>
  )
}

/** Result-typed sparkline for the Record tile — each column color-coded:
 *  accent=W, grey=L, amber=OTL, slate=DNF. Heights are uniform so the bar
 *  is a clean colored ribbon. */
function RecordSparkline({ results }: { results: RecentResult[] }) {
  return (
    <span className="rl-record-spark" aria-hidden>
      {results.map((r, i) => (
        <i key={i} className={`r-${r.toLowerCase()}`} />
      ))}
    </span>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function positionTag(r: RosterLedgerRow, goalie = false): string {
  if (goalie) return 'G'
  const raw = r.favoritePosition ?? r.position
  if (raw === null) return '—'
  return formatPosition(raw)
}

function formatSavePct(raw: string | null): string {
  if (raw === null) return '—'
  const n = parseFloat(raw)
  if (!Number.isFinite(n)) return '—'
  return (n / 100).toFixed(3).slice(1) // ".762"
}

function formatGaa(raw: string | null): string {
  if (raw === null) return '—'
  const n = parseFloat(raw)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(2)
}

function formatHockeyPct(rate: number): string {
  // Hockey-style ".750" — three decimals, no leading zero.
  return rate.toFixed(3).replace(/^0/, '')
}

function formatCount(v: number): string {
  return v.toLocaleString('en-US')
}
