// Loads the fact sheets for the news desk. Every number comes from the same
// functions the match page and the Discord poster use (stars, overtime,
// OCR-reviewed shots, loadout positions), so a story can never disagree with the page.
// Active game title only, unless `includeInactive` (the backfill of old
// nights); DNF games are left out. Throws on a database failure
// (the news service retries).
import { describeUnlock } from '@eanhl/db/discord'
import {
  getClubMemberIds,
  getMatchById,
  getMatchEvents,
  getMatchLineups,
  getMatchPeriodSummaries,
  getOpponentPlayerMatchStats,
  getPlayerMatchStats,
  listAiGoalieIds,
  listAllGameTitles,
  listMemberPressLevels,
  listNewsCardEvents,
  listNewsHistoryGames,
  listNewsNightMatches,
  listNewsNormGames,
  listNewsProfiles,
  listPlayerTitleTotals,
  listRecentNightSummaries,
  listTitleResultsUpTo,
} from '@eanhl/db/queries'
import {
  nightKey,
  nightsOfWeek,
  parseNewsFactsResponse,
  previousWeekStarts,
  type NewsFacts,
  type NewsFactsResponse,
} from '@eanhl/db/news'
import {
  aggregateOcrShots,
  applyLoadoutOverrides,
  starsForMatch,
  wentToOvertime,
} from '@/lib/match-recap'
import { normalizeLineupTag } from '@/lib/lineup-slots'
import {
  buildAiGoalieWeek,
  buildFacts,
  buildGameFacts,
  buildMilestones,
  buildPeople,
  buildRecordAndStreak,
  buildWeekHistory,
  buildWeekPlayers,
  HISTORY_WEEKS,
  isEndedEarly,
  passPctOf,
  periodsFromSummaries,
  titleAllowed,
  unlockText,
  type FactsLoadOptions,
  type GameFactsArgs,
  type GamePlayerInput,
  type GoalEventInput,
  type HistoryGameInput,
} from './build-facts'
import { applyNorms, normInputFromRow, type NormGameInput } from './norms'

/** An unlock counts when it lands up to this long after the last game of the sheet. */
const UNLOCK_WINDOW_AFTER_MINUTES = 10
const RECENT_NIGHTS = 3

type Match = NonNullable<Awaited<ReturnType<typeof getMatchById>>>
type BgmStat = Awaited<ReturnType<typeof getPlayerMatchStats>>[number]

interface LoadedGame {
  match: Match
  result: 'WIN' | 'LOSS' | 'OTL'
  overtime: boolean
  shots: { for: number; against: number }
  passPct: number | null
  /** The opponents' Pass % (their player rows), for the team norms. */
  passPctAgainst: number | null
  periods: GameFactsArgs['periods']
  /** The match page's event rows (its trust filter: EA rows, reviewed OCR and manual rows). */
  goalEvents: GoalEventInput[]
  /**
   * BGM player rows with the position the match page shows (loadout OCR over
   * EA's) and the star rank (AI-goalie flag not set yet).
   */
  stats: (BgmStat & { star: 1 | 2 | 3 | null })[]
}

function countedResult(result: string): 'WIN' | 'LOSS' | 'OTL' | null {
  return result === 'WIN' || result === 'LOSS' || result === 'OTL' ? result : null
}

