/**
 * Career Team Stats logic. Pure functions, no React/DOM.
 *
 * Two sources feed the table and are NEVER blended into one number:
 *   - `live`    — match-derived, computed from `matches` (`getLiveTeamStatsByMode`).
 *                 GP counts DNF games, so GP can exceed W + L + OTL.
 *   - `archive` — reviewed in-game STATS → CLUB STATS screenshot import
 *                 (`historical_club_team_stats`). Not EA API data.
 *
 * Missing values stay `null` end to end — nothing is coerced to 0 — and sort
 * last in both directions.
 *
 * Run: node --test apps/web/src/lib/team-history.test.ts
 */

export type TeamHistorySource = 'live' | 'archive'

/** Structural subset of `HistoricalClubTeamBatchRow` + the page's title/source tags. */
export interface TeamHistoryInput {
  gameTitleId: number
  titleName: string
  source: TeamHistorySource
  playlist: string
  gamesPlayed: number | null
  wins: number | null
  losses: number | null
  otl: number | null
  avgGoalsFor: string | null
  avgGoalsAgainst: string | null
  avgTimeOnAttack: string | null
  powerPlayPct: string | null
  powerPlayKillPct: string | null
}

/** Human labels for the verbatim playlist slugs. */
export const PLAYLIST_LABEL: Record<string, string> = {
  eashl_6v6: 'EASHL 6v6',
  eashl_3v3: 'EASHL 3v3',
  clubs_6v6: 'Clubs 6v6',
  clubs_3v3: 'Clubs 3v3',
  '6_player_full_team': '6P Full Team',
  clubs_6_players: 'Clubs 6P',
  threes: 'Threes',
  quickplay_3v3: 'Quickplay 3v3',
}

export const SOURCE_LABEL: Record<TeamHistorySource, string> = {
  live: 'Local · derived from matches',
  archive: 'Screenshot import · reviewed',
}

export const SOURCE_SHORT: Record<TeamHistorySource, string> = {
  live: 'Local',
  archive: 'Import',
}

// ─── Playlist families ────────────────────────────────────────────────────────

interface FamilyDef {
  key: string
  label: string
  playlists: readonly string[]
}

/**
 * Explicit playlist families. A family groups the era-specific slugs of the same
 * in-game mode (NHL 22/23 `clubs_*` naming vs NHL 24+ `eashl_*` / full-team
 * naming); the mapping follows the club-stats column mapping recorded in the
 * 2026-05-04 handoff. Threes and Quickplay 3v3 are casual modes and are kept
 * OUT of the competitive 3v3 family.
 *
 * Note: the DB layer's broad 3s query filter (`getHistoricalClubTeamStats`)
 * still lumps `threes` and `quickplay_3v3` under "3s". This table does not use
 * that filter; families here are deliberately narrower.
 */
const FAMILIES: readonly FamilyDef[] = [
  { key: '6v6', label: '6v6', playlists: ['eashl_6v6', 'clubs_6v6'] },
  { key: 'full_team', label: 'Full Team', playlists: ['6_player_full_team', 'clubs_6_players'] },
  { key: '3v3', label: '3v3', playlists: ['eashl_3v3', 'clubs_3v3'] },
  { key: 'threes', label: 'Threes', playlists: ['threes'] },
  { key: 'quickplay_3v3', label: 'Quickplay 3v3', playlists: ['quickplay_3v3'] },
]

export interface PlaylistFamily {
  key: string
  label: string
  /** Sort position; unknown playlists follow the known families. */
  order: number
}

/** Unknown slugs become their own family — never folded into another one. */
export function playlistFamily(playlist: string): PlaylistFamily {
  const idx = FAMILIES.findIndex((f) => f.playlists.includes(playlist))
  const def = FAMILIES[idx]
  if (def !== undefined) return { key: def.key, label: def.label, order: idx }
  return {
    key: `other:${playlist}`,
    label: PLAYLIST_LABEL[playlist] ?? playlist,
    order: FAMILIES.length,
  }
}

// ─── Row model ────────────────────────────────────────────────────────────────

