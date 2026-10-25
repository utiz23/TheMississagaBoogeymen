// Open threads for the news desk fact sheets (Part C2.8, spec §12.17-3): a
// label that persisted on 3+ nights opens a thread; a game of the sheet that
// ends it closes the thread "tonight". Derived, never stored (the stances on
// a thread are stored, by its key). Pure; the loader passes the title's
// earlier games, the sheet's games and the named players' rows.
import {
  SLUMP_MIN,
  STREAK_MIN,
  RIVAL_MIN_NIGHTS,
  THREAD_MIN_NIGHTS,
  runMinimum,
  type NewsGameFacts,
  type NewsPerson,
  type NewsThread,
  type ThreadKind,
} from '@eanhl/db/news'
import type { NewsNormGame } from '@eanhl/db/queries'
import { ROLLING_MIN, SLIDE_MIN, sameOpponent } from './context.ts'
import { hasPoint, noGoal, rateOf, type PlayerGameInput } from './players.ts'

/** A power-play drought thread follows 3+ games in a row with a chance and no goal. */
export const PP_DROUGHT_MIN = 3

/** One counted game of the title, as the threads need it. */
export interface ThreadTeamGame {
  matchId: number
  night: string
  result: 'WIN' | 'LOSS' | 'OTL'
  opponentName: string
  ppGoals: number | null
  ppOpportunities: number | null
  endedEarly: boolean
}

export function threadGameFromRow(r: NewsNormGame, endedEarly: boolean): ThreadTeamGame {
  return {
    matchId: r.id,
    night: r.night,
    result: r.result,
    opponentName: r.opponentName.replace(/\s+/g, ' ').trim(),
    ppGoals: r.ppGoals,
    ppOpportunities: r.ppOpportunities,
    endedEarly,
  }
}

export function threadGameFromFacts(g: NewsGameFacts): ThreadTeamGame {
  return {
    matchId: g.matchId,
    night: g.night,
    result: g.result,
    opponentName: g.opponentName,
    ppGoals: g.team?.ppGoals ?? null,
    ppOpportunities: g.team?.ppOpportunities ?? null,
    endedEarly: g.endedEarly,
  }
}

interface Item {
  night: string
  inSheet: boolean
}

/** A run of `hit` items that `labelMin` turned into a label on 3+ nights. */
interface Run<T> {
  items: T[]
  status: 'open' | 'closed-tonight'
}

/**
 * The label is on at the run's last item (the run is at least `labelMin`
 * long) and the whole run covers `THREAD_MIN_NIGHTS` distinct nights (C2 fix I1).
 */
export function persisted(items: readonly Item[], labelMin: number): boolean {
  if (items.length < labelMin) return false
  return new Set(items.map((i) => i.night)).size >= THREAD_MIN_NIGHTS
}

/**
 * The runs of a sequence (oldest first) that are threads: the run at the end
 * (open), and every run a sheet item ended (closed tonight).
 */
export function threadRuns<T extends Item>(
  seq: readonly T[],
  hit: (x: T) => boolean,
  labelMin: number,
): Run<T>[] {
  const out: Run<T>[] = []
  let run: T[] = []
  for (const x of seq) {
    if (hit(x)) {
      run.push(x)
      continue
    }
    if (x.inSheet && persisted(run, labelMin)) out.push({ items: run, status: 'closed-tonight' })
    run = []
  }
  if (persisted(run, labelMin)) out.push({ items: run, status: 'open' })
  return out
}

const n = (v: number) => String(v)

function thread(
  kind: ThreadKind,
  key: string,
  subject: string | null,
  since: string,
  status: NewsThread['status'],
  summary: string,
): NewsThread {
  return { key, kind, subject, since, status, summary }
}

/**
 * The team threads: win and losing streaks (all results in order) and the
 * power-play drought (games with a chance, not ended early).
 */
export function teamThreads(
  prior: readonly ThreadTeamGame[],
  sheet: readonly ThreadTeamGame[],
): NewsThread[] {
  const seq = [
    ...prior.map((g) => ({ ...g, inSheet: false })),
    ...sheet.map((g) => ({ ...g, inSheet: true })),
  ]
  const out: NewsThread[] = []
  for (const r of threadRuns(seq, (g) => g.result === 'WIN', ROLLING_MIN)) {
    const since = r.items[0]!.night
    const len = r.items.length
    out.push(
      thread(
        'winning-streak',
        `winning-streak@${since}`,
        null,
        since,
        r.status,
        r.status === 'open' ? `won ${n(len)} straight` : `a ${n(len)}-game win streak ended`,
      ),
    )
  }
  for (const r of threadRuns(seq, (g) => g.result !== 'WIN', SLIDE_MIN)) {
    const since = r.items[0]!.night
    const len = r.items.length
    out.push(
      thread(
        'losing-streak',
        `losing-streak@${since}`,
        null,
        since,
        r.status,
        r.status === 'open' ? `lost ${n(len)} straight` : `a ${n(len)}-game losing streak ended`,
      ),
    )
  }
  const pp = seq.filter((g) => !g.endedEarly && (g.ppOpportunities ?? 0) > 0)
  for (const r of threadRuns(pp, (g) => (g.ppGoals ?? 0) === 0, PP_DROUGHT_MIN)) {
    const since = r.items[0]!.night
    const chances = r.items.reduce((s, g) => s + (g.ppOpportunities ?? 0), 0)
    const games = r.items.length
    out.push(
      thread(
        'pp-drought',
        `pp-drought@${since}`,
        null,
        since,
        r.status,
        r.status === 'open'
          ? `no power-play goal in ${n(chances)} chances over ${n(games)} games`
          : `scored on the power play after ${n(chances)} chances without a goal over ${n(games)} games`,
      ),
    )
  }
  return out
}