/** One game's data, read the way the match page reads it. Null for a DNF. */
async function loadGame(match: Match): Promise<LoadedGame | null> {
  const result = countedResult(match.result)
  if (result === null) return null

  const [playerStats, opponentPlayerStats, lineups, periodSummaries, events] = await Promise.all([
    getPlayerMatchStats(match.id),
    getOpponentPlayerMatchStats(match.id),
    getMatchLineups(match.id),
    getMatchPeriodSummaries(match.id),
    getMatchEvents(match.id),
  ])

  const stars = starsForMatch(match, playerStats, opponentPlayerStats, lineups)
  const overtime = wentToOvertime(
    match,
    periodSummaries,
    [...playerStats, ...opponentPlayerStats].map((p) => p.toiSeconds),
  )
  const sameBgmPlayer = (
    e: { playerId: number | null; gamertag: string },
    playerId: number | null,
    gamertag: string,
  ) =>
    playerId !== null
      ? e.playerId === playerId
      : normalizeLineupTag(e.gamertag) === normalizeLineupTag(gamertag)

  // The stars are ranked by the match page's game score; the score itself
  // never goes on the sheet (spec §12.12-4).
  const stats = applyLoadoutOverrides(playerStats, lineups.bgm).map((p) => {
    const rank = stars.findIndex(
      (s) => s.side === 'bgm' && sameBgmPlayer(s, p.playerId, p.gamertag),
    )
    return {
      ...p,
      star:
        rank === 0 ? (1 as const) : rank === 1 ? (2 as const) : rank === 2 ? (3 as const) : null,
    }
  })

  // Shots exactly as the match page's box score: reviewed OCR over EA's count.
  const ocrShots = aggregateOcrShots(periodSummaries)
  const passAttempts = playerStats.reduce((n, p) => n + p.passAttempts, 0)
  const passCompletions = playerStats.reduce((n, p) => n + p.passCompletions, 0)
  const oppPassAttempts = opponentPlayerStats.reduce((n, p) => n + p.passAttempts, 0)
  const oppPassCompletions = opponentPlayerStats.reduce((n, p) => n + p.passCompletions, 0)

  return {
    match,
    result,
    overtime,
    shots: {
      for: ocrShots.for ?? match.shotsFor,
      against: ocrShots.against ?? match.shotsAgainst,
    },
    passPct: passPctOf(passCompletions, passAttempts),
    passPctAgainst: passPctOf(oppPassCompletions, oppPassAttempts),
    periods: periodsFromSummaries(periodSummaries, match.scoreFor, match.scoreAgainst),
    goalEvents: events
      .filter((e) => e.eventType === 'goal')
      .map(
        (e): GoalEventInput => ({
          id: e.id,
          eventType: e.eventType,
          periodNumber: e.periodNumber,
          periodLabel: e.periodLabel,
          clock: e.clock,
          teamSide: e.teamSide,
          goalNumberInGame: e.goalNumberInGame,
          scorerId: e.scorer?.id ?? null,
          scorerSnapshot: e.scorerSnapshot,
          actorId: e.actor?.id ?? null,
          primaryAssistId: e.primaryAssist?.id ?? null,
          secondaryAssistId: e.secondaryAssist?.id ?? null,
        }),
      ),
    stats,
  }
}

/**
 * The title's counted games of the four weeks before the week sheet's
 * Monday `start`, with shots as the match page shows them (reviewed OCR over
 * EA's count, as in `loadGame`). Read one game at a time: a weekly job, so
 * a gentle load matters more than speed.
 */
async function loadHistoryGames(gameTitleId: number, start: string): Promise<HistoryGameInput[]> {
  const weeks = previousWeekStarts(start, HISTORY_WEEKS)
  const from = weeks[0]
  if (from === undefined) return []
  const rows = await listNewsHistoryGames({ gameTitleId, from, to: start })
  const out: HistoryGameInput[] = []
  for (const r of rows) {
    const ocrShots = aggregateOcrShots(await getMatchPeriodSummaries(r.id))
    const shots = {
      for: ocrShots.for ?? r.shotsFor,
      against: ocrShots.against ?? r.shotsAgainst,
    }
    out.push({
      night: r.night,
      // As on the sheet: an ended-early game's shots and power play do not count (C1 fix 4).
      endedEarly: isEndedEarly({
        scoreFor: r.scoreFor,
        creditedGoals: r.creditedGoals,
        timeOnAttack: r.timeOnAttack,
        shots,
      }),
      result: r.result,
      scoreFor: r.scoreFor,
      scoreAgainst: r.scoreAgainst,
      shotsFor: shots.for,
      shotsAgainst: shots.against,
      ppGoals: r.ppGoals,
      ppOpportunities: r.ppOpportunities,
    })
  }
  return out
}

