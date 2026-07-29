// View-model builders for the /games/[id] match recap page.
//
// All formula logic and section-readiness rules live here so the page and
// components stay thin. Every "computed" output keeps its inputs visible so
// the UI can label and surface them honestly.

import type { Match, PlayerArchetype } from '@eanhl/db'
import type {
  LineupRow,
  MatchPeriodSummaryRow,
  getOpponentPlayerMatchStats,
  getPlayerMatchStats,
} from '@eanhl/db/queries'

type PlayerStatBase = Awaited<ReturnType<typeof getPlayerMatchStats>>[number]
type OpponentPlayerStatBase = Awaited<ReturnType<typeof getOpponentPlayerMatchStats>>[number]

interface AdvancedSkaterFields {
  deflections: number
  interceptions: number
  possession: number
  penaltiesDrawn: number
  saucerPasses: number
}

export type PlayerStat = PlayerStatBase & AdvancedSkaterFields
export type OpponentPlayerStat = OpponentPlayerStatBase & AdvancedSkaterFields

// ─── Score factors & player score entries ─────────────────────────────────────
//
// Every score is decomposed into a visible list of weighted factors so the UI
// can show exactly where the number came from. No hidden multipliers.

export interface ScoreFactor {
  label: string
  /** Raw stat value (integer or decimal). */
  value: number
  /** Weight applied to produce contribution. */
  weight: number
  /** value × weight — positive helps, negative hurts. */
  contribution: number
}

export interface PlayerScoreInlineStats {
  goals: number
  assists: number
  plusMinus: number
  shots: number
  hits: number
  faceoffPct: number | null
  toiSeconds: number | null
  saves: number | null
  shotsAgainst: number | null
}

export interface PlayerScoreEntry {
  /** 'bgm' = internal player, linkable to /roster/[id]. 'opp' = no profile. */
  side: 'bgm' | 'opp'
  /** BGM player DB id. null for opponent entries. */
  playerId: number | null
  /** EA persona id. Populated for opponent rows; null for BGM. */
  eaPlayerId: string | null
  gamertag: string
  position: string | null
  isGoalie: boolean
  score: number
  statLine: string
  breakdown: ScoreFactor[]
  /** Per-match raw stats — used by the flat ranked table's inline columns. */
  stats: PlayerScoreInlineStats
  /** Manual profile data — only populated for BGM players. */
  jerseyNumber: number | null
  archetype: PlayerArchetype | null
}

function winningSide(
  match: Pick<Match, 'result' | 'scoreFor' | 'scoreAgainst'>,
): 'bgm' | 'opp' | null {
  if (match.result === 'DNF') return null
  if (match.scoreFor > match.scoreAgainst) return 'bgm'
  if (match.scoreAgainst > match.scoreFor) return 'opp'
  return null
}

function hasRecordedActivity(
  p: {
    isGoalie: boolean
    goals: number
    assists: number
    plusMinus: number
  } & SkaterScoreInput &
    GoalieScoreInput,
): boolean {
  if (p.isGoalie) {
    return (
      (p.saves ?? 0) > 0 ||
      (p.goalsAgainst ?? 0) > 0 ||
      (p.shotsAgainst ?? 0) > 0 ||
      (p.despSaves ?? 0) > 0 ||
      (p.breakawaySaves ?? 0) > 0 ||
      (p.penSaves ?? 0) > 0 ||
      (p.pokechecks ?? 0) > 0
    )
  }

  return (
    p.goals > 0 ||
    p.assists > 0 ||
    p.plusMinus !== 0 ||
    p.shots > 0 ||
    p.hits > 0 ||
    p.interceptions > 0 ||
    p.blockedShots > 0 ||
    p.takeaways > 0 ||
    p.giveaways > 0 ||
    p.faceoffWins > 0 ||
    p.faceoffLosses > 0 ||
    p.penaltiesDrawn > 0 ||
    p.pim > 0
  )
}

// ─── Skater scoring ───────────────────────────────────────────────────────────
//
// Philosophy: two-way / puck-management-sensitive.
// Offense still leads (goals + assists are the primary driver), but the score
// intentionally reinforces defensive habits and punishes sloppy possession.
//
// Tier 1 — core offense:        goals (+4.0), assists (+3.25)   ratio 1.23:1
// Tier 2 — strong positive:     takeaways (+0.55), interceptions (+0.45),
//                                blocked shots (+0.45), penalties drawn (+0.40)
// Tier 3 — strong negative:     giveaways (−0.45), penalty min (−0.30)
// Tier 4 — light context only:  shots (+0.12), +/- (+0.20), hits (+0.08),
//                                faceoff net (+0.08)
//
// G:A ratio 1.23:1 — Luszczyszyn-inspired range (1.15–1.56 across published models);
// EA does not distinguish primary vs secondary assists so one weight is used for both.
// Takeaways/interceptions/blocks replace Corsi as the possession-quality signal
// (published models use shot-attempt differential, which we do not have).
//
// Reference scores: 2G 1A +2, tidy → ~14  •  0G 5A, clean → ~18  •  grind D → ~5

