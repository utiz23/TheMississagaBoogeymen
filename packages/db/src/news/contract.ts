import { REPORTER_IDS, type ReporterId } from './reporters.js'

/**
 * The JSON the web app's news fact-sheet route returns and the news service
 * consumes. Lives here (no DB client import) so both apps share one
 * definition. Parsed at the network boundary, never trusted.
 *
 * `forbiddenNames` never goes to the model: the service sends only `facts`
 * and uses the list to reject any text that names a player on it.
 */

/**
 * A person the writer may name. No position here (C2.11): a player's position
 * is per game, `games[].players[].position` (F/D/G) is THE position. An older
 * sheet's `position` is dropped by the parser.
 */
export interface NewsPerson {
  playerId: number
  name: string
  /** Players with press level `out` are never listed. */
  pressLevel: 'full' | 'easy'
}

/** A player's position in one game: forward, defence, goalie (rev 2, spec §12.12-5). */
export const NEWS_POSITIONS = ['F', 'D', 'G'] as const
export type NewsPosition = (typeof NEWS_POSITIONS)[number]

/**
 * One named player's game. No plus-minus and no game score (spec §12.12-4):
 * the writer must never cite them; the game score still ranks the stars.
 */
export interface NewsPlayerLine {
  playerId: number
  name: string
  /**
   * THE position of this player in this game (F forward, D defence, G goalie),
   * as the match page shows it (loadout over EA). The only position on the sheet.
   */
  position: NewsPosition
  isGoalie: boolean
  goals: number
  assists: number
  points: number
  /** Null when the game ended early (`endedEarly`): only goals, assists and points count then (C2.10). */
  shots: number | null
  /** Null when the game ended early, as `shots`. */
  hits: number | null
  pim: number
  saves: number | null
  goalsAgainst: number | null
  savePct: number | null
  star: 1 | 2 | 3 | null
  /** The line against the player's own normal (C2.3); null below 10 games or for a goalie / ended-early line. */
  norm: NewsPlayerNorm | null
  /** Season and career highs this game set (C2.3), fixed vocabulary `PLAYER_BESTS`. Words only. */
  bests: PlayerBest[]
  /** Last 5 games against the season (C2.3); null when neither. */
  form: PlayerForm | null
  /** Season firsts this game (C2.3), fixed vocabulary `PLAYER_FIRSTS`. Words only. */
  firsts: PlayerFirst[]
  /** Title milestones within 3 after this game (C2.3): "2 goals from 50". Numbers may be quoted. */
  approaching: NewsApproaching[]
  /** Runs this game extended or ended (C2.5, spec §12.15-1). Numbers may be quoted. */
  streaks: NewsPlayerStreak[]
  /** `club`: the member's first game for the club; `title`: first game of this title (C2.5). Absent otherwise. */
  debut?: 'club' | 'title'
  /** Days since the member's previous game in any title, when 30 or more (C2.5). Absent otherwise. */
  returnAfterDays?: number
  /**
   * Title totals after this game (C2.4; every row of the title, DNF too, like
   * the milestones), so a new club record is detectable. May be quoted. Null
   * from an older web app.
   */
  seasonTotals: NewsSeasonTotals | null
}

export interface NewsSeasonTotals {
  goals: number
  assists: number
  points: number
  games: number
}

/** The stats with club single-season records (C2.4, spec §12.14). */
export const RECORD_STATS = ['goals', 'assists', 'points'] as const
export type RecordStat = (typeof RECORD_STATS)[number]

/**
 * The club's best single season (one title) for a stat, as it stood before
 * the sheet's first game (C2.4): earlier titles from the site's club season
 * lines (EA member seasons, else the reviewed archive; the profile Awards
 * source), the current title from its games before the sheet. `holder` = the
 * member's sheet name (profile name, else gamertag), null for a non-member,
 * a member at press level `out` or an AI goalie. `title` = the game title's
 * name ("NHL 25"). Values may be quoted; a non-null holder is an allowed name.
 */
export interface NewsClubRecord {
  stat: RecordStat
  holder: string | null
  value: number
  title: string
}

export interface NewsPairRecord {
  /** Two names from `people`, ordered by player id. */
  pair: [string, string]
  games: number
  wins: number
  losses: number
  otl: number
}

/**
 * A named player whose title total passed the club record at this game
 * (C2.4): `value` = his new total. Not when the record was already his
 * (this title); a later sheet game compares with the record set earlier on
 * the sheet.
 */
export interface NewsNewRecord {
  stat: RecordStat
  name: string
  value: number
}

/**
 * A run (C2.5, spec §12.15-1) over the player's counted games of this title,
 * all modes, up to and including this game: `points` / `goals` in N straight
 * games (N >= 3), `noGoal` = N games without a goal (N >= 8, forwards only);
 * N also at least `runMinimum` of the player's rate (tuning).
 * `extended`: this game continued it (N counts this game); `ended`: this game
 * broke it (N = the run's length before this game). Goalie lines get none.
 */
export const STREAK_KINDS = ['points', 'goals', 'noGoal'] as const
export type StreakKind = (typeof STREAK_KINDS)[number]
export const STREAK_MIN = 3
export const SLUMP_MIN = 8
/**
 * Tuned on the NHL 26 backfill (C2 tuning): a run must also be unlikely at the
 * player's own rate, so a scorer who gets a point most nights is not "on a
 * streak" every night. With 10+ earlier counted games of the title, the
 * minimum is the smallest N with rate^N <= 0.1 (rate = his share of games
 * with a point / with a goal / without a goal), never below the floors above.
 */
export const STREAK_CHANCE = 0.1
export const STREAK_RATE_MIN_GAMES = 10

/** The run length that counts: `floor`, or longer when the player's own rate makes a run likely. */
export function runMinimum(floor: number, rate: number | null): number {
  if (rate === null || rate <= 0) return floor
  if (rate >= 1) return Number.POSITIVE_INFINITY
  return Math.max(floor, Math.ceil(Math.log(STREAK_CHANCE) / Math.log(rate) - 1e-9))
}
/** A return: at least this many days since the previous game. */
export const RETURN_MIN_DAYS = 30
export interface NewsPlayerStreak {
  kind: StreakKind
  games: number
  status: 'extended' | 'ended'
}

/**
 * Player norms (C2.3, spec §12.16/§12.17-1). The sample = the player's counted
 * games of this title BEFORE this game, in the same game mode and at the same
 * position (F/D, from the stored EA position), games that ended early left
 * out. Null below `PLAYER_NORM_MIN_GAMES`, for a goalie (G) line and for a
 * game that ended early.
 */
