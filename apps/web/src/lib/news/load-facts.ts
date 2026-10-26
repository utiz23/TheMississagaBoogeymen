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
  listNewsNightMatches,
  listNewsNormGames,
  listNewsPlayerGames,
  listNewsPlayersWithOtherSeasons,
  listNewsTitleSeasonTotals,
  listNewsClubRecordLines,
  listNewsProfiles,
  listPlayerTitleTotals,
  listRecentNightSummaries,
  listTitleResultsUpTo,
  stancesForThreads,
  predictionScorecards,
  activeTakesForPlayers,
} from '@eanhl/db/queries'
import {
  nightKey,
  nightsOfWeek,
  parseNewsFactsResponse,
  previousWeekStarts,
  takesForSheet,
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
  buildScorecards,
  buildWeekHistory,
  buildWeekPlayers,
  HISTORY_WEEKS,
  historyFromNormGames,
  passPctOf,
  periodsFromSummaries,
  titleAllowed,
  unlockText,
  type FactsLoadOptions,
  type GameFactsArgs,
  type GamePlayerInput,
  type GoalEventInput,
} from './build-facts'
import { applyNorms, normInputFromRow, type NormGameInput } from './norms'
import { applyContext, titleGameFromFacts, titleGameFromRow } from './context'
import { applyChemistry } from './chemistry'
import { rankFacts } from './rank-facts'
import { mapLimit, memoize } from './map-limit'
import {
  buildThreads,
  stancesWithoutForbidden,
  threadGameFromFacts,
  threadGameFromRow,
} from './threads'
import { applyNewRecords, buildRecords, publicRecords, type SeasonLineInput } from './records'
import {
  applyPlayerFacts,
  playerGameFromRow,
  recentPointLabels,
  type PlayerGameInput,
} from './players'

/** An unlock counts when it lands up to this long after the last game of the sheet. */
const UNLOCK_WINDOW_AFTER_MINUTES = 10
const RECENT_NIGHTS = 3
/** Games loaded at once (each runs a few queries, mostly one after another; the pool has 10 connections). */
const GAME_LOAD_CONCURRENCY = 6
const MATCH_LOAD_CONCURRENCY = 8
/**
 * The club-record season lines of every title (records, C2.4; Boogeymen
 * games only) change only when a game or an archive import lands: cached 10
 * minutes per server process (C2 fix A). The current title's part is always
 * read fresh.
 */
const clubSeasonLines = memoize(() => listNewsClubRecordLines(), 10 * 60 * 1000)

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