interface SkaterScoreInput {
  goals: number
  assists: number
  plusMinus: number
  shots: number
  hits: number
  interceptions: number
  blockedShots: number
  takeaways: number
  giveaways: number
  faceoffWins: number
  faceoffLosses: number
  penaltiesDrawn: number
  pim: number
}

interface GoalieScoreInput {
  saves: number | null
  goalsAgainst: number | null
  shotsAgainst: number | null
  despSaves: number | null
  breakawaySaves: number | null
  penSaves: number | null
  pokechecks: number | null
}

function f(label: string, value: number, weight: number): ScoreFactor {
  return { label, value, weight, contribution: value * weight }
}

function skaterBreakdown(p: SkaterScoreInput): ScoreFactor[] {
  const foNet = p.faceoffWins - p.faceoffLosses
  return [
    // Tier 1 — core offense
    f('Goals', p.goals, 4.0),
    f('Assists', p.assists, 3.25),
    // Tier 2 — strong positive support (puck-winning / defensive impact)
    f('Takeaways', p.takeaways, 0.55),
    f('Interceptions', p.interceptions, 0.45),
    f('Blocked Shots', p.blockedShots, 0.45),
    f('Penalties Drawn', p.penaltiesDrawn, 0.4),
    // Tier 3 — strong negative drag (sloppy possession / undisciplined play)
    f('Giveaways', p.giveaways, -0.45),
    f('Penalty Min', p.pim, -0.3),
    // Tier 4 — light context modifiers (present but not scoreboard drivers)
    f('Shots', p.shots, 0.12),
    f('+/-', p.plusMinus, 0.2),
    f('Hits', p.hits, 0.08),
    f('FO Net', foNet, 0.08),
  ]
}

function goalieBreakdown(p: GoalieScoreInput): ScoreFactor[] {
  const saves = p.saves ?? 0
  const ga = p.goalsAgainst ?? 0
  const sa = p.shotsAgainst ?? 0
  const svPct = sa > 0 ? saves / sa : 0
  return [
    f('Saves', saves, 0.2),
    // SV% stored as 0–1; multiplied by 15 so .920 → +13.8 (dominant factor)
    f('SV%', svPct, 15),
    f('Goals Against', ga, -0.8),
    f('Desp. Saves', p.despSaves ?? 0, 0.5),
    f('Breakaway Saves', p.breakawaySaves ?? 0, 0.8),
    f('Pen. Shot Saves', p.penSaves ?? 0, 0.8),
    f('Pokechecks', p.pokechecks ?? 0, 0.15),
  ]
}

// ─── Stat lines ───────────────────────────────────────────────────────────────

interface SkaterStatInput {
  goals: number
  assists: number
  plusMinus: number
}
interface GoalieStatInput {
  saves: number | null
  shotsAgainst: number | null
}

function skaterStatLine(p: SkaterStatInput): string {
  const pm = p.plusMinus >= 0 ? `+${p.plusMinus.toString()}` : p.plusMinus.toString()
  return `${p.goals.toString()}G ${p.assists.toString()}A ${pm}`
}

function goalieStatLine(p: GoalieStatInput): string {
  const saves = p.saves ?? 0
  const sa = p.shotsAgainst ?? 0
  if (sa <= 0) return `${saves.toString()} SV`
  return `${formatSavePct(saves / sa)} SV% · ${saves.toString()} SV`
}

// ─── Loadout-OCR overrides (position / jersey / archetype) ───────────────────
//
// Per-match position, jersey number, and player-archetype come from the
// pre-game loadout OCR when available (`getMatchLineups`). The EA payload
// only carries position; jersey and archetype are otherwise sourced from
// the manual `player_profiles` table. We prefer OCR whenever it's present
// because it reflects what the player actually used in THIS match, not a
// stale profile entry.
//
// Precedence (per field):
//   1. Loadout OCR (this match)
//   2. EA `playerMatchStats.position` / `player_profiles.{jerseyNumber,archetype}`
//   3. null

/** Loadout OCR uses short position codes; the rest of the app uses EA's full keys. */
const OCR_POSITION_TO_EA: Record<string, string> = {
  C: 'center',
  LW: 'leftWing',
  RW: 'rightWing',
  LD: 'leftDefenseMen',
  RD: 'rightDefenseMen',
  G: 'goalie',
}

/**
 * Map EA's canonical 8-build-class names (with optional "[Reference Player - ]"
 * prefix from the loadout view) to the project's 11-archetype taxonomy.
 * Returns null when the OCR string isn't a known build.
 */
const BUILD_TO_ARCHETYPE: Record<string, PlayerArchetype> = {
  Playmaker: 'playmaker',
  Sniper: 'sniper',
  Grinder: 'grinder',
  'Two-Way Forward': 'two-way-fwd',
  'Power Forward': 'power-forward',
  'Puck Moving Defenseman': 'puckmover',
  'Defensive Defenseman': 'defensive-d',
  'Offensive Defenseman': 'offensive-d',
}

export function buildClassToArchetype(canonical: string | null): PlayerArchetype | null {
  if (canonical === null) return null
  // Strip optional "Reference Player - " prefix: "Cole Caufield - Sniper" → "Sniper".
  const parts = canonical.split(/\s*-\s*/)
  const build = (parts.length > 1 ? (parts[parts.length - 1] ?? canonical) : canonical).trim()
  return BUILD_TO_ARCHETYPE[build] ?? null
}

