import {
  GAME_ARTICLE_KINDS,
  REPORTERS,
  TAKE_REUSE_DAYS,
  dueTakes,
  nightsOfWeek,
  planBuzz,
  REPORTER_IDS,
  takeCritics,
  type BuzzPlan,
  type GameArticleKind,
  type NewsTake,
  type NewsFacts,
  type NewsFactsResponse,
  type FeatureKind,
  type NewsGameFacts,
  type ReporterId,
} from '@eanhl/db/news'
import type {
  NewNewsItem,
  NewNewsStance,
  NewNewsUsage,
  NewsItemRow,
  NewsJobKind,
  NewsMention,
} from '@eanhl/db/queries'
import { WebhookOutcomeUnknownError } from '../webhook.ts'
import {
  assignFeature,
  assignGameArticles,
  assignGamePosts,
  assignNightRecap,
  predictionToJudge,
  type PostAssignment,
  type Activity,
  type ActivityKind,
} from './assign.ts'
import { NEWS_RULES_VERSION } from './rules-version.ts'
import { costUsd } from './cost.ts'
import {
  checkArticleFacts,
  checkFeatureFacts,
  checkGamePosts,
  type CheckResult,
} from './fact-check.ts'
import {
  articleSlug,
  buildArticlePayload,
  buildNewsPostPayload,
  type NewsWebhookPayload,
} from './messages.ts'
import {
  ARTICLE_SCHEMA,
  FEATURE_SCHEMA,
  GAME_POSTS_SCHEMA,
  criticizedAsOnSheet,
  zeroCalledAsOnSheet,
  parseArticle,
  parseFeature,
  featureBody,
  parseGamePosts,
  GAME_ARTICLE_FEATURE_KIND,
  stancesToStore,
  type Article,
} from './outputs.ts'
import {
  OWN_RECENT_PIECES,
  buildArticleUserPrompt,
  buildFeatureUserPrompt,
  buildGameArticleUserPrompt,
  buildGameUserPrompt,
  buildSystemPrompt,
  type DeskContext,
  type NightPost,
  type OwnPiece,
} from './prompts.ts'
import { classifyGame } from './situation.ts'
import {
  NewsRetryableError,
  NewsStopError,
  budgetLeft,
  writeChecked,
  type ModelCall,
} from './writer.ts'

/** Games that ended within this window may still get posts. */
export const NEWS_GAME_WINDOW_MS = 86_400_000
/** At most this many games are written per pass, oldest first. */
export const NEWS_GAME_LIMIT = 5
/** Discord allows ~30 webhook messages a minute per channel. */
export const NEWS_GAP_MS = 2100
/** A night is over 90 minutes after its last game. */
export const NIGHT_ENDED_FOR_MS = 90 * 60_000
/** Nights older than this are never written up (e.g. after a long outage). */
export const NIGHT_SINCE_MS = 3 * 86_400_000
/** After the API refuses the key, write nothing for this long (so attempts are not burned every pass). */
export const STOP_PAUSE_MS = 3_600_000
/** After the API is unavailable (rate limit, outage), write nothing for this long, so 3 tries span 30+ min. */
export const RETRYABLE_PAUSE_MS = 900_000
/** After a week's facts fetch fails, that week is not fetched again for this long (Mondays run every pass). */
export const WEEK_FETCH_PAUSE_MS = 900_000

const DELETE_LIMIT = 20
const UNDELIVERED_LIMIT = 10
const ACTIVITY_MS = 14 * 86_400_000

type Kind = NewsJobKind

/** The news queries the cycle uses (packages/db/src/queries/news.ts), plus one lookup. */
export interface NewsStore {
  listDiscordDeletions(limit: number): Promise<{ id: number; messageId: string }[]>
  markDiscordDeleted(id: number): Promise<void>
  getNewsEnabled(): Promise<boolean>
  monthNewsSpendUsd(now: Date): Promise<number>
  listUndeliveredNewsItems(limit: number): Promise<NewsItemRow[]>
  /** The reporter of item `id` (for a reply's "↪ to" prefix on a retry), or null when unknown. */
  newsItemReporter(id: number): Promise<ReporterId | null>
  listGameJobCandidates(args: { since: Date; limit: number }): Promise<number[]>
  listEndedNights(args: { now: Date; endedForMs: number; since: Date }): Promise<string[]>
  countNightGames(nights: string[]): Promise<number>
  claimNewsJob(kind: Kind, key: string, isTest: boolean): Promise<number | null>
  markNewsJob(
    jobId: number,
    status: 'done' | 'failed' | 'skipped',
    error: string | null,
  ): Promise<void>
  insertNewsItem(item: NewNewsItem): Promise<number>
  markNewsItemPosted(id: number, messageId: string | null): Promise<void>
  markNewsItemFailed(id: number, error: string): Promise<void>
  markNewsItemSkipped(id: number, reason: string): Promise<void>
  /** Real items since `since`, each with what it was (recap, reaction, night, feature). */
  reporterActivity(args: { since: Date }): Promise<Activity>
  /** The reporter's last pieces, posts and articles, newest first (C3a.3). */
  recentReporterPieces(
    reporter: ReporterId,
    limit: number,
    includeTest: boolean,
  ): Promise<OwnPiece[]>
  /** The night's posts, oldest first (the night article's prompt, C3a.3). */
  nightPostsForPrompt(night: string, includeTest: boolean): Promise<NightPost[]>
  /** When each take was last voiced since `since` (C3a.6). */
  takesUsedSince(since: Date, includeTest: boolean): Promise<{ takeId: number; lastUsed: Date }[]>
  /** Failed big-game article jobs under the cap (C3a.8): `<matchId>:<kind>`. */
  listGameArticleRetries(args: { since: Date; limit: number }): Promise<string[]>
  recordNewsUsage(row: NewNewsUsage): Promise<void>
  /** The newest real, not deleted weekly feature, or null (rev 2, B5). */
  lastFeature(): Promise<LastFeature | null>
  /** Names the night's items criticised harshly so far (not deleted; test items only when asked). */
  nightCriticized(night: string, includeTest: boolean): Promise<string[]>
  /** Zero call-outs of the night and of the previous night with items (C3a). */
  nightZeroCalled(
    night: string,
    includeTest: boolean,
  ): Promise<{ tonight: string[]; previous: string[] }>
  /** Stores a stance on a thread (C3a.4); the item that took it. */
  insertStance(stance: NewNewsStance): Promise<number>
  /** The reporters switched off on /admin/news (C3b.3); a reporter without a row is on. */
  listDisabledReporters(): Promise<ReporterId[]>
}