export const PLAYER_NORM_STATS = ['goals', 'assists', 'points', 'shots', 'hits'] as const
export type PlayerNormStat = (typeof PLAYER_NORM_STATS)[number]
export const PLAYER_NORM_MIN_GAMES = 10
/**
 * Against the player's own sample: above his 80th percentile = `big for him`,
 * under his 20th = `quiet for him` (never on shots for a D or G), else
 * `typical`.
 */
export const PLAYER_LABELS = ['typical', 'big for him', 'quiet for him'] as const
export type PlayerLabel = (typeof PLAYER_LABELS)[number]

export interface NewsPlayerNorm {
  /** Games in the sample. */
  games: number
  /** Per-game averages over the sample, one decimal. May be quoted. */
  perGame: Record<PlayerNormStat, number>
  /** Per-game averages over the sample's last 10 games, one decimal. May be quoted. */
  last10: { goals: number; assists: number; points: number }
  /** This game's numbers against the sample (words; a non-stat key). */
  labels: Record<PlayerNormStat, PlayerLabel>
}

/**
 * `season high <stat>`: more than in any earlier counted game of this title in
 * the same mode (5+ earlier games); `career high <stat>`: more than in any
 * earlier counted game the site has a box score for, every title, same mode
 * (20+ earlier games) — it replaces the season high of that stat. Minimum
 * values: goals 2, assists 2, points 3, shots 5, hits 5. Not for goalies.
 */
export const PLAYER_BESTS = [
  'season high goals',
  'season high assists',
  'season high points',
  'season high shots',
  'season high hits',
  'career high goals',
  'career high assists',
  'career high points',
  'career high shots',
  'career high hits',
] as const
export type PlayerBest = (typeof PLAYER_BESTS)[number]

/**
 * Points per game over the last 5 counted games of the title in this mode
 * (this one included) against the season sample (`norm.perGame.points`):
 * `heating up` at 1.5x and +0.6 or more, `cooling off` at half and -0.6 or
 * less. Needs a norm.
 */
export const PLAYER_FORMS = ['heating up', 'cooling off'] as const
export type PlayerForm = (typeof PLAYER_FORMS)[number]

/**
 * Title-wide (all modes; every earlier row of the title counts, DNF too, as
 * the title totals). `first point of the season` only when it is not also the
 * first goal or first assist.
 */
export const PLAYER_FIRSTS = [
  'first goal of the season',
  'first assist of the season',
  'first point of the season',
  'first hat trick of the season',
] as const
export type PlayerFirst = (typeof PLAYER_FIRSTS)[number]

/** A title milestone (`milestoneCrossed` tiers) the player is `remaining` (1-3) away from after this game. */
export interface NewsApproaching {
  stat: 'goals' | 'assists' | 'points' | 'games'
  value: number
  remaining: number
}

/** The C2 fields of a player line with nothing in them (older web apps, builders, fixtures). */
export function emptyPlayerExtras(): Pick<
  NewsPlayerLine,
  'norm' | 'bests' | 'form' | 'firsts' | 'approaching' | 'streaks' | 'seasonTotals'
> {
  return {
    norm: null,
    bests: [],
    form: null,
    firsts: [],
    approaching: [],
    streaks: [],
    seasonTotals: null,
  }
}

/** A period as the match page names it. EASHL has no shootout: periods 4-6 are OT, OT2, OT3. */
export const NEWS_GOAL_PERIODS = ['1st', '2nd', '3rd', 'OT', 'OT2', 'OT3'] as const
export type NewsGoalPeriod = (typeof NEWS_GOAL_PERIODS)[number]

/** One goal of a game's timeline, as the match page shows it. */
export interface NewsGoal {
  period: NewsGoalPeriod
  /** `MM:SS`, exactly as the match page shows it; see `NewsGameFacts.clockMeaning`. */
  clock: string
  /** `for` = a Boogeymen goal. */
  side: 'for' | 'against'
  /** A name from `people`, or null (opponent, guest, unnamed teammate, AI goalie, unknown). */
  scorer: string | null
  /** Names from `people` only; everyone else is left out. */
  assists: string[]
}

/**
 * An AI goalie's game for the club (spec §12.8): "Matteo Lehmann" or "Jonas
 * Wagner" (players.ai_goalie_side). Not a person: never in `people`, no press
 * level, no pile-on limit; praise and blame are allowed.
 */
export interface NewsAiGoalieLine {
  name: string
  saves: number
  shotsAgainst: number
  goalsAgainst: number
  /** Saves / shots against in %, one decimal (the match page's SV%); null without shots. */
  savePct: number | null
}

/** An AI goalie's totals over the week sheet's games. */
export interface NewsAiGoalieWeek extends NewsAiGoalieLine {
  games: number
}

/** The stats the team norms cover (spec §12.10). */
export const NORM_STATS = ['hits', 'shots', 'timeOnAttack', 'passPct', 'ppPct'] as const
export type NormStat = (typeof NORM_STATS)[number]

/**
 * One stat's norm: the club's and the opponents' average per game (one
 * decimal; time on attack in seconds; pass % the mean of the games' Pass %;
 * power play % = all power-play goals over all opportunities), and `leadPct`
 * = % of the games (one decimal) in which the club had more.
 */
export interface NewsNormStat {
  ours: number
  theirs: number
  leadPct: number
}

/**
 * The club's norms in the sheet's title from the counted games before the
 * sheet's first game (games that ended early left out). Null below 10 games.
 * A stat is null when fewer than 10 of those games have its numbers.
 */
export interface NewsNorms {
  /** How many games the norms come from. Not a stat to quote. */
  sampleGames: number
  hits: NewsNormStat | null
  shots: NewsNormStat | null
  timeOnAttack: NewsNormStat | null
  passPct: NewsNormStat | null
  ppPct: NewsNormStat | null
}

/**
 * The norms per game mode (spec §12.17-1): every norm, average and label is
 * computed within the game's mode. A game is compared with `norms[gameMode]`;
 * a game without a mode gets no labels. Each mode null below 10 games.
 */
export interface NewsModeNorms {
  '3s': NewsNorms | null
  '6s': NewsNorms | null
}

/** A game's numbers labelled against the club's own games. */
export const NORM_LABEL_KEYS = [
  'hitsFor',
  'hitsAgainst',
  'shotsFor',
  'shotsAgainst',
  'timeOnAttack',
  'passPct',
] as const
export type NormLabelKey = (typeof NORM_LABEL_KEYS)[number]

