'use client'

import { useId, useState, type ReactNode } from 'react'
import Image from 'next/image'
import type { LineupRow, MatchLineups } from '@eanhl/db/queries'
import type { PlayerArchetype } from '@eanhl/db/schema'
import { useGameSheetMode } from '@/components/matches/game-sheet-mode'
import { OpponentCrest } from '@/components/ui/opponent-crest'
import { splitBuild, type HeadToHeadStatLine } from '@/lib/head-to-head'
import { delayVar } from '@/lib/motion'
import type { PlayerScoreEntry } from '@/lib/match-recap'
import { DrawerLoadout } from './drawer-loadout'
import { DrawerStats } from './drawer-stats'
import {
  LineupModuleRow,
  type LineupPositionKey,
  type LineupSlotVM,
  type LineupStatTile,
} from './lineup-row'

// Lineup · Scouting — the prototype's one-roster-at-a-time lineup module.
// A BGM|OPP segmented control picks which team's six rows are browsed; the
// LOADOUTS|STATS page mode (context) decides what each row trails with.
// Opening a row renders the position head-to-head drawer: the build compare
// in LOADOUTS mode (falling back to the EA-backed stats drawer when no
// loadout snapshot exists — never a dead-end card), match stats in STATS.

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
  const { mode } = useGameSheetMode()
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

  const dressed = slots.filter((s) => s.human).length
  const goalieSlot = slots.find((s) => s.position === 'G')
  const goalieLabel = goalieSlot?.human ? (goalieSlot.persona ?? goalieSlot.handle ?? 'CPU') : 'CPU'
  const activeName = team === 'bgm' ? 'Boogeymen' : opponentName

  return (
    <section className="space-y-2">
      <div className="border border-border bg-surface">
        {/* Header: identity · team switch */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-3.5 pb-3 pt-3">
          <div className="flex min-w-0 flex-col gap-2">
            <h2 className="font-condensed text-[11px] font-extrabold uppercase tracking-[0.18em] text-fg-3">
              Lineup · Scouting
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
            {slots.some((s) => s.expandable) ? (
              <p className="font-condensed text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-3">
                {variant === 'ocr'
                  ? 'Tap a skater for full loadout and match stats'
                  : 'Tap a skater for full match stats'}
              </p>
            ) : null}
          </div>

          {/* BGM | OPP sliding-thumb team switch — opponent side rides --opp */}
          <div
            role="group"
            aria-label="Roster shown"
            className="relative h-10 w-[210px] flex-none border border-border bg-charcoal p-[3px]"
          >
            <span
              aria-hidden
              className={`gs-thumb absolute bottom-[3px] left-[3px] top-[3px] w-[calc(50%-3px)] ${
                team === 'bgm'
                  ? 'translate-x-0 bg-accent [box-shadow:0_0_14px_rgba(232,65,49,0.25)]'
                  : 'translate-x-full border [background:var(--opp-soft)] [border-color:var(--opp-line)]'
              }`}
            />
            <div className="relative flex h-full">
              <TeamButton
                active={team === 'bgm'}
                activeClass="text-white"
                onClick={() => {
                  setTeam('bgm')
                }}
              >
                BGM
              </TeamButton>
              <TeamButton
                active={team === 'opp'}
                activeClass="[color:var(--opp)]"
                onClick={() => {
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
            const bgmRow = bgmByPos.get(slot.position) ?? null
            const oppRow = oppByPos.get(slot.position) ?? null
            return (
              <div key={slot.position} className="gs-row-in" style={delayVar(slotIndex * 45)}>
                <LineupModuleRow
                  slot={slot}
                  mode={mode}
                  isOpen={isOpen}
                  panelId={panelId}
                  onToggle={() => {
                    setOpenPos((prev) => (prev === slot.position ? null : slot.position))
                  }}
                />
                {isOpen ? (
                  <div id={panelId}>
                    {mode === 'loadouts' && slot.hasLoadout ? (
                      <DrawerLoadout
                        posLabel={slot.posLabel}
                        bgmRow={bgmRow}
                        oppRow={oppRow}
                        oppAbbrev={opponentAbbrev}
                      />
                    ) : (
                      <DrawerStats
                        posLabel={slot.posLabel}
                        bgmRow={bgmRow}
                        oppRow={oppRow}
                        bgmStat={bgmRow ? findStat(bgmStats, 'bgm', bgmRow) : null}
                        oppStat={oppRow ? findStat(oppStats, 'opp', oppRow) : null}
                        tappedSide={team}
                        loadoutFallback={mode === 'loadouts'}
                        oppAbbrev={opponentAbbrev}
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
        active ? activeClass : 'text-fg-3 hover:text-fg-2'
      }`}
    >
      {children}
    </button>
  )
}

function HeaderKV({ k, v, dim = false }: { k: string; v: string; dim?: boolean }) {
  return (
    <span className="flex flex-col gap-px">
      <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.14em] text-fg-3">
        {k}
      </span>
      <span
        className={`truncate font-condensed text-[13px] font-extrabold uppercase tabular-nums ${
          dim ? 'text-fg-3' : 'text-fg-2'
        }`}
      >
        {v}
      </span>
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
      physLine: null,
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

  const { build } = splitBuild(row)
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
    physLine,
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
      tone: pm > 0 ? 'win' : pm < 0 ? 'loss' : 'dim',
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