/**
 * Augment player-stat rows with per-match loadout OCR overrides. Returns
 * new arrays — input arrays are not mutated. Each row's `position`,
 * `jerseyNumber`, and `archetype` use the loadout value when available,
 * otherwise the row's existing value (EA position / profile fields), else null.
 *
 * Matching key:
 *   - BGM rows: `playerId` (resolved on the loadout snapshot's `player.id`)
 *   - Opponent rows: case-insensitive gamertag
 */
export function applyLoadoutOverrides<
  T extends {
    playerId?: number | null
    eaPlayerId?: string | null
    gamertag: string
    position: string | null
    jerseyNumber?: number | null
    archetype?: PlayerArchetype | null
  },
>(rows: T[], lineupRows: LineupRow[]): T[] {
  if (lineupRows.length === 0) return rows
  const byPlayerId = new Map<number, LineupRow>()
  const byGamertag = new Map<string, LineupRow>()
  for (const row of lineupRows) {
    if (row.player?.id != null) byPlayerId.set(row.player.id, row)
    if (row.gamertagSnapshot) byGamertag.set(row.gamertagSnapshot.toLowerCase(), row)
  }
  return rows.map((row) => {
    const match =
      (row.playerId != null ? byPlayerId.get(row.playerId) : undefined) ??
      byGamertag.get(row.gamertag.toLowerCase())
    if (!match) return row
    const ocrPosition = match.position ? (OCR_POSITION_TO_EA[match.position] ?? null) : null
    const archetype = buildClassToArchetype(match.buildClassCanonical)
    return {
      ...row,
      position: ocrPosition ?? row.position,
      jerseyNumber: match.playerNumber ?? row.jerseyNumber ?? null,
      archetype: archetype ?? row.archetype ?? null,
    }
  })
}

// ─── Box-score lineup fallback (matches with no pre-game loadout OCR) ─────────
//
// Only a handful of matches have OCR'd pre-game loadout snapshots. For every
// other match we still know who dressed and in what position from the box
// score, plus jersey # + archetype from the manual profile (BGM only). We
// synthesize LineupRow[] from that so the Lineup & Loadouts section renders a
// real lineup (in its lean "box score" variant) instead of all-CPU placeholders.

/** Inverse of BUILD_TO_ARCHETYPE — the canonical build label for an archetype. */
const ARCHETYPE_TO_BUILD_LABEL: Partial<Record<PlayerArchetype, string>> = {
  playmaker: 'Playmaker',
  sniper: 'Sniper',
  grinder: 'Grinder',
  'two-way-fwd': 'Two-Way Forward',
  'power-forward': 'Power Forward',
  puckmover: 'Puck Moving Defenseman',
  'defensive-d': 'Defensive Defenseman',
  'offensive-d': 'Offensive Defenseman',
}

/** EA long-form skater/goalie positions → ladder slot (defense handled separately). */
const EA_POSITION_TO_LADDER_SLOT: Record<string, 'C' | 'LW' | 'RW' | 'G'> = {
  center: 'C',
  leftWing: 'LW',
  rightWing: 'RW',
  goalie: 'G',
}

/** Minimal stat shape both getPlayerMatchStats and getOpponentPlayerMatchStats satisfy. */
export interface LineupStatSource {
  playerId?: number | null
  gamertag: string
  position: string | null
  isGoalie: boolean
  jerseyNumber?: number | null
  archetype?: PlayerArchetype | null
}

/**
 * Build a lineup (LineupRow[]) from box-score player stats. Everything
 * OCR-specific (build detail, X-Factors, attributes, H/W/H, level, platform)
 * is null — the section renders these rows in its lean "box score" variant.
 *
 * EA reports both defencemen as `defenseMen` with no L/R split, so they fill
 * the LD then RD ladder slots in stat order; the section labels both slots "D".
 */
export function buildLineupFromStats(
  rows: LineupStatSource[],
  side: 'bgm' | 'opp',
  capturedAt: Date,
): LineupRow[] {
  let defenseSeen = 0
  const out: LineupRow[] = []
  for (const r of rows) {
    let position: 'C' | 'LW' | 'RW' | 'LD' | 'RD' | 'G' | null
    if (r.position === 'defenseMen') {
      position = defenseSeen === 0 ? 'LD' : defenseSeen === 1 ? 'RD' : null
      defenseSeen++
    } else {
      position = EA_POSITION_TO_LADDER_SLOT[r.position ?? ''] ?? null
    }
    if (position === null) continue
    const archetype = r.archetype ?? null
    out.push({
      snapshotId: -(out.length + 1),
      gamertagSnapshot: r.gamertag,
      playerNameSnapshot: null,
      playerNamePersona: null,
      playerNumber: r.jerseyNumber ?? null,
      isCaptain: null,
      position,
      buildClass: null,
      buildClassCanonical: archetype ? (ARCHETYPE_TO_BUILD_LABEL[archetype] ?? null) : null,
      heightText: null,
      weightLbs: null,
      handedness: null,
      playerLevelNumber: null,
      playerLevelRaw: null,
      playerPrestigeNumber: null,
      platform: null,
      capturedAt,
      player:
        side === 'bgm' && r.playerId != null ? { id: r.playerId, gamertag: r.gamertag } : null,
      xFactors: [],
      attributes: null,
    })
  }
  return out
}