export interface NewsDeps {
  store: NewsStore
  /** The fact sheet from the web app's internal route. Any error (404 included) ⇒ retry next pass. */
  fetchFacts(kind: 'game' | 'night' | 'week', key: string): Promise<NewsFactsResponse>
  /** The Claude call (Task 5's `anthropicModelCall`). */
  writer: ModelCall
  send(payload: NewsWebhookPayload): Promise<string | null>
  remove(messageId: string): Promise<void>
  writeDryRun(key: string, payload: NewsWebhookPayload): Promise<void>
  pause(ms: number): Promise<void>
  log(message: string): void
  now(): Date
}

/** In-memory state that lives as long as the process (one per service). */
export interface NewsCycleState {
  /** UTC 'YYYY-MM' whose money-limit stop was already logged. */
  budgetLoggedMonth: string | null
  /** Epoch ms: no writing before this (set when the API refuses the key or is unavailable). */
  pausedUntil: number
  /** Items written in test mode: reporterActivity counts real items only. */
  testActivity: Activity
  /** Week keys whose job is done, skipped, capped or in flight: not fetched again by this process. */
  settledWeeks: Set<string>
  /** Week key -> epoch ms: after a failed facts fetch, that week is not fetched again before this. */
  weekFetchPausedUntil: Map<string, number>
  /** The last feature written in test mode: lastFeature reads real items only. */
  testLastFeature: LastFeature | null
  /** True after "every reporter is switched off" was logged; reset when one is switched on. */
  allOffLogged: boolean
}

export interface LastFeature {
  kind: FeatureKind
  prediction: string | null
  weekStart: string | null
}

export function createNewsCycleState(): NewsCycleState {
  return {
    budgetLoggedMonth: null,
    pausedUntil: 0,
    testActivity: [],
    settledWeeks: new Set(),
    weekFetchPausedUntil: new Map(),
    testLastFeature: null,
    allOffLogged: false,
  }
}

export interface NewsCycleOptions {
  dryRun: boolean
  siteUrl: string
  monthlyLimitUsd: number
  state: NewsCycleState
}

export interface NewsSummary {
  deleted: number
  posted: number
  failed: number
  dryRun: number
  jobsDone: number
  jobsFailed: number
  jobsSkipped: number
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
/** Discord's rate limit: stop sending this pass instead of sending into it. */
const rateLimited = (err: unknown) => /HTTP 429\b/.test(message(err))

const SYSTEM_PROMPT = buildSystemPrompt(Object.values(REPORTERS))

/** The people an item names, as stored: sheet names only, one entry per player. */
function mentionsOf(names: string[], facts: NewsFacts): NewsMention[] {
  const out: NewsMention[] = []
  for (const n of names) {
    const p = facts.people.find((x) => x.name === n)
    if (p && !out.some((m) => m.playerId === p.playerId)) {
      out.push({ name: p.name, playerId: p.playerId })
    }
  }
  return out
}

const EDMONTON = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Edmonton',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
})

/** Wall clock in America/Edmonton: the date, the weekday and the hour. */
function edmontonClock(now: Date): { day: string; weekday: string; hour: number } {
  const p: Record<string, string> = {}
  for (const part of EDMONTON.formatToParts(now)) p[part.type] = part.value
  return {
    day: `${p['year']!}-${p['month']!}-${p['day']!}`,
    weekday: p['weekday']!,
    hour: Number(p['hour']),
  }
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10)
}

type Step = 'go' | 'end'

