import {
  FEATURE_REPORTER,
  REPORTER_IDS,
  RELATIONSHIPS,
  mulberry32,
  takeCritics,
  weightedPick,
  type BuzzPlan,
  type FeatureKind,
  type GameArticleKind,
  type NewsFacts,
  type NewsGameFacts,
  type NewsTake,
  type ReporterId,
} from '@eanhl/db/news'
import { classifyNight, type GameSituation, type NightSituation } from './situation.ts'

/**
 * What an item was, for the rotation queues (spec §12.4): the first post of a
 * game is its `recap`; a later post is a `reaction`; a night article is a
 * `night` recap; a big game's article is a `game` article (C3a.8); a weekly
 * piece is a `feature`. Each kind has its own queue.
 */
export type ActivityKind = 'recap' | 'reaction' | 'night' | 'game' | 'feature'

/** Items the desk already wrote (live or test), for the frequency limits and the queues. */
export type Activity = {
  reporter: ReporterId
  night: string | null
  createdAt: Date
  kind: ActivityKind
  /** A reply's target reporter (C3a.8: a pair used recently weighs less); absent otherwise. */
  replyTo?: ReporterId | null
}[]

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The reporters who fit each game. The list order breaks ties in the queue
 * (rev 2: Gord Pettibone fits the losses, Lyle Bergstrom the big games).
 */
export const GAME_PREFERENCE: Record<GameSituation, readonly ReporterId[]> = {
  ot_win: ['vale', 'barlow', 'bergstrom', 'rink'],
  ot_loss: ['mercer', 'barlow', 'quill', 'pettibone'],
  blowout_loss: ['mercer', 'quill', 'voss', 'pettibone'],
  goalie_steal: ['voss', 'quill', 'bergstrom', 'vale', 'rink'],
  // C3a.8: Vale writes about more than overtime games.
  quiet_win: ['quill', 'barlow', 'halberd', 'vale'],
  routine_win: ['barlow', 'halberd', 'quill', 'vale'],
  loss: ['barlow', 'mercer', 'quill', 'pettibone'],
}

const NIGHT_PREFERENCE: Record<NightSituation, readonly ReporterId[]> = {
  sweep: ['vale', 'barlow', 'bergstrom'],
  winning: ['barlow', 'halberd', 'bergstrom'],
  even: ['halberd', 'quill'],
  losing: ['quill', 'barlow', 'pettibone'],
  winless: ['mercer', 'barlow', 'pettibone'],
  single: ['barlow', 'quill', 'halberd'],
}

/** Always allowed, so every pick ends with someone. */
const FALLBACK: readonly ReporterId[] = ['barlow', 'quill', 'halberd']

/** The weekly feature rotation without Father Rink (spec §12.3). */
const FEATURE_ROTATION: readonly FeatureKind[] = ['trend', 'spotlight', 'notes', 'bigpicture']

/**
 * Dex Mercer: at most 1 item per night and 3 per 7 days. Father Rink: 1 per
 * 14 days. Others: always. `historic` waives both limits (spec §5.2).
 */
export function isAllowed(
  r: ReporterId,
  now: Date,
  night: string | null,
  activity: Activity,
  historic = false,
): boolean {
  if (historic) return true
  if (r === 'mercer') {
    const mine = activity.filter((a) => a.reporter === 'mercer')
    if (night !== null && mine.some((a) => a.night === night)) return false
    const weekAgo = now.getTime() - 7 * DAY_MS
    return mine.filter((a) => a.createdAt.getTime() > weekAgo).length < 3
  }
  if (r === 'rink') {
    const cutoff = now.getTime() - 14 * DAY_MS
    return !activity.some((a) => a.reporter === 'rink' && a.createdAt.getTime() > cutoff)
  }
  return true
}

/** When `r` last wrote an item of `kind`; -Infinity when never (never = oldest). */
function lastOf(r: ReporterId, kind: ActivityKind, activity: Activity): number {
  let last = -Infinity
  for (const a of activity) {
    if (a.reporter === r && a.kind === kind) last = Math.max(last, a.createdAt.getTime())
  }
  return last
}