/** A sheet game's numbers for the team norms, as the match page shows them. */
function normInputOf(g: LoadedGame, endedEarly: boolean): NormGameInput {
  return {
    endedEarly,
    hitsFor: g.match.hitsFor,
    hitsAgainst: g.match.hitsAgainst,
    shotsFor: g.shots.for,
    shotsAgainst: g.shots.against,
    timeOnAttack: g.match.timeOnAttack,
    timeOnAttackAgainst: g.match.timeOnAttackAgainst,
    passPct: g.passPct,
    passPctAgainst: g.passPctAgainst,
    ppGoals: g.match.ppGoals,
    ppOpportunities: g.match.ppOpportunities,
    ppGoalsAgainst: g.match.ppGoalsAgainst,
    ppOpportunitiesAgainst: g.match.ppOpportunitiesAgainst,
  }
}

/** Build one sheet from games (oldest first) of a single title. Null when there is none. */
async function loadSheet(
  kind: NewsFacts['kind'],
  key: string,
  matches: Match[],
): Promise<NewsFactsResponse | null> {
  const loaded: LoadedGame[] = []
  for (const m of matches) {
    const g = await loadGame(m)
    if (g) loaded.push(g)
  }
  const first = loaded[0]
  const last = loaded[loaded.length - 1]
  if (!first || !last) return null
  const gameTitleId = first.match.gameTitleId

  const titles = await listAllGameTitles()
  const gameTitleName = titles.find((t) => t.id === gameTitleId)?.name ?? ''

  // Who may be named: profile names and press levels for every BGM player.
  // Every member at "out" is forbidden too, also one who did not play.
  const playerIds = [...new Set(loaded.flatMap((g) => g.stats.map((s) => s.playerId)))]
  const [memberIdList, profiles, aiGoalies, memberLevels] = await Promise.all([
    getClubMemberIds(),
    listNewsProfiles(playerIds),
    listAiGoalieIds(playerIds),
    listMemberPressLevels(),
  ])
  const memberIds = new Set(memberIdList)
  const { people, forbiddenNames } = buildPeople({
    players: loaded.flatMap((g) =>
      g.stats.map((s) => ({
        playerId: s.playerId,
        gamertag: s.gamertag,
        aiGoalie: aiGoalies.has(s.playerId),
        position: s.position,
      })),
    ),
    memberIds,
    profiles,
    outMembers: memberLevels.filter((m) => m.pressLevel === 'out'),
  })

  const games = loaded.map((g) =>
    buildGameFacts({
      match: { ...g.match, result: g.result },
      gameTitleName,
      overtime: g.overtime,
      shots: g.shots,
      passPct: g.passPct,
      periods: g.periods,
      players: g.stats.map(
        (s): GamePlayerInput => ({
          playerId: s.playerId,
          gamertag: s.gamertag,
          position: s.position,
          isGoalie: s.isGoalie,
          aiGoalie: aiGoalies.has(s.playerId),
          goals: s.goals,
          assists: s.assists,
          shots: s.shots,
          hits: s.hits,
          pim: s.pim,
          saves: s.saves,
          goalsAgainst: s.goalsAgainst,
          shotsAgainst: s.shotsAgainst,
          star: s.star,
        }),
      ),
      people,
      memberIds,
      goalEvents: g.goalEvents,
    }),
  )

  const namedIds = people.map((p) => p.playerId)
  const nameById = new Map(people.map((p) => [p.playerId, p.name]))
  const [results, totals, events, recent, normGames] = await Promise.all([
    listTitleResultsUpTo(gameTitleId, last.match.id),
    listPlayerTitleTotals({
      gameTitleId,
      playerIds: namedIds,
      firstMatchId: first.match.id,
      lastMatchId: last.match.id,
    }),
    listNewsCardEvents({
      gameTitleId,
      playerIds: namedIds,
      firstMatchId: first.match.id,
      lastMatchId: last.match.id,
      afterMinutes: UNLOCK_WINDOW_AFTER_MINUTES,
    }),
    listRecentNightSummaries({
      gameTitleId,
      before: nightKey(first.match.playedAt),
      limit: RECENT_NIGHTS,
    }),
    // Team norms (spec §12.10): the title's counted games before the sheet's first game.
    listNewsNormGames({ gameTitleId, beforeMatchId: first.match.id }),
  ])
  const normed = applyNorms(
    games,
    loaded.map((g, i): NormGameInput => normInputOf(g, games[i]?.endedEarly ?? false)),
    normGames.map(normInputFromRow),
  )

  const unlocks: NewsFacts['unlocks'] = []
  for (const ev of events) {
    const name = nameById.get(ev.playerId)
    if (name === undefined || ev.aiGoalie) continue
    const d = describeUnlock(ev, { mythicTheme: ev.mythicTheme })
    if (d) unlocks.push({ playerId: ev.playerId, name, text: unlockText(d) })
  }

  // Week sheets (revision 2): the four weeks before, and each named person's
  // week with title totals through the week's last game (same totals as the milestones).
  const week =
    kind === 'week'
      ? {
          history: buildWeekHistory(await loadHistoryGames(gameTitleId, key), key),
          weekPlayers: buildWeekPlayers(games, people, totals.after),
          aiGoalieWeek: buildAiGoalieWeek(games),
        }
      : {}

  const facts = buildFacts({
    kind,
    key,
    gameTitleName,
    games: normed.games,
    norms: normed.norms,
    ...buildRecordAndStreak(results),
    unlocks,
    milestones: buildMilestones(totals.before, totals.after, people),
    recentNights: recent,
    people,
    ...week,
  })
  // The service parses the same shape at its boundary; refuse to emit a sheet it would reject.
  return parseNewsFactsResponse({ facts, forbiddenNames })
}

