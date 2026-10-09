import type { ClubSeasonLine } from '@eanhl/db/queries'
import type { ClubAward, VotedTrophy } from './club-awards'

/**
 * Profile "Awards" trophy case (Awards Trophy Case.dc.html): club records,
 * season-leader trophies and career milestones worked out from season lines,
 * plus the hand-entered club-vote trophies and championship banners
 * (`club-awards.ts`).
 */

export type AwardStat = 'G' | 'A' | 'PTS' | 'GP' | 'W' | 'SO'
export type AwardTier = 'bronze' | 'silver' | 'gold'
export type AwardKind = 'alltime' | 'record' | 'trophy' | 'banner' | 'milestone'
export type AwardSymbolKind =
  | 'mvp'
  | 'scorer'
  | 'assist'
  | 'points'
  | 'defense'
  | 'rookie'
  | 'banner-3s'
  | 'banner-arcade'
  | 'record'
  | 'alltime'
  | 'milestone'

export interface AwardItem {
  id: string
  kind: AwardKind
  symbol: AwardSymbolKind
  /** e.g. "Most Goals, Single Season". */
  name: string
  /** Tile label, e.g. "Most goals · season". */
  short: string
  /** Tile sub-label: "All-time", "NHL 26", or "Reached NHL 26" (milestone). */
  when: string
  /** Sort key: the title's release order (newest first within a kind). */
  order: number
  /** Stat on a record or milestone plate; null for trophies and banners. */
  stat: AwardStat | null
  /** The number on the symbol ("1,306", "24"); empty for trophies. */
  glyph: string
  tier: AwardTier | null
  /** Detail-panel eyebrow, e.g. "Gold · Career milestone · reached NHL 26". */
  kindLabel: string
  basis: string
  meta: string
}

export interface PlayerAwardsView {
  items: AwardItem[]
  /** The player's first and last titles, e.g. "NHL 22–NHL 27". */
  span: string
  totals: { trophies: number; banners: number; accolades: number }
}

const STATS: Record<AwardStat, { word: string; get: (l: ClubSeasonLine) => number }> = {
  G: { word: 'goals', get: (l) => l.goals },
  A: { word: 'assists', get: (l) => l.assists },
  PTS: { word: 'points', get: (l) => l.points },
  GP: { word: 'games played', get: (l) => l.skaterGp + l.goalieGp },
  W: { word: 'goalie wins', get: (l) => l.wins },
  SO: { word: 'shutouts', get: (l) => l.shutouts },
}

const SEASON_RECORD_STATS: readonly AwardStat[] = ['G', 'A', 'PTS', 'W', 'SO']
const ALLTIME_RECORD_STATS: readonly AwardStat[] = ['G', 'A', 'PTS', 'GP', 'W', 'SO']

/** Season-leader trophies, awarded for every finished title. */
const LEADERS: readonly { stat: AwardStat; symbol: AwardSymbolKind; name: string }[] = [
  { stat: 'G', symbol: 'scorer', name: 'Leading Scorer' },
  { stat: 'A', symbol: 'assist', name: 'Leading Assists' },
  { stat: 'PTS', symbol: 'points', name: 'Leading Points' },
]

const VOTED: Record<VotedTrophy, string> = {
  mvp: 'Team MVP',
  defense: 'Defensive Player of the Year',
  rookie: 'Rookie of the Year',
}
const VOTED_SHORT: Record<VotedTrophy, string> = {
  mvp: 'Team MVP',
  defense: 'Defensive POY',
  rookie: 'Rookie of the Year',
}
const BANNER = {
  '3s': { symbol: 'banner-3s', name: '3v3 Champions', mode: '3v3' },
  arcade: { symbol: 'banner-arcade', name: 'Arcade Champions', mode: 'Arcade' },
} as const

