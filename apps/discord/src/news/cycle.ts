import {
  REPORTERS,
  RELATIONSHIPS,
  nightsOfWeek,
  type NewsFacts,
  type NewsFactsResponse,
  type NewsGameFacts,
  type ReporterId,
} from '@eanhl/db/news'
import type {
  NewNewsItem,
  NewNewsUsage,
  NewsItemRow,
  NewsJobKind,
  NewsMention,
} from '@eanhl/db/queries'
import { WebhookOutcomeUnknownError } from '../webhook.ts'
import { assignArticle, assignGamePosts, type Activity } from './assign.ts'
import { costUsd } from './cost.ts'
import { checkArticleFacts, checkFacts, type CheckResult } from './fact-check.ts'
import {
  articleSlug,
  buildArticlePayload,
  buildNewsPostPayload,
  type NewsWebhookPayload,
} from './messages.ts'
import { ARTICLE_SCHEMA, GAME_POSTS_SCHEMA, parseArticle, parseGamePosts } from './outputs.ts'
import { buildArticleUserPrompt, buildGameUserPrompt, buildSystemPrompt } from './prompts.ts'
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

const DELETE_LIMIT = 20
const UNDELIVERED_LIMIT = 10
const ACTIVITY_MS = 14 * 86_400_000
const OWN_RECENT = 3

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
  hasNewsJob(kind: Kind, key: string): Promise<boolean>
  insertNewsItem(item: NewNewsItem): Promise<number>
  markNewsItemPosted(id: number, messageId: string | null): Promise<void>
  markNewsItemFailed(id: number, error: string): Promise<void>
  markNewsItemSkipped(id: number, reason: string): Promise<void>
  reporterActivity(args: {
    since: Date
  }): Promise<{ reporter: ReporterId; night: string | null; createdAt: Date }[]>
  recentReporterSummaries(
    reporter: ReporterId,
    limit: number,
  ): Promise<{ headline: string; summary: string; night: string | null }[]>
  recordNewsUsage(row: NewNewsUsage): Promise<void>
}

export interface NewsDeps {
  store: NewsStore
  /** The fact sheet from the web app's internal route. Any error (404 included) ⇒ retry next pass. */
  fetchFacts(kind: Kind, key: string): Promise<NewsFactsResponse>
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
  /** Epoch ms: no writing before this (set when the API refuses the key). */
  pausedUntil: number
  /** Items written in test mode: reporterActivity counts real items only. */
  testActivity: Activity
}

