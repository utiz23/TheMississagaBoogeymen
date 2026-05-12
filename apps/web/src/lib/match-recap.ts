// View-model builders for the /games/[id] match recap page.
//
// All formula logic and section-readiness rules live here so the page and
// components stay thin. Every "computed" output keeps its inputs visible so
// the UI can label and surface them honestly.

import type { Match } from '@eanhl/db'
import type {
  MatchPeriodSummaryRow,
  getOpponentPlayerMatchStats,
  getPlayerMatchStats,
} from '@eanhl/db/queries'

type PlayerStatBase = Awaited<ReturnType<typeof getPlayerMatchStats>>[number]
type OpponentPlayerStatBase = Awaited<
  ReturnType<typeof getOpponentPlayerMatchStats>
>[number]

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
}

function winningSide(match: Pick<Match, 'result' | 'scoreFor' | 'scoreAgainst'>): 'bgm' | 'opp' | null {
  if (match.result === 'DNF') return null
  if (match.scoreFor > match.scoreAgainst) return 'bgm'
  if (match.scoreAgainst > match.scoreFor) return 'opp'
  return null
}

function hasRecordedActivity(
  p: ({
    isGoalie: boolean
    goals: number
    assists: number
    plusMinus: number
  } & SkaterScoreInput & GoalieScoreInput),
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
    f('Goals',           p.goals,           4.00),
    f('Assists',         p.assists,         3.25),
    // Tier 2 — strong positive support (puck-winning / defensive impact)
    f('Takeaways',       p.takeaways,       0.55),
    f('Interceptions',   p.interceptions,   0.45),
    f('Blocked Shots',   p.blockedShots,    0.45),
    f('Penalties Drawn', p.penaltiesDrawn,  0.40),
    // Tier 3 — strong negative drag (sloppy possession / undisciplined play)
    f('Giveaways',       p.giveaways,      -0.45),
    f('Penalty Min',     p.pim,            -0.30),
    // Tier 4 — light context modifiers (present but not scoreboard drivers)
    f('Shots',           p.shots,           0.12),
    f('+/-',             p.plusMinus,       0.20),
    f('Hits',            p.hits,            0.08),
    f('FO Net',          foNet,             0.08),
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

function skaterScore(p: SkaterScoreInput): number {
  return skaterBreakdown(p).reduce((s, fac) => s + fac.contribution, 0)
}

// ─── Stat lines ───────────────────────────────────────────────────────────────

interface SkaterStatInput { goals: number; assists: number; plusMinus: number }
interface GoalieStatInput { saves: number | null; shotsAgainst: number | null }

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
    }))
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
  } & SkaterScoreInput &
    GoalieScoreInput,
): PlayerScoreEntry {
  const breakdown = p.isGoalie ? goalieBreakdown(p) : skaterBreakdown(p)
  if (winner === side) {
    breakdown.push(f('Win Bonus', 1, 1.0))
  }
  const score = breakdown.reduce((s, fac) => s + fac.contribution, 0)
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
  }
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
    shots: { us: number; them: number }
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