/**
 * The queue (spec §12.4): among the allowed fitting reporters, the one whose
 * last item of `kind` is oldest; a tie goes to the earlier one in the list.
 * When no fitting reporter is allowed, the same rule runs over the fallback.
 */
function pickFromQueue(
  list: readonly ReporterId[],
  kind: ActivityKind,
  now: Date,
  night: string | null,
  activity: Activity,
  exclude: readonly ReporterId[],
  historic = false,
): ReporterId {
  for (const pool of [list, FALLBACK, REPORTER_IDS]) {
    let best: ReporterId | null = null
    let bestAt = Infinity
    for (const r of pool) {
      if (exclude.includes(r) || !isAllowed(r, now, night, activity, historic)) continue
      const at = lastOf(r, kind, activity)
      if (best === null || at < bestAt) {
        best = r
        bestAt = at
      }
    }
    if (best !== null) return best
  }
  throw new Error('news assign: no reporter available')
}

/**
 * The recap post (post 1) goes to the fitting reporter whose last recap is
 * oldest. Father Rink is kept for nights and features: never on a game's
 * post list, except on a historic game (C3a.8).
 */
export function assignRecap(
  s: GameSituation,
  now: Date,
  night: string,
  activity: Activity,
  historic = false,
  disabled: readonly ReporterId[] = [],
): ReporterId {
  const list = GAME_PREFERENCE[s].filter((r) => historic || r !== 'rink')
  const exclude = historic ? disabled : [...disabled, 'rink' as const]
  return pickFromQueue(list, 'recap', now, night, activity, exclude, historic)
}

/**
 * Angles of the extra posts (spec §12.14: "a player, a number, a reply, a
 * joke, the big picture"; C3a.8 adds `history`, `counterpoint`, `mode` and a
 * reporter `take`, so a historic game's 8 extra posts never share an angle).
 * `reply` and `counterpoint` answer an earlier post of the game.
 */
export const POST_ANGLES = [
  'player',
  'number',
  'reply',
  'joke',
  'big picture',
  'history',
  'counterpoint',
  'mode',
  'take',
] as const
export type PostAngle = 'recap' | (typeof POST_ANGLES)[number]

/** What each angle asks of the post (the prompt's words). */
export const ANGLE_TEXT: Record<PostAngle, string> = {
  recap:
    'the recap: the result and the score, who scored for the Boogeymen, and exactly one key number besides the score',
  player: "one player's night, from his line on the sheet",
  number: 'one number on the sheet and what it says',
  reply: 'a reply to the post named below: argue with one number from the sheet',
  joke: 'a joke or a quip about the game, built on one fact from the sheet',
  'big picture':
    'the big picture: what the game means for the season, from the record, streak or norms',
  history: 'history: a record, a streak, a rematch or a milestone on the sheet',
  counterpoint:
    'a counterpoint to the post named below: the other side of the same game, with a number',
  mode: "the game mode: the reporter's opinion of 3s or 6s, tied to this game's numbers",
  take: "the reporter's take on a player (listed below), backed by the take's data angle",
}

/** Angles each reporter is good at: they weigh 2x in the draw. */
const ANGLE_FIT: Record<ReporterId, readonly PostAngle[]> = {
  barlow: ['number', 'counterpoint'],
  voss: ['player', 'big picture'],
  mercer: ['counterpoint', 'reply', 'take'],
  halberd: ['number', 'reply'],
  vale: ['joke', 'player', 'mode'],
  quill: ['number', 'counterpoint', 'reply'],
  rink: ['history', 'big picture'],
  pettibone: ['joke', 'take', 'mode'],
  bergstrom: ['big picture', 'mode', 'history'],
}

