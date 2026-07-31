'use client'

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import Image from 'next/image'
import type { LineupRow, MatchLineups } from '@eanhl/db/queries'
import type { PlayerArchetype } from '@eanhl/db/schema'
import { useGameSheetMode, type GameSheetMode } from '@/components/matches/game-sheet-mode'
import { useReducedMotion } from '@/components/matches/motion'
import { OpponentCrest } from '@/components/ui/opponent-crest'
import { ArchetypePillCompact } from '@/components/ui/archetype-pill'
import { resolvePlatform } from '@/components/ui/platform-badge'
import { splitBuild, type HeadToHeadStatLine } from '@/lib/head-to-head'
import { delayVar, durationVar } from '@/lib/motion'
import type { PlayerScoreEntry } from '@/lib/match-recap'
import { DrawerLoadout } from './drawer-loadout'
import { DrawerStats } from './drawer-stats'
import {
  LineupModuleRow,
  type LineupPositionKey,
  type LineupSlotVM,
  type LineupStatTile,
} from './lineup-row'

// Lineup — the prototype's one-roster-at-a-time module. A BGM|OPP segmented
// control picks which team's six rows are browsed; the LOADOUTS|STATS page
// mode (context) decides what each row trails with. Opening a row drills into
// that one player: their build in LOADOUTS mode (falling back to the EA-backed
// stats drawer when no loadout snapshot exists — never a dead-end card), their
// match stats in STATS.

const POSITIONS: LineupPositionKey[] = ['C', 'LW', 'RW', 'LD', 'RD', 'G']

type TeamKey = 'bgm' | 'opp'

/**
 * Stat shape both getPlayerMatchStats and getOpponentPlayerMatchStats rows
 * satisfy — the row tiles' fields plus the deep line the stats drawer's
 * category tables derive from (`HeadToHeadStatLine`).
 */
export interface LineupModuleStatRow extends HeadToHeadStatLine {
  playerId?: number | null
  gamertag: string
  isGoalie: boolean
  saves: number | null
  goalsAgainst: number | null
  shotsAgainst: number | null
}

interface LineupModuleProps {
  lineups: MatchLineups
  /** `ocr` = real pre-game loadout snapshots; `boxScore` = synthesized fallback. */
  variant: 'ocr' | 'boxScore'
  bgmStats: LineupModuleStatRow[]
  oppStats: LineupModuleStatRow[]
  /** Composite game scores for both teams (buildAllTeamScores output). */
  scores: PlayerScoreEntry[]
  opponentName: string
  opponentAbbrev: string
  opponentCrestAssetId: string | null
  opponentCrestUseBaseAsset: string | null
  /** Provenance footer — server-rendered, passed through untouched. */
  children?: ReactNode
}