/** A sheet game's numbers for the team norms, as the match page shows them. */
function normInputOf(g: LoadedGame, endedEarly: boolean): NormGameInput {
  return {
    gameMode: g.match.gameMode,
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
  // C2 fix A: a few games at a time (a week sheet has 20-30; one at a time took ~1 s each).
  const loaded = (await mapLimit(matches, GAME_LOAD_CONCURRENCY, loadGame)).filter(
    (g): g is LoadedGame => g !== null,
  )
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
  const [
    results,
    totals,
    events,
    recent,
    normGames,
    playerGames,
    earlierSeasons,
    seasonLines,
    titleSeasons,
  ] = await Promise.all([
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
    // Player facts (C2.3/C2.5): the named players' games in every title up to the sheet's last game.
    listNewsPlayerGames({ playerIds: namedIds, lastMatchId: last.match.id }),
    // Debuts (C2.5): who has a season in an earlier title.
    listNewsPlayersWithOtherSeasons({ playerIds: namedIds, gameTitleId }),
    // Club records (C2.4): earlier titles' season lines, this title before the sheet.
    clubSeasonLines(),
    listNewsTitleSeasonTotals({ gameTitleId, beforeMatchId: first.match.id }),
  ])
  const normed = applyNorms(
    games,
    loaded.map((g, i): NormGameInput => normInputOf(g, games[i]?.endedEarly ?? false)),
    normGames.map(normInputFromRow),
  )
  // Team context, team notes and head-to-head (C2.2): the same earlier games;
  // night and week sheets hold whole nights.
  const history = new Map<number, PlayerGameInput[]>()
  for (const r of playerGames) {
    const list = history.get(r.playerId) ?? []
    list.push(playerGameFromRow(r))
    history.set(r.playerId, list)
  }
  const withContext = applyContext(
    applyPlayerFacts(normed.games, history, gameTitleId, earlierSeasons),
    normed.games.map(titleGameFromFacts),
    normGames.map(titleGameFromRow),
    { nightComplete: kind !== 'game' },
  )

  // Club records (C2.4): a holder is named like a person on the sheet (a
  // member not at press level out: profile name, else gamertag), else null.
  const current = titles.find((t) => t.id === gameTitleId)
  const holderOf = new Map(
    memberLevels
      .filter((m) => m.pressLevel !== 'out')
      .map((m) => [
        m.playerId,
        {
          name: m.name?.trim() || m.gamertag.trim(),
          pressLevel: m.pressLevel === 'easy' ? ('easy' as const) : ('full' as const),
        },
      ]),
  )
  const records = buildRecords(
    [
      ...seasonLines
        .filter((l) => l.gameTitleId !== gameTitleId)
        .map(
          (l): SeasonLineInput => ({
            playerId: l.playerId,
            title: l.gameTitleName,
            releaseOrder: l.releaseOrder,
            current: false,
            goals: l.goals,
            assists: l.assists,
            points: l.points,
          }),
        ),
      ...titleSeasons.map(
        (t): SeasonLineInput => ({
          playerId: t.playerId,
          title: gameTitleName,
          releaseOrder: current?.releaseOrder ?? null,
          current: true,
          goals: t.goals,
          assists: t.assists,
          points: t.goals + t.assists,
        }),
      ),
    ],
    current?.releaseOrder ?? null,
    (id) => holderOf.get(id) ?? null,
  )
  const withRecords = applyChemistry(
    applyNewRecords(withContext, records, gameTitleName),
    history,
    gameTitleId,
  )

  // Open threads (C2.8): derived from the title's games and the named
  // players' rows; the stances reporters took on them are stored.
  const threads = buildThreads({
    prior: normGames.map((r) => threadGameFromRow(r, titleGameFromRow(r).endedEarly)),
    sheet: withRecords.map(threadGameFromFacts),
    people,
    history,
    gameTitleId,
  })
  // C2 fix M8: a stored stance never brings back a name that is now forbidden.
  const stances = stancesWithoutForbidden(
    await stancesForThreads(threads.map((t) => t.key)),
    forbiddenNames,
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
          // C2 fix A: from the norm games already loaded (no per-game OCR lookups).
          history: buildWeekHistory(
            historyFromNormGames(normGames, previousWeekStarts(key, HISTORY_WEEKS)[0] ?? key, key),
            key,
          ),
          weekPlayers: buildWeekPlayers(games, people, totals.after),
          aiGoalieWeek: buildAiGoalieWeek(games),
          // Prediction scorecards (C2.9): receipts of earlier weeks of the title.
          scorecards: buildScorecards(await predictionScorecards({ gameTitleId, beforeWeek: key })),
        }
      : {}

  const facts = buildFacts({
    kind,
    key,
    gameTitleName,
    games: withRecords,
    norms: normed.norms,
    records: publicRecords(records),
    threads,
    stances,
    ...buildRecordAndStreak(results),
    unlocks,
    milestones: buildMilestones(totals.before, totals.after, people),
    recentNights: recent,
    people,
    ...week,
  })
  // Fact ranking (C2.7): every fact of the finished sheet, most important first.
  const ranked: NewsFacts = { ...facts, topFacts: rankFacts(facts) }
  // Reporter takes (C3a.6, spec §12.19): GM-only lore, next to the facts (never
  // inside them: facts are stored on every item), only for players named on
  // this sheet (people already excludes Leave me out); Go easy ⇒ mild. The
  // data moves the intensity: the player's points labels of his last 5 games.
  const takes = takesForSheet(await activeTakesForPlayers(namedIds), people, (id) =>
    recentPointLabels(history.get(id) ?? [], gameTitleId),
  )
  // The service parses the same shape at its boundary; refuse to emit a sheet it would reject.
  return parseNewsFactsResponse({ facts: ranked, forbiddenNames, takes })
}

/** Matches of one title for the given nights (the active title unless `includeInactive`), oldest first. */
async function loadNightMatches(nights: string[], opts: FactsLoadOptions): Promise<Match[]> {
  const rows = await listNewsNightMatches(nights, {
    includeInactive: opts.includeInactive === true,
  })
  const titleId = rows[0]?.gameTitleId
  const ids = rows.filter((r) => r.gameTitleId === titleId).map((r) => r.id)
  const found = await mapLimit(ids, MATCH_LOAD_CONCURRENCY, (id) => getMatchById(id))
  return found.filter((m): m is Match => m !== null && m !== undefined)
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