/** Outside the club's 20th-80th percentile = unusual (spec §12.10). */
export const NORM_LABELS = ['typical', 'unusually high', 'unusually low'] as const
export type NormLabel = (typeof NORM_LABELS)[number]

/** Per key; null when the game or too few earlier games lack that number. */
export type NewsNormLabels = Record<NormLabelKey, NormLabel | null>

export interface NewsTeamStats {
  shotsFor: number
  shotsAgainst: number
  hitsFor: number
  hitsAgainst: number
  ppGoals: number | null
  ppOpportunities: number | null
  passPct: number | null
  timeOnAttackSeconds: number | null
}

/**
 * Team context (spec §12.16, C2.2). Fixed vocabularies:
 * - result: `rolling` a win making the win streak 5+; `blip` a loss ending a
 *   win streak of 5+; `slide` the 3rd or 4th loss in a row; `panic` the 5th+
 *   loss in a row or 2-8 or worse in the last 10; `turnaround` a win ending a
 *   losing streak of 3+; else `normal` (an overtime loss is a loss).
 * - margin (within the mode): `close` one goal or a tie; `blowout` above the
 *   club's 80th percentile of earlier margins and 4+ goals (5+ before 10 games
 *   of the mode); else `comfortable`.
 * - surprise (within the mode): expectation = mean of the title win rate and
 *   the last-10 win rate before the game; a loss at 0.8+ or a win at 0.3 or
 *   less is an `upset`, a `big upset` when it is a blowout; else `expected`
 *   (also below 10 games of the mode).
 */
export const RESULT_LABELS = ['rolling', 'blip', 'slide', 'panic', 'turnaround', 'normal'] as const
export type ResultLabel = (typeof RESULT_LABELS)[number]
export const MARGIN_LABELS = ['close', 'comfortable', 'blowout'] as const
export type MarginLabel = (typeof MARGIN_LABELS)[number]
export const SURPRISE_LABELS = ['expected', 'upset', 'big upset'] as const
export type SurpriseLabel = (typeof SURPRISE_LABELS)[number]

/**
 * A game's result read against what came before. Streaks, the result label,
 * `last10` (the last 10 counted games including this one) and `night` use the
 * title's games of all modes in order (the sheet's `streak` sequence); margin
 * and surprise compare within the game's mode. `night`: the night so far at
 * this game ("2nd win of the night, no loss yet", "3rd loss of the night";
 * on night and week sheets the night's last game also "swept the night" or
 * "lost every game of the night"). All values may be quoted.
 */
export interface NewsGameContext {
  result: ResultLabel
  /** The streak before this game; null before the title's first game. */
  streakBefore: NewsStreak | null
  /** The streak after this game. */
  streakAfter: NewsStreak | null
  last10: NewsRecord
  margin: MarginLabel
  surprise: SurpriseLabel
  night: string[]
}

/** Earlier meetings with the same opponent (name compared without case and spacing) in this title (§12.15-2). */
export interface NewsHeadToHead {
  wins: number
  losses: number
  otl: number
  lastMeeting: {
    result: 'WIN' | 'LOSS' | 'OTL'
    scoreFor: number
    scoreAgainst: number
    night: string
  }
}

export interface NewsGameFacts {
  matchId: number
  night: string
  playedAt: string
  gameTitleName: string
  gameMode: '3s' | '6s' | null
  result: 'WIN' | 'LOSS' | 'OTL'
  overtime: boolean
  scoreFor: number
  scoreAgainst: number
  opponentName: string
  /** Team numbers; null when the game ended early (`endedEarly`): only the score and scorers count then. */
  team: NewsTeamStats | null
  /**
   * The game ended early (spec §12.12-3): the score is above the goals the
   * player rows credit, or time on attack under 240 s, or under 10 shots in
   * all. Its team numbers are not on the sheet.
   */
  endedEarly: boolean
  /** Labels against the club's norms; null without norms or when the game ended early. */
  labels: NewsNormLabels | null
  /**
   * The usual patterns held or broken (out-hit, more shots, more time on
   * attack), each naming the club: "the Boogeymen were out-hit as usual",
   * "the Boogeymen were out-shot for the first time in 6 games" (only after a
   * gap of 3+ games), "... for the first time this title", "... for the 2nd
   * game in a row". Words only, not a source of numbers (a non-stat key in
   * the fact check). Empty without norms or when the game ended early.
   */
  patterns: string[]
  periods: { period: number; goalsFor: number; goalsAgainst: number }[] | null
  players: NewsPlayerLine[]
  aiGoalieInNet: boolean
  /** The AI goalie's line when one played for the club, else null. */
  aiGoalie: NewsAiGoalieLine | null
  /** Players in the game who are not club members (AI goalies not counted). */
  guestCount: number
  /** The game against what came before (C2.2); null from an older web app. */
  context: NewsGameContext | null
  /**
   * Title milestones and season bests at this game (C2.2), fixed forms:
   * "50th win of the title" (every 50th), "100th game of the title"
   * (100/250/500/750/1000), "250th goal of the title" (every 250th),
   * "longest win streak of the season: N" / "longest losing streak of the
   * season: N" (4+, longer than any earlier run), and from the 11th game
   * "most goals in a game this season: N", "biggest win of the season: 11-2",
   * "worst loss of the season: 8-1" (winner first). Numbers may be quoted.
   */
  teamNotes: string[]
  /** Earlier meetings with this opponent in the title; null when none (§12.15-2). */
  headToHead: NewsHeadToHead | null
  /** Club records a named player passed at this game (C2.4); usually empty. */
  newRecords: NewsNewRecord[]
  /**
   * Line chemistry (C2.6, spec §12.17-4): the title record of named pairs who
   * played this game together, from the counted games of the title up to and
   * including this one in which both played (the stats page's pair rule:
   * both in the club's rows of the match). At least 5 games together; the 3
   * pairs with the most games. Numbers may be quoted ("12-3-1 together").
   */
  chemistry: NewsPairRecord[]
  /** Club members in the game at press level `out`: teammates who must not be named or singled out. */
  unnamedTeammates: number
  /**
   * Goals by BGM players who are not in `players` (guests, unnamed teammates,
   * an AI goalie if it has any). Named goals + this = the team's goals, when
   * the EA data is consistent.
   */
  unnamedGoals: number
  /** Assists by the same unnamed players. */
  unnamedAssists: number
  /** The goals in the order they were scored, or null when the game has no complete timeline. */
  goals: NewsGoal[] | null
  /** Whether `goals[].clock` counts up from 00:00 (elapsed) or down to 00:00 (remaining). Null without goals. */
  clockMeaning: 'elapsed' | 'remaining' | null
}

