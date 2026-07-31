/**
 * Table logic for the lineup drawers. Pure functions, no React/DOM.
 *
 * These briefly backed a two-column BGM-vs-opponent compare; the drawer is
 * single-subject again, so the builders take one side. The two-valued
 * `buildAttributeCompare` / `buildStatCategories` pair was removed with it.
 *
 * The attribute taxonomy, hand formatting, and boost/nerf bar geometry are
 * lifted from the previous design's `lineup-expand-panel.tsx` (the logic
 * donor, deleted in Phase 11). The stat builders are new: the prototype's
 * drawer tables ran on fabricated numbers — these derive every value from
 * the real per-match stat rows shared by `player_match_stats` and
 * `opponent_player_match_stats`.
 *
 * Glyph discipline (prototype final review): `—` means "no attempts / not
 * captured", `0` is a genuine zero. Rates with a zero denominator are `—`.
 */

export interface AttributeValue {
  value: number
  delta: number | null
}

export type AttributeMap = Record<string, AttributeValue> | null

interface AttributeGroupDef {
  title: string
  keys: readonly string[]
}

/**
 * 5-group attribute taxonomy that matches the in-game Loadout view screen.
 * Mirrors the schema comment in `packages/db/src/schema/player-loadout.ts`.
 */
export const ATTRIBUTE_GROUPS: readonly AttributeGroupDef[] = [
  {
    title: 'Technique',
    keys: ['wrist_shot_accuracy', 'slap_shot_accuracy', 'speed', 'balance', 'agility'],
  },
  {
    title: 'Power',
    keys: ['wrist_shot_power', 'slap_shot_power', 'acceleration', 'puck_control', 'endurance'],
  },
  {
    title: 'Playstyle',
    keys: [
      'passing',
      'offensive_awareness',
      'body_checking',
      'stick_checking',
      'defensive_awareness',
    ],
  },
  { title: 'Tenacity', keys: ['hand_eye', 'strength', 'durability', 'shot_blocking'] },
  { title: 'Tactics', keys: ['deking', 'faceoffs', 'discipline', 'fighting_skill'] },
]

export const ATTRIBUTE_LABELS: Readonly<Record<string, string>> = {
  wrist_shot_accuracy: 'Wrist Shot Acc',
  slap_shot_accuracy: 'Slap Shot Acc',
  speed: 'Speed',
  balance: 'Balance',
  agility: 'Agility',
  wrist_shot_power: 'Wrist Shot Pwr',
  slap_shot_power: 'Slap Shot Pwr',
  acceleration: 'Acceleration',
  puck_control: 'Puck Control',
  endurance: 'Endurance',
  passing: 'Passing',
  offensive_awareness: 'Off. Awareness',
  body_checking: 'Body Checking',
  stick_checking: 'Stick Checking',
  defensive_awareness: 'Def. Awareness',
  hand_eye: 'Hand-Eye',
  strength: 'Strength',
  durability: 'Durability',
  shot_blocking: 'Shot Blocking',
  deking: 'Deking',
  faceoffs: 'Faceoffs',
  discipline: 'Discipline',
  fighting_skill: 'Fighting Skill',
}

export interface AttributeRow {
  key: string
  label: string
  value: AttributeValue | null
}

export interface AttributeGroup {
  title: string
  rows: AttributeRow[]
}

/**
 * One player's attribute snapshot in the 5-group structure — the prototype's
 * single-subject loadout drawer (R / Δ columns), not a two-side compare.
 */
export function buildAttributeTables(map: AttributeMap): AttributeGroup[] {
  return ATTRIBUTE_GROUPS.map((g) => ({
    title: g.title,
    rows: g.keys.map((key) => ({
      key,
      label: ATTRIBUTE_LABELS[key] ?? key,
      value: map?.[key] ?? null,
    })),
  }))
}

export interface BarGeometry {
  /** Neutral-tone fill 0..100 — the rating minus any positive boost. */
  baseWidth: number
  /** Boost overlay width appended after `baseWidth` (delta > 0). */
  boostWidth: number
  /** Nerf overlay start — the current (already reduced) rating. */
  nerfStart: number
  /** Nerf overlay width — from the rating to where it sat pre-nerf. */
  nerfWidth: number
}

