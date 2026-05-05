import Link from 'next/link'
import type { ReactNode } from 'react'
import type {
  PlayerProfileOverview,
  PlayerCareerSeasonRow,
  getPlayerPositionUsage,
  getPlayerGamertagHistory,
} from '@eanhl/db/queries'
import type { GameMode } from '@eanhl/db'
import { PositionDonut } from '@/components/roster/position-donut'
import { formatPosition } from '@/lib/format'

type PositionUsageRow = Awaited<ReturnType<typeof getPlayerPositionUsage>>[number]
type PlayerGamertagHistoryRow = Awaited<
  ReturnType<typeof getPlayerGamertagHistory>
>[number]

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeSkaterArchetype(
  goals: number,
  assists: number,
  hits: number,
  skaterGp: number,
  plusMinus: number,
): string | null {
  if (skaterGp < 5) return null
  const gPerGp = goals / skaterGp
  const aPerGp = assists / skaterGp
  const hPerGp = hits / skaterGp
  const ptsPerGp = gPerGp + aPerGp
  if (hPerGp >= 3 && ptsPerGp < 0.7) return 'Enforcer'
  if (goals > assists && gPerGp >= 0.35) return 'Sniper'
  if (assists > goals * 1.3 && aPerGp >= 0.3) return 'Playmaker'
  if (plusMinus > 0 && ptsPerGp >= 0.5) return 'Two-Way'
  return 'Balanced'
}

// ─── Component ──────────────────────────────────────────────────────────────

interface Props {
  overview: PlayerProfileOverview
  positionUsage: PositionUsageRow[]
  career: PlayerCareerSeasonRow[]
  history: PlayerGamertagHistoryRow[]
  selectedRole: 'skater' | 'goalie'
  hasSkaterData: boolean
  hasGoalieData: boolean
  gameMode: GameMode | null
}