export function LineupModule({
  lineups,
  variant,
  bgmStats,
  oppStats,
  scores,
  opponentName,
  opponentAbbrev,
  opponentCrestAssetId,
  opponentCrestUseBaseAsset,
  children,
}: LineupModuleProps) {
  const { mode, setMode, loadoutsAvailable } = useGameSheetMode()
  const [team, setTeam] = useState<TeamKey>('bgm')
  const [openPos, setOpenPos] = useState<LineupPositionKey | null>(null)
  const idBase = useId()

  const bgmByPos = bucketByPosition(lineups.bgm, variant)
  const oppByPos = bucketByPosition(lineups.opponent, variant)
  const activeByPos = team === 'bgm' ? bgmByPos : oppByPos
  const activeStats = team === 'bgm' ? bgmStats : oppStats

  const slots = POSITIONS.map((position) => {
    const row = activeByPos.get(position) ?? null
    const stat = row ? findStat(activeStats, team, row) : null
    return buildSlotVM({
      position,
      row,
      variant,
      stat,
      gs: row ? findScore(scores, team, row) : null,
    })
  })

  // Walk legs — expandable slots per team, canonical position order. Both are
  // needed up front: the walk crosses rosters, so it has to know the other
  // side's order before it gets there.
  const walkOrders = {
    bgm: expandableOrder(bgmByPos, bgmStats, 'bgm', variant),
    opp: expandableOrder(oppByPos, oppStats, 'opp', variant),
  }
  const onWalkAdvance = useCallback(
    (nextMode: GameSheetMode, nextTeam: TeamKey, nextPos: LineupPositionKey | null) => {
      setMode(nextMode)
      setTeam(nextTeam)
      setOpenPos(nextPos)
    },
    [setMode],
  )
  const walk = useLineupAutoWalk({
    mode,
    team,
    openPos,
    orders: walkOrders,
    loadoutsAvailable,
    onAdvance: onWalkAdvance,
  })

  const dressed = slots.filter((s) => s.human).length
  const goalieSlot = slots.find((s) => s.position === 'G')
  const goalieLabel = goalieSlot?.human ? (goalieSlot.persona ?? goalieSlot.handle ?? 'CPU') : 'CPU'
  const activeName = team === 'bgm' ? 'Boogeymen' : opponentName
  const buildChips = summarizeBuilds(team === 'bgm' ? lineups.bgm : lineups.opponent)

  return (
    <section className="space-y-2">
      {/* Panel settles in on load and a red hairline sweeps its top edge once —
          the prototype's `bcast-in` + `panel-wipe` pair, same treatment the
          box-score and team-stats panels already carry. */}
      {/* Hover/focus pause the auto-walk; `onFocusCapture` is what makes it
          reachable by keyboard, where the prototype only had mouseenter. */}
      <div
        ref={walk.panelRef}
        onMouseEnter={() => {
          walk.setHovered(true)
        }}
        onMouseLeave={() => {
          walk.setHovered(false)
        }}
        onFocusCapture={() => {
          walk.setHovered(true)
        }}
        onBlurCapture={() => {
          walk.setHovered(false)
        }}
        className="gs-rise relative overflow-hidden border border-border bg-surface"
      >
        <span aria-hidden className="gs-wipe" />
        {/* Dwell bar — the walk's clock and its only visible indicator.
            `key` restarts the animation on each advance. */}
        {walk.on ? (
          <span
            key={walk.step}
            aria-hidden
            onAnimationEnd={walk.advance}
            style={{
              ...durationVar(WALK_DWELL_MS),
              animationPlayState: walk.paused ? 'paused' : 'running',
            }}
            className="gs-dwell absolute left-0 top-0 z-[4] h-[2px] w-full [background:linear-gradient(90deg,rgba(232,65,49,0.2),var(--color-accent))]"
          />
        ) : null}
        {/* Header: identity · team switch */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-3.5 pb-3 pt-3">
          <div className="flex min-w-0 flex-col gap-[9px]">
            {/* ds-section-label + the prototype's ▰ ornament (decorative, so it
                stays out of the accessible name). */}
            <h2 className="font-condensed text-[12px] font-semibold uppercase tracking-[0.16em] text-fg-4">
              <span aria-hidden className="pr-1 text-fg-5">
                ▰
              </span>
              Lineup
            </h2>
            {/* `key={team}` remounts the crest + name on every swap, which is
                what replays their entrance — a CSS animation only runs when the
                element is created, so re-rendering the same node in place would
                change the content silently. */}
            <div key={team} className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
              {team === 'bgm' ? (
                <Image
                  src="/images/bgm-logo.png"
                  alt=""
                  width={24}
                  height={24}
                  className="gs-pop h-6 w-6 flex-none object-contain"
                />
              ) : (
                <span className="gs-pop flex h-6 w-6 flex-none items-center justify-center overflow-hidden rounded-full border bg-charcoal [border-color:var(--opp-line)]">
                  <OpponentCrest
                    crestAssetId={opponentCrestAssetId}
                    useBaseAsset={opponentCrestUseBaseAsset}
                    alt=""
                    width={20}
                    height={20}
                    className="h-5 w-5 object-contain"
                    fallback={
                      <span aria-hidden className="text-[9px] font-black text-fg-3">
                        {opponentAbbrev.slice(0, 2)}
                      </span>
                    }
                  />
                </span>
              )}
              <span
                className="gs-fade-in truncate font-condensed text-[16px] font-black uppercase tracking-[0.07em] text-fg-1"
                style={delayVar(40)}
              >
                {activeName}
              </span>
              <span className="flex items-center gap-3.5 border-l border-border pl-3.5">
                <HeaderKV k="Dressed" v={`${dressed.toString()}/6`} />
                <HeaderKV k="Goalie" v={goalieLabel} dim={goalieLabel === 'CPU'} />
              </span>
            </div>
            {/* Build mix for the roster on screen — "2× PMD · SNP · PLY" in
                canonical position order. Restored from the pre-revamp summary
                band; it's the only at-a-glance read of what the team dressed. */}
            {buildChips.length > 0 ? (
              <div
                key={`${team}-builds`}
                className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5"
              >
                {buildChips.map((chip) => (
                  <BuildMixChip key={chip.key} chip={chip} />
                ))}
              </div>
            ) : null}
            {slots.some((s) => s.expandable) ? (
              <p className="font-condensed text-[12px] font-semibold uppercase tracking-[0.1em] text-fg-4">
                {variant === 'ocr'
                  ? 'Tap a skater for full loadout and match stats'
                  : 'Tap a skater for full match stats'}
              </p>
            ) : null}
          </div>

          {/* BGM | OPP sliding-thumb team switch. The prototype's thumb is a
              TINT with a coloured label (accent-soft + accent-line + glow on
              BGM, surface-raised + --opp-line on the opponent) — not a solid
              accent fill with white text. */}
          <div
            role="group"
            aria-label="Roster shown"
            className="relative h-10 w-[250px] max-w-full flex-none border border-border bg-charcoal p-[3px]"
          >
            <span
              aria-hidden
              className={`gs-thumb absolute bottom-[3px] left-[3px] top-[3px] w-[calc(50%-3px)] border ${
                team === 'bgm'
                  ? 'translate-x-0 [background:var(--color-accent-soft)] [border-color:var(--color-accent-line)] [box-shadow:0_0_14px_rgba(232,65,49,0.2)]'
                  : 'translate-x-full bg-surface-raised [border-color:var(--opp-line)]'
              }`}
            />
            <div className="relative flex h-full">
              <TeamButton
                active={team === 'bgm'}
                activeClass="text-accent"
                onClick={() => {
                  walk.stop()
                  setTeam('bgm')
                }}
              >
                BGM
              </TeamButton>
              <TeamButton
                active={team === 'opp'}
                activeClass="text-fg-1"
                onClick={() => {
                  walk.stop()
                  setTeam('opp')
                }}
              >
                {opponentAbbrev}
              </TeamButton>
            </div>
          </div>
        </div>

        {/* Rows.
            `key={team}` again: the six rows deal back in on every swap, which
            is the cue that actually carries the state change — the thumb only
            says a control was pressed, the restagger says the roster under it
            is different. Remounting keeps `openPos`, so an open drawer stays
            open and simply replays its own entrance alongside them. */}
        <div key={team} className="border-t border-border-subtle">
          {slots.map((slot, slotIndex) => {
            const isOpen = openPos === slot.position && slot.expandable
            const panelId = `${idBase}-${slot.position}`
            // The drawer is the tapped player only — whichever roster the team
            // switch is showing.
            const row = activeByPos.get(slot.position) ?? null
            const stat = row ? findStat(activeStats, team, row) : null
            return (
              <div key={slot.position} className="gs-row-in" style={delayVar(slotIndex * 45)}>
                <LineupModuleRow
                  slot={slot}
                  mode={mode}
                  isOpen={isOpen}
                  panelId={panelId}
                  onToggle={() => {
                    // Any deliberate click ends the walk for good.
                    walk.stop()
                    setOpenPos((prev) => (prev === slot.position ? null : slot.position))
                  }}
                />
                {isOpen ? (
                  <div id={panelId}>
                    {mode === 'loadouts' && slot.hasLoadout ? (
                      <DrawerLoadout row={row} side={team} />
                    ) : (
                      <DrawerStats
                        row={row}
                        stat={stat}
                        side={team}
                        loadoutFallback={mode === 'loadouts'}
                      />
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
      {children}
    </section>
  )
}

// ─── Auto-walk ───────────────────────────────────────────────────────────────

/** Prototype default (`lineupRotateSeconds`). */
const WALK_DWELL_MS = 9000

interface AutoWalk {
  /** False once the walk is off for good — nothing renders the dwell bar then. */
  on: boolean
  paused: boolean
  /** Bumped per advance; keys the dwell bar so its animation restarts. */
  step: number
  /** Advance one slot. Bound to the dwell bar's `animationend`. */
  advance: () => void
  /** Any deliberate interaction hands the panel back to the user, for good. */
  stop: () => void
  setHovered: (v: boolean) => void
  panelRef: (el: HTMLDivElement | null) => void
}

/**
 * The lineup auto-walk. One flat sequence of steps, each held for the same
 * dwell — team nested inside view, with an overview step whenever the roster
 * on screen changes:
 *
 *   LOADOUTS  BGM (nothing open) -> C -> LW -> RW -> LD -> RD -> G
 *             OPP (nothing open) -> C -> LW -> RW -> LD -> RD -> G
 *   STATS     BGM (nothing open) -> C -> ...
 *             OPP (nothing open) -> C -> ...  -> repeat
 *
 * The overview step at the head of each roster is what makes the walk
 * readable — you see the team whole before it starts drilling into it.
 *
 * Slots that cannot expand are dropped rather than held as dead stops, which
 * is what skips CPU rows. Goalie rows are never expandable today, so G is
 * skipped in practice; a roster with no expandable slot at all contributes no
 * leg, not a lone overview nobody can drill into.
 *
 * When the match has no OCR loadouts the whole LOADOUTS half is omitted and
 * the walk only cycles STATS — there is nothing on the other tab to show.
 *
 * There is no JS timer. The dwell bar's CSS animation IS the clock: `advance`
 * fires on its `animationend` and pausing is `animation-play-state: paused`,
 * which preserves elapsed time for free. A `setTimeout` alongside a CSS bar
 * would be two clocks that drift apart on every pause.
 *
 * Pauses on hover, focus, offscreen and tab-hidden; any deliberate click ends
 * it permanently (the prototype's `luOff` — "any deliberate click hands the
 * panel back to the user"). Disabled outright under reduced motion, matching
 * `luAutoOn() { return on && !this._reduceMotion }`: content that advances on
 * its own is motion regardless of how it is drawn.
 */
interface WalkStep {
  mode: GameSheetMode
  team: TeamKey
  /** null = the roster's overview step, with no drawer open. */
  pos: LineupPositionKey | null
}

const WALK_TEAMS: TeamKey[] = ['bgm', 'opp']

function buildWalkSequence(
  orders: Record<TeamKey, LineupPositionKey[]>,
  loadoutsAvailable: boolean,
): WalkStep[] {
  const modes: GameSheetMode[] = loadoutsAvailable ? ['loadouts', 'stats'] : ['stats']
  return modes.flatMap((mode) =>
    WALK_TEAMS.flatMap((team) => {
      const order = orders[team]
      if (order.length === 0) return []
      return [{ mode, team, pos: null }, ...order.map((pos) => ({ mode, team, pos }))]
    }),
  )
}

function useLineupAutoWalk({
  mode,
  team,
  openPos,
  orders,
  loadoutsAvailable,
  onAdvance,
}: {
  mode: GameSheetMode
  team: TeamKey
  openPos: LineupPositionKey | null
  orders: Record<TeamKey, LineupPositionKey[]>
  loadoutsAvailable: boolean
  onAdvance: (mode: GameSheetMode, team: TeamKey, pos: LineupPositionKey | null) => void
}): AutoWalk {
  const reduced = useReducedMotion()
  const [stopped, setStopped] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [offscreen, setOffscreen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [step, setStep] = useState(0)
  const panelEl = useRef<HTMLDivElement | null>(null)

  // Pause while the panel is off screen — a walk nobody is looking at only
  // burns frames, and it would otherwise be several slots along by the time it
  // scrolls back in.
  useEffect(() => {
    const el = panelEl.current
    if (el === null || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setOffscreen(!e.isIntersecting)
      },
      { threshold: 0.05 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
    }
  }, [])

  useEffect(() => {
    const sync = () => {
      setHidden(document.hidden)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  const on = !stopped && !reduced && buildWalkSequence(orders, loadoutsAvailable).length > 1
  const paused = hovered || offscreen || hidden

  const stop = useCallback(() => {
    setStopped(true)
  }, [])

  const advance = useCallback(() => {
    const steps = buildWalkSequence(orders, loadoutsAvailable)
    if (steps.length === 0) return
    const i = steps.findIndex((st) => st.mode === mode && st.team === team && st.pos === openPos)
    // Not found means the user moved things before we stopped; restart cleanly
    // from the top rather than guessing where we were.
    const next = steps[(i + 1) % steps.length]
    if (next !== undefined) onAdvance(next.mode, next.team, next.pos)
    setStep((s) => s + 1)
  }, [mode, team, openPos, orders, loadoutsAvailable, onAdvance])

  // Kick the walk off at its first step. The ref makes this fire exactly once —
  // `orders` and `onAdvance` are fresh values every render, and re-running
  // would fight the user's own selection.
  const kicked = useRef(false)
  useEffect(() => {
    if (!on || kicked.current) return
    kicked.current = true
    const first = buildWalkSequence(orders, loadoutsAvailable)[0]
    if (first !== undefined) onAdvance(first.mode, first.team, first.pos)
  }, [on, orders, loadoutsAvailable, onAdvance])

  return {
    on,
    paused,
    step,
    advance,
    stop,
    setHovered,
    panelRef: (el) => {
      panelEl.current = el
    },
  }
}

/** Expandable slots for one team, canonical order — that team's walk leg. */
function expandableOrder(
  byPos: Map<LineupPositionKey, LineupRow>,
  stats: LineupModuleStatRow[],
  team: TeamKey,
  variant: 'ocr' | 'boxScore',
): LineupPositionKey[] {
  return POSITIONS.filter((position) => {
    const row = byPos.get(position) ?? null
    if (row === null) return false
    return buildSlotVM({ position, row, variant, stat: findStat(stats, team, row), gs: null })
      .expandable
  })
}

function TeamButton({
  active,
  activeClass,
  onClick,
  children,
}: {
  active: boolean
  activeClass: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`relative z-[1] flex-1 truncate px-1 font-condensed text-[13px] font-extrabold uppercase tracking-[0.14em] transition-colors ${
        active ? activeClass : 'text-fg-4 hover:text-fg-2'
      }`}
    >
      {children}
    </button>
  )
}

function HeaderKV({ k, v, dim = false }: { k: string; v: string; dim?: boolean }) {
  return (
    <span className="flex flex-col gap-px">
      <span className="font-condensed text-[12px] font-semibold uppercase leading-none tracking-[0.14em] text-fg-4">
        {k}
      </span>
      <span
        className={`truncate font-condensed text-[13px] font-extrabold uppercase tabular-nums ${
          dim ? 'text-fg-4' : 'text-fg-2'
        }`}
      >
        {v}
      </span>
    </span>
  )
}

// ─── Build mix ───────────────────────────────────────────────────────────────

interface BuildMixChip {
  key: string
  /** Canonical build (e.g. "Sniper"). */
  build: string
  /** Reference player when the build is a "Cole Caufield - Sniper" style pick. */
  ref: string | null
  /** How many skaters share this exact build+ref. */
  count: number
}

/**
 * Collapse a roster's builds into ordered chips: `2× PMD`, `SNP`, `PLY`.
 *
 * Order is first-appearance in the canonical C→LW→RW→LD→RD→G sequence the
 * rows already arrive in. (The pre-revamp version claimed that order in a
 * comment but emitted every reference build ahead of every bare one, which
 * scrambled it — that split is gone.) Reference builds key on build+ref so
 * two different Snipers don't merge into one chip.
 */
function summarizeBuilds(rows: LineupRow[]): BuildMixChip[] {
  const byKey = new Map<string, BuildMixChip>()
  for (const r of rows) {
    const { build, ref } = splitBuild(r)
    if (!build || build === 'Unknown build') continue
    const key = ref ? `ref:${ref}:${build}` : `bare:${build}`
    const existing = byKey.get(key)
    if (existing) existing.count++
    else byKey.set(key, { key, build, ref, count: 1 })
  }
  return [...byKey.values()]
}

function BuildMixChip({ chip }: { chip: BuildMixChip }) {
  const archetype = buildToArchetype(chip.build)
  return (
    <span className="inline-flex items-center gap-1.5">
      {chip.count > 1 ? (
        <span className="font-condensed text-[12px] font-bold tabular-nums text-fg-4">
          {chip.count}×
        </span>
      ) : null}
      {archetype !== null ? (
        <ArchetypePillCompact archetype={archetype} />
      ) : (
        <span className="border border-border bg-background px-2 py-[3px] font-condensed text-[12px] font-bold uppercase leading-none tracking-[0.08em] text-fg-2">
          {chip.build}
        </span>
      )}
    </span>
  )
}

// ─── Slot view-model ─────────────────────────────────────────────────────────

function buildSlotVM(args: {
  position: LineupPositionKey
  row: LineupRow | null
  variant: 'ocr' | 'boxScore'
  stat: LineupModuleStatRow | null
  gs: number | null
}): LineupSlotVM {
  const { position, row, variant, stat, gs } = args
  const isDefense = position === 'LD' || position === 'RD'
  // EA doesn't split defence into L/R, so box-score slots read a neutral "D".
  const posLabel = variant === 'boxScore' && isDefense ? 'D' : position

  if (row === null) {
    return {
      position,
      posLabel,
      human: false,
      persona: null,
      handle: null,
      isCaptain: false,
      jersey: null,
      archetype: null,
      buildLabel: null,
      buildRef: null,
      physLine: null,
      platform: null,
      xFactors: [],
      gs: null,
      statTiles: skaterTiles(null),
      hasLoadout: false,
      expandable: false,
    }
  }

  const gamertag = row.player?.gamertag ?? row.gamertagSnapshot ?? stat?.gamertag ?? null
  // Persona = the lobby-state-2 in-game name ("M. Rantanen"). Deliberately no
  // fallback to the long-form loadout-view name — gamertag reads consistent.
  const persona = row.playerNamePersona ?? gamertag
  const handle =
    gamertag !== null && persona !== null && gamertag.toLowerCase() !== persona.toLowerCase()
      ? gamertag
      : null

  const { build, ref } = splitBuild(row)
  const archetype = buildToArchetype(build)
  // OCR mode keeps junk-but-present builds visible as a text chip; box-score
  // mode never fabricates one (an unknown build there means "not captured").
  const buildLabel =
    variant === 'ocr' && archetype === null && build !== 'Unknown build' ? build : null

  const hwh = formatHWH(row.heightText, row.weightLbs, row.handedness)
  const levelPart =
    row.playerLevelNumber !== null
      ? `${row.playerPrestigeNumber !== null ? `P${row.playerPrestigeNumber.toString()}·` : ''}L${row.playerLevelNumber.toString()}`
      : null
  const physLine = [hwh, levelPart].filter(Boolean).join(' · ') || null
  const hasLoadout = row.attributes !== null && Object.keys(row.attributes).length > 0

  return {
    position,
    posLabel,
    human: true,
    persona,
    handle,
    isCaptain: row.isCaptain === true,
    jersey: row.playerNumber,
    archetype,
    buildLabel,
    // Reference builds only exist in OCR mode; box-score rows never carry one.
    buildRef: variant === 'ocr' ? ref : null,
    physLine,
    platform: resolvePlatform(row.platform),
    xFactors: row.xFactors,
    gs,
    statTiles: position === 'G' ? goalieTiles(stat) : skaterTiles(stat),
    hasLoadout,
    // The stats drawer is EA-backed, so box-score-variant rows expand too —
    // any human skater with a stat row or a loadout snapshot drills down.
    expandable: position !== 'G' && (stat !== null || hasLoadout),
  }
}

const SKATER_TILE_LABELS = ['G', 'A', 'PTS', '±', 'SOG', 'HIT', 'BLK'] as const
/** Interim narrow-width rule: keep G/A/PTS, hide the rest below `sm` (full responsive pass is Phase 10). */
const COLLAPSIBLE_LABELS = new Set(['±', 'SOG', 'HIT', 'BLK'])

function skaterTiles(stat: LineupModuleStatRow | null): LineupStatTile[] {
  if (stat === null) {
    return SKATER_TILE_LABELS.map((label) => ({
      label,
      value: '—',
      tone: 'muted',
      collapsible: COLLAPSIBLE_LABELS.has(label),
    }))
  }
  const pm = stat.plusMinus
  return [
    { label: 'G', value: stat.goals.toString(), tone: 'base' },
    { label: 'A', value: stat.assists.toString(), tone: 'base' },
    { label: 'PTS', value: (stat.goals + stat.assists).toString(), tone: 'lead' },
    {
      label: '±',
      value: pm > 0 ? `+${pm.toString()}` : pm.toString(),
      tone: pm > 0 ? 'win' : pm < 0 ? 'loss' : 'zero',
      collapsible: true,
    },
    { label: 'SOG', value: stat.shots.toString(), tone: 'dim', collapsible: true },
    { label: 'HIT', value: stat.hits.toString(), tone: 'dim', collapsible: true },
    { label: 'BLK', value: stat.blockedShots.toString(), tone: 'dim', collapsible: true },
  ]
}

function goalieTiles(stat: LineupModuleStatRow | null): LineupStatTile[] {
  if (stat === null || (stat.saves === null && stat.shotsAgainst === null)) {
    return [
      { label: 'SV', value: '—', tone: 'muted' },
      { label: 'GA', value: '—', tone: 'muted' },
      { label: 'SV%', value: '—', tone: 'muted' },
    ]
  }
  // Per-field, not per-row: a partially captured goalie line used to coerce its
  // missing fields to 0, which reads as "faced nothing" instead of "not
  // captured". — = no data, 0 = a real zero (the page-wide glyph rule).
  const { saves, shotsAgainst, goalsAgainst } = stat
  const savePct =
    saves !== null && shotsAgainst !== null && shotsAgainst > 0
      ? ((saves / shotsAgainst) * 100).toFixed(1)
      : null
  return [
    { label: 'SV', value: saves?.toString() ?? '—', tone: saves === null ? 'muted' : 'base' },
    {
      label: 'GA',
      value: goalsAgainst?.toString() ?? '—',
      tone: goalsAgainst === null ? 'muted' : 'dim',
    },
    { label: 'SV%', value: savePct ?? '—', tone: savePct === null ? 'muted' : 'lead' },
  ]
}

// ─── Lookups ─────────────────────────────────────────────────────────────────

/**
 * Gamertag join key: lowercase, whitespace stripped. OCR loses spaces in
 * tags ("RAIDERS G7" is snapshotted as "RAIDERSG7"), so an exact-lower match
 * would strand real players without stats.
 */
function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/\s+/g, '')
}

function findStat(
  stats: LineupModuleStatRow[],
  team: TeamKey,
  row: LineupRow,
): LineupModuleStatRow | null {
  if (team === 'bgm' && row.player) {
    const byId = stats.find((s) => s.playerId === row.player?.id)
    if (byId) return byId
  }
  const tag = normalizeTag(row.gamertagSnapshot ?? row.player?.gamertag ?? '')
  if (!tag) return null
  return stats.find((s) => normalizeTag(s.gamertag) === tag) ?? null
}

function findScore(scores: PlayerScoreEntry[], team: TeamKey, row: LineupRow): number | null {
  const side = team
  if (team === 'bgm' && row.player) {
    const byId = scores.find((s) => s.side === 'bgm' && s.playerId === row.player?.id)
    if (byId) return byId.score
  }
  const tag = normalizeTag(row.gamertagSnapshot ?? row.player?.gamertag ?? '')
  if (!tag) return null
  return scores.find((s) => s.side === side && normalizeTag(s.gamertag) === tag)?.score ?? null
}

// ─── Helpers lifted from the donor lineup-section (deleted in Phase 11) ──────

const JUNK_GAMERTAG_TOKENS = new Set(['away', 'home', 'cpu', '?', '(unknown)'])

/**
 * OCR-noise guard: a row with no build, no jersey AND no X-Factors is almost
 * certainly noise — treat the slot as CPU. Box-score rows are authoritative
 * (they came from the final stats) and bypass the guard.
 */
function isRenderable(row: LineupRow): boolean {
  const tag = (row.gamertagSnapshot ?? '').trim()
  if (!tag || JUNK_GAMERTAG_TOKENS.has(tag.toLowerCase())) return false
  return (
    row.buildClass !== null ||
    row.buildClassCanonical !== null ||
    row.playerNumber !== null ||
    row.xFactors.length > 0
  )
}

function bucketByPosition(
  rows: LineupRow[],
  variant: 'ocr' | 'boxScore',
): Map<LineupPositionKey, LineupRow> {
  const map = new Map<LineupPositionKey, LineupRow>()
  for (const r of rows) {
    if (!r.position) continue
    if (variant === 'ocr' && !isRenderable(r)) continue
    const pos = r.position as LineupPositionKey
    if (POSITIONS.includes(pos) && !map.has(pos)) map.set(pos, r)
  }
  return map
}

function buildToArchetype(build: string): PlayerArchetype | null {
  switch (build) {
    case 'Playmaker':
      return 'playmaker'
    case 'Sniper':
      return 'sniper'
    case 'Power Forward':
      return 'power-forward'
    case 'Grinder':
      return 'grinder'
    case 'Two-Way Forward':
      return 'two-way-fwd'
    case 'Puck Moving Defenseman':
      return 'puckmover'
    case 'Defensive Defenseman':
      return 'defensive-d'
    case 'Offensive Defenseman':
      return 'offensive-d'
    default:
      return null
  }
}

function formatHWH(
  height: string | null,
  weightLbs: number | null,
  handedness: string | null,
): string {
  const parts: string[] = []
  if (height) parts.push(height)
  if (weightLbs !== null) parts.push(`${weightLbs.toString()} lb`)
  if (handedness) parts.push(handedness.charAt(0).toUpperCase())
  return parts.join(' · ')
}