export interface TeamHistoryRow {
  key: string
  titleId: number
  titleName: string
  /** Numeric part of the title name ("NHL 27" → 27); newest = highest. */
  titleRank: number
  source: TeamHistorySource
  playlist: string
  /** Raw slug label ("EASHL 6v6"), shown beside the family label when it differs. */
  playlistLabel: string
  family: PlaylistFamily
  gp: number | null
  w: number | null
  l: number | null
  otl: number | null
  /** W ÷ (W + L + OTL) × 100. Null if any component is missing or there are no decisions. */
  wpct: number | null
  gfg: number | null
  gag: number | null
  /** Goal difference per game = GF/G − GA/G (derived from the two averages). */
  gdg: number | null
  toaSeconds: number | null
  pp: number | null
  pk: number | null
}

export function parseNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** "9:07" (live) and "08:42" (archive) → seconds. Anything else → null. */
export function parseToaSeconds(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const m = /^(\d+):([0-5]\d)$/u.exec(value.trim())
  if (m === null) return null
  return Number(m[1]) * 60 + Number(m[2])
}

export function titleRankOf(titleName: string): number {
  const m = /(\d+)\s*$/u.exec(titleName)
  return m === null ? 0 : Number(m[1])
}

function winPct(w: number | null, l: number | null, otl: number | null): number | null {
  if (w === null || l === null || otl === null) return null
  const decisions = w + l + otl
  return decisions > 0 ? (w / decisions) * 100 : null
}

export function toTeamHistoryRow(input: TeamHistoryInput): TeamHistoryRow {
  const gfg = parseNumber(input.avgGoalsFor)
  const gag = parseNumber(input.avgGoalsAgainst)
  const family = playlistFamily(input.playlist)
  return {
    key: `${String(input.gameTitleId)}:${input.source}:${input.playlist}`,
    titleId: input.gameTitleId,
    titleName: input.titleName,
    titleRank: titleRankOf(input.titleName),
    source: input.source,
    playlist: input.playlist,
    playlistLabel: PLAYLIST_LABEL[input.playlist] ?? input.playlist,
    family,
    gp: input.gamesPlayed,
    w: input.wins,
    l: input.losses,
    otl: input.otl,
    wpct: winPct(input.wins, input.losses, input.otl),
    gfg,
    gag,
    gdg: gfg !== null && gag !== null ? gfg - gag : null,
    toaSeconds: parseToaSeconds(input.avgTimeOnAttack),
    pp: parseNumber(input.powerPlayPct),
    pk: parseNumber(input.powerPlayKillPct),
  }
}

// ─── Filtering / grouping ─────────────────────────────────────────────────────

export function filterRows(
  rows: readonly TeamHistoryRow[],
  titleName: string | null,
  familyKey: string | null,
): TeamHistoryRow[] {
  return rows.filter(
    (r) =>
      (titleName === null || r.titleName === titleName) &&
      (familyKey === null || r.family.key === familyKey),
  )
}

/** Distinct titles, newest first. */
export function listTitles(rows: readonly TeamHistoryRow[]): string[] {
  const seen = new Map<string, number>()
  for (const r of rows) seen.set(r.titleName, r.titleRank)
  return [...seen.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0])).map(([n]) => n)
}