/** Career totals that earn a milestone: [threshold, tier]. */
export const MILESTONES: Partial<Record<AwardStat, readonly (readonly [number, AwardTier])[]>> = {
  G: [
    [250, 'bronze'],
    [500, 'silver'],
    [1000, 'gold'],
    [1500, 'gold'],
    [2000, 'gold'],
    [2500, 'gold'],
    [3000, 'gold'],
  ],
  A: [
    [250, 'bronze'],
    [500, 'silver'],
    [1000, 'gold'],
    [1500, 'gold'],
    [2000, 'gold'],
    [2500, 'gold'],
    [3000, 'gold'],
  ],
  PTS: [
    [500, 'bronze'],
    [1000, 'silver'],
    [2000, 'gold'],
    [3000, 'gold'],
    [4000, 'gold'],
    [5000, 'gold'],
  ],
  GP: [
    [250, 'bronze'],
    [500, 'silver'],
    [1000, 'gold'],
    [1500, 'gold'],
    [2000, 'gold'],
    [2500, 'gold'],
  ],
  W: [
    [100, 'bronze'],
    [250, 'silver'],
    [500, 'gold'],
    [1000, 'gold'],
  ],
}
/** These keep only the highest milestone reached — one plaque each. */
const SINGLE_PLAQUE: ReadonlySet<AwardStat> = new Set(['G', 'A', 'PTS'])

const STAT_ORDER: readonly AwardStat[] = ['G', 'A', 'PTS', 'GP', 'W', 'SO']
const SYMBOL_ORDER: readonly AwardSymbolKind[] = [
  'mvp',
  'scorer',
  'assist',
  'points',
  'defense',
  'rookie',
  'banner-3s',
  'banner-arcade',
]
const KIND_ORDER: Record<AwardKind, number> = {
  alltime: 0,
  record: 1,
  trophy: 2,
  banner: 3,
  milestone: 4,
}

const fmt = (n: number): string => n.toLocaleString('en-US')
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const titleCase = (s: string): string => s.split(' ').map(cap).join(' ')
const order = (l: { releaseOrder: number | null }): number =>
  l.releaseOrder ?? Number.MAX_SAFE_INTEGER