// ─── Top Performers (BGM-only, for the three star cards) ─────────────────────

export interface TopPerformer {
  side: 'bgm' | 'opp'
  playerId: number | null
  eaPlayerId: string | null
  gamertag: string
  position: string | null
  isGoalie: boolean
  statLine: string
  score: number
  /** Per-factor breakdown — fed to the star card's segment bar. */
  breakdown: ScoreFactor[]
  /** Per-match raw stats — fed to the card's inline stat line. */
  stats: PlayerScoreInlineStats
  jerseyNumber: number | null
  archetype: PlayerArchetype | null
}

export function buildTopPerformers(
  match: Pick<Match, 'result' | 'scoreFor' | 'scoreAgainst'>,
  bgm: PlayerStat[],
  opponent: OpponentPlayerStat[],
): TopPerformer[] {
  return buildAllTeamScores(match, bgm, opponent)
    .slice(0, 3)
    .map((entry) => ({
      side: entry.side,
      playerId: entry.playerId,
      eaPlayerId: entry.eaPlayerId,
      gamertag: entry.gamertag,
      position: entry.position,
      isGoalie: entry.isGoalie,
      statLine: entry.statLine,
      score: entry.score,
      breakdown: entry.breakdown,
      stats: entry.stats,
      jerseyNumber: entry.jerseyNumber,
      archetype: entry.archetype,
    }))
}

// ─── Season-to-date average composite score (for "vs season avg" delta) ──────
//
// The DB query returns raw player_match_stats rows for the BGM players plus
// the host match's score/result. We re-use the same skaterBreakdown /
// goalieBreakdown + Win Bonus rule the per-match score uses — single source
// of truth, no formula drift between "current match score" and "season avg".

/**
 * Shape of one row returned by `getSeasonPlayerMatchStats`. Only the fields
 * the score formula touches are required here; the query may return more.
 */
export interface SeasonPlayerMatchRow extends SkaterScoreInput, GoalieScoreInput {
  playerId: number | null
  isGoalie: boolean
  scoreFor: number
  scoreAgainst: number
  result: Match['result']
}

export function computeSeasonAvgs(
  rows: SeasonPlayerMatchRow[],
): Map<number, { avgScore: number; gp: number }> {
  const acc = new Map<number, { sum: number; gp: number }>()
  for (const row of rows) {
    if (row.playerId === null) continue
    const breakdown = row.isGoalie ? goalieBreakdown(row) : skaterBreakdown(row)
    // Win bonus mirrors `winningSide` + `toEntry`: DNF and ties get no bonus.
    const bgmWon = row.result !== 'DNF' && row.scoreFor > row.scoreAgainst
    const score = breakdown.reduce((s, fac) => s + fac.contribution, 0) + (bgmWon ? 1.0 : 0)
    const prev = acc.get(row.playerId) ?? { sum: 0, gp: 0 }
    acc.set(row.playerId, { sum: prev.sum + score, gp: prev.gp + 1 })
  }
  const result = new Map<number, { avgScore: number; gp: number }>()
  for (const [playerId, { sum, gp }] of acc) {
    result.set(playerId, { avgScore: gp > 0 ? sum / gp : 0, gp })
  }
  return result
}

export interface TopPerformerWithDelta extends TopPerformer {
  /**
   * Signed delta vs the player's season-to-date average score, before this
   * match. null for opponent players (no profile / no history tracked) and
   * for BGM players with zero prior games in the current game-title.
   */
  vsSeasonAvg: number | null
}

export function attachSeasonAvgs(
  performers: TopPerformer[],
  seasonAvgs: Map<number, { avgScore: number; gp: number }>,
): TopPerformerWithDelta[] {
  return performers.map((p) => {
    if (p.side !== 'bgm' || p.playerId === null) {
      return { ...p, vsSeasonAvg: null }
    }
    const avg = seasonAvgs.get(p.playerId)
    if (!avg || avg.gp === 0) {
      return { ...p, vsSeasonAvg: null }
    }
    return { ...p, vsSeasonAvg: p.score - avg.avgScore }
  })
}

// ─── All-team ranked scores (BGM + opponent) ──────────────────────────────────
//
// Used by the "Show all player scores" expanded section. Includes full
// breakdown for every entry. Opponent entries have playerId=null (no profile).