/** Draw weights (Claude's call, spec §12.11). */
export const PAIR_WEIGHT_RELATIONSHIP = 3
export const PAIR_WEIGHT_RECENT = 0.2
/** A pair is "recent" when it is among this many latest replies. */
export const RECENT_REPLY_PAIRS = 6
/** A reporter who fits the game's situation weighs this much more for an extra post. */
export const FIT_WEIGHT = 2
/** Vale writes about more than overtime games (spec §12.12-8). */
export const VALE_WEIGHT = 1.5

/** One post of a game: who writes it, from which angle, on which top fact. */
export interface PostAssignment {
  reporter: ReporterId
  angle: PostAngle
  /** The index of the earlier post this one answers (reply, counterpoint), else null. */
  replyTo: number | null
  /** The `topFacts` id this post builds on (distinct per post), else null. */
  factId: string | null
  /** The due take this post may voice (angle `take`, critics only), else null. */
  takeId: number | null
  /**
   * The take this post pushes back on: its defender answers the critic's post
   * of this game (a reply), never voicing the take (C3a fix I4). Absent otherwise.
   */
  pushesBack?: number
}

const hasRelationship = (from: ReporterId, to: ReporterId) =>
  RELATIONSHIPS.some((r) => r.from === from && r.to === to)

/** Reply pairs among the latest `RECENT_REPLY_PAIRS` replies of the activity. */
function recentPairs(activity: Activity): Set<string> {
  const replies = activity
    .filter((a) => a.replyTo !== undefined && a.replyTo !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, RECENT_REPLY_PAIRS)
  return new Set(replies.map((a) => `${a.reporter}>${a.replyTo!}`))
}

/** How much a reply from `from` to `to` weighs (spec §12.11). */
export function pairWeight(from: ReporterId, to: ReporterId, recent: ReadonlySet<string>): number {
  let w = hasRelationship(from, to) ? PAIR_WEIGHT_RELATIONSHIP : 1
  if (recent.has(`${from}>${to}`)) w *= PAIR_WEIGHT_RECENT
  return w
}

/**
 * The posts of one game (C3a.8): post 1 is the recap (rotation queue), posts
 * 2..N are distinct reporters drawn with weights (fit for the situation 2x,
 * Vale 1.5x), each with its own angle and top fact; a reply or counterpoint
 * answers an earlier post, its target drawn by pair weights (relationship
 * 3x, a pair used recently 0.2x). Mercer and Rink limits hold, except on a
 * historic game (all nine post); Rink is on a game's list only when historic.
 * A due take whose critic is drawn gives that post the `take` angle; its
 * defender, when drawn later, replies to that post (C3a fix I4). Seeded
 * from the match id, so a rerun gives the same posts.
 */