export interface NewsRecord {
  wins: number
  losses: number
  otl: number
}

export interface NewsStreak {
  kind: 'W' | 'L'
  count: number
}

/** One earlier week of the title (week sheets only): Monday key and the week's team totals. */
export interface NewsWeekHistory {
  weekStart: string
  wins: number
  losses: number
  otl: number
  goalsFor: number
  goalsAgainst: number
  shotsFor: number
  shotsAgainst: number
  ppGoals: number
  ppOpportunities: number
}

/** A named person's week (sums of their game lines) and title totals through the week's last game. */
export interface NewsWeekPlayer {
  playerId: number
  name: string
  games: number
  goals: number
  assists: number
  points: number
  shots: number
  hits: number
  titleGoals: number
  titleAssists: number
  titlePoints: number
  titleGames: number
}

export interface NewsFacts {
  kind: 'game' | 'night' | 'week'
  key: string
  gameTitleName: string
  games: NewsGameFacts[]
  nightTotals: {
    goalsFor: number
    goalsAgainst: number
    shotsFor: number
    shotsAgainst: number
    wins: number
    losses: number
    otl: number
  }
  record: NewsRecord
  streak: NewsStreak | null
  unlocks: { playerId: number; name: string; text: string }[]
  milestones: {
    playerId: number
    name: string
    stat: 'goals' | 'assists' | 'points' | 'games'
    value: number
  }[]
  recentNights: {
    night: string
    wins: number
    losses: number
    otl: number
    goalsFor: number
    goalsAgainst: number
  }[]
  people: NewsPerson[]
  /** Week sheets: the four weeks before this one, oldest first; weeks without a game left out. Else []. */
  history: NewsWeekHistory[]
  /** Week sheets: every named person who played this week. Else []. */
  weekPlayers: NewsWeekPlayer[]
  /** Week sheets: each AI goalie's week totals, most games first. Else []. */
  aiGoalieWeek: NewsAiGoalieWeek[]
  /** Club lore (spec §12.13, `CLUB_LORE`), on every sheet. Never a source of stats. */
  lore: string[]
  /**
   * The club's norms in this title before the sheet's first game (spec §12.10),
   * per game mode (§12.17-1); a mode is null below 10 games of that mode.
   */
  norms: NewsModeNorms
  /** The club's single-season records before the sheet's first game (C2.4); [] from an older web app. */
  records: NewsClubRecord[]
  /** Open threads and the ones a game of this sheet closed (C2.8); [] from an older web app. */
  threads: NewsThread[]
  /** Earlier stances on those threads, oldest first (C2.8); [] when none. */
  stances: NewsThreadStance[]
  /** Week sheets: each reporter's judged predictions in the title before this week (C2.9). Else []. */
  scorecards: NewsScorecardLine[] /** Every fact of the sheet ranked, most important first (C2.7); C3 picks the top 5 per piece. */
  topFacts: NewsTopFact[]
}

/**
 * Open threads (C2.8, spec §12.17-3): derived, never stored. A label that
 * persists across nights opens a thread: the label is on at the run's last
 * game and the whole run covers `THREAD_MIN_NIGHTS` (2) distinct nights (C2
 * fix I1); a rival needs losses on `RIVAL_MIN_NIGHTS` (3) nights. It is
 * `closed-tonight` when a game of this sheet ended it. Kinds and the label
 * each one follows:
 * - `winning-streak` (5+ wins in a row, the `rolling` label),
 *   `losing-streak` (3+ losses in a row, the `slide` label);
 * - `pp-drought`: 3+ games in a row with a power-play chance and no
 *   power-play goal (games without a chance or that ended early are skipped);
 * - `player-hot` (points in 3+ straight games) and `player-slump` (8+ games
 *   without a goal, forwards) of a named player, counted games of the title;
 *   both at least `runMinimum` of the player's rate in the title so far;
 * - `rival`: an opponent of this sheet the club lost to on 3+ nights of the
 *   title with a losing record against them (open after another loss,
 *   closed-tonight after a win).
 * `key` is stable for one thread: `<kind>@<since>`, `player-…:<playerId>@<since>`,
 * `rival:<opponent, lower case>@<since>` (C2 fix M9); `since` = the night it began. Both are not
 * stats. `subject` = the player's or opponent's name, null for the team.
 * `summary` = one fixed-form sentence; its numbers may be quoted.
 */
export const THREAD_KINDS = [
  'pp-drought',
  'player-slump',
  'player-hot',
  'rival',
  'losing-streak',
  'winning-streak',
] as const
export type ThreadKind = (typeof THREAD_KINDS)[number]
export const THREAD_MIN_NIGHTS = 2
export const RIVAL_MIN_NIGHTS = 3

export interface NewsThread {
  key: string
  kind: ThreadKind
  subject: string | null
  since: string
  status: 'open' | 'closed-tonight'
  summary: string
}

/**
 * A reporter's earlier stance on a thread of this sheet (C2.8; stored in
 * news_stances). Words of a writer, not a source of numbers.
 */
export interface NewsThreadStance {
  threadKey: string
  reporter: ReporterId
  stance: string
  night: string | null
}

/**
 * A reporter's judged predictions in this title before the week (C2.9, spec
 * §12.15-4; week sheets only): `hits` + `misses` = `judged`, so "4 for 7"
 * can be quoted.
 */
export interface NewsScorecardLine {
  reporter: ReporterId
  hits: number
  misses: number
  judged: number
}

/**
 * One ranked fact (C2.7, spec §12.17-2; `rankFacts` in the web app): a short
 * sentence built only from values and labels on this sheet (its numbers may
 * be quoted), an importance `weight` (not a stat) and the player, opponent or
 * AI goalie it is about (null: the team). `id` is stable per sheet (not a stat).
 */
export interface NewsTopFact {
  id: string
  text: string
  weight: number
  subject: string | null
}

export interface NewsFactsResponse {
  facts: NewsFacts
  forbiddenNames: string[]
}

