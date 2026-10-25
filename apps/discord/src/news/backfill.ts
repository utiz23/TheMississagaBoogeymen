/**
 * News desk backfill of old nights, with NO Claude API call. The "model" step
 * is done outside this program (by a Claude Code session); the program
 * prepares the prompts, checks the answers with the same code checks as the
 * live desk, and imports the accepted items for the site only (never Discord).
 *
 *   WEB_INTERNAL_URL=… DISCORD_INTERNAL_TOKEN=… \
 *     node apps/discord/src/news/backfill.ts plan --nights 2026-05-08,2026-05-09 --out <dir>
 *   WEB_INTERNAL_URL=… DISCORD_INTERNAL_TOKEN=… \
 *     node apps/discord/src/news/backfill.ts next-feature --out <dir> --week <monday>
 *   node apps/discord/src/news/backfill.ts check --out <dir>
 *   DATABASE_URL=… node apps/discord/src/news/backfill.ts import --out <dir>
 *
 * `plan` makes the game and night jobs only. Weekly features (rev 2) are made
 * one week at a time with `next-feature`, after the previous feature is
 * accepted: the kind and last week's prediction come from the latest accepted
 * feature job in <dir>.
 *
 * Files in <dir>:
 *   system.txt            the system prompt for every write (all reporters)
 *   review-system.txt     the system prompt for every review
 *   review-schema.json    the JSON schema of a review answer
 *   jobs/<id>.json        one item to write: { id, kind, night, matchId?, reporters,
 *                         secondIsReply?, featureKind?, previousPrediction?, user,
 *                         schema, sheet }; a feature's `night` is its week's Monday
 *   status/<id>.json      also for a waiting job when its night already has a harsh
 *                         list: { state: 'waiting', prompt } (write from that prompt)
 *   answers/<id>.json     the model's JSON answer to `user` (written outside)
 *   reviews/<id>.json     the review answer, { "ok": true } or { "ok": false, "problems": [...] }
 *   status/<id>.json      written by `check`: rewrite / review / accepted
 *
 * A review counts only when its file is not older than the answer file.
 * The import never touches news_jobs or news_ai_usage, and every item gets
 * discord_status 'skipped', so the live desk never sends it.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  FEATURE_KINDS,
  FEATURE_REPORTER,
  REPORTERS,
  REPORTER_IDS,
  RELATIONSHIPS,
  parseNewsFactsResponse,
  weekStart as mondayOf,
  type FeatureKind,
  type NewsFacts,
  type NewsFactsResponse,
  type ReporterId,
} from '@eanhl/db/news'
import type { NewNewsItem, NewsMention } from '@eanhl/db/queries'
import {
  assignGamePosts,
  assignNightRecap,
  nextFeatureKind,
  predictionToJudge,
  type Activity,
} from './assign.ts'
import {
  checkArticleFacts,
  checkFeatureFacts,
  checkGamePosts,
  type CheckResult,
} from './fact-check.ts'
import { articleSlug } from './messages.ts'
import {
  ARTICLE_SCHEMA,
  FEATURE_SCHEMA,
  GAME_POSTS_SCHEMA,
  REVIEW_SCHEMA,
  criticizedAsOnSheet,
  featureBody,
  parseArticle,
  parseFeature,
  parseGamePosts,
  parseReview,
  type Article,
  type Feature,
  type GamePost,
} from './outputs.ts'
import {
  REVIEW_SYSTEM_PROMPT,
  buildArticleUserPrompt,
  buildFeatureUserPrompt,
  buildGameUserPrompt,
  buildReviewPrompt,
  buildRewritePrompt,
  buildSystemPrompt,
  setCriticizedTonight,
} from './prompts.ts'
import { classifyGame } from './situation.ts'
import { fetchNewsFacts } from './web-client.ts'

/** A night's article is dated 90 minutes after its last game (when the night ends). */
export const ARTICLE_DELAY_MS = 90 * 60_000
/** Posts of one game are dated one second apart, in order. */
const POST_STEP_MS = 1000
const SITE_ONLY = 'backfill: site only, never sent to Discord'