function toEntry(
  side: 'bgm' | 'opp',
  winner: 'bgm' | 'opp' | null,
  playerId: number | null,
  eaPlayerId: string | null,
  p: {
    gamertag: string
    position: string | null
    isGoalie: boolean
    goals: number
    assists: number
    plusMinus: number
    toiSeconds?: number | null
    jerseyNumber?: number | null
    archetype?: PlayerArchetype | null
  } & SkaterScoreInput &
    GoalieScoreInput,
): PlayerScoreEntry {
  const breakdown = p.isGoalie ? goalieBreakdown(p) : skaterBreakdown(p)
  if (winner === side) {
    breakdown.push(f('Win Bonus', 1, 1.0))
  }
  const score = breakdown.reduce((s, fac) => s + fac.contribution, 0)
  const foAttempts = p.faceoffWins + p.faceoffLosses
  const faceoffPct = foAttempts > 0 ? (p.faceoffWins / foAttempts) * 100 : null
  return {
    side,
    playerId,
    eaPlayerId,
    gamertag: p.gamertag,
    position: p.position,
    isGoalie: p.isGoalie,
    score,
    statLine: p.isGoalie ? goalieStatLine(p) : skaterStatLine(p),
    breakdown,
    stats: {
      goals: p.goals,
      assists: p.assists,
      plusMinus: p.plusMinus,
      shots: p.shots,
      hits: p.hits,
      faceoffPct,
      toiSeconds: p.toiSeconds ?? null,
      saves: p.saves,
      shotsAgainst: p.shotsAgainst,
    },
    jerseyNumber: p.jerseyNumber ?? null,
    archetype: p.archetype ?? null,
  }
}

/**
 * Stable identity for a scored player, independent of list position. BGM rows
 * key on the DB player id; opponents have no profile, so they key on the EA
 * persona id and fall back to the gamertag (the production identity anchor —
 * blazeId is absent from EA match payloads).
 */
export function performerKey(
  entry: Pick<PlayerScoreEntry, 'side' | 'playerId' | 'eaPlayerId' | 'gamertag'>,
): string {
  return entry.side === 'bgm'
    ? `bgm:${entry.playerId?.toString() ?? entry.gamertag}`
    : `opp:${entry.eaPlayerId ?? entry.gamertag}`
}

export function buildAllTeamScores(
  match: Pick<Match, 'result' | 'scoreFor' | 'scoreAgainst'>,
  bgm: PlayerStat[],
  opponent: OpponentPlayerStat[],
): PlayerScoreEntry[] {
  const winner = winningSide(match)
  const bgmEntries = bgm
    .filter((p) => hasRecordedActivity(p))
    .map((p) => toEntry('bgm', winner, p.playerId, null, p))
  const oppEntries = opponent
    .filter((p) => hasRecordedActivity(p))
    .map((p) => toEntry('opp', winner, null, p.eaPlayerId, p))
  return [...bgmEntries, ...oppEntries].sort((a, b) => b.score - a.score)
}

// ─── Overtime derivation ──────────────────────────────────────────────────────
//
// No OT column exists in the schema; the hero's OT badge derives it from
// whichever signal is present. Any one of:
//   - result OTL — an overtime loss by definition,
//   - an OCR period summary past regulation (period 4+ = OT1..OT3; EASHL has
//     no shootout — a tied OT3 ends as a tie, never SO) — but only when the
//     row recorded actual play: the in-game box score always shows an OT
//     column, so OCR stores a zero/NULL placeholder period-4 row even for
//     games that never left regulation (match 972, a one-period game, has
//     one). A played OT always leaves a trace — its opening faceoff, a shot,
//     or the sudden-death goal.
//   - any player's TOI beyond regulation (EA-only path: toi_seconds counts
//     periods actually played, 3600 = a full three-period game).

export function wentToOvertime(
  match: Pick<Match, 'result'>,
  periodSummaries: Pick<
    MatchPeriodSummaryRow,
    | 'periodNumber'
    | 'goalsFor'
    | 'goalsAgainst'
    | 'shotsFor'
    | 'shotsAgainst'
    | 'faceoffsFor'
    | 'faceoffsAgainst'
  >[],
  playerToiSeconds: (number | null)[],
): boolean {
  if (match.result === 'OTL') return true
  const otPlayed = periodSummaries.some(
    (r) =>
      r.periodNumber >= 4 &&
      ((r.goalsFor ?? 0) > 0 ||
        (r.goalsAgainst ?? 0) > 0 ||
        (r.shotsFor ?? 0) > 0 ||
        (r.shotsAgainst ?? 0) > 0 ||
        (r.faceoffsFor ?? 0) > 0 ||
        (r.faceoffsAgainst ?? 0) > 0),
  )
  if (otPlayed) return true
  return playerToiSeconds.some((t) => t !== null && t > 3600)
}

// ─── Possession & Pressure Edge (computed) ────────────────────────────────────
//
// One comparison bar between BGM and opponent computed from team totals.
//
// Weight tiers — highest to lowest territorial signal:
//   1. Shot share  — strong proxy for zone time and puck pressure
//   2. TOA share   — direct territorial control; only used when both sides
//                    are recorded (time_on_attack + time_on_attack_against).
//                    The schema stores both; older matches may have only BGM.
//   3. Faceoff share — meaningful but situational; suppressed when absent
//   4. Hit share   — lowest weight; a pressed team absorbs more hits, so
//                    hits skew toward the team getting dominated, not the
//                    team doing the dominating.
//
// Active weight set depends on data availability:
//   TOA bilateral + faceoff:  shots 0.40 · toa 0.30 · faceoffs 0.20 · hits 0.10
//   TOA bilateral, no faceoff: shots 0.50 · toa 0.35 · hits 0.15
//   No TOA, faceoff:          shots 0.55 · faceoffs 0.30 · hits 0.15
//   Neither:                  shots 0.70 · hits 0.30
//
// If shots and hits are both zero, the section is hidden (returns null).