const listNames = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`

interface Entry {
  playerId: number
  gamertag: string
  value: number
  season: string | null
}

/** Everyone tied at the top, plus the best entry that isn't the holder's own. */
function rank(entries: Entry[]): { top: Entry[]; next: Entry | undefined } {
  const sorted = entries.filter((e) => e.value > 0).sort((a, b) => b.value - a.value)
  const best = sorted[0]
  if (best === undefined) return { top: [], next: undefined }
  const top = sorted.filter((e) => e.value === best.value)
  return { top, next: sorted[top.length] }
}

function nextBest(next: Entry | undefined): string {
  if (next === undefined) return ''
  const where = next.season === null ? next.gamertag : `${next.gamertag}, ${next.season}`
  return ` Next best: ${fmt(next.value)} (${where}).`
}

function sharedWith(top: Entry[], playerId: number, withSeason = true): string {
  const others = top.filter((e) => e.playerId !== playerId)
  if (others.length === 0) return ''
  const names = others.map((e) =>
    !withSeason || e.season === null ? e.gamertag : `${e.gamertag}, ${e.season}`,
  )
  return ` Shared with ${listNames(names)}.`
}

export function buildPlayerAwards(
  lines: readonly ClubSeasonLine[],
  playerId: number,
  clubAwards: readonly ClubAward[] = [],
): PlayerAwardsView {
  const own = lines.filter((l) => l.playerId === playerId).sort((a, b) => order(a) - order(b))
  const titleOrder = new Map(lines.map((l) => [l.gameTitleName, order(l)]))
  const gamertags = new Map(lines.map((l) => [l.playerId, l.gamertag]))
  const titles = [...titleOrder].sort((a, b) => a[1] - b[1])
  const newestTitle = titles[titles.length - 1]?.[0] ?? ''
  const newestOrder = titles[titles.length - 1]?.[1] ?? 0
  const mineClub = clubAwards.filter((a) => a.playerIds.includes(playerId))

  const items: AwardItem[] = []

  // Single-season club records: best player-title line for each stat.
  for (const stat of SEASON_RECORD_STATS) {
    const { word, get } = STATS[stat]
    const { top, next } = rank(
      lines.map((l) => ({
        playerId: l.playerId,
        gamertag: l.gamertag,
        value: get(l),
        season: l.gameTitleName,
      })),
    )
    for (const e of top.filter((t) => t.playerId === playerId)) {
      const season = e.season ?? ''
      const at = titleOrder.get(season) ?? 0
      items.push({
        id: `record-${stat}-${season}`,
        kind: 'record',
        symbol: 'record',
        name: `Most ${titleCase(word)}, Single Season`,
        short: `Most ${word} · season`,
        when: season,
        order: at,
        stat,
        glyph: fmt(e.value),
        tier: null,
        kindLabel: `Single-season record · ${season}`,
        basis: `Club record for ${word} in one season.${sharedWith(top, playerId)}${nextBest(next)}`,
        meta: at === newestOrder ? `Set ${season} · season in progress` : `Set ${season}`,
      })
    }
  }

  // Season-leader trophies for every title but the newest, still in progress.
  for (const [title, at] of titles) {
    if (at === newestOrder) continue
    const inTitle = lines.filter((l) => l.gameTitleName === title)
    for (const { stat, symbol, name } of LEADERS) {
      const { word, get } = STATS[stat]
      const { top, next } = rank(
        inTitle.map((l) => ({
          playerId: l.playerId,
          gamertag: l.gamertag,
          value: get(l),
          season: title,
        })),
      )
      const mine = top.find((t) => t.playerId === playerId)
      if (mine === undefined) continue
      items.push({
        id: `trophy-${symbol}-${title}`,
        kind: 'trophy',
        symbol,
        name,
        short: name,
        when: title,
        order: at,
        stat: null,
        glyph: '',
        tier: null,
        kindLabel: `Club trophy · ${title}`,
        basis: `Most ${word} on the club in ${title}: ${fmt(mine.value)}.${sharedWith(top, playerId, false)}${
          next === undefined ? '' : ` Next best: ${fmt(next.value)} (${next.gamertag}).`
        }`,
        meta: `${title} · club stats`,
      })
    }
  }

  // Hand-entered club-vote trophies and championship banners.
  for (const a of mineClub) {
    const at = titleOrder.get(a.title) ?? 0
    if (a.kind === 'trophy') {
      items.push({
        id: `trophy-${a.trophy}-${a.title}`,
        kind: 'trophy',
        symbol: a.trophy,
        name: VOTED[a.trophy],
        short: VOTED_SHORT[a.trophy],
        when: a.title,
        order: at,
        stat: null,
        glyph: '',
        tier: null,
        kindLabel: `Club trophy · ${a.title}`,
        basis: `Voted by the club at the end of ${a.title}.`,
        meta: `${a.title} · club vote`,
      })
    } else {
      const b = BANNER[a.mode]
      const mates = a.playerIds
        .filter((id) => id !== playerId)
        .map((id) => gamertags.get(id))
        .filter((g): g is string => g !== undefined)
      items.push({
        id: `banner-${a.mode}-${a.title}`,
        kind: 'banner',
        symbol: b.symbol,
        name: b.name,
        short: b.name,
        when: a.title,
        order: at,
        stat: null,
        glyph: a.title.replace(/^\D+/, ''),
        tier: null,
        kindLabel: `Championship banner · ${b.mode} · ${a.title}`,
        basis: `${b.mode} champions in ${a.title}.${
          mates.length === 0 ? '' : ` Won with ${listNames(mates)}.`
        }`,
        meta: `Champions · ${a.title}`,
      })
    }
  }

  // Career totals, oldest title first, for all-time records and milestones.
  const careers = new Map<number, { gamertag: string; lines: ClubSeasonLine[] }>()
  for (const l of [...lines].sort((a, b) => order(a) - order(b))) {
    const c = careers.get(l.playerId) ?? { gamertag: l.gamertag, lines: [] }
    c.lines.push(l)
    careers.set(l.playerId, c)
  }

  for (const stat of ALLTIME_RECORD_STATS) {
    const { word, get } = STATS[stat]
    const { top, next } = rank(
      [...careers].map(([id, c]) => ({
        playerId: id,
        gamertag: c.gamertag,
        value: c.lines.reduce((s, l) => s + get(l), 0),
        season: null,
      })),
    )
    const mine = top.find((t) => t.playerId === playerId)
    if (mine === undefined) continue
    items.push({
      id: `alltime-${stat}`,
      kind: 'alltime',
      symbol: 'alltime',
      name: stat === 'GP' ? 'Most Games Played' : `Most Career ${titleCase(word)}`,
      short: `Most ${stat === 'GP' ? 'GP' : word} · all-time`,
      when: 'All-time',
      order: newestOrder,
      stat,
      glyph: fmt(mine.value),
      tier: null,
      kindLabel: 'All-time record',
      basis: `Club all-time record for ${word}.${sharedWith(top, playerId)}${nextBest(next)}`,
      meta: `Active · through ${newestTitle}`,
    })
  }

  // Career milestones: the title in which each threshold was crossed.
  for (const stat of STAT_ORDER) {
    const ladder = MILESTONES[stat]
    if (ladder === undefined) continue
    const { word, get } = STATS[stat]
    const career = own.reduce((s, x) => s + get(x), 0)
    const reached: AwardItem[] = []
    let total = 0
    for (const l of own) {
      const before = total
      total += get(l)
      for (const [at, tier] of ladder) {
        if (before >= at || total < at) continue
        const statWord = stat === 'GP' ? 'GP' : stat === 'W' ? 'wins' : stat
        reached.push({
          id: `milestone-${stat}-${String(at)}`,
          kind: 'milestone',
          symbol: 'milestone',
          name: stat === 'GP' ? `${fmt(at)} Games Played` : `${fmt(at)} Career ${titleCase(word)}`,
          short: `${fmt(at)} career ${statWord}`,
          when: `Reached ${l.gameTitleName}`,
          order: order(l),
          stat,
          glyph: fmt(at),
          tier,
          kindLabel: `${cap(tier)} · Career milestone · reached ${l.gameTitleName}`,
          basis: `Reached ${fmt(at)} career ${word} during ${l.gameTitleName}. Career total: ${fmt(career)}.`,
          meta: `Reached ${l.gameTitleName}`,
        })
      }
    }
    const highest = reached[reached.length - 1]
    if (SINGLE_PLAQUE.has(stat)) {
      if (highest !== undefined) items.push(highest)
    } else {
      items.push(...reached)
    }
  }

  const ownTitles = [...own.map((l) => l.gameTitleName), ...mineClub.map((a) => a.title)].sort(
    (a, b) => (titleOrder.get(a) ?? 0) - (titleOrder.get(b) ?? 0),
  )
  const first = ownTitles[0]
  const last = ownTitles[ownTitles.length - 1]
  const span =
    first === undefined || last === undefined ? '' : first === last ? first : `${first}–${last}`

  const value = (i: AwardItem): number => Number.parseInt(i.glyph.replace(/,/g, ''), 10) || 0
  const sub = (i: AwardItem): number =>
    i.stat === null ? SYMBOL_ORDER.indexOf(i.symbol) : STAT_ORDER.indexOf(i.stat)
  items.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      b.order - a.order ||
      sub(a) - sub(b) ||
      value(b) - value(a),
  )
  const count = (...kinds: AwardKind[]) => items.filter((i) => kinds.includes(i.kind)).length
  return {
    items,
    span,
    totals: {
      trophies: count('trophy'),
      banners: count('banner'),
      accolades: count('alltime', 'record', 'milestone'),
    },
  }
}
