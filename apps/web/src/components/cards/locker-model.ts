/**
 * Card Locker view model (Card Locker.dc.html renderVals; spec Part 3). Pure:
 * the page builds it on the server, so dates are formatted once with a fixed
 * zone and locale and the client renders strings only. Read-only until member
 * logins exist (D1/D10): every theme's action is shown but never enabled.
 */
import {
  BADGE_FAMILIES,
  BADGE_GROUPS,
  CARD_THEME_NAMES,
  CARD_THEME_ORDER,
  FAMILIES_PER_TIER,
  TIER_LABELS,
  TIER_THEME,
  isThemeEquippable,
  poolOf,
  themeTier,
  tierBar,
} from '@eanhl/db/cards'
import type {
  BadgeFamilyId,
  BadgeShapeId,
  CardEventKind,
  CardThemeKey,
  CardTier,
  MythicThemeKey,
  TierPool,
} from '@eanhl/db/cards'
import { badgeVisual } from '../badges/badge-board.ts'
import type { CardViewModel } from './card-model'

/** The operator's zone (docker-compose BACKUP_TZ default): history dates read as local days. */
export const LOCKER_TIME_ZONE = 'America/Edmonton'

/** Rail labels (Card Locker.dc.html SHORT). */
const THEME_SHORT: Readonly<Record<CardThemeKey, string>> = {
  away: 'AWAY',
  home: 'HOME',
  alternate: 'ALT',
  carbon: 'CARBON',
  futureB: 'HARDLIGHT',
  frozen: 'FROZEN',
  futureC: 'CYBER',
  inferno: 'INFERNO',
  stormLive: 'STORM',
  olympus: 'MAXIMUS',
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'] as const
const ROW_COUNT = 6
const TIERS: readonly CardTier[] = [1, 2, 3, 4, 5, 6]

export interface LockerEventInput {
  kind: CardEventKind
  familyId: BadgeFamilyId | null
  fromValue: number
  toValue: number
  occurredAt: Date
}

export interface LockerInput {
  /** Card name (real name, else gamertag). */
  name: string
  /** What the card shows (the preview's URL params may override the stored standing). */
  tier: CardTier
  level: number
  equipped: CardThemeKey
  /** The club-awarded mythic on this card (the only mythic it can wear). */
  mythicTheme?: MythicThemeKey | null
  /** True when the card follows its tier (no pick, or the pick is locked here). Default true. */
  auto?: boolean
  /** The viewer may equip on this card (it's theirs, or they're an admin). Default false. */
  canEdit?: boolean
  /** Pool that set the tier; null before the worker's first recompute. */
  pool: TierPool | 'manual' | null
  badges: readonly { familyId: BadgeFamilyId; level: number }[]
  /** Newest first (getPlayerCardProgress order). */
  events: readonly LockerEventInput[]
  /** When the card history began; null before the first recompute. */
  trackedSince: Date | null
  /** The season (game title) this card belongs to, e.g. "NHL 27"; null before the first card. */
  seasonName?: string | null
}

export type ThemeStatus = 'locked' | 'equipped' | 'unlocked'

export interface LockerTheme {
  key: CardThemeKey
  name: string
  short: string
  tier: CardTier
  status: ThemeStatus
  /** 'T6 · LOCKED · PREVIEW' | 'T4 · EQUIPPED (AUTO)' | 'T2 · UNLOCKED' */
  tag: string
  /** Primary button label. */
  action: string
  /** The primary button can equip this theme (given `canEdit`). */
  equippable: boolean
  /** Extra sentence for a locked theme's requirement block, or null. */
  unlockNote: string | null
}

export interface LockerRequirement {
  title: string
  count: string
  /** Bar fill 0–100, or null when no bar applies (T6 is awarded, not earned). */
  pct: number | null
  note: string
}

export interface LockerBadgeRow {
  familyId: BadgeFamilyId
  short: string
  shape: BadgeShapeId
  /** Badge look by level (level 0 drawn as level 1 and dimmed by the caller). */
  theme: CardThemeKey
  locked: boolean
  done: boolean
  pct: number
  value: string
}

export interface LockerTrackStep {
  tier: CardTier
  label: string
  theme: string
  note: string | null
  state: 'done' | 'now' | 'next'
}

export interface LockerHistoryItem {
  date: string
  text: string
}

export interface LockerView {
  /** 'IGOR ORLOV · NHL 27 · T4 ELITE · LVL 6/10 · 4 / 10 THEMES' (season when known) */
  subline: string
  tierLabel: string
  level: number
  levelNote: string
  unlockedCount: number
  /** The card follows its tier (AUTO); false once the member equipped a theme. */
  auto: boolean
  /** The viewer may equip on this card. */
  canEdit: boolean
  themes: LockerTheme[]
  requirement: LockerRequirement
  rows: LockerBadgeRow[]
  track: LockerTrackStep[]
  history: LockerHistoryItem[]
  /** Shown when history is empty. */
  historyEmpty: string
}

const upper = (s: string) => s.toUpperCase()
const tierName = (t: CardTier) => `T${String(t)} ${TIER_LABELS[t]}`
const clampTier = (n: number) => Math.min(6, Math.max(1, Math.round(n))) as CardTier

function poolFamilies(pool: TierPool) {
  return BADGE_FAMILIES.filter((f) => poolOf(f) === pool)
}

function buildRequirement(
  tier: CardTier,
  pool: TierPool,
  levels: ReadonlyMap<BadgeFamilyId, number>,
): LockerRequirement {
  if (tier === 6) {
    return {
      title: `T6 ${upper(TIER_LABELS[6])} · MAX TIER`,
      count: 'COMPLETE',
      pct: 100,
      note: 'Every regular theme, plus the mythic the club awarded.',
    }
  }
  if (tier === 5) {
    return {
      title: `NEXT · T6 ${upper(TIER_LABELS[6])}`,
      count: 'AWARDED',
      pct: null,
      note: 'T6 mythic cards are awarded by the club, not earned from stats.',
    }
  }
  const next = clampTier(tier + 1)
  const bar = tierBar(next)
  const met = poolFamilies(pool).filter((f) => (levels.get(f.id) ?? 0) >= bar).length
  const shown = Math.min(met, FAMILIES_PER_TIER)
  return {
    title: `NEXT · ${upper(tierName(next))}`,
    count: `${String(shown)} / ${String(FAMILIES_PER_TIER)} BADGES`,
    pct: Math.round((shown / FAMILIES_PER_TIER) * 100),
    note: `${String(FAMILIES_PER_TIER)} ${pool} badges at Tier ${ROMAN[next - 1] ?? ''} (LVL ${String(bar)}+).`,
  }
}

function buildRows(
  tier: CardTier,
  pool: TierPool,
  levels: ReadonlyMap<BadgeFamilyId, number>,
): LockerBadgeRow[] {
  if (tier >= 5) return []
  const bar = tierBar(tier + 1)
  // BADGE_FAMILIES is in catalog order and sort is stable, so ties keep catalog order.
  return poolFamilies(pool)
    .map((f) => ({ f, level: levels.get(f.id) ?? 0 }))
    .sort((a, b) => b.level - a.level)
    .slice(0, ROW_COUNT)
    .map(({ f, level }) => {
      const done = level >= bar
      return {
        familyId: f.id,
        short: f.short,
        shape: BADGE_GROUPS.find((g) => g.id === f.group)?.shape ?? 'hex',
        theme: badgeVisual(level).theme,
        locked: level === 0,
        done,
        pct: Math.min(100, Math.round((level / bar) * 100)),
        value: done ? 'DONE' : `LVL ${String(level)}/${String(bar)}`,
      }
    })
}

function unlockNote(name: string, themeT: CardTier, tier: CardTier): string | null {
  if (themeT === 6 && tier === 6) return `${name} is not this card's awarded mythic.`
  if (themeT === 6) return tier === 5 ? null : `${name} is a T6 mythic, awarded by the club.`
  return themeT > tier + 1 ? `${name} unlocks at ${tierName(themeT)}.` : null
}

function buildThemes(
  tier: CardTier,
  equipped: CardThemeKey,
  mythicTheme: MythicThemeKey | null,
  auto: boolean,
): LockerTheme[] {
  return CARD_THEME_ORDER.map((key) => {
    const t = themeTier(key)
    const name = CARD_THEME_NAMES[key]
    const status: ThemeStatus =
      key === equipped
        ? 'equipped'
        : isThemeEquippable(key, tier, mythicTheme)
          ? 'unlocked'
          : 'locked'
    const state =
      status === 'locked'
        ? 'LOCKED · PREVIEW'
        : status === 'equipped'
          ? auto
            ? 'EQUIPPED (AUTO)'
            : 'EQUIPPED'
          : 'UNLOCKED'
    // Under AUTO the shown theme can still be equipped: that pins it, so a
    // later tier-up no longer changes the card.
    const equippable = status === 'unlocked' || (status === 'equipped' && auto)
    return {
      key,
      name,
      short: THEME_SHORT[key],
      tier: t,
      status,
      tag: `T${String(t)} · ${state}`,
      action: status === 'locked' ? 'LOCKED' : equippable ? `EQUIP ${upper(name)}` : 'EQUIPPED',
      equippable,
      unlockNote: status === 'locked' ? unlockNote(name, t, tier) : null,
    }
  })
}

function describeEvent(e: LockerEventInput): string {
  switch (e.kind) {
    case 'tier_up': {
      const to = clampTier(e.toValue)
      const theme = to === 6 ? 'Mythic' : CARD_THEME_NAMES[TIER_THEME[to]]
      return `${tierName(to)} · ${theme} unlocked`
    }
    case 'level_up':
      return `Level ${String(e.toValue)} reached`
    case 'badge_level_up': {
      const family = BADGE_FAMILIES.find((f) => f.id === e.familyId)
      return `${family?.name ?? 'Badge'} · Level ${String(e.toValue)}`
    }
    case 'mythic_awarded':
      return `${tierName(6)} · Mythic card awarded`
    case 'mythic_cleared':
      return `Mythic cleared · back to T${String(e.toValue)}`
  }
}

export function buildLockerView(input: LockerInput, timeZone = LOCKER_TIME_ZONE): LockerView {
  const { tier, level } = input
  const pool: TierPool = input.pool === 'goalie' ? 'goalie' : 'skater'
  const levels = new Map(input.badges.map((b) => [b.familyId, b.level]))
  const mythicTheme = input.mythicTheme ?? null
  const auto = input.auto ?? true
  const themes = buildThemes(tier, input.equipped, mythicTheme, auto)
  const unlockedCount = CARD_THEME_ORDER.filter((k) =>
    isThemeEquippable(k, tier, mythicTheme),
  ).length
  const chip = `${upper(tierName(tier))} · LVL ${String(level)}/10`
  const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone })
  const longFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  })
  const next = clampTier(tier + 1)
  return {
    subline: [
      upper(input.name),
      ...(input.seasonName ? [upper(input.seasonName)] : []),
      chip,
      `${String(unlockedCount)} / 10 THEMES`,
    ].join(' · '),
    tierLabel: upper(TIER_LABELS[tier]),
    level,
    levelNote:
      tier === 6
        ? 'Top tier. Level stays full.'
        : tier === 5
          ? 'Top tier from stats. Level stays full.'
          : `Average progress of the best ${String(FAMILIES_PER_TIER)} ${pool} badges toward ${tierName(next)}. Never goes down.`,
    unlockedCount,
    auto,
    canEdit: input.canEdit ?? false,
    themes,
    requirement: buildRequirement(tier, pool, levels),
    rows: buildRows(tier, pool, levels),
    track: TIERS.map((n) => ({
      tier: n,
      label: upper(TIER_LABELS[n]),
      theme: n === 6 ? '5 MYTHICS' : upper(CARD_THEME_NAMES[TIER_THEME[n]]),
      note: n === 6 ? 'AWARDED' : null,
      state: n < tier ? 'done' : n === tier ? 'now' : 'next',
    })),
    history: input.events.map((e) => ({
      date: upper(dayFmt.format(e.occurredAt)),
      text: describeEvent(e),
    })),
    historyEmpty:
      input.trackedSince === null
        ? 'No card history yet.'
        : `History starts ${longFmt.format(input.trackedSince)}.`,
  }
}

/**
 * The browsed theme on this player's card (prototype previewCfg): a locked
 * theme shows at its own tier and level 1; an unlocked one at the player's.
 * Front only: the preview never flips.
 */
export function lockerPreviewCard(card: CardViewModel, theme: LockerTheme): CardViewModel {
  const locked = theme.status === 'locked'
  return {
    back: null,
    front: {
      ...card.front,
      theme: theme.key,
      tier: locked ? theme.tier : card.front.tier,
      level: locked ? 1 : card.front.level,
    },
  }
}