function fail(path: string, why: string): never {
  throw new Error(`news contract: ${path} ${why}`)
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'is not an object')
  return v as Record<string, unknown>
}
function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'is not a finite number')
  return v
}
function int(v: unknown, path: string): number {
  const n = num(v, path)
  if (!Number.isSafeInteger(n)) fail(path, 'is not an integer')
  return n
}
function nonNegInt(v: unknown, path: string): number {
  const n = int(v, path)
  if (n < 0) fail(path, 'is negative')
  return n
}
function str(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, 'is not a string')
  return v
}
function night(v: unknown, path: string): string {
  const s = str(v, path)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(path, 'is not a YYYY-MM-DD date')
  return s
}
function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'is not a boolean')
  return v
}
function nullable<T>(v: unknown, path: string, inner: (v: unknown, p: string) => T): T | null {
  return v === null ? null : inner(v, path)
}
function oneOf<const T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) fail(path, 'is invalid')
  return v as T
}
function arr<T>(v: unknown, path: string, item: (v: unknown, p: string) => T): T[] {
  if (!Array.isArray(v)) fail(path, 'is not an array')
  return v.map((x, i) => item(x, `${path}[${String(i)}]`))
}

function parsePerson(v: unknown, path: string): NewsPerson {
  const o = obj(v, path)
  return {
    playerId: int(o['playerId'], `${path}.playerId`),
    name: str(o['name'], `${path}.name`),
    pressLevel: oneOf(o['pressLevel'], `${path}.pressLevel`, ['full', 'easy']),
  }
}

function parsePlayerLine(v: unknown, path: string): NewsPlayerLine {
  const o = obj(v, path)
  const star = o['star']
  if (star !== null && star !== 1 && star !== 2 && star !== 3) fail(`${path}.star`, 'is invalid')
  return {
    playerId: int(o['playerId'], `${path}.playerId`),
    name: str(o['name'], `${path}.name`),
    position: oneOf(o['position'], `${path}.position`, NEWS_POSITIONS),
    isGoalie: bool(o['isGoalie'], `${path}.isGoalie`),
    goals: int(o['goals'], `${path}.goals`),
    assists: int(o['assists'], `${path}.assists`),
    points: int(o['points'], `${path}.points`),
    shots: nullable(o['shots'], `${path}.shots`, int),
    hits: nullable(o['hits'], `${path}.hits`, int),
    pim: int(o['pim'], `${path}.pim`),
    saves: nullable(o['saves'], `${path}.saves`, int),
    goalsAgainst: nullable(o['goalsAgainst'], `${path}.goalsAgainst`, int),
    savePct: nullable(o['savePct'], `${path}.savePct`, num),
    star,
    // C2.3; missing (an older web app) reads as none.
    norm: opt(o, 'norm', null, () => nullable(o['norm'], `${path}.norm`, parsePlayerNorm)),
    bests: opt(o, 'bests', [], () =>
      arr(o['bests'], `${path}.bests`, (x, p) => oneOf(x, p, PLAYER_BESTS)),
    ),
    form: opt(o, 'form', null, () =>
      nullable(o['form'], `${path}.form`, (x, p) => oneOf(x, p, PLAYER_FORMS)),
    ),
    firsts: opt(o, 'firsts', [], () =>
      arr(o['firsts'], `${path}.firsts`, (x, p) => oneOf(x, p, PLAYER_FIRSTS)),
    ),
    approaching: opt(o, 'approaching', [], () =>
      arr(o['approaching'], `${path}.approaching`, parseApproaching),
    ),
    // C2.5; missing reads as none; the optional ones stay absent.
    streaks: opt(o, 'streaks', [], () => arr(o['streaks'], `${path}.streaks`, parseStreakRun)),
    ...(o['debut'] === undefined
      ? {}
      : { debut: oneOf(o['debut'], `${path}.debut`, ['club', 'title']) }),
    ...(o['returnAfterDays'] === undefined
      ? {}
      : { returnAfterDays: nonNegInt(o['returnAfterDays'], `${path}.returnAfterDays`) }),
    seasonTotals: opt(o, 'seasonTotals', null, () =>
      nullable(o['seasonTotals'], `${path}.seasonTotals`, parseSeasonTotals),
    ),
  }
}

function parseSeasonTotals(v: unknown, path: string): NewsSeasonTotals {
  const o = obj(v, path)
  return {
    goals: int(o['goals'], `${path}.goals`),
    assists: int(o['assists'], `${path}.assists`),
    points: int(o['points'], `${path}.points`),
    games: nonNegInt(o['games'], `${path}.games`),
  }
}

function parseClubRecord(v: unknown, path: string): NewsClubRecord {
  const o = obj(v, path)
  return {
    stat: oneOf(o['stat'], `${path}.stat`, RECORD_STATS),
    holder: nullable(o['holder'], `${path}.holder`, str),
    value: nonNegInt(o['value'], `${path}.value`),
    title: str(o['title'], `${path}.title`),
  }
}

function parseThread(v: unknown, path: string): NewsThread {
  const o = obj(v, path)
  return {
    key: str(o['key'], `${path}.key`),
    kind: oneOf(o['kind'], `${path}.kind`, THREAD_KINDS),
    subject: nullable(o['subject'], `${path}.subject`, str),
    since: night(o['since'], `${path}.since`),
    status: oneOf(o['status'], `${path}.status`, ['open', 'closed-tonight']),
    summary: str(o['summary'], `${path}.summary`),
  }
}

function parseTopFact(v: unknown, path: string): NewsTopFact {
  const o = obj(v, path)
  return {
    id: str(o['id'], `${path}.id`),
    text: str(o['text'], `${path}.text`),
    weight: num(o['weight'], `${path}.weight`),
    subject: nullable(o['subject'], `${path}.subject`, str),
  }
}

function parseScorecard(v: unknown, path: string): NewsScorecardLine {
  const o = obj(v, path)
  const hits = nonNegInt(o['hits'], `${path}.hits`)
  const misses = nonNegInt(o['misses'], `${path}.misses`)
  const judged = nonNegInt(o['judged'], `${path}.judged`)
  if (judged !== hits + misses) fail(`${path}.judged`, 'is not hits + misses')
  return { reporter: oneOf(o['reporter'], `${path}.reporter`, REPORTER_IDS), hits, misses, judged }
}

function parseStance(v: unknown, path: string): NewsThreadStance {
  const o = obj(v, path)
  return {
    threadKey: str(o['threadKey'], `${path}.threadKey`),
    reporter: oneOf(o['reporter'], `${path}.reporter`, REPORTER_IDS),
    stance: str(o['stance'], `${path}.stance`),
    night: nullable(o['night'], `${path}.night`, night),
  }
}

function parsePairRecord(v: unknown, path: string): NewsPairRecord {
  const o = obj(v, path)
  const pair = arr(o['pair'], `${path}.pair`, str)
  if (pair.length !== 2) fail(`${path}.pair`, 'is not two names')
  return {
    pair: [pair[0]!, pair[1]!],
    games: nonNegInt(o['games'], `${path}.games`),
    wins: nonNegInt(o['wins'], `${path}.wins`),
    losses: nonNegInt(o['losses'], `${path}.losses`),
    otl: nonNegInt(o['otl'], `${path}.otl`),
  }
}

