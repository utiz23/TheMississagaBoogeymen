// Loads the fact sheets for the news desk. Every number comes from the same
// functions the match page and the Discord poster use (stars, game scores,
// overtime, OCR-reviewed shots), so a story can never disagree with the page.
// Active game title only; DNF games are left out. Throws on a database failure
// (the news service retries).
import { describeUnlock } from '@eanhl/db/discord'
import {
  getClubMemberIds,
  getMatchById,
  getMatchLineups,
  getMatchPeriodSummaries,
  getOpponentPlayerMatchStats,
  getPlayerMatchStats,
  listAiGoalieIds,
  listAllGameTitles,
  listNewsCardEvents,
  listNewsNightMatches,
  listNewsProfiles,
  listPlayerTitleTotals,
  listRecentNightSummaries,
  listTitleResultsUpTo,
} from '@eanhl/db/queries'
import {
  nightKey,
  nightsOfWeek,
  parseNewsFactsResponse,
  type NewsFacts,
  type NewsFactsResponse,
} from '@eanhl/db/news'
import {
  aggregateOcrShots,
  applyLoadoutOverrides,
  buildAllTeamScores,
  starsForMatch,
  wentToOvertime,
} from '@/lib/match-recap'
import { normalizeLineupTag } from '@/lib/lineup-slots'
import {
  buildFacts,
  buildGameFacts,
  buildMilestones,
  buildPeople,
  buildRecordAndStreak,
  passPctOf,
  periodsFromSummaries,
  unlockText,
  type GameFactsArgs,
  type GamePlayerInput,
} from './build-facts'

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
  periods: GameFactsArgs['periods']
  /** BGM player rows with this game's score and star rank (AI-goalie flag not set yet). */
  stats: (BgmStat & { gameScore: number | null; star: 1 | 2 | 3 | null })[]
}

function countedResult(result: string): 'WIN' | 'LOSS' | 'OTL' | null {
  return result === 'WIN' || result === 'LOSS' || result === 'OTL' ? result : null
}

