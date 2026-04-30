// View-model builders for the /games/[id] match recap page.
//
// All formula logic and section-readiness rules live here so the page and
// components stay thin. Every "computed" output keeps its inputs visible so
// the UI can label and surface them honestly.

import type { Match } from '@eanhl/db'
import type { getPlayerMatchStats } from '@eanhl/db/queries'

export type PlayerStat = Awaited<ReturnType<typeof getPlayerMatchStats>>[number]

// ─── Top Performers (computed) ────────────────────────────────────────────────
//
// Skater score: goals*4 + assists*2 + plusMinus*0.5 + hits*0.1 + (TA-GV)*0.2
// Goalie score: saves*0.15 + savePct*12 - goalsAgainst*0.5
//
// Tuned so a 2G 1A skater game and a 0.917 SV% / 25-save goalie game both
// show up as top-3 candidates. Formula is intentionally simple and
// transparent — the UI also shows the raw stat line on every card.

export interface TopPerformer {
  playerId: number
  gamertag: string
  position: string | null
  isGoalie: boolean
  /** Short stat line: "2G 1A +3" or ".917 SV% · 25 SV". */
  statLine: string
  /** Raw composite score; only used for ranking / debugging. */
  score: number
}

function skaterScore(p: PlayerStat): number {
  return (
    p.goals * 4 +
    p.assists * 2 +
    p.plusMinus * 0.5 +
    p.hits * 0.1 +
    (p.takeaways - p.giveaways) * 0.2
  )
}

function goalieScore(p: PlayerStat): number {
  const saves = p.saves ?? 0
  const ga = p.goalsAgainst ?? 0
  const sa = p.shotsAgainst ?? 0
  const svPct = sa > 0 ? saves / sa : 0
  return saves * 0.15 + svPct * 12 - ga * 0.5
}

function skaterStatLine(p: PlayerStat): string {
  const pm = p.plusMinus >= 0 ? `+${p.plusMinus.toString()}` : p.plusMinus.toString()
  return `${p.goals.toString()}G ${p.assists.toString()}A ${pm}`
}

function goalieStatLine(p: PlayerStat): string {
  const saves = p.saves ?? 0
  const sa = p.shotsAgainst ?? 0
  if (sa <= 0) return `${saves.toString()} SV`
  const svPct = saves / sa
  return `${formatSavePct(svPct)} SV% · ${saves.toString()} SV`
}