function parseNewRecord(v: unknown, path: string): NewsNewRecord {
  const o = obj(v, path)
  return {
    stat: oneOf(o['stat'], `${path}.stat`, RECORD_STATS),
    name: str(o['name'], `${path}.name`),
    value: nonNegInt(o['value'], `${path}.value`),
  }
}

function parseStreakRun(v: unknown, path: string): NewsPlayerStreak {
  const o = obj(v, path)
  return {
    kind: oneOf(o['kind'], `${path}.kind`, STREAK_KINDS),
    games: nonNegInt(o['games'], `${path}.games`),
    status: oneOf(o['status'], `${path}.status`, ['extended', 'ended']),
  }
}

function parsePlayerNorm(v: unknown, path: string): NewsPlayerNorm {
  const o = obj(v, path)
  const per = obj(o['perGame'], `${path}.perGame`)
  const l10 = obj(o['last10'], `${path}.last10`)
  const lab = obj(o['labels'], `${path}.labels`)
  const record = <T>(f: (k: PlayerNormStat) => T): Record<PlayerNormStat, T> => ({
    goals: f('goals'),
    assists: f('assists'),
    points: f('points'),
    shots: f('shots'),
    hits: f('hits'),
  })
  return {
    games: nonNegInt(o['games'], `${path}.games`),
    perGame: record((k) => num(per[k], `${path}.perGame.${k}`)),
    last10: {
      goals: num(l10['goals'], `${path}.last10.goals`),
      assists: num(l10['assists'], `${path}.last10.assists`),
      points: num(l10['points'], `${path}.last10.points`),
    },
    labels: record((k) => oneOf(lab[k], `${path}.labels.${k}`, PLAYER_LABELS)),
  }
}

function parseApproaching(v: unknown, path: string): NewsApproaching {
  const o = obj(v, path)
  return {
    stat: oneOf(o['stat'], `${path}.stat`, ['goals', 'assists', 'points', 'games']),
    value: nonNegInt(o['value'], `${path}.value`),
    remaining: nonNegInt(o['remaining'], `${path}.remaining`),
  }
}

function parseTeam(v: unknown, path: string): NewsTeamStats {
  const o = obj(v, path)
  return {
    shotsFor: int(o['shotsFor'], `${path}.shotsFor`),
    shotsAgainst: int(o['shotsAgainst'], `${path}.shotsAgainst`),
    hitsFor: int(o['hitsFor'], `${path}.hitsFor`),
    hitsAgainst: int(o['hitsAgainst'], `${path}.hitsAgainst`),
    ppGoals: nullable(o['ppGoals'], `${path}.ppGoals`, int),
    ppOpportunities: nullable(o['ppOpportunities'], `${path}.ppOpportunities`, int),
    passPct: nullable(o['passPct'], `${path}.passPct`, num),
    timeOnAttackSeconds: nullable(o['timeOnAttackSeconds'], `${path}.timeOnAttackSeconds`, int),
  }
}

function parseAiGoalie(v: unknown, path: string): NewsAiGoalieLine {
  const o = obj(v, path)
  return {
    name: str(o['name'], `${path}.name`),
    saves: nonNegInt(o['saves'], `${path}.saves`),
    shotsAgainst: nonNegInt(o['shotsAgainst'], `${path}.shotsAgainst`),
    goalsAgainst: nonNegInt(o['goalsAgainst'], `${path}.goalsAgainst`),
    savePct: nullable(o['savePct'], `${path}.savePct`, num),
  }
}

function parseAiGoalieWeek(v: unknown, path: string): NewsAiGoalieWeek {
  const o = obj(v, path)
  return {
    ...parseAiGoalie(o, path),
    games: nonNegInt(o['games'], `${path}.games`),
  }
}

/** `endedEarly` (missing: false) and `team`: null exactly when the game ended early. */
function parseTeamAndEnd(
  o: Record<string, unknown>,
  path: string,
): Pick<NewsGameFacts, 'team' | 'endedEarly'> {
  const endedEarly =
    o['endedEarly'] === undefined ? false : bool(o['endedEarly'], `${path}.endedEarly`)
  if (endedEarly) {
    if (o['team'] !== null) fail(`${path}.team`, 'must be null when the game ended early')
    return { team: null, endedEarly }
  }
  return { team: parseTeam(o['team'], `${path}.team`), endedEarly }
}

function parseNormStat(v: unknown, path: string): NewsNormStat {
  const o = obj(v, path)
  return {
    ours: num(o['ours'], `${path}.ours`),
    theirs: num(o['theirs'], `${path}.theirs`),
    leadPct: num(o['leadPct'], `${path}.leadPct`),
  }
}

function parseNorms(v: unknown, path: string): NewsNorms {
  const o = obj(v, path)
  const stat = (k: NormStat) => {
    if (o[k] === undefined) fail(`${path}.${k}`, 'is missing')
    return nullable(o[k], `${path}.${k}`, parseNormStat)
  }
  return {
    sampleGames: nonNegInt(o['sampleGames'], `${path}.sampleGames`),
    hits: stat('hits'),
    shots: stat('shots'),
    timeOnAttack: stat('timeOnAttack'),
    passPct: stat('passPct'),
    ppPct: stat('ppPct'),
  }
}

/** Missing or null (an older web app): no norms in either mode. */
function parseModeNorms(v: unknown, path: string): NewsModeNorms {
  if (v === undefined || v === null) return { '3s': null, '6s': null }
  const o = obj(v, path)
  const mode = (k: '3s' | '6s') => {
    if (o[k] === undefined) fail(`${path}.${k}`, 'is missing')
    return nullable(o[k], `${path}.${k}`, parseNorms)
  }
  return { '3s': mode('3s'), '6s': mode('6s') }
}

function parseLabels(v: unknown, path: string): NewsNormLabels {
  const o = obj(v, path)
  const label = (k: NormLabelKey) => {
    if (o[k] === undefined) fail(`${path}.${k}`, 'is missing')
    return nullable(o[k], `${path}.${k}`, (x, p) => oneOf(x, p, NORM_LABELS))
  }
  return {
    hitsFor: label('hitsFor'),
    hitsAgainst: label('hitsAgainst'),
    shotsFor: label('shotsFor'),
    shotsAgainst: label('shotsAgainst'),
    timeOnAttack: label('timeOnAttack'),
    passPct: label('passPct'),
  }
}