export interface PossessionEdge {
  /** Composite share for BGM, 0-100 (rounded). */
  bgmShare: number
  /** Composite share for opponent, 0-100. (= 100 - bgmShare) */
  oppShare: number
  /** Unrounded composite × 100, one decimal — for display precision. */
  bgmRaw: number
  oppRaw: number
  inputs: {
    shots: { us: number; them: number; source: 'ea' | 'ocr' }
    /** BGM faceoff percentage (0-100), or null if unknown. */
    faceoffPct: number | null
    hits: { us: number; them: number }
    /** BGM time on attack in seconds. */
    timeOnAttackSeconds: number | null
    /** Opponent time on attack in seconds. */
    timeOnAttackSecondsAgainst: number | null
  }
  /** Active weights so the page can render a transparent footnote. */
  weights: { shots: number; faceoff: number; hits: number; toa: number }
}

export function buildPossessionEdge(
  match: Match,
  periodSummaries: MatchPeriodSummaryRow[] = [],
): PossessionEdge | null {
  const ocrShots = aggregateOcrShots(periodSummaries)
  const shotsFor = ocrShots.for ?? match.shotsFor
  const shotsAgainst = ocrShots.against ?? match.shotsAgainst
  const shotsSource: 'ea' | 'ocr' = ocrShots.for !== null ? 'ocr' : 'ea'

  const totalShots = shotsFor + shotsAgainst
  const totalHits = match.hitsFor + match.hitsAgainst
  if (totalShots === 0 && totalHits === 0) return null

  const shotShare = totalShots > 0 ? shotsFor / totalShots : 0.5
  const hitShare = totalHits > 0 ? match.hitsFor / totalHits : 0.5
  const faceoffPctNum = match.faceoffPct !== null ? parseFloat(match.faceoffPct) : null
  const foShare = faceoffPctNum !== null ? faceoffPctNum / 100 : null

  const toaUs = match.timeOnAttack
  const toaThem = match.timeOnAttackAgainst
  const toaShare =
    toaUs !== null && toaThem !== null && toaUs + toaThem > 0 ? toaUs / (toaUs + toaThem) : null

  let weights: { shots: number; faceoff: number; hits: number; toa: number }
  let composite: number

  if (toaShare !== null && foShare !== null) {
    weights = { shots: 0.4, toa: 0.3, faceoff: 0.2, hits: 0.1 }
    composite =
      shotShare * weights.shots +
      toaShare * weights.toa +
      foShare * weights.faceoff +
      hitShare * weights.hits
  } else if (toaShare !== null) {
    weights = { shots: 0.5, toa: 0.35, faceoff: 0, hits: 0.15 }
    composite = shotShare * weights.shots + toaShare * weights.toa + hitShare * weights.hits
  } else if (foShare !== null) {
    weights = { shots: 0.55, toa: 0, faceoff: 0.3, hits: 0.15 }
    composite = shotShare * weights.shots + foShare * weights.faceoff + hitShare * weights.hits
  } else {
    weights = { shots: 0.7, toa: 0, faceoff: 0, hits: 0.3 }
    composite = shotShare * weights.shots + hitShare * weights.hits
  }

  const bgmRaw = Math.max(0, Math.min(100, composite * 100))
  const bgmShare = Math.round(bgmRaw)
  return {
    bgmShare,
    oppShare: 100 - bgmShare,
    bgmRaw: Math.round(bgmRaw * 10) / 10,
    oppRaw: Math.round((100 - bgmRaw) * 10) / 10,
    inputs: {
      shots: { us: shotsFor, them: shotsAgainst, source: shotsSource },
      faceoffPct: faceoffPctNum,
      hits: { us: match.hitsFor, them: match.hitsAgainst },
      timeOnAttackSeconds: match.timeOnAttack,
      timeOnAttackSecondsAgainst: match.timeOnAttackAgainst,
    },
    weights,
  }
}

// ─── Box score / team comparison rows ─────────────────────────────────────────
//
// Trusted match-level totals only. Hidden rows: anything where the source
// field is null or zero in a way that would mislead (e.g. all-zero PIM).

export interface BoxScoreRow {
  label: string
  /** BGM value (already formatted). */
  us: string
  /** Opponent value (formatted). null = unknown / not comparable. */
  them: string | null
  /**
   * Indicates the stat's semantic direction.
   * 'higher-better' (default) — more is good for BGM (goals, shots, hits).
   * 'lower-better' — less is good for BGM (giveaways, penalties).
   * Used by team-stats.tsx to show a "↓ better" indicator on inverted rows.
   */
  polarity?: 'higher-better' | 'lower-better'
}

export interface BoxScoreGroup {
  title: string
  rows: BoxScoreRow[]
  /** Small caption under the group, used to disclose OCR overrides etc. */
  footnote?: string
}

