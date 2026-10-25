// Club single-season records for the news desk fact sheets (Part C2.4, spec
// §12.14): the best goals / assists / points season of any club player, and
// the games at which a named player passes one. Pure; the loader passes the
// site's club season lines of the earlier titles (`getClubSeasonLines`, the
// profile Awards source) and the current title's totals before the sheet.
import {
  RECORD_STATS,
  type NewsClubRecord,
  type NewsGameFacts,
  type NewsNewRecord,
  type RecordStat,
} from '@eanhl/db/news'

/** One player's season (one title). */
export interface SeasonLineInput {
  playerId: number
  title: string
  releaseOrder: number | null
  /** The sheet's own title (totals before the sheet's first game). */
  current: boolean
  goals: number
  assists: number
  points: number
}

/** A record with who set it, for the new-record check. */
export interface ClubRecordState extends NewsClubRecord {
  holderId: number
  /** Set in the sheet's own title. */
  current: boolean
}

/** Earlier title first; the current title last; an unknown order after the known ones. */
function setOrder(l: SeasonLineInput): number {
  if (l.current) return Number.MAX_SAFE_INTEGER
  return l.releaseOrder ?? Number.MAX_SAFE_INTEGER - 1
}

/**
 * The best season per stat (value > 0). Lines of titles released after the
 * current one are left out (a backfill must not see the future); a tie goes
 * to the season set first, then the lower player id. `nameOf` gives the
 * holder's sheet name or null when the holder may not be named.
 */
export function buildRecords(
  lines: readonly SeasonLineInput[],
  currentReleaseOrder: number | null,
  nameOf: (playerId: number) => string | null,
): ClubRecordState[] {
  const usable = lines.filter(
    (l) =>
      l.current ||
      l.releaseOrder === null ||
      currentReleaseOrder === null ||
      l.releaseOrder < currentReleaseOrder,
  )
  const out: ClubRecordState[] = []
  for (const stat of RECORD_STATS) {
    const best = [...usable]
      .filter((l) => l[stat] > 0)
      .sort((a, b) => b[stat] - a[stat] || setOrder(a) - setOrder(b) || a.playerId - b.playerId)[0]
    if (best === undefined) continue
    out.push({
      stat,
      holder: nameOf(best.playerId),
      value: best[stat],
      title: best.title,
      holderId: best.playerId,
      current: best.current,
    })
  }
  return out
}

/** The sheet's records without the internal fields. */
export function publicRecords(records: readonly ClubRecordState[]): NewsClubRecord[] {
  return records.map(({ stat, holder, value, title }) => ({ stat, holder, value, title }))
}

/**
 * Each game's `newRecords`: a named line whose title total passed a record at
 * this game (before <= record < after), unless the record was already his in
 * this title. A record set on the sheet is the one later sheet games compare with.
 */
export function applyNewRecords(
  games: readonly NewsGameFacts[],
  records: readonly ClubRecordState[],
  currentTitle: string,
): NewsGameFacts[] {
  const state = new Map<RecordStat, ClubRecordState>(records.map((r) => [r.stat, { ...r }]))
  return games.map((game) => {
    const found: NewsNewRecord[] = []
    for (const line of game.players) {
      const totals = line.seasonTotals
      if (totals === null) continue
      for (const stat of RECORD_STATS) {
        const rec = state.get(stat)
        if (rec === undefined) continue
        const after = totals[stat]
        const before = after - line[stat]
        if (!(after > rec.value && before <= rec.value)) continue
        if (rec.current && rec.holderId === line.playerId) continue
        found.push({ stat, name: line.name, value: after })
        state.set(stat, {
          stat,
          holder: line.name,
          value: after,
          title: currentTitle,
          holderId: line.playerId,
          current: true,
        })
      }
    }
    return { ...game, newRecords: found }
  })
}