export function assignGamePosts(args: {
  game: NewsGameFacts
  facts: NewsFacts
  situation: GameSituation
  plan: Pick<BuzzPlan, 'level' | 'posts'>
  now: Date
  night: string
  activity: Activity
  /** Takes due on the sheet's players (`dueTakes`). */
  takes?: readonly NewsTake[]
  /** Reporters who may not write (benched); never empties the cast. */
  disabled?: readonly ReporterId[]
}): PostAssignment[] {
  const { game, situation, plan, now, night, activity } = args
  const historic = plan.level === 'historic'
  const disabled = args.disabled ?? []
  const rng = mulberry32((game.matchId * 2654435761) >>> 0)
  const facts = args.facts.topFacts.map((f) => f.id)
  const usedFacts = new Set<string>()
  const nextFact = (): string | null => {
    const id = facts.find((f) => !usedFacts.has(f)) ?? null
    if (id !== null) usedFacts.add(id)
    return id
  }

  const recap = assignRecap(situation, now, night, activity, historic, disabled)
  const posts: PostAssignment[] = [
    { reporter: recap, angle: 'recap', replyTo: null, factId: nextFact(), takeId: null },
  ]
  const fits = GAME_PREFERENCE[situation]
  const pool = REPORTER_IDS.filter(
    (r) =>
      r !== recap &&
      !disabled.includes(r) &&
      (historic || r !== 'rink') &&
      isAllowed(r, now, night, activity, historic),
  )
  const usedAngles = new Set<PostAngle>()
  const recent = recentPairs(activity)
  const takes = [...(args.takes ?? [])]
  const voiced: { take: NewsTake; index: number }[] = []
  const want = Math.min(plan.posts, 1 + pool.length)
  while (posts.length < want) {
    const remaining = pool.filter((r) => !posts.some((p) => p.reporter === r))
    const reporter = weightedPick(
      remaining.map(
        (r) => [r, (fits.includes(r) ? FIT_WEIGHT : 1) * (r === 'vale' ? VALE_WEIGHT : 1)] as const,
      ),
      rng,
    )
    // Only a critic voices a take; its defender answers the critic's post (C3a fix I4).
    const take = takes.find((t) => takeCritics(t).includes(reporter))
    const defended = voiced.find((v) => v.take.defender === reporter)
    let angle: PostAngle
    let replyTo: number | null = null
    let pushesBack: number | undefined
    if (take !== undefined && !usedAngles.has('take')) {
      angle = 'take'
    } else if (defended !== undefined) {
      angle = !usedAngles.has('reply')
        ? 'reply'
        : !usedAngles.has('counterpoint')
          ? 'counterpoint'
          : 'reply'
      replyTo = defended.index
      pushesBack = defended.take.id
    } else {
      const open = POST_ANGLES.filter((a) => a !== 'take' && !usedAngles.has(a))
      angle =
        open.length === 0
          ? 'reply'
          : weightedPick(
              open.map((a) => [a, ANGLE_FIT[reporter].includes(a) ? 2 : 1] as const),
              rng,
            )
    }
    usedAngles.add(angle)
    if (replyTo === null && (angle === 'reply' || angle === 'counterpoint')) {
      replyTo = weightedPick(
        posts.map((p, i) => [i, pairWeight(reporter, p.reporter, recent)] as const),
        rng,
      )
    }
    const takeId = angle === 'take' && take !== undefined ? take.id : null
    if (takeId !== null) {
      takes.splice(takes.indexOf(take!), 1)
      voiced.push({ take: take!, index: posts.length })
    }
    posts.push({
      reporter,
      angle,
      replyTo,
      factId: angle === 'take' ? null : nextFact(),
      takeId,
      ...(pushesBack === undefined ? {} : { pushesBack }),
    })
  }
  return posts
}

/** Who writes a big game's articles (spec §12.18-1): queue + fit. */
const GAME_STORY_PREFERENCE: Record<GameSituation, readonly ReporterId[]> = {
  ot_win: ['vale', 'barlow', 'bergstrom'],
  ot_loss: ['barlow', 'halberd', 'quill'],
  blowout_loss: ['barlow', 'halberd', 'quill'],
  goalie_steal: ['barlow', 'halberd', 'voss'],
  quiet_win: ['barlow', 'halberd', 'quill'],
  routine_win: ['barlow', 'halberd', 'vale'],
  loss: ['barlow', 'halberd', 'quill'],
}
const SPOTLIGHT_WRITERS: readonly ReporterId[] = ['voss', 'bergstrom', 'barlow']
const COLUMN_WRITERS: readonly ReporterId[] = ['bergstrom', 'mercer', 'pettibone', 'quill', 'rink']

/**
 * The writers of a big game's articles, distinct, from the `game` queue among
 * the reporters who fit (a game story: the beat and analysis desks; a
 * spotlight: Voss first; a column: the columnists, Rink when his limit allows
 * or the game is historic).
 */
export function assignGameArticles(args: {
  kinds: readonly GameArticleKind[]
  situation: GameSituation
  historic: boolean
  now: Date
  night: string
  activity: Activity
  disabled?: readonly ReporterId[]
}): { kind: GameArticleKind; reporter: ReporterId }[] {
  const out: { kind: GameArticleKind; reporter: ReporterId }[] = []
  const disabled = args.disabled ?? []
  for (const kind of args.kinds) {
    const list =
      kind === 'game'
        ? GAME_STORY_PREFERENCE[args.situation]
        : kind === 'spotlight'
          ? SPOTLIGHT_WRITERS
          : COLUMN_WRITERS
    const exclude = [...disabled, ...out.map((o) => o.reporter)]
    const reporter = pickFromQueue(
      list,
      'game',
      args.now,
      args.night,
      args.activity,
      exclude,
      args.historic,
    )
    out.push({ kind, reporter })
  }
  return out
}