export interface BackfillJob {
  id: string
  kind: 'game' | 'night' | 'feature'
  /** A game's or night's night; for a feature, the Monday of its week. */
  night: string
  matchId?: number
  reporters: ReporterId[]
  secondIsReply?: boolean
  /** Features only (rev 2, B6). */
  featureKind?: FeatureKind
  /** Features only: last week's prediction to judge, or null. */
  previousPrediction?: string | null
  user: string
  schema: object
  sheet: NewsFactsResponse
}

export interface BackfillPlan {
  system: string
  reviewSystem: string
  reviewSchema: object
  jobs: BackfillJob[]
}

export type FetchFacts = (
  kind: 'game' | 'night' | 'week',
  key: string,
) => Promise<NewsFactsResponse>

const NIGHT = /^\d{4}-\d{2}-\d{2}$/
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
const pad2 = (n: number) => String(n).padStart(2, '0')

const EDMONTON_HOUR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Edmonton',
  hour: '2-digit',
  hourCycle: 'h23',
})

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10)
}

/** 12:00 America/Edmonton on `day` (MDT is UTC-6, MST UTC-7). */
export function edmontonNoon(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  for (const offset of [6, 7]) {
    const t = new Date(Date.UTC(y!, m! - 1, d!, 12 + offset))
    if (Number(EDMONTON_HOUR.format(t)) === 12) return t
  }
  throw new Error(`no 12:00 in America/Edmonton on ${day}`)
}

/** A feature is dated when the live desk would write it: the following Monday, 12:00 Edmonton. */
export function featureCreatedAt(weekStart: string): Date {
  return edmontonNoon(addDays(weekStart, 7))
}

/**
 * When the item is dated: a post at its game's end (+1 s per post), a night
 * article 90 min after the night's last game, a feature on the following
 * Monday at 12:00 Edmonton.
 */
export function itemCreatedAt(job: BackfillJob, index: number): Date {
  if (job.kind === 'feature') return featureCreatedAt(job.night)
  const games = job.sheet.facts.games
  if (job.kind === 'game') {
    const game = games.find((g) => g.matchId === job.matchId)
    if (!game) throw new Error(`job ${job.id}: the sheet has no game ${String(job.matchId)}`)
    return new Date(Date.parse(game.playedAt) + index * POST_STEP_MS)
  }
  const last = Math.max(...games.map((g) => Date.parse(g.playedAt)))
  if (!Number.isFinite(last)) throw new Error(`job ${job.id}: the night sheet has no game`)
  return new Date(last + ARTICLE_DELAY_MS)
}

// ── plan ─────────────────────────────────────────────────────────────────────

/**
 * Jobs for the nights, in date order: each counted game's posts, then the
 * night article. Reporters are assigned with the live desk's rules against a
 * simulated activity list that grows as the plan goes, so the frequency limits
 * hold across the whole backfill. Any fetch failure stops the plan.
 */
