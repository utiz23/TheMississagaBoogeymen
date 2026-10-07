/**
 * Builds card view models from the data each surface already loads:
 * roster rows (+ getCardProgressForPlayers) for lists, and the player-page
 * profile/career/game-log data (+ getPlayerCardProgress) for the hero.
 * Structural input types only — no runtime import of the db client.
 */
import { pickBestBadge, resolveCardTheme } from '@eanhl/db/cards'
import type { BadgeFamilyId, CardThemeKey, CardTier, MythicThemeKey } from '@eanhl/db/cards'
import {
  buildBadgeShowcase,
  buildLast10,
  buildLedger,
  cardStats,
  formatRecord,
  formatWinPct,
  positionTag,
  type CardCareerRow,
  type CardGame,
  type CardRole,
  type CardViewModel,
} from './card-model.ts'

/** Fields a list card reads; getEARoster / getRoster rows satisfy this. */
export interface CardRosterRow {
  playerId: number
  gamertag: string
  playerName: string | null
  jerseyNumber: number | null
  position: string | null
  favoritePosition: string | null
  preferredPosition: string | null
  skaterWins: number | null
  skaterLosses: number | null
  skaterOtl: number | null
  goalieWins: number | null
  goalieLosses: number | null
  goalieOtl: number | null
  skaterGp: number
  goalieGp: number
  goals: number
  assists: number
  points: number
  savePct: string | null
  gaa: string | null
  nationality: string | null
  clientPlatform: string | null
}

/** getCardProgressForPlayers value. */
export interface CardSummaryInput {
  tier: CardTier
  level: number
  theme: CardThemeKey
  bestBadge: { familyId: BadgeFamilyId; level: number } | null
}

const jersey = (n: number | null) => (n === null ? '##' : String(n))

export function cardFromRosterRow(row: CardRosterRow, summary?: CardSummaryInput): CardViewModel {
  const effective = row.preferredPosition ?? row.favoritePosition ?? row.position
  const role: CardRole = effective === 'goalie' ? 'goalie' : 'skater'
  const [w, l, otl] =
    role === 'goalie'
      ? [row.goalieWins, row.goalieLosses, row.goalieOtl]
      : [row.skaterWins, row.skaterLosses, row.skaterOtl]
  return {
    front: {
      playerId: row.playerId,
      name: row.playerName ?? row.gamertag,
      jersey: jersey(row.jerseyNumber),
      role,
      position: positionTag(effective),
      record: formatRecord(w, l, otl),
      winPct: formatWinPct(w, l, otl),
      stats: cardStats(role, row),
      platform: row.clientPlatform,
      nationality: row.nationality,
      tier: summary?.tier ?? 1,
      level: summary?.level ?? 1,
      theme: summary?.theme ?? 'away',
      badge: summary?.bestBadge ?? null,
    },
    back: null,
  }
}

export interface CardProfileInput {
  player: {
    id: number
    gamertag: string
    playerName: string | null
    jerseyNumber: number | null
    nationality: string | null
    position: string | null
    preferredPosition: string | null
  }
  /** The newest EA season row (getPlayerProfileOverview().currentEaSeason). */
  season: {
    gameTitleId: number
    favoritePosition: string | null
    clientPlatform: string | null
    skaterGp: number
    goalieGp: number
    goals: number
    assists: number
    points: number
    skaterWins: number | null
    skaterLosses: number | null
    skaterOtl: number | null
    goalieWins: number | null
    goalieLosses: number | null
    goalieOtl: number | null
    goalieSavePct: string | null
    goalieGaa: string | null
  } | null
  /** Newest first (getPlayerProfileOverview().trendGames). */
  trendGames: readonly CardGame[]
  /** getPlayerCareerSeasons rows, newest first. */
  career: readonly CardCareerRow[]
  role: CardRole
  /** getPlayerCardProgress result, or null when it failed to load. */
  progress: {
    standing: { tier: CardTier; level: number; mythicTheme: MythicThemeKey | null } | null
    badges: readonly { familyId: BadgeFamilyId; value: number; level: number }[]
  } | null
}

function careerSource(career: readonly CardCareerRow[]): string {
  const newest = career[0]?.gameTitleName
  const oldest = career[career.length - 1]?.gameTitleName
  if (newest === undefined || oldest === undefined) return 'CAREER'
  if (newest === oldest) return `CAREER · ${newest.toUpperCase()}`
  return `CAREER · ${oldest.toUpperCase()}–${newest.replace(/^NHL\s*/i, '')}`
}

export function cardFromProfile(input: CardProfileInput): CardViewModel {
  const { player, season, role, progress } = input
  // Same fallback chain as the live hero's position pill.
  const preferred = player.preferredPosition ?? season?.favoritePosition ?? player.position
  const position = role === 'goalie' ? 'G' : positionTag(preferred === 'goalie' ? null : preferred)
  const [w, l, otl] =
    season === null
      ? [null, null, null]
      : role === 'goalie'
        ? [season.goalieWins, season.goalieLosses, season.goalieOtl]
        : [season.skaterWins, season.skaterLosses, season.skaterOtl]
  const totals = {
    skaterGp: season?.skaterGp ?? 0,
    goalieGp: season?.goalieGp ?? 0,
    goals: season?.goals ?? 0,
    assists: season?.assists ?? 0,
    points: season?.points ?? 0,
    goalieWins: season?.goalieWins ?? null,
    savePct: season?.goalieSavePct ?? null,
    gaa: season?.goalieGaa ?? null,
  }
  const standing = progress?.standing ?? null
  const tier: CardTier = standing?.tier ?? 1
  const badges = (progress?.badges ?? []).map((b) => ({ familyId: b.familyId, level: b.level }))
  return {
    front: {
      playerId: player.id,
      name: player.playerName ?? player.gamertag,
      jersey: jersey(player.jerseyNumber),
      role,
      position,
      record: formatRecord(w, l, otl),
      winPct: formatWinPct(w, l, otl),
      stats:
        season === null
          ? cardStats(role, totals).map((s) => ({ label: s.label, value: '—' }))
          : cardStats(role, totals),
      platform: season?.clientPlatform ?? null,
      nationality: player.nationality,
      tier,
      level: standing?.level ?? 1,
      theme: resolveCardTheme(tier, standing?.mythicTheme ?? null),
      badge: pickBestBadge(badges),
    },
    back: {
      ledger: buildLedger(
        role,
        buildLast10(input.trendGames, role),
        input.career,
        season?.gameTitleId ?? null,
      ),
      badges: buildBadgeShowcase(badges, role),
      source: careerSource(input.career),
    },
  }
}