/**
 * The night recap: the night queue among the reporters who fit the night,
 * never the writer of the previous night recap. Father Rink keeps his own
 * trigger: a sweep or winless night of 4+ games is his when his 14-day limit
 * allows (he writes "now and then", so the queue would almost never reach him).
 */
export function assignNightRecap(
  facts: NewsFacts,
  now: Date,
  activity: Activity,
  disabled: readonly ReporterId[] = [],
): ReporterId {
  const situation = classifyNight(facts)
  const list = NIGHT_PREFERENCE[situation]
  let previous: { reporter: ReporterId; at: number } | null = null
  for (const a of activity) {
    if (a.kind !== 'night') continue
    const at = a.createdAt.getTime()
    if (previous === null || at >= previous.at) previous = { reporter: a.reporter, at }
  }
  const rinkNight = (situation === 'sweep' || situation === 'winless') && facts.games.length >= 4
  if (
    rinkNight &&
    !disabled.includes('rink') &&
    previous?.reporter !== 'rink' &&
    isAllowed('rink', now, facts.key, activity)
  ) {
    return 'rink'
  }
  try {
    return pickFromQueue(
      list,
      'night',
      now,
      facts.key,
      activity,
      previous === null ? disabled : [...disabled, previous.reporter],
    )
  } catch (err: unknown) {
    // Only the previous writer is left (the others are benched): he writes again.
    if (previous === null) throw err
    return pickFromQueue(list, 'night', now, facts.key, activity, disabled)
  }
}

/**
 * The next weekly feature kind: trend → spotlight → notes → bigpicture, then
 * Father Rink's column as every 5th feature when he is allowed (else trend
 * again), then trend. No previous feature ⇒ trend.
 */
export function nextFeatureKind(last: FeatureKind | null, rinkAllowed: boolean): FeatureKind {
  if (last === null || last === 'rink') return 'trend'
  if (last === 'bigpicture') return rinkAllowed ? 'rink' : 'trend'
  return FEATURE_ROTATION[FEATURE_ROTATION.indexOf(last) + 1]!
}

/** The kind and the writer of the next weekly feature. */
export function assignFeature(
  lastKind: FeatureKind | null,
  now: Date,
  activity: Activity,
  disabled: readonly ReporterId[] = [],
): { kind: FeatureKind; reporter: ReporterId } {
  const rinkAllowed = isAllowed('rink', now, null, activity) && !disabled.includes('rink')
  // A benched writer's kind is skipped: the rotation moves on to the next kind.
  let from = lastKind
  for (let i = 0; i < 6; i++) {
    const kind = nextFeatureKind(from, rinkAllowed)
    if (!disabled.includes(FEATURE_REPORTER[kind]))
      return { kind, reporter: FEATURE_REPORTER[kind] }
    from = kind
  }
  throw new Error('news assign: no feature writer is switched on')
}

/**
 * The prediction the new feature must judge (spec §12.6: "last week's
 * prediction"): the last feature's prediction only when that feature covered
 * the week right before `weekStart`. After a week without games the old
 * prediction was about a week that was never played, so there is none.
 */
export function predictionToJudge(
  weekStart: string,
  last: { prediction: string | null; weekStart: string | null } | null,
): string | null {
  if (last === null || last.prediction === null || last.weekStart === null) return null
  const [y, m, d] = weekStart.split('-').map(Number)
  const previous = new Date(Date.UTC(y!, m! - 1, d! - 7)).toISOString().slice(0, 10)
  return last.weekStart === previous ? last.prediction : null
}