export async function planBackfill(args: {
  nights: readonly string[]
  fetchFacts: FetchFacts
}): Promise<BackfillPlan> {
  for (const n of args.nights) {
    if (!NIGHT.test(n)) throw new Error(`"${n}" is not a YYYY-MM-DD night`)
  }
  const nights = [...new Set(args.nights)].sort()
  const activity: Activity = []
  const jobs: BackfillJob[] = []

  const fetchOr = async (kind: 'game' | 'night', key: string, what: string) => {
    try {
      return await args.fetchFacts(kind, key)
    } catch (err: unknown) {
      throw new Error(`${what}: ${message(err)}`)
    }
  }

  for (const night of nights) {
    const nightSheet = await fetchOr('night', night, `night ${night}`)
    for (const [i, g] of nightSheet.facts.games.entries()) {
      const sheet = await fetchOr(
        'game',
        String(g.matchId),
        `night ${night} game ${String(g.matchId)}`,
      )
      const game = sheet.facts.games.find((x) => x.matchId === g.matchId)
      if (sheet.facts.kind !== 'game' || !game) {
        throw new Error(`night ${night} game ${String(g.matchId)}: the game sheet has no such game`)
      }
      const job: BackfillJob = {
        id: `${night}-a${pad2(i + 1)}-g${String(g.matchId)}`,
        kind: 'game',
        night,
        matchId: g.matchId,
        reporters: [],
        user: '',
        schema: GAME_POSTS_SCHEMA,
        sheet,
      }
      const a = assignGamePosts(classifyGame(game), itemCreatedAt(job, 0), night, activity)
      job.reporters = a.second === null ? [a.first] : [a.first, a.second]
      job.secondIsReply = a.secondIsReply
      const relationship =
        a.second !== null && a.secondIsReply
          ? (RELATIONSHIPS.find((r) => r.from === a.second && r.to === a.first)?.note ?? null)
          : null
      job.user = buildGameUserPrompt({
        facts: sheet.facts,
        first: REPORTERS[a.first],
        second: a.second === null ? null : REPORTERS[a.second],
        secondIsReply: a.secondIsReply,
        relationship,
        // The night's harsh list is known only once earlier jobs are accepted: `check` swaps it in.
        criticizedTonight: [],
      })
      job.reporters.forEach((r, k) =>
        activity.push({
          reporter: r,
          night,
          createdAt: itemCreatedAt(job, k),
          kind: k === 0 ? 'recap' : 'reaction',
        }),
      )
      jobs.push(job)
    }

    const article: BackfillJob = {
      id: `${night}-z-night`,
      kind: 'night',
      night,
      reporters: [],
      user: '',
      schema: ARTICLE_SCHEMA,
      sheet: nightSheet,
    }
    const createdAt = itemCreatedAt(article, 0)
    const reporter = assignNightRecap(nightSheet.facts, createdAt, activity)
    article.reporters = [reporter]
    // The reporter's own recent pieces are not known before they are written.
    article.user = buildArticleUserPrompt({
      facts: nightSheet.facts,
      reporter: REPORTERS[reporter],
      kind: 'night',
      ownRecent: [],
      criticizedTonight: [],
    })
    activity.push({ reporter, night, createdAt, kind: 'night' })
    jobs.push(article)
  }

  return {
    system: buildSystemPrompt(Object.values(REPORTERS)),
    reviewSystem: REVIEW_SYSTEM_PROMPT,
    reviewSchema: REVIEW_SCHEMA,
    jobs,
  }
}