/**
 * One pass of the news desk, in this order:
 *  1. Discord deletions of deleted items (always, also when off or out of money).
 *  2. The on/off switch.  3. The money limit (logged once a month).
 *  4. Retry of undelivered items.  5. Game posts.  6. Night articles.  7. The week piece.
 * Rules (as in cycle-unlocks.ts): fetch the facts first, then claim the job, then
 * write; a claimed job is never claimed again unless it is marked failed (3 tries).
 * A send that may have reached Discord is never re-sent. HTTP 429 stops sending
 * for this pass. NewsStopError (the key is refused) ends the pass and pauses
 * writing for an hour; NewsRetryableError (API down) ends the pass's writing and
 * pauses writing for 15 minutes. Deletions and undelivered sends run during a pause.
 */
export async function runNewsCycle(deps: NewsDeps, opts: NewsCycleOptions): Promise<NewsSummary> {
  const { store, log } = deps
  const state = opts.state
  const summary: NewsSummary = {
    deleted: 0,
    posted: 0,
    failed: 0,
    dryRun: 0,
    jobsDone: 0,
    jobsFailed: 0,
    jobsSkipped: 0,
  }
  let discordUsed = false
  let sendingStopped = false
  /** The reporters switched off (C3b.3); read once per pass, before any writing. */
  let disabled: ReporterId[] = []

  /** Keep NEWS_GAP_MS between any two Discord calls of this pass. */
  async function gap(): Promise<void> {
    if (discordUsed) await deps.pause(NEWS_GAP_MS)
    discordUsed = true
  }

  async function moneyLeft(): Promise<boolean> {
    const now = deps.now()
    const spent = await store.monthNewsSpendUsd(now)
    if (budgetLeft(spent, opts.monthlyLimitUsd)) return true
    const month = now.toISOString().slice(0, 7)
    if (state.budgetLoggedMonth !== month) {
      state.budgetLoggedMonth = month
      log(
        `monthly money limit reached (${spent.toFixed(2)} of ${opts.monthlyLimitUsd.toFixed(2)} USD) — writing nothing new until next month`,
      )
    }
    return false
  }

  async function loadActivity(now: Date): Promise<Activity> {
    const since = new Date(now.getTime() - ACTIVITY_MS)
    state.testActivity = state.testActivity.filter((a) => a.createdAt >= since)
    const rows = await store.reporterActivity({ since })
    return opts.dryRun ? [...rows, ...state.testActivity] : rows
  }

  function noteWritten(
    reporter: ReporterId,
    night: string | null,
    kind: ActivityKind,
    replyTo: ReporterId | null = null,
  ): void {
    if (opts.dryRun) {
      state.testActivity.push({ reporter, night, createdAt: deps.now(), kind, replyTo })
    }
  }

  async function failJob(jobId: number, tag: string, reason: string): Promise<void> {
    await store.markNewsJob(jobId, 'failed', reason)
    summary.jobsFailed++
    log(`${tag}: not written (${reason})`)
  }

  async function markItemFailed(id: number, tag: string, error: string): Promise<void> {
    try {
      await store.markNewsItemFailed(id, error)
    } catch (err: unknown) {
      log(`${tag}: could not record the failure — left pending (${message(err)})`)
    }
  }

  /**
   * Send one stored item (or write its file in a dry run) and record the outcome.
   * `retry`: the item came from the undelivered list (status failed). An unknown
   * outcome then marks it skipped, or the list would send it again next pass.
   */
  async function deliver(
    id: number,
    payload: NewsWebhookPayload,
    tag: string,
    retry = false,
  ): Promise<void> {
    if (opts.dryRun) {
      try {
        await deps.writeDryRun(`news-${String(id)}`, payload)
        await store.markNewsItemSkipped(id, 'dry run')
        summary.dryRun++
      } catch (err: unknown) {
        log(`${tag}: dry-run file not written (${message(err)})`)
      }
      return
    }
    if (sendingStopped) {
      // Never tried; failed status puts it on the retry list for the next pass.
      await markItemFailed(id, tag, 'not sent: Discord rate limit')
      return
    }
    await gap()
    let messageId: string | null
    try {
      messageId = await deps.send(payload)
    } catch (err: unknown) {
      summary.failed++
      if (err instanceof WebhookOutcomeUnknownError) {
        log(`${tag}: ${err.message} — not retried; check the channel`)
        if (retry) {
          try {
            await store.markNewsItemSkipped(id, 'outcome unknown — check the channel')
          } catch (markErr: unknown) {
            log(`${tag}: could not mark it skipped (${message(markErr)})`)
          }
        }
      } else {
        log(`${tag}: send failed (${message(err)})`)
        await markItemFailed(id, tag, message(err))
      }
      if (rateLimited(err)) {
        sendingStopped = true
        log('Discord rate limit — news sending stopped until the next pass')
      }
      return
    }
    summary.posted++
    try {
      await store.markNewsItemPosted(id, messageId)
    } catch (err: unknown) {
      log(`${tag}: posted but not recorded — left pending, not retried (${message(err)})`)
    }
  }

  /**
   * Write with the checked writer; usage is recorded per call against the job.
   * Returns the output, or 'failed' (job marked failed), or 'end' (pass over).
   */
  async function write<T>(
    jobId: number,
    tag: string,
    args: {
      user: string
      schema: object
      parse: (v: unknown) => T
      check: (out: T) => CheckResult
      textForReview: (out: T) => string
      criticizedForReview: (out: T) => string[]
      /** The takes the piece was offered (shown to the review, C3a.10). */
      takesForReview?: readonly NewsTake[]
      facts: NewsFacts
    },
  ): Promise<{ out: T } | 'failed' | 'end'> {
    try {
      const r = await writeChecked({
        call: deps.writer,
        system: SYSTEM_PROMPT,
        ...args,
        record: (purpose, model, usage) =>
          store.recordNewsUsage({
            jobId,
            purpose,
            model,
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheReadTokens: usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
            costUsd: costUsd(model, usage),
          }),
      })
      if (r.ok) return { out: r.out }
      await failJob(jobId, tag, r.reason)
      return 'failed'
    } catch (err: unknown) {
      await failJob(jobId, tag, message(err))
      if (err instanceof NewsStopError) {
        state.pausedUntil = deps.now().getTime() + STOP_PAUSE_MS
        log('the Claude API refused the key — writing paused for 1 hour; check ANTHROPIC_API_KEY')
        return 'end'
      }
      if (err instanceof NewsRetryableError) {
        state.pausedUntil = deps.now().getTime() + RETRYABLE_PAUSE_MS
        log('the Claude API is unavailable — writing paused for 15 minutes')
        return 'end'
      }
      return 'failed'
    }
  }

  // ── 1. Deletions ──────────────────────────────────────────────────────────
  for (const d of await store.listDiscordDeletions(DELETE_LIMIT)) {
    const tag = `news item ${String(d.id)}`
    await gap()
    try {
      await deps.remove(d.messageId)
    } catch (err: unknown) {
      log(`${tag}: Discord delete failed, will retry (${message(err)})`)
      if (rateLimited(err)) {
        log('Discord rate limit — pass stopped until the next cycle')
        return summary
      }
      continue
    }
    try {
      await store.markDiscordDeleted(d.id)
      summary.deleted++
    } catch (err: unknown) {
      log(`${tag}: Discord message deleted but not recorded (${message(err)})`)
    }
  }

  // ── 2. Switch, 3. money ───────────────────────────────────────────────────
  if (!(await store.getNewsEnabled())) return summary
  if (!(await moneyLeft())) return summary

  // ── 4. Undelivered items (live only: nothing is ever sent in test mode) ────
  if (!opts.dryRun) {
    for (const item of await store.listUndeliveredNewsItems(UNDELIVERED_LIMIT)) {
      if (sendingStopped) break
      const tag = `news item ${String(item.id)}`
      await deliver(item.id, await payloadForStored(item), tag, true)
    }
    if (sendingStopped) return summary
  }

  if (deps.now().getTime() < state.pausedUntil) return summary

  // The per-reporter switch (C3b.3). A read error stops the writing: a benched reporter
  // must never write because the switch could not be read.
  try {
    disabled = await store.listDisabledReporters()
  } catch (err: unknown) {
    log(`the reporter switches could not be read — nothing written this pass (${message(err)})`)
    return summary
  }
  if (REPORTER_IDS.every((r) => disabled.includes(r))) {
    if (!state.allOffLogged) {
      state.allOffLogged = true
      log('every reporter is switched off — writing nothing new')
    }
    return summary
  }
  state.allOffLogged = false

  if ((await gamePass()) === 'end') return summary
  if ((await nightPass()) === 'end') return summary
  await weekPass()
  return summary

  async function payloadForStored(item: NewsItemRow): Promise<NewsWebhookPayload> {
    const reporter = REPORTERS[item.reporter]
    if (item.kind === 'article') {
      return buildArticlePayload({
        reporter,
        headline: item.headline ?? '',
        dek: item.dek ?? '',
        url: `${opts.siteUrl}/news/${item.slug ?? ''}`,
        siteUrl: opts.siteUrl,
      })
    }
    let replyToName: string | null = null
    if (item.replyTo !== null) {
      const to = await store.newsItemReporter(item.replyTo)
      if (to === null)
        log(`news item ${String(item.id)}: reply target not found, sent without prefix`)
      else replyToName = REPORTERS[to].name
    }
    return buildNewsPostPayload({ reporter, text: item.body, replyToName, siteUrl: opts.siteUrl })
  }

  // ── 5. Game posts ─────────────────────────────────────────────────────────
  async function gamePass(): Promise<Step> {
    const now = deps.now()
    const since = new Date(now.getTime() - NEWS_GAME_WINDOW_MS)
    const ids = await store.listGameJobCandidates({ since, limit: NEWS_GAME_LIMIT })
    for (const matchId of ids) {
      if (!(await moneyLeft())) return 'end'
      const key = String(matchId)
      const tag = `game ${key}`
      let res: NewsFactsResponse
      try {
        res = await deps.fetchFacts('game', key)
      } catch (err: unknown) {
        log(`${tag}: facts unavailable, will retry (${message(err)})`)
        continue
      }
      const jobId = await store.claimNewsJob('game', key, opts.dryRun)
      if (jobId === null) continue
      const game = res.facts.games.find((g) => g.matchId === matchId)
      if (res.facts.kind !== 'game' || game === undefined) {
        try {
          await store.markNewsJob(jobId, 'skipped', 'the fact sheet has no such game')
          summary.jobsSkipped++
        } catch (err: unknown) {
          await failJob(jobId, tag, `could not mark skipped: ${message(err)}`)
        }
        continue
      }
      const plan = planBuzz(game, res.facts)
      if ((await writeGame(jobId, tag, res, game, plan)) === 'end') return 'end'
      if ((await gameArticles(res, game, plan, plan.articles)) === 'end') return 'end'
    }
    // Big-game articles whose job failed earlier (C3a.8): written again under the cap.
    for (const jobKey of await store.listGameArticleRetries({ since, limit: NEWS_GAME_LIMIT })) {
      const [matchKey, kind] = jobKey.split(':')
      if (!(GAME_ARTICLE_KINDS as readonly string[]).includes(kind ?? '')) continue
      if (!(await moneyLeft())) return 'end'
      let res: NewsFactsResponse
      try {
        res = await deps.fetchFacts('game', matchKey!)
      } catch (err: unknown) {
        log(`game ${matchKey!}: facts unavailable, will retry (${message(err)})`)
        continue
      }
      const game = res.facts.games.find((g) => String(g.matchId) === matchKey)
      if (game === undefined) continue
      const plan = planBuzz(game, res.facts)
      if ((await gameArticles(res, game, plan, [kind as GameArticleKind])) === 'end') return 'end'
    }
    return 'go'
  }

  /** The reporters' own last pieces (C3a.3), for every reporter of a request. */
  async function ownRecentOf(
    reporters: readonly ReporterId[],
  ): Promise<Partial<Record<ReporterId, OwnPiece[]>>> {
    const out: Partial<Record<ReporterId, OwnPiece[]>> = {}
    for (const r of new Set(reporters)) {
      out[r] = await store.recentReporterPieces(r, OWN_RECENT_PIECES, opts.dryRun)
    }
    return out
  }

  /** The takes due on the sheet's players (spec §12.19: about once a week per take). */
  async function takesDue(res: NewsFactsResponse, now: Date): Promise<NewsTake[]> {
    if (res.takes.length === 0) return []
    const since = new Date(now.getTime() - TAKE_REUSE_DAYS * 86_400_000)
    const used = await store.takesUsedSince(since, opts.dryRun)
    return dueTakes(res.takes, new Map(used.map((u) => [u.takeId, u.lastUsed])), now)
  }

  async function writeGame(
    jobId: number,
    tag: string,
    res: NewsFactsResponse,
    game: NewsGameFacts,
    plan: BuzzPlan,
  ): Promise<Step> {
    const { facts, forbiddenNames } = res
    const night = facts.key // a game sheet's key is its night (R12)
    const now = deps.now()
    // The job is claimed: any error before the write must mark it failed, never leave it pending.
    let posts: PostAssignment[]
    let ctx: DeskContext
    let takes: NewsTake[]
    try {
      takes = await takesDue(res, now)
      posts = assignGamePosts({
        game,
        facts,
        situation: classifyGame(game),
        plan,
        now,
        night,
        activity: await loadActivity(now),
        takes,
        disabled,
      })
      const zero = await store.nightZeroCalled(night, opts.dryRun)
      ctx = {
        criticizedTonight: await store.nightCriticized(night, opts.dryRun),
        zeroCalledTonight: zero.tonight,
        zeroCalledPrevious: zero.previous,
        ownRecent: await ownRecentOf(posts.map((p) => p.reporter)),
      }
    } catch (err: unknown) {
      await failJob(jobId, tag, `could not prepare: ${message(err)}`)
      return 'go'
    }
    const order = posts.map((p) => p.reporter)
    const offered = posts.map((p) => (p.takeId === null ? [] : [p.takeId]))
    const written = await write(jobId, tag, {
      user: buildGameUserPrompt({ facts, posts, ctx: { ...ctx, takes } }),
      schema: GAME_POSTS_SCHEMA,
      parse: (v) => parseGamePosts(v, order),
      check: (out) =>
        checkGamePosts(out.posts, facts, forbiddenNames, ctx.criticizedTonight, {
          replies: posts.map((p) => p.replyTo !== null),
          zeroCalledTonight: ctx.zeroCalledTonight,
          zeroCalledPrevious: ctx.zeroCalledPrevious,
          offeredTakes: offered,
        }),
      textForReview: (out) =>
        out.posts.map((p) => `${REPORTERS[p.reporter].name}: ${p.text}`).join('\n\n'),
      criticizedForReview: (out) => [...new Set(out.posts.flatMap((p) => p.criticized))],
      takesForReview: takes.filter((t) => offered.flat().includes(t.id)),
      facts,
    })
    if (written === 'end') return 'end'
    if (written === 'failed') return 'go'

    const out = written.out.posts
    const stored: { id: number; reporter: ReporterId; text: string; replyTo: number | null }[] = []
    try {
      for (const [i, p] of out.entries()) {
        const target = posts[i]!.replyTo
        const id = await store.insertNewsItem({
          jobId,
          kind: 'post',
          reporter: p.reporter,
          matchId: game.matchId,
          night,
          replyTo: target === null ? null : stored[target]!.id,
          body: p.text,
          mentions: mentionsOf(p.mentions, facts),
          criticized: criticizedAsOnSheet(p.criticized, facts),
          zeroCalled: zeroCalledAsOnSheet(p.zeroCalled, facts),
          takesUsed: p.takesUsed,
          rulesVersion: NEWS_RULES_VERSION,
          facts,
          isTest: opts.dryRun,
        })
        stored.push({ id, reporter: p.reporter, text: p.text, replyTo: target })
        await saveStances(stancesToStore(p.stances, facts, p.reporter, night, id), tag)
        noteWritten(
          p.reporter,
          night,
          i === 0 ? 'recap' : 'reaction',
          target === null ? null : out[target]!.reporter,
        )
      }
    } catch (err: unknown) {
      if (stored.length === 0) {
        await failJob(jobId, tag, `could not store: ${message(err)}`)
        return 'go'
      }
      // Some posts exist: a retry would write them twice. Leave the job pending.
      log(
        `${tag}: stored ${String(stored.length)} of ${String(out.length)} posts — job left pending, not retried (${message(err)})`,
      )
    }
    if (stored.length === out.length) await markDone(jobId, tag)

    for (const s of stored) {
      const payload = buildNewsPostPayload({
        reporter: REPORTERS[s.reporter],
        text: s.text,
        replyToName: s.replyTo === null ? null : REPORTERS[stored[s.replyTo]!.reporter].name,
        siteUrl: opts.siteUrl,
      })
      await deliver(s.id, payload, `${tag} item ${String(s.id)}`)
    }
    return sendingStopped ? 'end' : 'go'
  }

  /**
   * A big game's articles (C3a.7/C3a.8): one job each (`game_article`,
   * `<matchId>:<kind>`), so a failed article never rewrites the posts. The
   * writers come from the `game` queue; a game story 200-350 words, a
   * spotlight or column 400-700.
   */
  async function gameArticles(
    res: NewsFactsResponse,
    game: NewsGameFacts,
    plan: BuzzPlan,
    kinds: readonly GameArticleKind[],
  ): Promise<Step> {
    if (kinds.length === 0) return 'go'
    const { facts, forbiddenNames } = res
    const night = facts.key
    const now = deps.now()
    let writers: { kind: GameArticleKind; reporter: ReporterId }[]
    try {
      writers = assignGameArticles({
        kinds,
        situation: classifyGame(game),
        historic: plan.level === 'historic',
        now,
        night,
        activity: await loadActivity(now),
        disabled,
      })
    } catch (err: unknown) {
      log(`game ${String(game.matchId)}: articles not assigned (${message(err)})`)
      return 'go'
    }
    for (const w of writers) {
      if (!(await moneyLeft())) return 'end'
      const key = `${String(game.matchId)}:${w.kind}`
      const tag = `game article ${key}`
      const jobId = await store.claimNewsJob('game_article', key, opts.dryRun)
      if (jobId === null) continue
      let ctx: DeskContext
      let takes: NewsTake[]
      try {
        takes = await takesDue(res, deps.now())
        const zero = await store.nightZeroCalled(night, opts.dryRun)
        ctx = {
          criticizedTonight: await store.nightCriticized(night, opts.dryRun),
          zeroCalledTonight: zero.tonight,
          zeroCalledPrevious: zero.previous,
          ownRecent: await ownRecentOf([w.reporter]),
        }
      } catch (err: unknown) {
        await failJob(jobId, tag, `could not prepare: ${message(err)}`)
        continue
      }
      const reporter = REPORTERS[w.reporter]
      const mine = takes.filter(
        (t) => takeCritics(t).includes(w.reporter) || t.defender === w.reporter,
      )
      const written = await write(jobId, tag, {
        user: buildGameArticleUserPrompt({
          facts,
          reporter,
          kind: w.kind,
          ctx: { ...ctx, takes: mine },
        }),
        schema: ARTICLE_SCHEMA,
        parse: parseArticle,
        check: (x) =>
          checkArticleFacts(x, facts, forbiddenNames, ctx.criticizedTonight, {
            reporter: w.reporter,
            length: w.kind === 'game' ? 'game-story' : 'game-feature',
            zeroCalledTonight: ctx.zeroCalledTonight,
            zeroCalledPrevious: ctx.zeroCalledPrevious,
            offeredTakes: mine.map((t) => t.id),
          }),
        textForReview: (x) =>
          [`By ${REPORTERS[w.reporter].name}`, x.headline, x.dek, ...x.paragraphs].join('\n\n'),
        criticizedForReview: (x) => x.criticized,
        takesForReview: mine,
        facts,
      })
      if (written === 'end') return 'end'
      if (written === 'failed') continue
      const a = written.out
      const slug = articleSlug(`${night}-g${String(game.matchId)}`, a.headline)
      let id: number
      try {
        id = await store.insertNewsItem({
          jobId,
          kind: 'article',
          reporter: w.reporter,
          matchId: game.matchId,
          night,
          slug,
          headline: a.headline,
          dek: a.dek,
          body: a.paragraphs.join('\n\n'),
          summary: a.summary,
          mentions: mentionsOf(a.mentions, facts),
          criticized: criticizedAsOnSheet(a.criticized, facts),
          zeroCalled: zeroCalledAsOnSheet(a.zeroCalled, facts),
          takesUsed: a.takesUsed,
          rulesVersion: NEWS_RULES_VERSION,
          featureKind: GAME_ARTICLE_FEATURE_KIND[w.kind],
          facts,
          isTest: opts.dryRun,
        })
      } catch (err: unknown) {
        await failJob(jobId, tag, `could not store: ${message(err)}`)
        continue
      }
      await saveStances(stancesToStore(a.stances, facts, w.reporter, night, id), tag)
      noteWritten(w.reporter, night, 'game')
      await markDone(jobId, tag)
      const payload = buildArticlePayload({
        reporter,
        headline: a.headline,
        dek: a.dek,
        url: `${opts.siteUrl}/news/${slug}`,
        siteUrl: opts.siteUrl,
      })
      await deliver(id, payload, `${tag} item ${String(id)}`)
      if (sendingStopped) return 'end'
    }
    return 'go'
  }

  /** Stances are a side record: a failed insert is logged, never fails the item. */
  async function saveStances(rows: NewNewsStance[], tag: string): Promise<void> {
    for (const row of rows) {
      try {
        await store.insertStance(row)
      } catch (err: unknown) {
        log(`${tag}: stance not stored (${message(err)})`)
      }
    }
  }

  async function markDone(jobId: number, tag: string): Promise<void> {
    try {
      await store.markNewsJob(jobId, 'done', null)
      summary.jobsDone++
    } catch (err: unknown) {
      log(`${tag}: written but not marked done — left pending, not retried (${message(err)})`)
    }
  }

  // ── 6. Night articles ─────────────────────────────────────────────────────
  async function nightPass(): Promise<Step> {
    const now = deps.now()
    const nights = await store.listEndedNights({
      now,
      endedForMs: NIGHT_ENDED_FOR_MS,
      since: new Date(now.getTime() - NIGHT_SINCE_MS),
    })
    for (const night of nights) {
      const tag = `night ${night}`
      if ((await store.countNightGames([night])) === 0) {
        // Only DNF games: nothing to write about.
        const jobId = await store.claimNewsJob('night', night, opts.dryRun)
        if (jobId !== null) {
          await store.markNewsJob(jobId, 'skipped', 'no counted game')
          summary.jobsSkipped++
        }
        continue
      }
      if (!(await moneyLeft())) return 'end'
      if ((await articleJob('night', night, tag)) === 'end') return 'end'
    }
    return 'go'
  }

  // ── 7. Week piece: Mondays from 12:00 America/Edmonton, for the week before ─
  async function weekPass(): Promise<Step> {
    const clock = edmontonClock(deps.now())
    if (clock.weekday !== 'Mon' || clock.hour < 12) return 'go'
    const start = addDays(clock.day, -7)
    // No hasNewsJob gate: a failed week job under the cap must be claimed again.
    // claimNewsJob returns null for done, skipped, pending and capped rows.
    if (state.settledWeeks.has(start)) return 'go'
    if ((state.weekFetchPausedUntil.get(start) ?? 0) > deps.now().getTime()) return 'go'
    if ((await store.countNightGames(nightsOfWeek(start))) === 0) return 'go'
    if (!(await moneyLeft())) return 'end'
    return articleJob('week', start, `week ${start}`, {
      onSettled: () => state.settledWeeks.add(start),
      onFetchFailed: () =>
        state.weekFetchPausedUntil.set(start, deps.now().getTime() + WEEK_FETCH_PAUSE_MS),
    })
  }

  /**
   * `onSettled` runs when the job can never be written again: claim refused, or
   * done. `onFetchFailed` runs when the facts could not be fetched.
   */
  async function articleJob(
    kind: 'night' | 'week',
    key: string,
    tag: string,
    hooks: { onSettled?: () => void; onFetchFailed?: () => void } = {},
  ): Promise<Step> {
    let res: NewsFactsResponse
    try {
      res = await deps.fetchFacts(kind, key)
    } catch (err: unknown) {
      log(`${tag}: facts unavailable, will retry (${message(err)})`)
      hooks.onFetchFailed?.()
      return 'go'
    }
    const jobId = await store.claimNewsJob(kind, key, opts.dryRun)
    if (jobId === null) {
      hooks.onSettled?.()
      return 'go'
    }
    const { facts, forbiddenNames } = res
    const now = deps.now()
    // The job is claimed: any error before the write must mark it failed, never leave it pending.
    let reporterId: ReporterId
    let ctx: DeskContext
    let mine: NewsTake[]
    /** Week jobs: the feature kind and the prediction to judge (rev 2, B3/B5). */
    let feature: { kind: FeatureKind; previousPrediction: string | null } | null = null
    try {
      const activity = await loadActivity(now)
      let zero = { tonight: [] as string[], previous: [] as string[] }
      let tonight: string[] = []
      let nightPosts: NightPost[] | undefined
      if (kind === 'night') {
        reporterId = assignNightRecap(facts, now, activity, disabled)
        tonight = await store.nightCriticized(key, opts.dryRun)
        zero = await store.nightZeroCalled(key, opts.dryRun)
        nightPosts = await store.nightPostsForPrompt(key, opts.dryRun)
      } else {
        const last =
          opts.dryRun && state.testLastFeature !== null
            ? state.testLastFeature
            : await store.lastFeature()
        const next = assignFeature(last?.kind ?? null, now, activity, disabled)
        reporterId = next.reporter
        feature = { kind: next.kind, previousPrediction: predictionToJudge(key, last) }
      }
      ctx = {
        criticizedTonight: tonight,
        zeroCalledTonight: zero.tonight,
        zeroCalledPrevious: zero.previous,
        ownRecent: await ownRecentOf([reporterId]),
        ...(nightPosts === undefined ? {} : { nightPosts }),
      }
      const who = reporterId
      mine = (await takesDue(res, now)).filter(
        (t) => takeCritics(t).includes(who) || t.defender === who,
      )
    } catch (err: unknown) {
      await failJob(jobId, tag, `could not prepare: ${message(err)}`)
      return 'go'
    }
    const reporter = REPORTERS[reporterId]

    let a: Article
    let closing: {
      prediction: string
      receipt: string
      receiptVerdict: 'hit' | 'miss' | null
    } | null = null
    if (feature === null) {
      const written = await write(jobId, tag, {
        user: buildArticleUserPrompt({ facts, reporter, ctx: { ...ctx, takes: mine } }),
        schema: ARTICLE_SCHEMA,
        parse: parseArticle,
        check: (x) =>
          checkArticleFacts(x, facts, forbiddenNames, ctx.criticizedTonight, {
            reporter: reporterId,
            zeroCalledTonight: ctx.zeroCalledTonight,
            zeroCalledPrevious: ctx.zeroCalledPrevious,
            offeredTakes: mine.map((t) => t.id),
          }),
        textForReview: (x) =>
          [`By ${REPORTERS[reporterId].name}`, x.headline, x.dek, ...x.paragraphs].join('\n\n'),
        criticizedForReview: (x) => x.criticized,
        takesForReview: mine,
        facts,
      })
      if (written === 'end') return 'end'
      if (written === 'failed') return 'go'
      a = written.out
    } else {
      const rules = feature
      const written = await write(jobId, tag, {
        user: buildFeatureUserPrompt({
          facts,
          reporter,
          kind: rules.kind,
          previousPrediction: rules.previousPrediction,
          ctx: { ...ctx, takes: mine },
        }),
        schema: FEATURE_SCHEMA,
        parse: parseFeature,
        check: (f) =>
          checkFeatureFacts(f, facts, forbiddenNames, rules, [], {
            reporter: reporterId,
            offeredTakes: mine.map((t) => t.id),
          }),
        textForReview: (f) =>
          [`By ${REPORTERS[reporterId].name}`, f.headline, f.dek, featureBody(f, f)].join('\n\n'),
        criticizedForReview: (f) => f.criticized,
        takesForReview: mine,
        facts,
      })
      if (written === 'end') return 'end'
      if (written === 'failed') return 'go'
      a = written.out
      closing = {
        prediction: written.out.prediction,
        receipt: written.out.receipt,
        receiptVerdict: written.out.receiptVerdict,
      }
    }

    const night = kind === 'night' ? key : null
    const slug = articleSlug(kind === 'week' ? `week-${key}` : key, a.headline)
    let id: number
    try {
      id = await store.insertNewsItem({
        jobId,
        kind: 'article',
        reporter: reporterId,
        night,
        weekStart: kind === 'week' ? key : null,
        slug,
        headline: a.headline,
        dek: a.dek,
        body: closing === null ? a.paragraphs.join('\n\n') : featureBody(a, closing),
        summary: a.summary,
        mentions: mentionsOf(a.mentions, facts),
        criticized: criticizedAsOnSheet(a.criticized, facts),
        zeroCalled: zeroCalledAsOnSheet(a.zeroCalled, facts),
        takesUsed: a.takesUsed,
        rulesVersion: NEWS_RULES_VERSION,
        featureKind: feature?.kind ?? null,
        prediction: closing?.prediction ?? null,
        receiptVerdict: closing?.receiptVerdict ?? null,
        facts,
        isTest: opts.dryRun,
      })
    } catch (err: unknown) {
      await failJob(jobId, tag, `could not store: ${message(err)}`)
      return 'go'
    }
    await saveStances(stancesToStore(a.stances, facts, reporterId, night, id), tag)
    noteWritten(reporterId, night, kind === 'night' ? 'night' : 'feature')
    if (opts.dryRun && feature !== null && closing !== null) {
      state.testLastFeature = { kind: feature.kind, prediction: closing.prediction, weekStart: key }
    }
    await markDone(jobId, tag)
    hooks.onSettled?.()
    // B7: a feature's Discord notice is the article's: headline, dek, link.
    const payload = buildArticlePayload({
      reporter,
      headline: a.headline,
      dek: a.dek,
      url: `${opts.siteUrl}/news/${slug}`,
      siteUrl: opts.siteUrl,
    })
    await deliver(id, payload, `${tag} item ${String(id)}`)
    return sendingStopped ? 'end' : 'go'
  }
}