export function buildTopPerformers(playerStats: PlayerStat[]): TopPerformer[] {
  const ranked = playerStats
    .map((p) => ({
      p,
      score: p.isGoalie ? goalieScore(p) : skaterScore(p),
    }))
    // Skip rows with no meaningful contribution: 0 score AND no goals/assists/saves.
    .filter(({ p, score }) => {
      if (score > 0) return true
      if (p.isGoalie) return (p.saves ?? 0) > 0
      return p.goals + p.assists + p.shots + p.hits > 0
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  return ranked.map(({ p, score }) => ({
    playerId: p.playerId,
    gamertag: p.gamertag,
    position: p.position,
    isGoalie: p.isGoalie,
    statLine: p.isGoalie ? goalieStatLine(p) : skaterStatLine(p),
    score,
  }))
}

// ─── Possession & Pressure Edge (computed) ────────────────────────────────────
//
// One comparison bar between BGM and opponent computed from team totals.
// Inputs (suggested by spec):
//   - shot share  (45% weight)
//   - faceoff share (30% weight)
//   - hit share   (25% weight, lighter factor per spec)
//
// TOA is intentionally NOT in the share formula — we only have BGM TOA, no
// opponent TOA. Showing it as an information line below the bar is honest.
//
// If faceoffPct is missing (older matches), weight is redistributed across
// shots (0.65) + hits (0.35). If shots and hits are both zero, the section
// is hidden entirely (returns null).

export interface PossessionEdge {
  /** Composite share for BGM, 0-100 (rounded). */
  bgmShare: number
  /** Composite share for opponent, 0-100. (= 100 - bgmShare) */
  oppShare: number
  inputs: {
    shots: { us: number; them: number }
    /** BGM faceoff percentage (0-100), or null if unknown. */
    faceoffPct: number | null
    hits: { us: number; them: number }
    /** Time on attack in seconds; informational only. */
    timeOnAttackSeconds: number | null
  }
  /** Active weights so the page can render a transparent footnote. */
  weights: { shots: number; faceoff: number; hits: number }
}

export function buildPossessionEdge(match: Match): PossessionEdge | null {
  const totalShots = match.shotsFor + match.shotsAgainst
  const totalHits = match.hitsFor + match.hitsAgainst
  if (totalShots === 0 && totalHits === 0) return null

  const shotShare = totalShots > 0 ? match.shotsFor / totalShots : 0.5
  const hitShare = totalHits > 0 ? match.hitsFor / totalHits : 0.5
  const faceoffPctNum = match.faceoffPct !== null ? parseFloat(match.faceoffPct) : null
  const foShare = faceoffPctNum !== null ? faceoffPctNum / 100 : null

  let weights: { shots: number; faceoff: number; hits: number }
  let composite: number
  if (foShare !== null) {
    weights = { shots: 0.45, faceoff: 0.3, hits: 0.25 }
    composite =
      shotShare * weights.shots + foShare * weights.faceoff + hitShare * weights.hits
  } else {
    weights = { shots: 0.65, faceoff: 0, hits: 0.35 }
    composite = shotShare * weights.shots + hitShare * weights.hits
  }

  const bgmShare = Math.max(0, Math.min(100, Math.round(composite * 100)))
  return {
    bgmShare,
    oppShare: 100 - bgmShare,
    inputs: {
      shots: { us: match.shotsFor, them: match.shotsAgainst },
      faceoffPct: faceoffPctNum,
      hits: { us: match.hitsFor, them: match.hitsAgainst },
      timeOnAttackSeconds: match.timeOnAttack,
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

export function buildBoxScore(match: Match): BoxScoreRow[] {
  const rows: BoxScoreRow[] = [
    { label: 'Shots', us: match.shotsFor.toString(), them: match.shotsAgainst.toString() },
    { label: 'Hits', us: match.hitsFor.toString(), them: match.hitsAgainst.toString() },
  ]

  if (match.faceoffPct !== null) {
    const ours = parseFloat(match.faceoffPct)
    const theirs = 100 - ours
    rows.push({
      label: 'Faceoffs',
      us: `${ours.toFixed(1)}%`,
      them: `${theirs.toFixed(1)}%`,
    })
  }

  if (match.timeOnAttack !== null) {
    rows.push({
      label: 'Time on Attack',
      us: formatSeconds(match.timeOnAttack),
      them: null,
    })
  }

  if (match.penaltyMinutes !== null && match.penaltyMinutes > 0) {
    rows.push({
      label: 'Penalty Minutes',
      us: match.penaltyMinutes.toString(),
      them: null,
    })
  }

  if (match.passAttempts !== null && match.passCompletions !== null && match.passAttempts > 0) {
    const pct = (match.passCompletions / match.passAttempts) * 100
    rows.push({
      label: 'Passing',
      us: `${match.passCompletions.toString()}/${match.passAttempts.toString()} (${pct.toFixed(0)}%)`,
      them: null,
    })
  }

  if (match.ppOpportunities !== null && match.ppOpportunities > 0) {
    rows.push({
      label: 'Power Play',
      us: `${(match.ppGoals ?? 0).toString()}/${match.ppOpportunities.toString()}`,
      them: null,
    })
  }

  return rows
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

export interface SkaterRow {
  playerId: number
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
  blocks: number
  dnf: boolean
}

export interface GoalieRow {
  playerId: number
  gamertag: string
  saves: number
  goalsAgainst: number
  /** Formatted ".917" or "—". */
  savePctFormatted: string
  shotsAgainst: number
  /** Time on ice "mm:ss" — null when unknown. */
  toi: string | null
  dnf: boolean
}

export interface Scoresheet {
  skaters: SkaterRow[]
  goalies: GoalieRow[]
}

export function buildScoresheet(playerStats: PlayerStat[]): Scoresheet {
  const skaters: SkaterRow[] = []
  const goalies: GoalieRow[] = []

  for (const p of playerStats) {
    if (p.isGoalie) {
      const saves = p.saves ?? 0
      const sa = p.shotsAgainst ?? 0
      goalies.push({
        playerId: p.playerId,
        gamertag: p.gamertag,
        saves,
        goalsAgainst: p.goalsAgainst ?? 0,
        savePctFormatted: sa > 0 ? formatSavePct(saves / sa) : '—',
        shotsAgainst: sa,
        toi: p.toiSeconds !== null ? formatSeconds(p.toiSeconds) : null,
        dnf: p.playerDnf,
      })
      continue
    }

    const fow = p.faceoffWins
    const fol = p.faceoffLosses
    const passPct =
      p.passAttempts > 0 ? (p.passCompletions / p.passAttempts) * 100 : null

    skaters.push({
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
      passPct,
      blocks: p.blockedShots,
      dnf: p.playerDnf,
    })
  }

  return { skaters, goalies }
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