export function buildBoxScore(
  match: Match,
  bgm: PlayerStat[],
  opponent: OpponentPlayerStat[],
  periodSummaries: MatchPeriodSummaryRow[] = [],
): BoxScoreGroup[] {
  const bgmAgg = aggregatePlayerSide(bgm)
  const oppAgg = aggregateOpponentSide(opponent)

  // OCR-derived shot totals override EA's number when reviewed OCR exists for
  // this match. EA's Pro Clubs API consistently under-counts shots vs the
  // in-game Box Score; treating reviewed OCR as canonical fixes the cognitive
  // dissonance between this widget and the per-period OCR summary below it.
  const ocrShots = aggregateOcrShots(periodSummaries)
  const shotsFor = ocrShots.for ?? match.shotsFor
  const shotsAgainst = ocrShots.against ?? match.shotsAgainst
  const shotsLabel = ocrShots.for !== null ? 'Shots *' : 'Shots'

  const offenseRows: BoxScoreRow[] = [
    row('Goals', match.scoreFor, match.scoreAgainst),
    row('Assists', bgmAgg.assists, oppAgg.assists),
    row(shotsLabel, shotsFor, shotsAgainst),
    pctRow('Shooting %', pct(match.scoreFor, shotsFor), pct(match.scoreAgainst, shotsAgainst)),
    pctRow(
      'Shot On Net %',
      pct(shotsFor, bgmAgg.shotAttempts),
      pct(shotsAgainst, oppAgg.shotAttempts),
    ),
    row('Deflections', bgmAgg.deflections, oppAgg.deflections),
    powerPlayRow(
      'Power Play',
      match.ppGoals,
      match.ppOpportunities,
      match.ppGoalsAgainst,
      match.ppOpportunitiesAgainst,
    ),
  ]
    .filter(nonNullable)
    .filter(nonEmptyRow)

  const possessionRows: BoxScoreRow[] = [
    match.faceoffPct !== null
      ? {
          label: 'Face Off %',
          us: `${parseFloat(match.faceoffPct).toFixed(1)}%`,
          them: `${(100 - parseFloat(match.faceoffPct)).toFixed(1)}%`,
        }
      : null,
    passPctRow(
      'Pass %',
      bgmAgg.passCompletions,
      bgmAgg.passAttempts,
      oppAgg.passCompletions,
      oppAgg.passAttempts,
    ),
    timeRow('Possession', bgmAgg.possession, oppAgg.possession),
    timeRow('Time on Attack', match.timeOnAttack, match.timeOnAttackAgainst),
  ]
    .filter(nonNullable)
    .filter(nonEmptyRow)

  const defenseRows: BoxScoreRow[] = [
    row('Hits', match.hitsFor, match.hitsAgainst),
    row('Blocked Shots', bgmAgg.blockedShots, oppAgg.blockedShots),
    row('Takeaways', bgmAgg.takeaways, oppAgg.takeaways),
    row('Interceptions', bgmAgg.interceptions, oppAgg.interceptions),
    row('Short Handed Goals', bgmAgg.shGoals, oppAgg.shGoals),
  ].filter(nonEmptyRow)

  const disciplineRows: BoxScoreRow[] = [
    { ...row('Giveaways', bgmAgg.giveaways, oppAgg.giveaways), polarity: 'lower-better' as const },
    {
      ...row('Penalties', match.penaltyMinutes ?? 0, match.penaltyMinutesAgainst ?? 0),
      polarity: 'lower-better' as const,
    },
  ].filter(nonEmptyRow)

  // Goalie group only appears when aggregate goalie data is non-trivially present.
  const goalieRows: BoxScoreRow[] = [
    row('Saves', bgmAgg.saves, oppAgg.saves),
    row('Goals Against', bgmAgg.goalsAgainst, oppAgg.goalsAgainst),
    pctRow(
      'Save %',
      pct(bgmAgg.saves, bgmAgg.shotsAgainst),
      pct(oppAgg.saves, oppAgg.shotsAgainst),
      true,
    ),
  ].filter(nonEmptyRow)

  const groups: BoxScoreGroup[] = []
  if (offenseRows.length > 0) {
    const offense: BoxScoreGroup = { title: 'Offense', rows: offenseRows }
    if (ocrShots.for !== null) {
      offense.footnote = '* Shots and shooting % are from the in-game Box Score (OCR-reviewed).'
    }
    groups.push(offense)
  }
  if (possessionRows.length > 0) groups.push({ title: 'Possession', rows: possessionRows })
  if (defenseRows.length > 0) groups.push({ title: 'Defense', rows: defenseRows })
  if (disciplineRows.length > 0) groups.push({ title: 'Discipline', rows: disciplineRows })
  if (goalieRows.length > 0) groups.push({ title: 'Goalie', rows: goalieRows })
  return groups
}

/**
 * Sum BGM and opponent shot totals across reviewed OCR period summaries.
 * Returns null on either side when no usable data is found, so the caller
 * can fall back to EA's headline value.
 */