/** Distinct families present, in display order. */
export function listFamilies(rows: readonly TeamHistoryRow[]): PlaylistFamily[] {
  const seen = new Map<string, PlaylistFamily>()
  for (const r of rows) seen.set(r.family.key, r.family)
  return [...seen.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
}

export type GroupBy = 'title' | 'playlist'

/** Natural order: within a title → family order; within a family → newest title first. */
function naturalCompare(a: TeamHistoryRow, b: TeamHistoryRow, groupBy: GroupBy): number {
  const byFamily = a.family.order - b.family.order || a.family.label.localeCompare(b.family.label)
  const byTitle = b.titleRank - a.titleRank
  const primary = groupBy === 'title' ? byFamily || byTitle : byTitle || byFamily
  return primary || a.playlist.localeCompare(b.playlist) || a.source.localeCompare(b.source)
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

export interface Aggregate {
  rowCount: number
  gp: number | null
  w: number | null
  l: number | null
  otl: number | null
  wpct: number | null
  gfg: number | null
  gag: number | null
  gdg: number | null
  /**
   * True when gfg / gag / gdg are a GP-weighted mean of several rows' captured
   * per-game averages. Those averages are already rounded in their source, so
   * the result is an approximation, not a recomputation from goal totals.
   * False for a single row (the value is the source's own figure).
   */
  averagesApproximate: boolean
}

function sumOrNull(values: readonly (number | null)[]): number | null {
  let total = 0
  for (const v of values) {
    if (v === null) return null
    total += v
  }
  return total
}

/** GP-weighted mean; null unless every row has a GP > 0 and a value. */
function weightedMean(rows: readonly TeamHistoryRow[], pick: (r: TeamHistoryRow) => number | null) {
  let num = 0
  let den = 0
  for (const r of rows) {
    const v = pick(r)
    if (v === null || r.gp === null || r.gp <= 0) return null
    num += v * r.gp
    den += r.gp
  }
  return den > 0 ? num / den : null
}

/**
 * Aggregate rows that share ONE source. Sums are exact; a sum is null if any
 * contributing row is missing that field. TOA, PP% and PK% are deliberately not
 * aggregated (no per-row weights or opportunity counts are supplied, and
 * playlists are not commensurate).
 */
export function aggregate(rows: readonly TeamHistoryRow[]): Aggregate {
  const w = sumOrNull(rows.map((r) => r.w))
  const l = sumOrNull(rows.map((r) => r.l))
  const otl = sumOrNull(rows.map((r) => r.otl))
  const gfg = weightedMean(rows, (r) => r.gfg)
  const gag = weightedMean(rows, (r) => r.gag)
  return {
    rowCount: rows.length,
    gp: sumOrNull(rows.map((r) => r.gp)),
    w,
    l,
    otl,
    wpct: winPct(w, l, otl),
    gfg,
    gag,
    gdg: gfg !== null && gag !== null ? gfg - gag : null,
    averagesApproximate: rows.length > 1,
  }
}

export interface SourceAggregate {
  source: TeamHistorySource
  aggregate: Aggregate
}

/** One aggregate per source present, live first. Sources are never merged. */
export function aggregateBySource(rows: readonly TeamHistoryRow[]): SourceAggregate[] {
  const out: SourceAggregate[] = []
  for (const source of ['live', 'archive'] as const) {
    const subset = rows.filter((r) => r.source === source)
    if (subset.length > 0) out.push({ source, aggregate: aggregate(subset) })
  }
  return out
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

export type SortKey =
  | 'label'
  | 'gp'
  | 'record'
  | 'wpct'
  | 'gfg'
  | 'gag'
  | 'gdg'
  | 'toa'
  | 'pp'
  | 'pk'
export type SortDir = 'asc' | 'desc'
export interface SortState {
  key: SortKey
  dir: SortDir
}

function sortValue(row: TeamHistoryRow, key: SortKey, groupBy: GroupBy): number | null {
  switch (key) {
    case 'label':
      // Row label is the family (by title) or the title (by playlist).
      return groupBy === 'title' ? row.family.order : -row.titleRank
    case 'gp':
      return row.gp
    case 'record':
      return row.w
    case 'wpct':
      return row.wpct
    case 'gfg':
      return row.gfg
    case 'gag':
      return row.gag
    case 'gdg':
      return row.gdg
    case 'toa':
      return row.toaSeconds
    case 'pp':
      return row.pp
    case 'pk':
      return row.pk
  }
}

/**
 * Numeric sort with missing values always last, in both directions. Ties fall
 * back to the natural order so results are deterministic.
 */
export function sortRows(
  rows: readonly TeamHistoryRow[],
  sort: SortState | null,
  groupBy: GroupBy,
): TeamHistoryRow[] {
  return [...rows].sort((a, b) => {
    if (sort !== null) {
      const av = sortValue(a, sort.key, groupBy)
      const bv = sortValue(b, sort.key, groupBy)
      if (av === null && bv !== null) return 1
      if (av !== null && bv === null) return -1
      if (av !== null && bv !== null && av !== bv) {
        return sort.dir === 'asc' ? av - bv : bv - av
      }
    }
    return naturalCompare(a, b, groupBy)
  })
}

/** Click cycle: first direction → opposite → cleared (natural order). */
export function nextSort(current: SortState | null, key: SortKey): SortState | null {
  const first: SortDir = key === 'label' ? 'asc' : 'desc'
  if (current?.key !== key) return { key, dir: first }
  if (current.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' }
  return null
}

export interface TeamHistoryGroup {
  key: string
  label: string
  rows: TeamHistoryRow[]
  hasLive: boolean
  /** One entry per source present; length > 1 means the group mixes sources. */
  subtotals: SourceAggregate[]
}

export function buildGroups(
  rows: readonly TeamHistoryRow[],
  groupBy: GroupBy,
  sort: SortState | null,
): TeamHistoryGroup[] {
  const byKey = new Map<string, { label: string; order: number; rows: TeamHistoryRow[] }>()
  for (const r of rows) {
    const key = groupBy === 'title' ? `t:${r.titleName}` : `f:${r.family.key}`
    const label = groupBy === 'title' ? r.titleName : r.family.label
    const order = groupBy === 'title' ? -r.titleRank : r.family.order
    const g = byKey.get(key)
    if (g) g.rows.push(r)
    else byKey.set(key, { label, order, rows: [r] })
  }
  return [...byKey.entries()]
    .sort((a, b) => a[1].order - b[1].order || a[1].label.localeCompare(b[1].label))
    .map(([key, g]) => ({
      key,
      label: g.label,
      rows: sortRows(g.rows, sort, groupBy),
      hasLive: g.rows.some((r) => r.source === 'live'),
      subtotals: aggregateBySource(g.rows),
    }))
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export const MISSING = '—'

export function formatCount(n: number | null): string {
  return n === null ? MISSING : n.toLocaleString('en-US')
}

export function formatRecord(w: number | null, l: number | null, otl: number | null): string {
  if (w === null || l === null || otl === null) return MISSING
  return `${String(w)}–${String(l)}–${String(otl)}`
}

export function formatPercent(n: number | null, digits = 1): string {
  return n === null ? MISSING : `${n.toFixed(digits)}%`
}

export function formatAverage(n: number | null): string {
  return n === null ? MISSING : n.toFixed(2)
}

/** Signed to 2dp with a true minus sign; ±0.00 shows unsigned. */
export function formatGoalDiff(n: number | null): string {
  if (n === null) return MISSING
  const fixed = Math.abs(n).toFixed(2)
  if (Number(fixed) === 0) return fixed
  return `${n > 0 ? '+' : '−'}${fixed}`
}

export function formatToa(seconds: number | null): string {
  if (seconds === null) return MISSING
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`
}

// ─── Loading ──────────────────────────────────────────────────────────────────

/** A failed query is "unavailable", never an empty result that looks complete. */
export type TeamHistoryLoad = { status: 'ok'; rows: TeamHistoryInput[] } | { status: 'unavailable' }

interface TitleRef {
  id: number
  name: string
}

/** What the queries return, before the loader adds the title name and source tag. */
type QueryRow = Omit<TeamHistoryInput, 'titleName' | 'source'>

export interface TeamHistoryLoaderDeps {
  /** Every active title; each contributes match-derived (live) rows. */
  activeTitles: readonly TitleRef[]
  listArchiveTitles: () => Promise<readonly TitleRef[]>
  getLiveRows: (titleId: number) => Promise<readonly QueryRow[]>
  getArchiveRows: (titleIds: number[]) => Promise<readonly QueryRow[]>
  onError?: (error: unknown) => void
}

/**
 * Load Career Team Stats rows: live rows for every active title plus reviewed
 * archive rows. If ANY required query fails the whole load is `unavailable` —
 * partial rows are never returned, since a career table missing one title
 * would look complete. An archive title list with no titles is a valid empty
 * result (the archive query is simply skipped).
 */
export async function loadTeamHistory(deps: TeamHistoryLoaderDeps): Promise<TeamHistoryLoad> {
  try {
    const archiveTitles = await deps.listArchiveTitles()
    const archiveIds = archiveTitles.map((t) => t.id)
    const titleNameById = new Map(
      [...deps.activeTitles, ...archiveTitles].map((t) => [t.id, t.name] as const),
    )
    const [liveGroups, archiveRows] = await Promise.all([
      Promise.all(deps.activeTitles.map((t) => deps.getLiveRows(t.id))),
      archiveIds.length > 0 ? deps.getArchiveRows(archiveIds) : Promise.resolve([]),
    ])
    const tagged = [
      ...liveGroups.flat().map((r) => ({ ...r, source: 'live' as const })),
      ...archiveRows.map((r) => ({ ...r, source: 'archive' as const })),
    ]
    return {
      status: 'ok',
      rows: tagged.map((r) => ({ ...r, titleName: titleNameById.get(r.gameTitleId) ?? '' })),
    }
  } catch (error) {
    deps.onError?.(error)
    return { status: 'unavailable' }
  }
}
