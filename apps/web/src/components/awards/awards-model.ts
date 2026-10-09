import type { ClubSeasonLine } from '@eanhl/db/queries'

/**
 * Profile "Awards" trophy case — the awards the site can work out from stats
 * it already has (Awards Trophy Case.dc.html). Club-vote trophies and
 * championship banners have no data source yet; their symbols exist in
 * `award-symbol.tsx` for when they do.
 */

export type AwardStat = 'G' | 'A' | 'PTS' | 'GP' | 'W' | 'SO'
export type AwardTier = 'bronze' | 'silver' | 'gold'
export type AwardKind = 'record' | 'alltime' | 'milestone'

export interface AwardItem {
  id: string
  kind: AwardKind
  /** e.g. "Most Goals, Single Season". */
  name: string
  /** Tile label, e.g. "Most goals · season". */
  short: string
  /** Tile sub-label: "All-time", "NHL 26" (season record) or "Reached NHL 26" (milestone). */
  when: string
  /** Sort key: the title's release order (newest first within a kind). */
  order: number
  stat: AwardStat
  /** The number on the symbol, formatted ("1,306"). */
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

const STAT_ORDER: readonly AwardStat[] = ['G', 'A', 'PTS', 'GP', 'W', 'SO']
const KIND_ORDER: Record<AwardKind, number> = { alltime: 0, record: 1, milestone: 2 }

const fmt = (n: number): string => n.toLocaleString('en-US')
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const titleCase = (s: string): string => s.split(' ').map(cap).join(' ')
const order = (l: { releaseOrder: number | null }): number =>
  l.releaseOrder ?? Number.MAX_SAFE_INTEGER

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

function sharedWith(top: Entry[], playerId: number): string {
  const others = top.filter((e) => e.playerId !== playerId)
  if (others.length === 0) return ''
  const names = others.map((e) => (e.season === null ? e.gamertag : `${e.gamertag}, ${e.season}`))
  return ` Shared with ${names.join(' and ')}.`
}

export function buildPlayerAwards(
  lines: readonly ClubSeasonLine[],
  playerId: number,
): PlayerAwardsView {
  const own = lines.filter((l) => l.playerId === playerId).sort((a, b) => order(a) - order(b))
  const first = own[0]
  const last = own[own.length - 1]
  const span =
    first === undefined || last === undefined
      ? ''
      : first.gameTitleName === last.gameTitleName
        ? first.gameTitleName
        : `${first.gameTitleName}–${last.gameTitleName}`
  const newestTitle = [...lines].sort((a, b) => order(b) - order(a))[0]?.gameTitleName ?? ''
  const newestOrder = Math.max(...lines.map((l) => l.releaseOrder ?? 0))

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
      const line = own.find((l) => l.gameTitleName === e.season)
      const live = line !== undefined && (line.releaseOrder ?? 0) === newestOrder
      items.push({
        id: `record-${stat}-${e.season ?? ''}`,
        kind: 'record',
        name: `Most ${titleCase(word)}, Single Season`,
        short: `Most ${word} · season`,
        when: e.season ?? '',
        order: line === undefined ? 0 : order(line),
        stat,
        glyph: fmt(e.value),
        tier: null,
        kindLabel: `Single-season record · ${e.season ?? ''}`,
        basis: `Club record for ${word} in one season.${sharedWith(top, playerId)}${nextBest(next)}`,
        meta: live ? `Set ${e.season ?? ''} · season in progress` : `Set ${e.season ?? ''}`,
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
    let total = 0
    for (const l of own) {
      const before = total
      total += get(l)
      for (const [at, tier] of ladder) {
        if (before >= at || total < at) continue
        const statWord = stat === 'GP' ? 'GP' : stat === 'W' ? 'wins' : stat
        items.push({
          id: `milestone-${stat}-${String(at)}`,
          kind: 'milestone',
          name: stat === 'GP' ? `${fmt(at)} Games Played` : `${fmt(at)} Career ${titleCase(word)}`,
          short: `${fmt(at)} career ${statWord}`,
          when: `Reached ${l.gameTitleName}`,
          order: order(l),
          stat,
          glyph: fmt(at),
          tier,
          kindLabel: `${cap(tier)} · Career milestone · reached ${l.gameTitleName}`,
          basis: `Reached ${fmt(at)} career ${word} during ${l.gameTitleName}. Career total: ${fmt(
            own.reduce((s, x) => s + get(x), 0),
          )}.`,
          meta: `Reached ${l.gameTitleName}`,
        })
      }
    }
  }

  const value = (i: AwardItem): number => Number.parseInt(i.glyph.replace(/,/g, ''), 10)
  items.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      b.order - a.order ||
      STAT_ORDER.indexOf(a.stat) - STAT_ORDER.indexOf(b.stat) ||
      value(b) - value(a),
  )
  return { items, span }
}