function aggregateOcrShots(rows: MatchPeriodSummaryRow[]): {
  for: number | null
  against: number | null
} {
  let totalFor: number | null = null
  let totalAgainst: number | null = null
  for (const r of rows) {
    if (r.source !== 'ocr') continue
    if (r.reviewStatus !== 'reviewed') continue
    if (r.periodNumber === -1) continue // ignore aggregate "TOT" sentinels if any
    if (r.shotsFor !== null) totalFor = (totalFor ?? 0) + r.shotsFor
    if (r.shotsAgainst !== null) totalAgainst = (totalAgainst ?? 0) + r.shotsAgainst
  }
  return { for: totalFor, against: totalAgainst }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format save percentage as ".917" hockey style (no leading zero). */
export function formatSavePct(pct: number): string {
  if (pct >= 1) return '1.000'
  if (pct < 0) return '.000'
  return pct.toFixed(3).slice(1)
}

/** Format seconds as "mm:ss". */
export function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString()}:${s.toString().padStart(2, '0')}`
}

function aggregatePlayerSide(rows: PlayerStat[]) {
  return rows.reduce(
    (acc, p) => {
      acc.assists += p.assists
      acc.shotAttempts += p.shotAttempts
      acc.deflections += p.deflections
      acc.passAttempts += p.passAttempts
      acc.passCompletions += p.passCompletions
      acc.possession += p.possession
      acc.blockedShots += p.blockedShots
      acc.takeaways += p.takeaways
      acc.giveaways += p.giveaways
      acc.interceptions += p.interceptions
      acc.shGoals += p.shGoals
      acc.saves += p.saves ?? 0
      acc.goalsAgainst += p.goalsAgainst ?? 0
      acc.shotsAgainst += p.shotsAgainst ?? 0
      return acc
    },
    {
      assists: 0,
      shotAttempts: 0,
      deflections: 0,
      passAttempts: 0,
      passCompletions: 0,
      possession: 0,
      blockedShots: 0,
      takeaways: 0,
      giveaways: 0,
      interceptions: 0,
      shGoals: 0,
      saves: 0,
      goalsAgainst: 0,
      shotsAgainst: 0,
    },
  )
}

function aggregateOpponentSide(rows: OpponentPlayerStat[]) {
  return rows.reduce(
    (acc, p) => {
      acc.assists += p.assists
      acc.shotAttempts += p.shotAttempts
      acc.deflections += p.deflections
      acc.passAttempts += p.passAttempts
      acc.passCompletions += p.passCompletions
      acc.possession += p.possession
      acc.blockedShots += p.blockedShots
      acc.takeaways += p.takeaways
      acc.giveaways += p.giveaways
      acc.interceptions += p.interceptions
      acc.shGoals += p.shGoals
      acc.saves += p.saves ?? 0
      acc.goalsAgainst += p.goalsAgainst ?? 0
      acc.shotsAgainst += p.shotsAgainst ?? 0
      return acc
    },
    {
      assists: 0,
      shotAttempts: 0,
      deflections: 0,
      passAttempts: 0,
      passCompletions: 0,
      possession: 0,
      blockedShots: 0,
      takeaways: 0,
      giveaways: 0,
      interceptions: 0,
      shGoals: 0,
      saves: 0,
      goalsAgainst: 0,
      shotsAgainst: 0,
    },
  )
}

function row(label: string, us: number, them: number): BoxScoreRow {
  return { label, us: us.toString(), them: them.toString() }
}

function pctRow(
  label: string,
  us: number | null,
  them: number | null,
  hockeyPct = false,
): BoxScoreRow | null {
  if (us === null && them === null) return null
  const fmt = (n: number | null) =>
    n === null ? null : hockeyPct ? formatSavePct(n) : `${n.toFixed(1)}%`
  return { label, us: fmt(us) ?? '—', them: fmt(them) }
}

function passPctRow(
  label: string,
  usC: number,
  usA: number,
  themC: number,
  themA: number,
): BoxScoreRow | null {
  if (usA <= 0 && themA <= 0) return null
  const us = usA > 0 ? `${((usC / usA) * 100).toFixed(1)}%` : '—'
  const them = themA > 0 ? `${((themC / themA) * 100).toFixed(1)}%` : null
  return { label, us, them }
}

function timeRow(label: string, us: number | null, them: number | null): BoxScoreRow | null {
  if (us === null && them === null) return null
  return {
    label,
    us: us !== null ? formatSeconds(us) : '—',
    them: them !== null ? formatSeconds(them) : null,
  }
}

function powerPlayRow(
  label: string,
  usG: number | null,
  usO: number | null,
  themG: number | null,
  themO: number | null,
): BoxScoreRow | null {
  if ((usO ?? 0) <= 0 && (themO ?? 0) <= 0) return null
  return {
    label,
    us: `${(usG ?? 0).toString()}/${(usO ?? 0).toString()}`,
    them: `${(themG ?? 0).toString()}/${(themO ?? 0).toString()}`,
  }
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return (numerator / denominator) * 100
}

function nonEmptyRow(row: BoxScoreRow | null): row is BoxScoreRow {
  if (row === null) return false
  const empty = (v: string | null) => v === null || v === '0' || v === '0.0%' || v === '.000'
  return !(empty(row.us) && empty(row.them))
}

function nonNullable<T>(value: T | null): value is T {
  return value !== null
}