/** One game's data, read the way the match page reads it. Null for a DNF. */
async function loadGame(match: Match): Promise<LoadedGame | null> {
  const result = countedResult(match.result)
  if (result === null) return null

  const [playerStats, opponentPlayerStats, lineups, periodSummaries] = await Promise.all([
    getPlayerMatchStats(match.id),
    getOpponentPlayerMatchStats(match.id),
    getMatchLineups(match.id),
    getMatchPeriodSummaries(match.id),
  ])

  const stars = starsForMatch(match, playerStats, opponentPlayerStats, lineups)
  const overtime = wentToOvertime(
    match,
    periodSummaries,
    [...playerStats, ...opponentPlayerStats].map((p) => p.toiSeconds),
  )
  const scores = buildAllTeamScores(
    match,
    applyLoadoutOverrides(playerStats, lineups.bgm),
    applyLoadoutOverrides(opponentPlayerStats, lineups.opponent),
  ).filter((e) => e.side === 'bgm')

  const sameBgmPlayer = (
    e: { playerId: number | null; gamertag: string },
    playerId: number | null,
    gamertag: string,
  ) =>
    playerId !== null
      ? e.playerId === playerId
      : normalizeLineupTag(e.gamertag) === normalizeLineupTag(gamertag)

  const stats = playerStats.map((p) => {
    const rank = stars.findIndex(
      (s) => s.side === 'bgm' && sameBgmPlayer(s, p.playerId, p.gamertag),
    )
    return {
      ...p,
      gameScore: scores.find((e) => sameBgmPlayer(e, p.playerId, p.gamertag))?.score ?? null,
      star:
        rank === 0 ? (1 as const) : rank === 1 ? (2 as const) : rank === 2 ? (3 as const) : null,
    }
  })

  // Shots exactly as the match page's box score: reviewed OCR over EA's count.
  const ocrShots = aggregateOcrShots(periodSummaries)
  const passAttempts = playerStats.reduce((n, p) => n + p.passAttempts, 0)
  const passCompletions = playerStats.reduce((n, p) => n + p.passCompletions, 0)

  return {
    match,
    result,
    overtime,
    shots: {
      for: ocrShots.for ?? match.shotsFor,
      against: ocrShots.against ?? match.shotsAgainst,
    },
    passPct: passPctOf(passCompletions, passAttempts),
    periods: periodsFromSummaries(periodSummaries, match.scoreFor, match.scoreAgainst),
    stats,
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
  const playerIds = [...new Set(loaded.flatMap((g) => g.stats.map((s) => s.playerId)))]
  const [memberIdList, profiles, aiGoalies] = await Promise.all([
    getClubMemberIds(),
    listNewsProfiles(playerIds),
    listAiGoalieIds(playerIds),
  ])
  const { people, forbiddenNames } = buildPeople({
    players: loaded.flatMap((g) =>
      g.stats.map((s) => ({
        playerId: s.playerId,
        gamertag: s.gamertag,
        aiGoalie: aiGoalies.has(s.playerId),
        position: s.position,
      })),
    ),
    memberIds: new Set(memberIdList),
    profiles,
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
          plusMinus: s.plusMinus,
          pim: s.pim,
          saves: s.saves,
          goalsAgainst: s.goalsAgainst,
          shotsAgainst: s.shotsAgainst,
          gameScore: s.gameScore,
          star: s.star,
        }),
      ),
      people,
    }),
  )

  const namedIds = people.map((p) => p.playerId)
  const nameById = new Map(people.map((p) => [p.playerId, p.name]))
  const [results, totals, events, recent] = await Promise.all([
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
  ])

  const unlocks: NewsFacts['unlocks'] = []
  for (const ev of events) {
    const name = nameById.get(ev.playerId)
    if (name === undefined || ev.aiGoalie) continue
    const d = describeUnlock(ev, { mythicTheme: ev.mythicTheme })
    if (d) unlocks.push({ playerId: ev.playerId, name, text: unlockText(d) })
  }

  const facts = buildFacts({
    kind,
    key,
    gameTitleName,
    games,
    ...buildRecordAndStreak(results),
    unlocks,
    milestones: buildMilestones(totals.before, totals.after, people),
    recentNights: recent,
    people,
  })
  // The service parses the same shape at its boundary; refuse to emit a sheet it would reject.
  return parseNewsFactsResponse({ facts, forbiddenNames })
}

/** Matches of the active title for the given nights, oldest first. */
async function loadNightMatches(nights: string[]): Promise<Match[]> {
  const rows = await listNewsNightMatches(nights)
  const titleId = rows[0]?.gameTitleId
  const out: Match[] = []
  for (const r of rows) {
    if (r.gameTitleId !== titleId) continue
    const m = await getMatchById(r.id)
    if (m) out.push(m)
  }
  return out
}

/** The sheet for one game. Null: unknown match, DNF, or not the active title. */
export async function loadGameFacts(matchId: number): Promise<NewsFactsResponse | null> {
  const match = await getMatchById(matchId)
  if (!match || countedResult(match.result) === null) return null
  const title = (await listAllGameTitles()).find((t) => t.id === match.gameTitleId)
  if (!title?.isActive) return null
  // R12: a game sheet's key is its night; the match id is games[0].matchId.
  return loadSheet('game', nightKey(match.playedAt), [match])
}

/** The sheet for one night (`YYYY-MM-DD`). Null when the night has no counted game. */
export async function loadNightFacts(night: string): Promise<NewsFactsResponse | null> {
  return loadSheet('night', night, await loadNightMatches([night]))
}

/** The sheet for the Monday-to-Sunday week that starts on `start`. Null when it had no counted game. */
export async function loadWeekFacts(start: string): Promise<NewsFactsResponse | null> {
  return loadSheet('week', start, await loadNightMatches(nightsOfWeek(start)))
}