function parseContext(v: unknown, path: string): NewsGameContext {
  const o = obj(v, path)
  return {
    result: oneOf(o['result'], `${path}.result`, RESULT_LABELS),
    streakBefore: nullable(o['streakBefore'], `${path}.streakBefore`, parseStreak),
    streakAfter: nullable(o['streakAfter'], `${path}.streakAfter`, parseStreak),
    last10: parseRecord(o['last10'], `${path}.last10`),
    margin: oneOf(o['margin'], `${path}.margin`, MARGIN_LABELS),
    surprise: oneOf(o['surprise'], `${path}.surprise`, SURPRISE_LABELS),
    night: arr(o['night'], `${path}.night`, str),
  }
}

function parseHeadToHead(v: unknown, path: string): NewsHeadToHead {
  const o = obj(v, path)
  const l = obj(o['lastMeeting'], `${path}.lastMeeting`)
  const lp = `${path}.lastMeeting`
  return {
    wins: nonNegInt(o['wins'], `${path}.wins`),
    losses: nonNegInt(o['losses'], `${path}.losses`),
    otl: nonNegInt(o['otl'], `${path}.otl`),
    lastMeeting: {
      result: oneOf(l['result'], `${lp}.result`, ['WIN', 'LOSS', 'OTL']),
      scoreFor: nonNegInt(l['scoreFor'], `${lp}.scoreFor`),
      scoreAgainst: nonNegInt(l['scoreAgainst'], `${lp}.scoreAgainst`),
      night: night(l['night'], `${lp}.night`),
    },
  }
}

/** A field an older web app does not send: missing reads as `none`. */
function opt<T>(o: Record<string, unknown>, key: string, none: T, parse: () => T): T {
  return o[key] === undefined ? none : parse()
}

function parseGoal(v: unknown, path: string): NewsGoal {
  const o = obj(v, path)
  const clock = str(o['clock'], `${path}.clock`)
  if (!/^\d{1,2}:\d{2}$/.test(clock)) fail(`${path}.clock`, 'is not an MM:SS clock')
  return {
    period: oneOf(o['period'], `${path}.period`, NEWS_GOAL_PERIODS),
    clock,
    side: oneOf(o['side'], `${path}.side`, ['for', 'against']),
    scorer: nullable(o['scorer'], `${path}.scorer`, str),
    assists: arr(o['assists'], `${path}.assists`, str),
  }
}

/**
 * The timeline and its clock meaning. A missing `goals` reads as null, so a
 * sheet from a web app without the timeline still parses. A timeline needs a
 * clock meaning.
 */
function parseTimeline(
  o: Record<string, unknown>,
  path: string,
): Pick<NewsGameFacts, 'goals' | 'clockMeaning'> {
  const goals =
    o['goals'] === undefined
      ? null
      : nullable(o['goals'], `${path}.goals`, (x, p) => arr(x, p, parseGoal))
  const raw = o['clockMeaning'] === undefined ? null : o['clockMeaning']
  const clockMeaning = nullable(raw, `${path}.clockMeaning`, (x, p) =>
    oneOf(x, p, ['elapsed', 'remaining']),
  )
  if (goals !== null && clockMeaning === null) {
    fail(`${path}.clockMeaning`, 'is required when goals are present')
  }
  return { goals, clockMeaning: goals === null ? null : clockMeaning }
}

function parseGame(v: unknown, path: string): NewsGameFacts {
  const o = obj(v, path)
  return {
    matchId: int(o['matchId'], `${path}.matchId`),
    night: night(o['night'], `${path}.night`),
    playedAt: str(o['playedAt'], `${path}.playedAt`),
    gameTitleName: str(o['gameTitleName'], `${path}.gameTitleName`),
    gameMode: nullable(o['gameMode'], `${path}.gameMode`, (x, p) => oneOf(x, p, ['3s', '6s'])),
    result: oneOf(o['result'], `${path}.result`, ['WIN', 'LOSS', 'OTL']),
    overtime: bool(o['overtime'], `${path}.overtime`),
    scoreFor: int(o['scoreFor'], `${path}.scoreFor`),
    scoreAgainst: int(o['scoreAgainst'], `${path}.scoreAgainst`),
    opponentName: str(o['opponentName'], `${path}.opponentName`),
    ...parseTeamAndEnd(o, path),
    // Missing (an older web app) reads as none.
    labels: o['labels'] === undefined ? null : nullable(o['labels'], `${path}.labels`, parseLabels),
    patterns: o['patterns'] === undefined ? [] : arr(o['patterns'], `${path}.patterns`, str),
    periods: nullable(o['periods'], `${path}.periods`, (x, p) =>
      arr(x, p, (r, rp) => {
        const po = obj(r, rp)
        return {
          period: int(po['period'], `${rp}.period`),
          goalsFor: int(po['goalsFor'], `${rp}.goalsFor`),
          goalsAgainst: int(po['goalsAgainst'], `${rp}.goalsAgainst`),
        }
      }),
    ),
    players: arr(o['players'], `${path}.players`, parsePlayerLine),
    aiGoalieInNet: bool(o['aiGoalieInNet'], `${path}.aiGoalieInNet`),
    // Missing (an older web app) reads as none.
    aiGoalie:
      o['aiGoalie'] === undefined
        ? null
        : nullable(o['aiGoalie'], `${path}.aiGoalie`, parseAiGoalie),
    context: opt(o, 'context', null, () => nullable(o['context'], `${path}.context`, parseContext)),
    teamNotes: opt(o, 'teamNotes', [], () => arr(o['teamNotes'], `${path}.teamNotes`, str)),
    headToHead: opt(o, 'headToHead', null, () =>
      nullable(o['headToHead'], `${path}.headToHead`, parseHeadToHead),
    ),
    newRecords: opt(o, 'newRecords', [], () =>
      arr(o['newRecords'], `${path}.newRecords`, parseNewRecord),
    ),
    chemistry: opt(o, 'chemistry', [], () =>
      arr(o['chemistry'], `${path}.chemistry`, parsePairRecord),
    ),
    guestCount: int(o['guestCount'], `${path}.guestCount`),
    unnamedTeammates: int(o['unnamedTeammates'], `${path}.unnamedTeammates`),
    unnamedGoals: nonNegInt(o['unnamedGoals'], `${path}.unnamedGoals`),
    unnamedAssists: nonNegInt(o['unnamedAssists'], `${path}.unnamedAssists`),
    ...parseTimeline(o, path),
  }
}