export function ProfileHero({
  overview,
  positionUsage,
  career,
  history,
  selectedRole,
  hasSkaterData,
  hasGoalieData,
  gameMode,
}: Props) {
  const { player, currentEaSeason } = overview
  const displayPosition =
    player.preferredPosition ?? currentEaSeason?.favoritePosition ?? player.position
  const positionLabel = displayPosition ? formatPosition(displayPosition) : null

  // Archetype computation (skater-only) — only if we have a current EA season with skater data
  const archetypeLabel =
    selectedRole === 'skater' && currentEaSeason !== null && currentEaSeason.skaterGp > 0
      ? computeSkaterArchetype(
          currentEaSeason.goals,
          currentEaSeason.assists,
          currentEaSeason.hits,
          currentEaSeason.skaterGp,
          currentEaSeason.plusMinus,
        )
      : null

  // AKA strip: collect prior gamertags (skip the current one)
  const currentGamertag = player.gamertag.toLowerCase()
  const aka = history
    .filter((h) => h.gamertag.toLowerCase() !== currentGamertag)
    .map((h) => h.gamertag)
  const uniqueAka = Array.from(new Set(aka))

  // Show role selector only if both roles have data; otherwise hide it
  const showRoleSelector = hasSkaterData && hasGoalieData

  // Aggregate career totals for the selected role
  const aggregate = aggregateCareer(career, selectedRole)

  return (
    <section className="relative overflow-hidden border border-zinc-800 bg-surface">
      {/* Background jersey number watermark */}
      {player.jerseyNumber !== null && (
        <div className="pointer-events-none absolute -right-6 -top-2 select-none font-condensed text-[12rem] font-black leading-none text-zinc-100/[0.03]">
          {player.jerseyNumber.toString()}
        </div>
      )}

      <div className="grid gap-6 p-6 lg:grid-cols-[3fr_2fr]">
        {/* Left column: Identity */}
        <div className="space-y-4">
          {/* Club label */}
          <p className="font-condensed text-[10px] font-bold uppercase tracking-[0.24em] text-zinc-600">
            Boogeymen Club Profile
          </p>

          {/* Gamertag */}
          <h1 className="font-condensed text-5xl font-black uppercase leading-none tracking-tight text-zinc-50">
            {player.gamertag}
          </h1>

          {/* Jersey + pills row */}
          <div className="flex flex-wrap items-center gap-2">
            {player.jerseyNumber !== null && (
              <span className="font-condensed text-base font-bold text-rose-500">
                #{player.jerseyNumber.toString()}
              </span>
            )}
            {positionLabel !== null && (
              <Pill className="border-zinc-600 bg-zinc-800/40 text-zinc-300">
                {positionLabel}
              </Pill>
            )}
            {archetypeLabel !== null && (
              <Pill className="border-rose-500/50 bg-rose-500/10 text-rose-300">
                {archetypeLabel}
              </Pill>
            )}
            {player.nationality !== null && (
              <Pill className="border-zinc-600 bg-zinc-800/40 text-zinc-300">
                {player.nationality}
              </Pill>
            )}
          </div>

          {/* Bio */}
          {player.bio !== null && (
            <p className="max-w-prose text-sm leading-relaxed text-zinc-400">
              {player.bio}
            </p>
          )}

          {/* AKA strip */}
          {uniqueAka.length > 0 && (
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-600">
              <span className="text-zinc-500">AKA</span>{' '}
              <span className="text-zinc-400 normal-case tracking-normal">
                {uniqueAka.join(', ')}
              </span>
            </p>
          )}

          {/* Role selector */}
          {showRoleSelector && (
            <div className="flex gap-1 pt-2">
              <RoleLink
                role="skater"
                active={selectedRole === 'skater'}
                gameMode={gameMode}
                label="Skater"
              />
              <RoleLink
                role="goalie"
                active={selectedRole === 'goalie'}
                gameMode={gameMode}
                label="Goalie"
              />
            </div>
          )}
        </div>

        {/* Right column: Stats */}
        <div className="space-y-5 border-zinc-800 lg:border-l lg:pl-6">
          {/* THIS SEASON */}
          <div className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h3 className="font-condensed text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-100">
                This Season
              </h3>
              {currentEaSeason !== null && (
                <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                  NHL 26 · EA totals
                </span>
              )}
            </div>
            {currentEaSeason !== null ? (
              selectedRole === 'skater' ? (
                <SkaterCurrentStrip season={currentEaSeason} />
              ) : (
                <GoalieCurrentStrip season={currentEaSeason} />
              )
            ) : (
              <p className="text-xs text-zinc-500">No current-season data yet.</p>
            )}
          </div>

          {/* CAREER TOTALS */}
          <div className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h3 className="font-condensed text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-100">
                Career Totals
              </h3>
              <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                NHL 22-26 · sum
              </span>
            </div>
            {aggregate.gp > 0 ? (
              selectedRole === 'skater' ? (
                <SkaterCareerStrip aggregate={aggregate as SkaterAggregate} />
              ) : (
                <GoalieCareerStrip aggregate={aggregate as GoalieAggregate} />
              )
            ) : (
              <p className="text-xs text-zinc-500">No career data yet.</p>
            )}
          </div>

          {/* Position donut (lg+ only) */}
          {positionUsage.length > 0 && (
            <div className="hidden lg:flex lg:justify-end lg:pt-2">
              <PositionDonut usage={positionUsage} />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Pill({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 font-condensed text-[10px] font-semibold uppercase tracking-[0.16em] ${className}`}
    >
      {children}
    </span>
  )
}

function RoleLink({
  role,
  active,
  gameMode,
  label,
}: {
  role: 'skater' | 'goalie'
  active: boolean
  gameMode: GameMode | null
  label: string
}) {
  const params = new URLSearchParams()
  params.set('role', role)
  if (gameMode !== null) params.set('mode', gameMode)
  return (
    <Link
      href={`?${params.toString()}`}
      className={[
        'rounded border px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-[0.16em] transition-colors',
        active
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-zinc-700 bg-zinc-900/70 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200',
      ].join(' ')}
    >
      {label}
    </Link>
  )
}

function StatCell({
  label,
  value,
  accent = false,
}: {
  label: string
  value: string | number
  accent?: boolean
}) {
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
        {label}
      </span>
      <span
        className={`font-condensed text-lg font-black tabular-nums ${
          accent ? 'text-accent' : 'text-zinc-100'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

function SkaterCurrentStrip({
  season,
}: {
  season: NonNullable<PlayerProfileOverview['currentEaSeason']>
}) {
  const plusMinusStr =
    season.plusMinus >= 0 ? `+${season.plusMinus.toString()}` : season.plusMinus.toString()
  return (
    <div className="grid grid-cols-5 gap-3">
      <StatCell label="GP" value={season.skaterGp} />
      <StatCell label="G" value={season.goals} />
      <StatCell label="A" value={season.assists} />
      <StatCell label="PTS" value={season.points} accent />
      <StatCell label="+/-" value={plusMinusStr} />
    </div>
  )
}

function GoalieCurrentStrip({
  season,
}: {
  season: NonNullable<PlayerProfileOverview['currentEaSeason']>
}) {
  const record = `${(season.goalieWins ?? 0).toString()}-${(season.goalieLosses ?? 0).toString()}-${(season.goalieOtl ?? 0).toString()}`
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-5">
      <StatCell label="GP" value={season.goalieGp} />
      <StatCell label="W-L-OTL" value={record} />
      <StatCell
        label="SV%"
        value={season.goalieSavePct !== null ? `${season.goalieSavePct}%` : '—'}
        accent
      />
      <StatCell label="GAA" value={season.goalieGaa ?? '—'} />
      <StatCell label="SO" value={season.goalieShutouts ?? 0} />
    </div>
  )
}

interface SkaterAggregate {
  gp: number
  g: number
  a: number
  pts: number
  plusMinus: number
  shots: number
  hits: number
  pim: number
  shtPct: string | null
}
interface GoalieAggregate {
  gp: number
  w: number
  l: number
  otl: number
  so: number
  savePct: string | null
  gaa: string | null
}

type CareerAggregate = SkaterAggregate | GoalieAggregate

function aggregateCareer(
  rows: PlayerCareerSeasonRow[],
  role: 'skater' | 'goalie',
): CareerAggregate {
  if (role === 'skater') {
    const filtered = rows.filter((r) => r.skaterGp > 0)
    const sum = filtered.reduce(
      (acc, r) => ({
        gp: acc.gp + r.skaterGp,
        g: acc.g + r.goals,
        a: acc.a + r.assists,
        pts: acc.pts + r.points,
        plusMinus: acc.plusMinus + r.plusMinus,
        shots: acc.shots + r.shots,
        hits: acc.hits + r.hits,
        pim: acc.pim + r.pim,
      }),
      { gp: 0, g: 0, a: 0, pts: 0, plusMinus: 0, shots: 0, hits: 0, pim: 0 },
    )
    const sht = sum.shots > 0 ? `${((sum.g / sum.shots) * 100).toFixed(1)}%` : null
    return { ...sum, shtPct: sht }
  }

  const filtered = rows.filter((r) => r.goalieGp > 0)
  const sum = filtered.reduce(
    (acc, r) => ({
      gp: acc.gp + r.goalieGp,
      w: acc.w + (r.wins ?? 0),
      l: acc.l + (r.losses ?? 0),
      otl: acc.otl + (r.otl ?? 0),
      so: acc.so + (r.shutouts ?? 0),
    }),
    { gp: 0, w: 0, l: 0, otl: 0, so: 0 },
  )
  // SV% and GAA cannot be reliably re-aggregated from this row shape (no total saves/SA across all rows).
  // Show null in the strip; per-season values still show in the StatsRecord table.
  return { ...sum, savePct: null, gaa: null }
}

function SkaterCareerStrip({ aggregate }: { aggregate: SkaterAggregate }) {
  const plusMinusStr =
    aggregate.plusMinus >= 0
      ? `+${aggregate.plusMinus.toString()}`
      : aggregate.plusMinus.toString()
  return (
    <div className="grid grid-cols-5 gap-3">
      <StatCell label="GP" value={aggregate.gp} />
      <StatCell label="G" value={aggregate.g} />
      <StatCell label="A" value={aggregate.a} />
      <StatCell label="PTS" value={aggregate.pts} accent />
      <StatCell label="+/-" value={plusMinusStr} />
    </div>
  )
}

function GoalieCareerStrip({ aggregate }: { aggregate: GoalieAggregate }) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-5">
      <StatCell label="GP" value={aggregate.gp} />
      <StatCell label="W" value={aggregate.w} />
      <StatCell label="L" value={aggregate.l} />
      <StatCell label="OTL" value={aggregate.otl} />
      <StatCell label="SO" value={aggregate.so} />
    </div>
  )
}