/**
 * Boost/nerf bar geometry, lifted from the donor panel's `AttributeRow`:
 *   - Neutral base = value − max(0, delta): a +3 boost on 95 fills 0..92
 *     neutral, then a boost overlay fills 92..95.
 *   - A nerf (delta < 0) extends BEYOND the value to where the rating would
 *     have sat without it — overlay from `value` to `value − delta`.
 */
export function attributeBarGeometry(v: AttributeValue | null): BarGeometry {
  if (v === null) return { baseWidth: 0, boostWidth: 0, nerfStart: 0, nerfWidth: 0 }
  const delta = v.delta ?? 0
  const boosted = delta > 0
  const downgraded = delta < 0
  const baseWidth = Math.max(0, Math.min(100, v.value - Math.max(0, delta)))
  const boostWidth = boosted ? Math.max(0, Math.min(100, delta)) : 0
  const nerfStart = downgraded ? Math.min(100, v.value) : 0
  const nerfWidth = downgraded ? Math.max(0, Math.min(100 - nerfStart, Math.abs(delta))) : 0
  return { baseWidth, boostWidth, nerfStart, nerfWidth }
}

export function formatHand(h: string | null): string {
  if (!h) return '—'
  const t = h.trim().toLowerCase()
  if (t === 'r' || t.startsWith('right')) return 'Right'
  if (t === 'l' || t.startsWith('left')) return 'Left'
  return h
}

/** Split a build string into `{ build, ref }` — "Cole Caufield - Sniper" → { Sniper, C. Caufield }. */
export function splitBuild(row: {
  buildClass: string | null
  buildClassCanonical: string | null
}): { build: string; ref: string | null } {
  const source = row.buildClassCanonical ?? row.buildClass
  if (!source) return { build: 'Unknown build', ref: null }
  const dashIdx = source.indexOf(' - ')
  if (dashIdx === -1) return { build: source.trim(), ref: null }
  const refPart = source.slice(0, dashIdx).trim()
  const buildPart = source.slice(dashIdx + 3).trim()
  if (!refPart || !buildPart) return { build: source.trim(), ref: null }
  const parts = refPart.split(/\s+/)
  const refDisplay =
    parts.length >= 2 ? `${parts[0]?.charAt(0) ?? ''}. ${parts.slice(1).join(' ')}` : refPart
  return { build: buildPart, ref: refDisplay }
}

/** `—` for null, else m:ss (possession and TOI are stored in seconds). */
export function formatClock(seconds: number | null): string {
  if (seconds === null) return '—'
  const clamped = Math.max(0, Math.floor(seconds))
  const m = Math.floor(clamped / 60)
  const s = clamped % 60
  return `${m.toString()}:${s.toString().padStart(2, '0')}`
}

/** Percentage with one decimal; `—` when there were no attempts. */
export function formatPct(num: number, den: number): string {
  if (den <= 0) return '—'
  return `${((num / den) * 100).toFixed(1)}%`
}

/**
 * Shot-on-net rate, guarded: EA occasionally reports skshotattempts < skshots
 * (impossible under its own "attempts include blocked + missed" semantics —
 * match 250 has a 7-SOG / 6-attempt row). A >100% rate reads as a rendering
 * bug, so an inconsistent attempts figure renders `—` instead.
 */
export function formatShotOnNetPct(shots: number, shotAttempts: number): string {
  if (shotAttempts < shots) return '—'
  return formatPct(shots, shotAttempts)
}

/**
 * The deep skater fields both stat queries share — everything the drawer's
 * summary strip and category tables derive from. Both `getPlayerMatchStats`
 * and `getOpponentPlayerMatchStats` rows satisfy this structurally.
 */
export interface HeadToHeadStatLine {
  goals: number
  assists: number
  plusMinus: number
  shots: number
  hits: number
  pim: number
  takeaways: number
  giveaways: number
  faceoffWins: number
  faceoffLosses: number
  passAttempts: number
  passCompletions: number
  toiSeconds: number | null
  shotAttempts: number
  blockedShots: number
  interceptions: number
  penaltiesDrawn: number
  possession: number
  deflections: number
  saucerPasses: number
  ppGoals: number
  shGoals: number
  playerDnf: boolean
}

export interface StatSummaryTile {
  label: string
  value: string
  /** True when the value is a `—` placeholder — rendered dimmed. */
  muted: boolean
}

/**
 * The tapped player's derived-rate strip. Deliberately no SCORE tile — the
 * row already shows GS and the prototype review flagged the duplicate.
 */