export function buildPossessionEdge(match: Match): PossessionEdge | null {
  const totalShots = match.shotsFor + match.shotsAgainst
  const totalHits = match.hitsFor + match.hitsAgainst
  if (totalShots === 0 && totalHits === 0) return null

  const shotShare = totalShots > 0 ? match.shotsFor / totalShots : 0.5
  const hitShare = totalHits > 0 ? match.hitsFor / totalHits : 0.5
  const faceoffPctNum = match.faceoffPct !== null ? parseFloat(match.faceoffPct) : null
  const foShare = faceoffPctNum !== null ? faceoffPctNum / 100 : null

  const toaUs = match.timeOnAttack
  const toaThem = match.timeOnAttackAgainst
  const toaShare =
    toaUs !== null && toaThem !== null && toaUs + toaThem > 0
      ? toaUs / (toaUs + toaThem)
      : null

  let weights: { shots: number; faceoff: number; hits: number; toa: number }
  let composite: number

  if (toaShare !== null && foShare !== null) {
    weights = { shots: 0.40, toa: 0.30, faceoff: 0.20, hits: 0.10 }
    composite =
      shotShare * weights.shots +
      toaShare * weights.toa +
      foShare * weights.faceoff +
      hitShare * weights.hits
  } else if (toaShare !== null) {
    weights = { shots: 0.50, toa: 0.35, faceoff: 0, hits: 0.15 }
    composite =
      shotShare * weights.shots +
      toaShare * weights.toa +
      hitShare * weights.hits
  } else if (foShare !== null) {
    weights = { shots: 0.55, toa: 0, faceoff: 0.30, hits: 0.15 }
    composite =
      shotShare * weights.shots +
      foShare * weights.faceoff +
      hitShare * weights.hits
  } else {
    weights = { shots: 0.70, toa: 0, faceoff: 0, hits: 0.30 }
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
      shots: { us: match.shotsFor, them: match.shotsAgainst },
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
}

export interface BoxScoreGroup {
  title: string
  rows: BoxScoreRow[]
  placeholder?: boolean
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
    powerPlayRow('Power Play', match.ppGoals, match.ppOpportunities, match.ppGoalsAgainst, match.ppOpportunitiesAgainst),
  ].filter(nonNullable).filter(nonEmptyRow)

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
    row('Possession', bgmAgg.possession, oppAgg.possession),
    timeRow('Time on Attack', match.timeOnAttack, match.timeOnAttackAgainst),
  ].filter(nonNullable).filter(nonEmptyRow)

  const defenseRows: BoxScoreRow[] = [
    row('Hits', match.hitsFor, match.hitsAgainst),
    row('Blocked Shots', bgmAgg.blockedShots, oppAgg.blockedShots),
    row('Takeaways', bgmAgg.takeaways, oppAgg.takeaways),
    row('Giveaways', bgmAgg.giveaways, oppAgg.giveaways),
    row('Interceptions', bgmAgg.interceptions, oppAgg.interceptions),
    row('Penalties', match.penaltyMinutes ?? 0, match.penaltyMinutesAgainst ?? 0),
    row('Short Handed Goals', bgmAgg.shGoals, oppAgg.shGoals),
  ].filter(nonEmptyRow)

  // Goalie group only appears when aggregate goalie data is non-trivially present.
  const goalieRows: BoxScoreRow[] = [
    row('Saves', bgmAgg.saves, oppAgg.saves),
    row('Goals Against', bgmAgg.goalsAgainst, oppAgg.goalsAgainst),
    pctRow('Save %', pct(bgmAgg.saves, bgmAgg.shotsAgainst), pct(oppAgg.saves, oppAgg.shotsAgainst), true),
  ].filter(nonEmptyRow)

  const groups: BoxScoreGroup[] = []
  if (offenseRows.length > 0) {
    const offense: BoxScoreGroup = { title: 'Offense', rows: offenseRows }
    if (ocrShots.for !== null) {
      offense.footnote =
        '* Shots and shooting % are taken from the in-game Box Score (OCR-reviewed). EA reported ' +
        `${String(match.shotsFor)}–${String(match.shotsAgainst)}.`
    }
    groups.push(offense)
  }
  if (possessionRows.length > 0) groups.push({ title: 'Possession', rows: possessionRows })
  if (defenseRows.length > 0) groups.push({ title: 'Defense', rows: defenseRows })
  if (goalieRows.length > 0) groups.push({ title: 'Goalie', rows: goalieRows })
  groups.push({
    title: 'Ratings',
    rows: [],
    placeholder: true,
  })
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

// ─── Goalie Spotlight ─────────────────────────────────────────────────────────

export interface GoalieSpotlight {
  playerId: number
  gamertag: string
  saves: number
  goalsAgainst: number
  shotsAgainst: number
  /** Formatted ".917" or "—" when shotsAgainst = 0. */
  savePctFormatted: string
  // Optional advanced (any may be null).
  breakawaySaves: number | null
  breakawayShots: number | null
  despSaves: number | null
  penSaves: number | null
  penShots: number | null
  pokechecks: number | null
}

export function buildGoalieSpotlight(playerStats: PlayerStat[]): GoalieSpotlight[] {
  return playerStats
    .filter(
      (p) =>
        p.isGoalie &&
        // require at least one of the core goalie counters to be populated
        ((p.saves ?? 0) > 0 || (p.goalsAgainst ?? 0) > 0 || (p.shotsAgainst ?? 0) > 0),
    )
    .map((p) => {
      const saves = p.saves ?? 0
      const ga = p.goalsAgainst ?? 0
      const sa = p.shotsAgainst ?? 0
      return {
        playerId: p.playerId,
        gamertag: p.gamertag,
        saves,
        goalsAgainst: ga,
        shotsAgainst: sa,
        savePctFormatted: sa > 0 ? formatSavePct(saves / sa) : '—',
        breakawaySaves: p.breakawaySaves,
        breakawayShots: p.breakawayShots,
        despSaves: p.despSaves,
        penSaves: p.penSaves,
        penShots: p.penShots,
        pokechecks: p.pokechecks,
      }
    })
}

// ─── Scoresheet rows ──────────────────────────────────────────────────────────
//
// Row types are source-agnostic: a SkaterRow / GoalieRow can come from either
// the BGM `player_match_stats` table or the `opponent_player_match_stats` table.
// The discriminator that matters to the UI is `playerId`:
//
//   - playerId !== null  → BGM player; render gamertag as <Link to /roster/[id]>
//   - playerId === null  → opponent player; render gamertag as plain text
//
// `rowKey` is a stable React key — for BGM it's the BGM player_id, for opponents
// it's the EA persona id (the JSON object key in the raw payload). The two
// namespaces are distinct so collisions are not possible.