export function createNewsCycleState(): NewsCycleState {
  return { budgetLoggedMonth: null, pausedUntil: 0, testActivity: [] }
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

function mergeChecks(results: CheckResult[]): CheckResult {
  const problems = [...new Set(results.flatMap((r) => (r.ok ? [] : r.problems)))]
  return problems.length === 0 ? { ok: true } : { ok: false, problems }
}

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
 * writing for an hour; NewsRetryableError (API down) ends writing for this pass.
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

  function noteWritten(reporter: ReporterId, night: string | null): void {
    if (opts.dryRun) state.testActivity.push({ reporter, night, createdAt: deps.now() })
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

  /** Send one stored item (or write its file in a dry run) and record the outcome. */
  async function deliver(id: number, payload: NewsWebhookPayload, tag: string): Promise<void> {
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
        log(`${tag}: ${err.message} — left pending, not retried; check the channel`)
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
        log('the Claude API is unavailable — no more writing this pass')
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
      await deliver(item.id, await payloadForStored(item), tag)
    }
    if (sendingStopped) return summary
  }

  if (deps.now().getTime() < state.pausedUntil) return summary

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
    const ids = await store.listGameJobCandidates({
      since: new Date(now.getTime() - NEWS_GAME_WINDOW_MS),
      limit: NEWS_GAME_LIMIT,
    })
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
        await store.markNewsJob(jobId, 'skipped', 'the fact sheet has no such game')
        summary.jobsSkipped++
        continue
      }
      if ((await writeGame(jobId, tag, res, game)) === 'end') return 'end'
    }
    return 'go'
  }

  async function writeGame(
    jobId: number,
    tag: string,
    res: NewsFactsResponse,
    game: NewsGameFacts,
  ): Promise<Step> {
    const { facts, forbiddenNames } = res
    const night = facts.key // a game sheet's key is its night (R12)
    const now = deps.now()
    const a = assignGamePosts(classifyGame(game), now, night, await loadActivity(now))
    const order: ReporterId[] = a.second === null ? [a.first] : [a.first, a.second]
    const relationship =
      a.second !== null && a.secondIsReply
        ? (RELATIONSHIPS.find((r) => r.from === a.second && r.to === a.first)?.note ?? null)
        : null
    const written = await write(jobId, tag, {
      user: buildGameUserPrompt({
        facts,
        first: REPORTERS[a.first],
        second: a.second === null ? null : REPORTERS[a.second],
        secondIsReply: a.secondIsReply,
        relationship,
      }),
      schema: GAME_POSTS_SCHEMA,
      parse: (v) => parseGamePosts(v, order),
      check: (out) =>
        mergeChecks(out.posts.map((p) => checkFacts(p.text, facts, forbiddenNames, p))),
      textForReview: (out) =>
        out.posts.map((p) => `${REPORTERS[p.reporter].name}: ${p.text}`).join('\n\n'),
      facts,
    })
    if (written === 'end') return 'end'
    if (written === 'failed') return 'go'

    const posts = written.out.posts
    const stored: { id: number; reporter: ReporterId; text: string; isReply: boolean }[] = []
    try {
      for (const [i, p] of posts.entries()) {
        const isReply = i === 1 && a.secondIsReply
        const id = await store.insertNewsItem({
          jobId,
          kind: 'post',
          reporter: p.reporter,
          matchId: game.matchId,
          night,
          replyTo: isReply ? stored[0]!.id : null,
          body: p.text,
          mentions: mentionsOf(p.mentions, facts),
          facts,
          isTest: opts.dryRun,
        })
        stored.push({ id, reporter: p.reporter, text: p.text, isReply })
        noteWritten(p.reporter, night)
      }
    } catch (err: unknown) {
      if (stored.length === 0) {
        await failJob(jobId, tag, `could not store: ${message(err)}`)
        return 'go'
      }
      // Some posts exist: a retry would write them twice. Leave the job pending.
      log(
        `${tag}: stored ${String(stored.length)} of ${String(posts.length)} posts — job left pending, not retried (${message(err)})`,
      )
    }
    if (stored.length === posts.length) await markDone(jobId, tag)

    for (const s of stored) {
      const payload = buildNewsPostPayload({
        reporter: REPORTERS[s.reporter],
        text: s.text,
        replyToName: s.isReply ? REPORTERS[a.first].name : null,
        siteUrl: opts.siteUrl,
      })
      await deliver(s.id, payload, `${tag} item ${String(s.id)}`)
    }
    return sendingStopped ? 'end' : 'go'
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
    if (await store.hasNewsJob('week', start)) return 'go'
    if ((await store.countNightGames(nightsOfWeek(start))) === 0) return 'go'
    if (!(await moneyLeft())) return 'end'
    return articleJob('week', start, `week ${start}`)
  }

  async function articleJob(kind: 'night' | 'week', key: string, tag: string): Promise<Step> {
    let res: NewsFactsResponse
    try {
      res = await deps.fetchFacts(kind, key)
    } catch (err: unknown) {
      log(`${tag}: facts unavailable, will retry (${message(err)})`)
      return 'go'
    }
    const jobId = await store.claimNewsJob(kind, key, opts.dryRun)
    if (jobId === null) return 'go'
    const { facts, forbiddenNames } = res
    const now = deps.now()
    const reporterId = assignArticle(kind, facts, now, await loadActivity(now))
    const reporter = REPORTERS[reporterId]
    const ownRecent = await store.recentReporterSummaries(reporterId, OWN_RECENT)
    const written = await write(jobId, tag, {
      user: buildArticleUserPrompt({ facts, reporter, kind, ownRecent }),
      schema: ARTICLE_SCHEMA,
      parse: parseArticle,
      check: (a) => checkArticleFacts(a, facts, forbiddenNames),
      textForReview: (a) => [a.headline, a.dek, ...a.paragraphs].join('\n\n'),
      facts,
    })
    if (written === 'end') return 'end'
    if (written === 'failed') return 'go'

    const a = written.out
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
        body: a.paragraphs.join('\n\n'),
        summary: a.summary,
        mentions: mentionsOf(a.mentions, facts),
        facts,
        isTest: opts.dryRun,
      })
    } catch (err: unknown) {
      await failJob(jobId, tag, `could not store: ${message(err)}`)
      return 'go'
    }
    noteWritten(reporterId, night)
    await markDone(jobId, tag)
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