const dirs = (out: string) => ({
  jobs: join(out, 'jobs'),
  answers: join(out, 'answers'),
  reviews: join(out, 'reviews'),
  status: join(out, 'status'),
})

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`

/** Writes the plan. Refuses a directory that already has jobs (answers would no longer match). */
export function writePlan(out: string, plan: BackfillPlan): void {
  const d = dirs(out)
  if (existsSync(d.jobs) && readdirSync(d.jobs).some((f) => f.endsWith('.json'))) {
    throw new Error(`${out} already has jobs; plan into an empty directory`)
  }
  for (const p of Object.values(d)) mkdirSync(p, { recursive: true })
  writeFileSync(join(out, 'system.txt'), plan.system)
  writeFileSync(join(out, 'review-system.txt'), plan.reviewSystem)
  writeFileSync(join(out, 'review-schema.json'), json(plan.reviewSchema))
  for (const job of plan.jobs) writeFileSync(join(d.jobs, `${job.id}.json`), json(job))
}

function parseJob(v: unknown, file: string): BackfillJob {
  const o = v as Partial<BackfillJob> & Record<string, unknown>
  const bad = (why: string): never => {
    throw new Error(`${file}: ${why}`)
  }
  if (typeof o !== 'object' || o === null) bad('is not an object')
  if (typeof o.id !== 'string' || `${o.id}.json` !== file) bad('id does not match the file name')
  if (o.kind !== 'game' && o.kind !== 'night' && o.kind !== 'feature') {
    bad('kind is not game, night or feature')
  }
  if (typeof o.night !== 'string' || !NIGHT.test(o.night)) bad('night is not YYYY-MM-DD')
  if (o.kind === 'game' && !Number.isSafeInteger(o.matchId)) bad('matchId is missing')
  const reporters = o.reporters
  if (
    !Array.isArray(reporters) ||
    reporters.length < 1 ||
    reporters.length > 2 ||
    !reporters.every((r) => (REPORTER_IDS as readonly unknown[]).includes(r))
  ) {
    bad('reporters are invalid')
  }
  if (o.kind === 'feature') {
    if (reporters!.length !== 1) bad('a feature has one reporter')
    if (!(FEATURE_KINDS as readonly unknown[]).includes(o.featureKind))
      bad('featureKind is invalid')
    if (o.previousPrediction !== null && typeof o.previousPrediction !== 'string') {
      bad('previousPrediction is not a string or null')
    }
  }
  if (typeof o.user !== 'string') bad('user is not a string')
  const job: BackfillJob = {
    id: o.id!,
    kind: o.kind!,
    night: o.night!,
    reporters: reporters!,
    user: o.user!,
    schema:
      o.kind === 'game'
        ? GAME_POSTS_SCHEMA
        : o.kind === 'feature'
          ? FEATURE_SCHEMA
          : ARTICLE_SCHEMA,
    sheet: parseNewsFactsResponse(o.sheet),
  }
  if (o.kind === 'game') {
    job.matchId = o.matchId!
    job.secondIsReply = o.secondIsReply === true
  }
  if (o.kind === 'feature') {
    job.featureKind = o.featureKind!
    job.previousPrediction = o.previousPrediction ?? null
  }
  // Key order as the plan writes it, so a read job equals the planned one.
  return Object.fromEntries(
    [
      'id',
      'kind',
      'night',
      'matchId',
      'reporters',
      'secondIsReply',
      'featureKind',
      'previousPrediction',
      'user',
      'schema',
      'sheet',
    ]
      .filter((k) => k in job)
      .map((k) => [k, job[k as keyof BackfillJob]]),
  ) as unknown as BackfillJob
}

/** Every job of the plan, in id (= chronological) order. */
export function readJobs(out: string): BackfillJob[] {
  const d = dirs(out)
  return readdirSync(d.jobs)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => parseJob(JSON.parse(readFileSync(join(d.jobs, f), 'utf8')), f))
}

// ── next-feature ─────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const RINK_GAP_MS = 14 * DAY_MS

/** What the dir's jobs will be, dated as the import dates them (for Father Rink's limit). */
function activityOf(jobs: readonly BackfillJob[]): Activity {
  return jobs.flatMap((job) =>
    job.reporters.map((reporter, k) => ({
      reporter,
      night: job.kind === 'feature' ? null : job.night,
      createdAt: itemCreatedAt(job, k),
      kind:
        job.kind === 'feature'
          ? ('feature' as const)
          : job.kind === 'night'
            ? ('night' as const)
            : k === 0
              ? ('recap' as const)
              : ('reaction' as const),
    })),
  )
}

/**
 * Makes ONE weekly feature job for the week starting `week` (a Monday) and
 * writes it to <out>/jobs. The kind follows the latest ACCEPTED feature job in
 * <out> (none ⇒ trend), and its prediction is judged when it covered the week
 * right before. Father Rink's column only when no Rink item of the backfill is
 * within 14 days of the feature, before or after (the plan is already fixed).
 * Refuses when a feature job is not accepted yet, when the week is not after
 * the latest feature's week, or when the week already has a feature job.
 */
export async function planNextFeature(args: {
  out: string
  week: string
  fetchFacts: FetchFacts
}): Promise<BackfillJob> {
  const { out, week } = args
  if (!NIGHT.test(week) || mondayOf(week) !== week) {
    throw new Error(`"${week}" is not a Monday (YYYY-MM-DD)`)
  }
  const evaluated = evaluateDir(out)
  const features = evaluated.filter((e) => e.job.kind === 'feature')
  const open = features.find((e) => e.evaluation.state !== 'accepted')
  if (open) throw new Error(`feature job ${open.job.id} is not accepted yet; accept it first`)
  const latest = features.reduce<(typeof features)[number] | null>(
    (best, e) => (best === null || e.job.night > best.job.night ? e : best),
    null,
  )
  if (latest !== null && week < latest.job.night) {
    throw new Error(
      `weeks must go forward: the latest feature is for the week of ${latest.job.night}`,
    )
  }
  const same = features.find((e) => e.job.night === week)
  if (same)
    throw new Error(`${out} already has a feature job for the week of ${week} (${same.job.id})`)

  let last: { kind: FeatureKind; prediction: string; weekStart: string } | null = null
  if (latest !== null && latest.evaluation.state === 'accepted') {
    last = {
      kind: latest.job.featureKind!,
      prediction: (latest.evaluation.output as Feature).prediction,
      weekStart: latest.job.night,
    }
  }

  let sheet: NewsFactsResponse
  try {
    sheet = await args.fetchFacts('week', week)
  } catch (err: unknown) {
    throw new Error(`week ${week}: ${message(err)}`)
  }
  if (sheet.facts.kind !== 'week' || sheet.facts.games.length === 0) {
    throw new Error(`week ${week}: the week sheet has no game`)
  }

  const id = `${addDays(week, 7)}-0-feature`
  const at = featureCreatedAt(week).getTime()
  const rinkNearby = activityOf(evaluated.map((e) => e.job)).some(
    (a) => a.reporter === 'rink' && Math.abs(a.createdAt.getTime() - at) < RINK_GAP_MS,
  )
  const kind = nextFeatureKind(last?.kind ?? null, !rinkNearby)
  const reporter = FEATURE_REPORTER[kind]
  const previousPrediction = predictionToJudge(week, last)
  const job: BackfillJob = {
    id,
    kind: 'feature',
    night: week,
    reporters: [reporter],
    featureKind: kind,
    previousPrediction,
    // The reporter's own recent pieces are not known before they are written.
    user: buildFeatureUserPrompt({
      facts: sheet.facts,
      reporter: REPORTERS[reporter],
      kind,
      ownRecent: [],
      previousPrediction,
    }),
    schema: FEATURE_SCHEMA,
    sheet,
  }
  writeFileSync(join(dirs(out).jobs, `${id}.json`), json(job))
  return job
}

// ── check ────────────────────────────────────────────────────────────────────

export type GameOutput = { posts: GamePost[] }
export type JobOutput = GameOutput | Article | Feature

export type Evaluation =
  /** `prompt`: the request with the night's real harsh list, when the night has one so far. */
  | { state: 'waiting'; prompt?: string }
  | { state: 'rewrite'; problems: string[]; rewritePrompt: string }
  | { state: 'review'; reviewPrompt: string; reviewError?: string }
  | { state: 'accepted'; output: JobOutput }

/** The people an accepted output criticises harshly. */
function criticizedOf(output: JobOutput): string[] {
  return 'posts' in output ? output.posts.flatMap((p) => p.criticized) : output.criticized
}

/**
 * The state of one job: its answer is parsed and checked exactly as the live
 * desk does (outputs.ts, fact-check.ts); a passed answer needs a review, and
 * an ok review accepts it. `reviewText` must be null when there is no review
 * for this answer. `criticizedTonight`: the names the night's earlier accepted
 * jobs criticised harshly (the pile-on limit); the request is rewritten with them.
 */
export function evaluateJob(
  job: BackfillJob,
  answerText: string | null,
  reviewText: string | null,
  criticizedTonight: readonly string[] = [],
): Evaluation {
  const user = setCriticizedTonight(job.user, criticizedTonight)
  if (answerText === null) {
    return criticizedTonight.length === 0
      ? { state: 'waiting' }
      : { state: 'waiting', prompt: user }
  }
  const rewrite = (problems: string[]): Evaluation => ({
    state: 'rewrite',
    problems,
    rewritePrompt: buildRewritePrompt(user, problems),
  })
  let value: unknown
  try {
    value = JSON.parse(answerText)
  } catch {
    return rewrite(['The answer was empty, cut off, or not valid JSON.'])
  }

  const { facts, forbiddenNames } = job.sheet
  let output: JobOutput
  let checked: CheckResult
  let textForReview: string
  try {
    if (job.kind === 'game') {
      const out = parseGamePosts(value, job.reporters)
      output = out
      checked = checkGamePosts(out.posts, facts, forbiddenNames, criticizedTonight)
      textForReview = out.posts.map((p) => `${REPORTERS[p.reporter].name}: ${p.text}`).join('\n\n')
    } else if (job.kind === 'feature') {
      const f = parseFeature(value)
      output = f
      checked = checkFeatureFacts(f, facts, forbiddenNames, {
        kind: job.featureKind!,
        previousPrediction: job.previousPrediction ?? null,
      })
      textForReview = [f.headline, f.dek, featureBody(f, f)].join('\n\n')
    } else {
      const a = parseArticle(value)
      output = a
      checked = checkArticleFacts(a, facts, forbiddenNames, criticizedTonight)
      textForReview = [a.headline, a.dek, ...a.paragraphs].join('\n\n')
    }
  } catch (err: unknown) {
    return rewrite([message(err)])
  }
  if (!checked.ok) return rewrite(checked.problems)

  const reviewPrompt = buildReviewPrompt({
    facts,
    text: textForReview,
    criticized: [...new Set(criticizedOf(output))],
  })
  if (reviewText === null) return { state: 'review', reviewPrompt }
  let verdict: { ok: boolean; problems: string[] }
  try {
    const raw: unknown = JSON.parse(reviewText)
    // `{ "ok": true }` is enough; the schema's problems list defaults to empty.
    const withProblems =
      typeof raw === 'object' && raw !== null && !Array.isArray(raw) && !('problems' in raw)
        ? { ...raw, problems: [] }
        : raw
    verdict = parseReview(withProblems)
  } catch (err: unknown) {
    return {
      state: 'review',
      reviewPrompt,
      reviewError: `the review file is invalid: ${message(err)}`,
    }
  }
  if (!verdict.ok) {
    return rewrite(
      verdict.problems.length > 0 ? verdict.problems : ['The review rejected the text.'],
    )
  }
  return { state: 'accepted', output }
}

function readIf(path: string): { text: string; mtimeMs: number } | null {
  if (!existsSync(path)) return null
  return { text: readFileSync(path, 'utf8'), mtimeMs: statSync(path).mtimeMs }
}

/**
 * Every job with its evaluation, in id order. A review older than its answer
 * is ignored. The pile-on limit of a job counts the earlier ACCEPTED jobs of
 * the same night (in id order), so write and accept a night's jobs in order.
 */
export function evaluateDir(out: string): { job: BackfillJob; evaluation: Evaluation }[] {
  const d = dirs(out)
  const harsh = new Map<string, string[]>()
  return readJobs(out).map((job) => {
    const answer = readIf(join(d.answers, `${job.id}.json`))
    const review = readIf(join(d.reviews, `${job.id}.json`))
    const freshReview = answer !== null && review !== null && review.mtimeMs >= answer.mtimeMs
    // A feature has no night: the pile-on limit does not apply to it.
    const tonight = job.kind === 'feature' ? [] : (harsh.get(job.night) ?? [])
    const evaluation = evaluateJob(
      job,
      answer?.text ?? null,
      freshReview ? review.text : null,
      tonight,
    )
    if (evaluation.state === 'accepted' && job.kind !== 'feature') {
      harsh.set(job.night, [...new Set([...tonight, ...criticizedOf(evaluation.output)])])
    }
    return { job, evaluation }
  })
}

export interface CheckSummary {
  waiting: number
  rewrite: number
  review: number
  accepted: number
}

/** Writes status/<id>.json for every answered job (removes it for the others) and prints a table. */
export function runCheck(out: string, log: (line: string) => void): CheckSummary {
  const d = dirs(out)
  mkdirSync(d.status, { recursive: true })
  const summary: CheckSummary = { waiting: 0, rewrite: 0, review: 0, accepted: 0 }
  const width = 24
  log(`${'job'.padEnd(width)}  ${'state'.padEnd(9)}  reporters / detail`)
  for (const { job, evaluation: e } of evaluateDir(out)) {
    summary[e.state]++
    const file = join(d.status, `${job.id}.json`)
    let detail = job.reporters.join('+')
    if (e.state === 'waiting') {
      if (e.prompt === undefined) {
        rmSync(file, { force: true })
        detail += ' — no answer yet'
      } else {
        writeFileSync(file, json(e))
        detail += ' — no answer yet; write from the prompt in its status file'
      }
    } else if (e.state === 'rewrite') {
      writeFileSync(file, json(e))
      detail += ` — ${String(e.problems.length)} problem(s): ${e.problems[0] ?? ''}`
    } else if (e.state === 'review') {
      writeFileSync(file, json(e))
      if (e.reviewError) detail += ` — ${e.reviewError}`
    } else {
      writeFileSync(file, json({ state: 'accepted' }))
    }
    log(`${job.id.padEnd(width)}  ${e.state.padEnd(9)}  ${detail}`)
  }
  log(
    `waiting ${String(summary.waiting)} · rewrite ${String(summary.rewrite)} · review ${String(summary.review)} · accepted ${String(summary.accepted)}`,
  )
  return summary
}

// ── import ───────────────────────────────────────────────────────────────────

export interface BackfillStore {
  /** A post with this match, reporter and body (any state, deleted included), or null. */
  findPost(args: { matchId: number; reporter: ReporterId; body: string }): Promise<number | null>
  /** An item with this slug (any state, deleted included), or null. */
  findArticle(slug: string): Promise<number | null>
  insert(item: NewNewsItem): Promise<number>
}

/** The people an item names, as stored: sheet names only, one entry per player (as the cycle). */
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

/**
 * Inserts the accepted items in job-id (chronological) order: real items
 * (`is_test` false), `discord_status` 'skipped' so they are never sent, no
 * news job. An item that already exists (same match + reporter + body, or
 * same slug) is not inserted again; an existing first post still gets its reply linked.
 */
export async function importAccepted(
  entries: readonly { job: BackfillJob; output: JobOutput }[],
  store: BackfillStore,
  log: (line: string) => void,
): Promise<{ jobs: number; inserted: number; existing: number }> {
  const sorted = [...entries].sort((a, b) =>
    a.job.id < b.job.id ? -1 : a.job.id > b.job.id ? 1 : 0,
  )
  let inserted = 0
  let existing = 0
  for (const { job, output } of sorted) {
    const facts = job.sheet.facts
    const common = {
      jobId: null,
      reporter: job.reporters[0]!,
      night: job.night,
      facts,
      isTest: false,
      discordStatus: 'skipped' as const,
      lastError: SITE_ONLY,
    }
    if (job.kind === 'game') {
      const posts = (output as GameOutput).posts
      const ids: number[] = []
      for (const [i, p] of posts.entries()) {
        const matchId = job.matchId!
        const found = await store.findPost({ matchId, reporter: p.reporter, body: p.text })
        if (found !== null) {
          ids.push(found)
          existing++
          continue
        }
        const isReply = i === 1 && job.secondIsReply === true
        ids.push(
          await store.insert({
            ...common,
            kind: 'post',
            reporter: p.reporter,
            matchId,
            replyTo: isReply ? ids[0]! : null,
            body: p.text,
            mentions: mentionsOf(p.mentions, facts),
            criticized: criticizedAsOnSheet(p.criticized, facts),
            createdAt: itemCreatedAt(job, i),
          }),
        )
        inserted++
      }
      log(`${job.id}: ${String(posts.length)} post(s)`)
    } else if (job.kind === 'feature') {
      const f = output as Feature
      const slug = articleSlug(job.night, f.headline) // <weekStart>-<words>
      if ((await store.findArticle(slug)) !== null) {
        existing++
        log(`${job.id}: feature ${slug} already exists`)
        continue
      }
      await store.insert({
        ...common,
        kind: 'article',
        night: null,
        weekStart: job.night,
        slug,
        headline: f.headline,
        dek: f.dek,
        body: featureBody(f, f),
        summary: f.summary,
        mentions: mentionsOf(f.mentions, facts),
        criticized: criticizedAsOnSheet(f.criticized, facts),
        featureKind: job.featureKind!,
        prediction: f.prediction,
        createdAt: itemCreatedAt(job, 0),
      })
      inserted++
      log(`${job.id}: feature ${slug}`)
    } else {
      const a = output as Article
      const slug = articleSlug(job.night, a.headline)
      if ((await store.findArticle(slug)) !== null) {
        existing++
        log(`${job.id}: article ${slug} already exists`)
        continue
      }
      await store.insert({
        ...common,
        kind: 'article',
        weekStart: null,
        slug,
        headline: a.headline,
        dek: a.dek,
        body: a.paragraphs.join('\n\n'),
        summary: a.summary,
        mentions: mentionsOf(a.mentions, facts),
        criticized: criticizedAsOnSheet(a.criticized, facts),
        createdAt: itemCreatedAt(job, 0),
      })
      inserted++
      log(`${job.id}: article ${slug}`)
    }
  }
  return { jobs: sorted.length, inserted, existing }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function flag(argv: readonly string[], name: string): string | null {
  const i = argv.indexOf(name)
  const v = i >= 0 ? argv[i + 1] : undefined
  return v === undefined || v.startsWith('--') ? null : v
}

const USAGE = [
  'usage:',
  '  node apps/discord/src/news/backfill.ts plan --nights <YYYY-MM-DD,…> --out <dir>   (WEB_INTERNAL_URL, DISCORD_INTERNAL_TOKEN)',
  '  node apps/discord/src/news/backfill.ts next-feature --out <dir> --week <monday YYYY-MM-DD>   (WEB_INTERNAL_URL, DISCORD_INTERNAL_TOKEN)',
  '  node apps/discord/src/news/backfill.ts check --out <dir>',
  '  node apps/discord/src/news/backfill.ts import --out <dir>                          (DATABASE_URL)',
].join('\n')

export async function main(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  log: (line: string) => void = console.log,
): Promise<number> {
  const command = argv[0]
  const out = flag(argv, '--out')
  if (
    out === null ||
    (command !== 'plan' &&
      command !== 'next-feature' &&
      command !== 'check' &&
      command !== 'import')
  ) {
    log(USAGE)
    return 2
  }
  const web = env['WEB_INTERNAL_URL']?.trim().replace(/\/+$/, '') ?? ''
  const token = env['DISCORD_INTERNAL_TOKEN'] ?? ''
  const fetchFacts: FetchFacts = (kind, key) =>
    fetchNewsFacts({ webBaseUrl: web, token, kind, key, includeInactive: true })

  if (command === 'next-feature') {
    const week = flag(argv, '--week')
    if (week === null || web === '' || token === '') {
      log(USAGE)
      return 2
    }
    const job = await planNextFeature({ out, week, fetchFacts })
    log(
      `${job.id}  ${job.featureKind!} by ${job.reporters[0]!}; last week's prediction: ${job.previousPrediction === null ? 'none' : `"${job.previousPrediction}"`}`,
    )
    return 0
  }

  if (command === 'plan') {
    const nights = (flag(argv, '--nights') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
    if (nights.length === 0 || web === '' || token === '') {
      log(USAGE)
      return 2
    }
    const plan = await planBackfill({ nights, fetchFacts })
    writePlan(out, plan)
    for (const j of plan.jobs) log(`${j.id}  ${j.reporters.join('+')}`)
    log(`${String(plan.jobs.length)} job(s) written to ${join(out, 'jobs')}`)
    return 0
  }

  if (command === 'check') {
    runCheck(out, log)
    return 0
  }

  if ((env['DATABASE_URL'] ?? '') === '') {
    log('DATABASE_URL is unset')
    return 2
  }
  const evaluated = evaluateDir(out)
  const accepted = evaluated.flatMap(({ job, evaluation }) =>
    evaluation.state === 'accepted' ? [{ job, output: evaluation.output }] : [],
  )
  // Loaded here only: the query module opens a database connection on import.
  const q = await import('@eanhl/db/queries')
  const { sql } = await import('@eanhl/db')
  try {
    const r = await importAccepted(
      accepted,
      { findPost: q.findNewsPostId, findArticle: q.findNewsArticleId, insert: q.insertNewsItem },
      log,
    )
    log(
      `${String(r.jobs)} accepted job(s): ${String(r.inserted)} item(s) inserted, ${String(r.existing)} already there; ${String(evaluated.length - accepted.length)} job(s) not accepted, not imported`,
    )
  } finally {
    await sql.end()
  }
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then(
    (code) => {
      process.exitCode = code
    },
    (err: unknown) => {
      console.error(`backfill failed: ${message(err)}`)
      process.exitCode = 1
    },
  )
}
