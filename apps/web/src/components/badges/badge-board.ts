/**
 * View model for the Player Badges section (Player Badges.dc.html): rows,
 * groups, totals, and the level → look mapping. Pure; no React.
 */
import {
  BADGE_FAMILIES,
  BADGE_GROUPS,
  BADGE_LADDERS,
  type LadderSet,
  BADGE_MAX_LEVEL,
  CARD_THEME_NAMES,
  CARD_THEME_ORDER,
  badgeProgress,
} from '@eanhl/db/cards'
import type {
  BadgeFamily,
  BadgeFamilyId,
  BadgeGroup,
  BadgeProgress,
  BadgeShapeId,
  CardThemeKey,
} from '@eanhl/db/cards'

export type BadgeFrame = 'single' | 'double' | 'heavy'
type Step = 1 | 2 | 3

const FRAME_BY_STEP = { 1: 'single', 2: 'double', 3: 'heavy' } as const

export interface BadgeVisual {
  theme: CardThemeKey
  step: Step
  frame: BadgeFrame
}

/**
 * Level → look: theme index ceil(lvl/3)−1 into the card theme order, step
 * (lvl−1)%3+1 shown as the frame. A locked badge (level 0) is drawn as level 1
 * and dimmed by the caller.
 */
export function badgeVisual(level: number): BadgeVisual {
  const l = Math.min(BADGE_MAX_LEVEL, Math.max(1, Math.floor(level)))
  const theme = CARD_THEME_ORDER[Math.ceil(l / 3) - 1] ?? 'away'
  const step = (((l - 1) % 3) + 1) as Step
  return { theme, step, frame: FRAME_BY_STEP[step] }
}

export function themeLabel(level: number): string {
  if (level <= 0) return 'Locked'
  const v = badgeVisual(level)
  return `${CARD_THEME_NAMES[v.theme]} ${String(v.step)}`
}

/** A badge's caption on the card: short name and the level as a number (no Roman numerals). */
export function badgeCaption(short: string, level: number): string {
  return `${short} ${String(level)}`
}

/** Fixed locale so server and browser render identical text (no hydration mismatch). */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

export interface BadgeRowInput {
  familyId: BadgeFamilyId
  value: number
}

export interface BadgeRowView {
  family: BadgeFamily
  shape: BadgeShapeId
  progress: BadgeProgress
  locked: boolean
  themeLabel: string
  progressText: string
  remainingText: string
  /** Where the value comes from: club games, or EA totals that include drop-ins. */
  sourceText: string
}

export interface BadgeGroupView {
  group: BadgeGroup
  members: BadgeRowView[]
  unlocked: number
}

export interface BadgeBoardView {
  groups: BadgeGroupView[]
  rows: BadgeRowView[]
  unlocked: number
  total: number
  levels: number
  maxLevels: number
}

export function buildBadgeBoard(
  input: readonly BadgeRowInput[],
  ladders: LadderSet = BADGE_LADDERS,
): BadgeBoardView {
  const valueById = new Map(input.map((r) => [r.familyId, r.value]))
  const shapeByGroup = new Map(BADGE_GROUPS.map((g) => [g.id, g.shape]))
  const rows: BadgeRowView[] = BADGE_FAMILIES.map((family) => {
    const progress = badgeProgress(ladders[family.id], valueById.get(family.id) ?? 0)
    return {
      family,
      shape: shapeByGroup.get(family.group) ?? 'hex',
      progress,
      locked: progress.level === 0,
      themeLabel: themeLabel(progress.level),
      progressText:
        progress.nextThreshold === null
          ? `Maxed · ${formatCount(progress.value)} ${family.unit}`
          : `${formatCount(progress.value)} / ${formatCount(progress.nextThreshold)} ${family.unit}`,
      remainingText:
        progress.remaining === null
          ? ''
          : `${formatCount(progress.remaining)} to LVL ${String(progress.level + 1)}`,
      sourceText:
        family.source === 'ea' ? 'EA season totals · includes drop-ins' : 'Counts club games only',
    }
  })
  const groups = BADGE_GROUPS.map((group) => {
    const members = rows.filter((r) => r.family.group === group.id)
    return { group, members, unlocked: members.filter((m) => !m.locked).length }
  })
  return {
    groups,
    rows,
    unlocked: rows.filter((r) => !r.locked).length,
    total: rows.length,
    levels: rows.reduce((sum, r) => sum + r.progress.level, 0),
    maxLevels: rows.length * BADGE_MAX_LEVEL,
  }
}

/** Initially selected badge: the highest level (ties → catalog order). */
export function defaultSelection(board: BadgeBoardView): BadgeFamilyId {
  let best: BadgeRowView | undefined
  for (const r of board.rows)
    if (best === undefined || r.progress.level > best.progress.level) best = r
  return best?.family.id ?? 'p3v3'
}