function parseRecord(v: unknown, path: string): NewsRecord {
  const o = obj(v, path)
  return {
    wins: int(o['wins'], `${path}.wins`),
    losses: int(o['losses'], `${path}.losses`),
    otl: int(o['otl'], `${path}.otl`),
  }
}

function parseStreak(v: unknown, path: string): NewsStreak {
  const o = obj(v, path)
  return {
    kind: oneOf(o['kind'], `${path}.kind`, ['W', 'L']),
    count: int(o['count'], `${path}.count`),
  }
}

function parseHistory(v: unknown, path: string): NewsWeekHistory {
  const o = obj(v, path)
  return {
    weekStart: night(o['weekStart'], `${path}.weekStart`),
    wins: nonNegInt(o['wins'], `${path}.wins`),
    losses: nonNegInt(o['losses'], `${path}.losses`),
    otl: nonNegInt(o['otl'], `${path}.otl`),
    goalsFor: nonNegInt(o['goalsFor'], `${path}.goalsFor`),
    goalsAgainst: nonNegInt(o['goalsAgainst'], `${path}.goalsAgainst`),
    shotsFor: nonNegInt(o['shotsFor'], `${path}.shotsFor`),
    shotsAgainst: nonNegInt(o['shotsAgainst'], `${path}.shotsAgainst`),
    ppGoals: nonNegInt(o['ppGoals'], `${path}.ppGoals`),
    ppOpportunities: nonNegInt(o['ppOpportunities'], `${path}.ppOpportunities`),
  }
}

function parseWeekPlayer(v: unknown, path: string): NewsWeekPlayer {
  const o = obj(v, path)
  return {
    playerId: int(o['playerId'], `${path}.playerId`),
    name: str(o['name'], `${path}.name`),
    games: nonNegInt(o['games'], `${path}.games`),
    goals: int(o['goals'], `${path}.goals`),
    assists: int(o['assists'], `${path}.assists`),
    points: int(o['points'], `${path}.points`),
    shots: int(o['shots'], `${path}.shots`),
    hits: int(o['hits'], `${path}.hits`),
    titleGoals: int(o['titleGoals'], `${path}.titleGoals`),
    titleAssists: int(o['titleAssists'], `${path}.titleAssists`),
    titlePoints: int(o['titlePoints'], `${path}.titlePoints`),
    titleGames: nonNegInt(o['titleGames'], `${path}.titleGames`),
  }
}

function parseFacts(v: unknown, path: string): NewsFacts {
  const o = obj(v, path)
  const t = obj(o['nightTotals'], `${path}.nightTotals`)
  const tp = `${path}.nightTotals`
  return {
    kind: oneOf(o['kind'], `${path}.kind`, ['game', 'night', 'week']),
    key: night(o['key'], `${path}.key`),
    gameTitleName: str(o['gameTitleName'], `${path}.gameTitleName`),
    games: arr(o['games'], `${path}.games`, parseGame),
    nightTotals: {
      goalsFor: int(t['goalsFor'], `${tp}.goalsFor`),
      goalsAgainst: int(t['goalsAgainst'], `${tp}.goalsAgainst`),
      shotsFor: int(t['shotsFor'], `${tp}.shotsFor`),
      shotsAgainst: int(t['shotsAgainst'], `${tp}.shotsAgainst`),
      wins: int(t['wins'], `${tp}.wins`),
      losses: int(t['losses'], `${tp}.losses`),
      otl: int(t['otl'], `${tp}.otl`),
    },
    record: parseRecord(o['record'], `${path}.record`),
    streak: nullable(o['streak'], `${path}.streak`, parseStreak),
    unlocks: arr(o['unlocks'], `${path}.unlocks`, (x, p) => {
      const u = obj(x, p)
      return {
        playerId: int(u['playerId'], `${p}.playerId`),
        name: str(u['name'], `${p}.name`),
        text: str(u['text'], `${p}.text`),
      }
    }),
    milestones: arr(o['milestones'], `${path}.milestones`, (x, p) => {
      const m = obj(x, p)
      return {
        playerId: int(m['playerId'], `${p}.playerId`),
        name: str(m['name'], `${p}.name`),
        stat: oneOf(m['stat'], `${p}.stat`, ['goals', 'assists', 'points', 'games']),
        value: int(m['value'], `${p}.value`),
      }
    }),
    recentNights: arr(o['recentNights'], `${path}.recentNights`, (x, p) => {
      const n = obj(x, p)
      return {
        night: night(n['night'], `${p}.night`),
        wins: int(n['wins'], `${p}.wins`),
        losses: int(n['losses'], `${p}.losses`),
        otl: int(n['otl'], `${p}.otl`),
        goalsFor: int(n['goalsFor'], `${p}.goalsFor`),
        goalsAgainst: int(n['goalsAgainst'], `${p}.goalsAgainst`),
      }
    }),
    people: arr(o['people'], `${path}.people`, parsePerson),
    // A sheet from a web app without them still parses (deploy order).
    history: o['history'] === undefined ? [] : arr(o['history'], `${path}.history`, parseHistory),
    weekPlayers:
      o['weekPlayers'] === undefined
        ? []
        : arr(o['weekPlayers'], `${path}.weekPlayers`, parseWeekPlayer),
    aiGoalieWeek:
      o['aiGoalieWeek'] === undefined
        ? []
        : arr(o['aiGoalieWeek'], `${path}.aiGoalieWeek`, parseAiGoalieWeek),
    lore: o['lore'] === undefined ? [] : arr(o['lore'], `${path}.lore`, str),
    norms: parseModeNorms(o['norms'], `${path}.norms`),
    records: opt(o, 'records', [], () => arr(o['records'], `${path}.records`, parseClubRecord)),
    threads: opt(o, 'threads', [], () => arr(o['threads'], `${path}.threads`, parseThread)),
    stances: opt(o, 'stances', [], () => arr(o['stances'], `${path}.stances`, parseStance)),
    scorecards: opt(o, 'scorecards', [], () =>
      arr(o['scorecards'], `${path}.scorecards`, parseScorecard),
    ),
    topFacts: opt(o, 'topFacts', [], () => arr(o['topFacts'], `${path}.topFacts`, parseTopFact)),
  }
}

/** Throws (with the path of the first bad field) when the value is not a valid fact-sheet response. */
export function parseNewsFactsResponse(value: unknown): NewsFactsResponse {
  const o = obj(value, 'root')
  return {
    facts: parseFacts(o['facts'], 'facts'),
    forbiddenNames: arr(o['forbiddenNames'], 'forbiddenNames', str),
  }
}