/** Matches of one title for the given nights (the active title unless `includeInactive`), oldest first. */
async function loadNightMatches(nights: string[], opts: FactsLoadOptions): Promise<Match[]> {
  const rows = await listNewsNightMatches(nights, {
    includeInactive: opts.includeInactive === true,
  })
  const titleId = rows[0]?.gameTitleId
  const out: Match[] = []
  for (const r of rows) {
    if (r.gameTitleId !== titleId) continue
    const m = await getMatchById(r.id)
    if (m) out.push(m)
  }
  return out
}

/** The sheet for one game. Null: unknown match, DNF, or not the active title (unless `includeInactive`). */
export async function loadGameFacts(
  matchId: number,
  opts: FactsLoadOptions = {},
): Promise<NewsFactsResponse | null> {
  const match = await getMatchById(matchId)
  if (!match || countedResult(match.result) === null) return null
  const title = (await listAllGameTitles()).find((t) => t.id === match.gameTitleId)
  if (!titleAllowed(title, opts)) return null
  // R12: a game sheet's key is its night; the match id is games[0].matchId.
  return loadSheet('game', nightKey(match.playedAt), [match])
}

/** The sheet for one night (`YYYY-MM-DD`). Null when the night has no counted game. */
export async function loadNightFacts(
  night: string,
  opts: FactsLoadOptions = {},
): Promise<NewsFactsResponse | null> {
  return loadSheet('night', night, await loadNightMatches([night], opts))
}

/** The sheet for the Monday-to-Sunday week that starts on `start`. Null when it had no counted game. */
export async function loadWeekFacts(
  start: string,
  opts: FactsLoadOptions = {},
): Promise<NewsFactsResponse | null> {
  return loadSheet('week', start, await loadNightMatches(nightsOfWeek(start), opts))
}