export function buildStatSummary(stat: HeadToHeadStatLine | null): StatSummaryTile[] {
  const tile = (label: string, value: string): StatSummaryTile => ({
    label,
    value,
    muted: value === '—',
  })
  if (stat === null) {
    return ['Shot on Net', 'Shooting %', 'Pass %', 'FO %', 'Possession'].map((l) => tile(l, '—'))
  }
  return [
    tile('Shot on Net', formatShotOnNetPct(stat.shots, stat.shotAttempts)),
    tile('Shooting %', formatPct(stat.goals, stat.shots)),
    tile('Pass %', formatPct(stat.passCompletions, stat.passAttempts)),
    tile('FO %', formatPct(stat.faceoffWins, stat.faceoffWins + stat.faceoffLosses)),
    tile('Possession', formatClock(stat.possession)),
  ]
}

function signed(n: number): string {
  return n > 0 ? `+${n.toString()}` : n.toString()
}

/** One side's formatted values for every category row, in table order. */
function statLineValues(stat: HeadToHeadStatLine | null): Record<string, string> {
  if (stat === null) {
    return {}
  }
  const foTotal = stat.faceoffWins + stat.faceoffLosses
  return {
    'Shots / Att':
      stat.shotAttempts > 0 ? `${stat.shots.toString()}/${stat.shotAttempts.toString()}` : '—',
    'Shot on Net %': formatShotOnNetPct(stat.shots, stat.shotAttempts),
    'Shooting %': formatPct(stat.goals, stat.shots),
    Deflections: stat.deflections.toString(),
    'Passes / Att':
      stat.passAttempts > 0
        ? `${stat.passCompletions.toString()}/${stat.passAttempts.toString()}`
        : '—',
    'Pass %': formatPct(stat.passCompletions, stat.passAttempts),
    Saucer: stat.saucerPasses.toString(),
    Possession: formatClock(stat.possession),
    'FO W–L': foTotal > 0 ? `${stat.faceoffWins.toString()}–${stat.faceoffLosses.toString()}` : '—',
    'FO %': formatPct(stat.faceoffWins, foTotal),
    PPG: stat.ppGoals.toString(),
    SHG: stat.shGoals.toString(),
    PIM: stat.pim.toString(),
    'Pen. Drawn': stat.penaltiesDrawn.toString(),
    Hits: stat.hits.toString(),
    Blocks: stat.blockedShots.toString(),
    Interceptions: stat.interceptions.toString(),
    Takeaways: stat.takeaways.toString(),
    Giveaways: stat.giveaways.toString(),
    TOI: formatClock(stat.toiSeconds),
    '+/−': signed(stat.plusMinus),
  }
}

const STAT_CATEGORIES: readonly { title: string; labels: readonly string[] }[] = [
  { title: 'Shooting', labels: ['Shots / Att', 'Shot on Net %', 'Shooting %', 'Deflections'] },
  { title: 'Passing & Poss', labels: ['Passes / Att', 'Pass %', 'Saucer', 'Possession'] },
  { title: 'Faceoffs', labels: ['FO W–L', 'FO %'] },
  { title: 'Special Teams', labels: ['PPG', 'SHG'] },
  { title: 'Discipline', labels: ['PIM', 'Pen. Drawn'] },
  { title: 'Defense', labels: ['Hits', 'Blocks', 'Interceptions'] },
  { title: 'Turnovers', labels: ['Takeaways', 'Giveaways'] },
  { title: 'Workload', labels: ['TOI', '+/−'] },
]

export interface StatRow {
  label: string
  value: string
}

export interface StatGroup {
  title: string
  rows: StatRow[]
}

/**
 * The 8 grouped category tables for ONE player — the prototype's `deepCats`.
 * Groups whose every row is `—` are dropped rather than rendered as an empty
 * frame (a skater with no special-teams goals shouldn't get a SPECIAL TEAMS
 * card that says nothing).
 */
export function buildStatTables(stat: HeadToHeadStatLine | null): StatGroup[] {
  const values = statLineValues(stat)
  return STAT_CATEGORIES.map((cat) => ({
    title: cat.title,
    rows: cat.labels.map((label) => ({ label, value: values[label] ?? '—' })),
  })).filter((g) => g.rows.some((r) => r.value !== '—'))
}