export interface SkaterRow {
  rowKey: string
  /** BGM `players.id` for /roster/[id] linking; null for opponent rows. */
  playerId: number | null
  gamertag: string
  position: string | null
  goals: number
  assists: number
  points: number
  plusMinus: number
  shots: number
  hits: number
  pim: number
  /** Faceoff "W-L" — null when player took none. */
  faceoffRecord: string | null
  /** Time on ice "mm:ss" — null when toiSeconds is null. */
  toi: string | null
  /** Pass completion percentage (0-100), null when no passes attempted. */
  passPct: number | null
  passAttempts: number
  passCompletions: number
  blocks: number
  shotAttempts: number
  deflections: number
  takeaways: number
  giveaways: number
  interceptions: number
  possessionSeconds: number
  penaltiesDrawn: number
  saucerPasses: number
  ppGoals: number
  shGoals: number
  faceoffWins: number
  faceoffLosses: number
  dnf: boolean
  /** True only for opponent rows where EA marked the player as drop-in. */
  isGuest: boolean
  score: number
}

export interface GoalieRow {
  rowKey: string
  /** BGM `players.id` for /roster/[id] linking; null for opponent rows. */
  playerId: number | null
  gamertag: string
  saves: number
  goalsAgainst: number
  /** Formatted ".917" or "—". */
  savePctFormatted: string
  shotsAgainst: number
  /** Time on ice "mm:ss" — null when unknown. */
  toi: string | null
  dnf: boolean
  isGuest: boolean
  breakawaySaves: number | null
  breakawayShots: number | null
  despSaves: number | null
  penSaves: number | null
  penShots: number | null
  pokechecks: number | null
}

/** One side (BGM or opponent) of the scoresheet. */
export interface ScoresheetSide {
  /** Display label — "BGM" / opponent name. */
  teamLabel: string
  /** Whether players on this side have BGM identity (linkable profiles). */
  isBgm: boolean
  skaters: SkaterRow[]
  goalies: GoalieRow[]
}

export interface Scoresheet {
  bgm: ScoresheetSide
  opponent: ScoresheetSide
}

export function buildScoresheet(input: {
  bgm: PlayerStat[]
  opponent: OpponentPlayerStat[]
  /** Display name for the opponent club (e.g. "G0obers"). */
  opponentLabel: string
}): Scoresheet {
  return {
    bgm: {
      teamLabel: 'BGM',
      isBgm: true,
      ...partitionBgm(input.bgm),
    },
    opponent: {
      teamLabel: input.opponentLabel,
      isBgm: false,
      ...partitionOpponent(input.opponent),
    },
  }
}

function partitionBgm(rows: PlayerStat[]): { skaters: SkaterRow[]; goalies: GoalieRow[] } {
  const skaters: SkaterRow[] = []
  const goalies: GoalieRow[] = []
  for (const p of rows) {
    if (p.isGoalie) {
      goalies.push(bgmGoalieRow(p))
    } else {
      skaters.push(bgmSkaterRow(p))
    }
  }
  return { skaters, goalies }
}

function partitionOpponent(rows: OpponentPlayerStat[]): {
  skaters: SkaterRow[]
  goalies: GoalieRow[]
} {
  const skaters: SkaterRow[] = []
  const goalies: GoalieRow[] = []
  for (const p of rows) {
    if (p.isGoalie) {
      goalies.push(opponentGoalieRow(p))
    } else {
      skaters.push(opponentSkaterRow(p))
    }
  }
  return { skaters, goalies }
}

function bgmSkaterRow(p: PlayerStat): SkaterRow {
  const fow = p.faceoffWins
  const fol = p.faceoffLosses
  return {
    rowKey: `bgm:${p.playerId.toString()}`,
    playerId: p.playerId,
    gamertag: p.gamertag,
    position: p.position,
    goals: p.goals,
    assists: p.assists,
    points: p.goals + p.assists,
    plusMinus: p.plusMinus,
    shots: p.shots,
    hits: p.hits,
    pim: p.pim,
    faceoffRecord: fow + fol > 0 ? `${fow.toString()}-${fol.toString()}` : null,
    toi: p.toiSeconds !== null ? formatSeconds(p.toiSeconds) : null,
    passPct: p.passAttempts > 0 ? (p.passCompletions / p.passAttempts) * 100 : null,
    passAttempts: p.passAttempts,
    passCompletions: p.passCompletions,
    blocks: p.blockedShots,
    shotAttempts: p.shotAttempts,
    deflections: p.deflections,
    takeaways: p.takeaways,
    giveaways: p.giveaways,
    interceptions: p.interceptions,
    possessionSeconds: p.possession,
    penaltiesDrawn: p.penaltiesDrawn,
    saucerPasses: p.saucerPasses,
    ppGoals: p.ppGoals,
    shGoals: p.shGoals,
    faceoffWins: fow,
    faceoffLosses: fol,
    dnf: p.playerDnf,
    isGuest: false,
    score: skaterScore(p),
  }
}