/**
 * Rival threads, one per opponent of the sheet: lost to on 3+ nights of the
 * title with a losing record against them. Open when the sheet's last
 * meeting was a loss; closed tonight when it was a win and the thread stood
 * before it.
 */
export function rivalThreads(
  prior: readonly ThreadTeamGame[],
  sheet: readonly ThreadTeamGame[],
): NewsThread[] {
  const out: NewsThread[] = []
  const seen: string[] = []
  for (const g of sheet) {
    if (seen.some((o) => sameOpponent(o, g.opponentName))) continue
    seen.push(g.opponentName)
    const met = [...prior, ...sheet].filter((x) => sameOpponent(x.opponentName, g.opponentName))
    const last = met[met.length - 1]!
    const lastIsWin = last.result === 'WIN'
    const standing = lastIsWin ? met.slice(0, -1) : met
    const losses = standing.filter((x) => x.result !== 'WIN')
    const wins = standing.length - losses.length
    const lossNights = new Set(losses.map((x) => x.night)).size
    if (lossNights < RIVAL_MIN_NIGHTS || wins >= losses.length) continue
    const name = g.opponentName.replace(/\s+/g, ' ').trim()
    out.push(
      thread(
        'rival',
        `rival:${name.toLowerCase()}`,
        name,
        losses[0]!.night,
        lastIsWin ? 'closed-tonight' : 'open',
        lastIsWin
          ? `beat ${name} after losing to them on ${n(lossNights)} nights this title`
          : `lost to ${name} on ${n(lossNights)} nights this title`,
      ),
    )
  }
  return out
}

/**
 * Player threads of the named people: points runs (3+, `player-hot`) and
 * goal droughts (8+, `player-slump`, forwards: the position of the player's
 * last game), counted games of the title in order.
 */
export function playerThreads(
  people: readonly NewsPerson[],
  history: ReadonlyMap<number, readonly PlayerGameInput[]>,
  gameTitleId: number,
  sheetMatchIds: ReadonlySet<number>,
): NewsThread[] {
  const out: NewsThread[] = []
  for (const person of people) {
    const rows = (history.get(person.playerId) ?? [])
      .filter((g) => g.gameTitleId === gameTitleId && g.result !== 'DNF')
      .map((g) => ({ ...g, inSheet: sheetMatchIds.has(g.matchId) }))
    if (!rows.some((g) => g.inSheet)) continue
    const id = n(person.playerId)
    // The player's own rate in the title up to the sheet (`runMinimum`), as on his line.
    for (const r of threadRuns(rows, hasPoint, runMinimum(STREAK_MIN, rateOf(rows, hasPoint)))) {
      const since = r.items[0]!.night
      const len = r.items.length
      out.push(
        thread(
          'player-hot',
          `player-hot:${id}@${since}`,
          person.name,
          since,
          r.status,
          r.status === 'open'
            ? `${person.name}: points in ${n(len)} straight games`
            : `${person.name}'s ${n(len)}-game point streak ended`,
        ),
      )
    }
    if (rows[rows.length - 1]!.position !== 'F') continue
    for (const r of threadRuns(rows, noGoal, runMinimum(SLUMP_MIN, rateOf(rows, noGoal)))) {
      const since = r.items[0]!.night
      const len = r.items.length
      out.push(
        thread(
          'player-slump',
          `player-slump:${id}@${since}`,
          person.name,
          since,
          r.status,
          r.status === 'open'
            ? `${person.name}: no goal in ${n(len)} games`
            : `${person.name} scored, ending ${n(len)} games without a goal`,
        ),
      )
    }
  }
  return out
}

/** Every thread of the sheet: team, rivals, players. */
export function buildThreads(args: {
  prior: readonly ThreadTeamGame[]
  sheet: readonly ThreadTeamGame[]
  people: readonly NewsPerson[]
  history: ReadonlyMap<number, readonly PlayerGameInput[]>
  gameTitleId: number
}): NewsThread[] {
  return [
    ...teamThreads(args.prior, args.sheet),
    ...rivalThreads(args.prior, args.sheet),
    ...playerThreads(
      args.people,
      args.history,
      args.gameTitleId,
      new Set(args.sheet.map((g) => g.matchId)),
    ),
  ]
}