function bgmGoalieRow(p: PlayerStat): GoalieRow {
  const saves = p.saves ?? 0
  const sa = p.shotsAgainst ?? 0
  return {
    rowKey: `bgm:${p.playerId.toString()}`,
    playerId: p.playerId,
    gamertag: p.gamertag,
    saves,
    goalsAgainst: p.goalsAgainst ?? 0,
    savePctFormatted: sa > 0 ? formatSavePct(saves / sa) : '—',
    shotsAgainst: sa,
    toi: p.toiSeconds !== null ? formatSeconds(p.toiSeconds) : null,
    dnf: p.playerDnf,
    isGuest: false,
    breakawaySaves: p.breakawaySaves,
    breakawayShots: p.breakawayShots,
    despSaves: p.despSaves,
    penSaves: p.penSaves,
    penShots: p.penShots,
    pokechecks: p.pokechecks,
  }
}

function opponentSkaterRow(p: OpponentPlayerStat): SkaterRow {
  const fow = p.faceoffWins
  const fol = p.faceoffLosses
  return {
    rowKey: `opp:${p.eaPlayerId}`,
    playerId: null,
    gamertag: p.gamertag,
    position: p.position,
    goals: p.goals,
    assists: p.assists,
    points: p.goals + p.assists,
    plusMinus: p.plusMinus,
    shots: p.shots,
    hits: p.hits,
    pim: p.pim,
    faceoffRecord: fow + fol > 0 ? `${fow.toString()}-${fol.toString()}` : null,
    toi: p.toiSeconds !== null ? formatSeconds(p.toiSeconds) : null,
    passPct: p.passAttempts > 0 ? (p.passCompletions / p.passAttempts) * 100 : null,
    passAttempts: p.passAttempts,
    passCompletions: p.passCompletions,
    blocks: p.blockedShots,
    shotAttempts: p.shotAttempts,
    deflections: p.deflections,
    takeaways: p.takeaways,
    giveaways: p.giveaways,
    interceptions: p.interceptions,
    possessionSeconds: p.possession,
    penaltiesDrawn: p.penaltiesDrawn,
    saucerPasses: p.saucerPasses,
    ppGoals: p.ppGoals,
    shGoals: p.shGoals,
    faceoffWins: fow,
    faceoffLosses: fol,
    dnf: p.playerDnf,
    isGuest: p.isGuest,
    score: skaterScore(p),
  }
}

function opponentGoalieRow(p: OpponentPlayerStat): GoalieRow {
  const saves = p.saves ?? 0
  const sa = p.shotsAgainst ?? 0
  return {
    rowKey: `opp:${p.eaPlayerId}`,
    playerId: null,
    gamertag: p.gamertag,
    saves,
    goalsAgainst: p.goalsAgainst ?? 0,
    savePctFormatted: sa > 0 ? formatSavePct(saves / sa) : '—',
    shotsAgainst: sa,
    toi: p.toiSeconds !== null ? formatSeconds(p.toiSeconds) : null,
    dnf: p.playerDnf,
    isGuest: p.isGuest,
    breakawaySaves: p.breakawaySaves,
    breakawayShots: p.breakawayShots,
    despSaves: p.despSaves,
    penSaves: p.penSaves,
    penShots: p.penShots,
    pokechecks: p.pokechecks,
  }
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

function pctRow(label: string, us: number | null, them: number | null, hockeyPct = false): BoxScoreRow | null {
  if (us === null && them === null) return null
  const fmt = (n: number | null) =>
    n === null ? null : hockeyPct ? formatSavePct(n) : `${n.toFixed(1)}%`
  return { label, us: fmt(us) ?? '—', them: fmt(them) }
}

function passPctRow(label: string, usC: number, usA: number, themC: number, themA: number): BoxScoreRow | null {
  if (usA <= 0 && themA <= 0) return null
  const us = usA > 0 ? `${((usC / usA) * 100).toFixed(1)}%` : '—'
  const them = themA > 0 ? `${((themC / themA) * 100).toFixed(1)}%` : null
  return { label, us, them }
}

function timeRow(label: string, us: number | null, them: number | null): BoxScoreRow | null {
  if (us === null && them === null) return null
  return { label, us: us !== null ? formatSeconds(us) : '—', them: them !== null ? formatSeconds(them) : null }
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
