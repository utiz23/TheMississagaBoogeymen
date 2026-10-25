/**
 * News desk backfill of old nights, with NO Claude API call. The "model" step
 * is done outside this program (by a Claude Code session); the program
 * prepares the prompts, checks the answers with the same code checks as the
 * live desk, and imports the accepted items for the site only (never Discord).
 *
 *   WEB_INTERNAL_URL=… DISCORD_INTERNAL_TOKEN=… \
 *     node apps/discord/src/news/backfill.ts plan --nights 2026-05-08,2026-05-09 --out <dir>
 *   node apps/discord/src/news/backfill.ts check --out <dir>
 *   DATABASE_URL=… node apps/discord/src/news/backfill.ts import --out <dir>
 *
 * Files in <dir>:
 *   system.txt            the system prompt for every write (all reporters)
 *   review-system.txt     the system prompt for every review
 *   review-schema.json    the JSON schema of a review answer
 *   jobs/<id>.json        one item to write: { id, kind, night, matchId?, reporters,
 *                         secondIsReply?, user, schema, sheet }
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
  REPORTERS,
  REPORTER_IDS,
  RELATIONSHIPS,
  parseNewsFactsResponse,
  type NewsFacts,
  type NewsFactsResponse,
  type ReporterId,
} from '@eanhl/db/news'
import type { NewNewsItem, NewsMention } from '@eanhl/db/queries'
import { assignArticle, assignGamePosts, type Activity } from './assign.ts'
import { checkArticleFacts, checkFacts, type CheckResult } from './fact-check.ts'
import { articleSlug } from './messages.ts'
import {
  ARTICLE_SCHEMA,
  GAME_POSTS_SCHEMA,
  REVIEW_SCHEMA,
  parseArticle,
  parseGamePosts,
  parseReview,
  type Article,
  type GamePost,
} from './outputs.ts'
import {
  REVIEW_SYSTEM_PROMPT,
  buildArticleUserPrompt,
  buildGameUserPrompt,
  buildReviewPrompt,
  buildRewritePrompt,
  buildSystemPrompt,
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
  kind: 'game' | 'night'
  night: string
  matchId?: number
  reporters: ReporterId[]
  secondIsReply?: boolean
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

export type FetchFacts = (kind: 'game' | 'night', key: string) => Promise<NewsFactsResponse>

const NIGHT = /^\d{4}-\d{2}-\d{2}$/
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
const pad2 = (n: number) => String(n).padStart(2, '0')

/** When the item is dated: a post at its game's end (+1 s per post), an article 90 min after the night's last game. */
export function itemCreatedAt(job: BackfillJob, index: number): Date {
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
      })
      job.reporters.forEach((r, k) =>
        activity.push({ reporter: r, night, createdAt: itemCreatedAt(job, k) }),
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
    const reporter = assignArticle('night', nightSheet.facts, createdAt, activity)
    article.reporters = [reporter]
    // The reporter's own recent pieces are not known before they are written.
    article.user = buildArticleUserPrompt({
      facts: nightSheet.facts,
      reporter: REPORTERS[reporter],
      kind: 'night',
      ownRecent: [],
    })
    activity.push({ reporter, night, createdAt })
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
  if (o.kind !== 'game' && o.kind !== 'night') bad('kind is not game or night')
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
  if (typeof o.user !== 'string') bad('user is not a string')
  const job: BackfillJob = {
    id: o.id!,
    kind: o.kind!,
    night: o.night!,
    reporters: reporters!,
    user: o.user!,
    schema: o.kind === 'game' ? GAME_POSTS_SCHEMA : ARTICLE_SCHEMA,
    sheet: parseNewsFactsResponse(o.sheet),
  }
  if (o.kind === 'game') {
    job.matchId = o.matchId!
    job.secondIsReply = o.secondIsReply === true
  }
  // Key order as the plan writes it, so a read job equals the planned one.
  return Object.fromEntries(
    ['id', 'kind', 'night', 'matchId', 'reporters', 'secondIsReply', 'user', 'schema', 'sheet']
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

// ── check ────────────────────────────────────────────────────────────────────

export type GameOutput = { posts: GamePost[] }
export type JobOutput = GameOutput | Article

export type Evaluation =
  | { state: 'waiting' }
  | { state: 'rewrite'; problems: string[]; rewritePrompt: string }
  | { state: 'review'; reviewPrompt: string; reviewError?: string }
  | { state: 'accepted'; output: JobOutput }

function mergeChecks(results: CheckResult[]): CheckResult {
  const problems = [...new Set(results.flatMap((r) => (r.ok ? [] : r.problems)))]
  return problems.length === 0 ? { ok: true } : { ok: false, problems }
}

/**
 * The state of one job: its answer is parsed and checked exactly as the live
 * desk does (outputs.ts, fact-check.ts); a passed answer needs a review, and
 * an ok review accepts it. `reviewText` must be null when there is no review
 * for this answer.
 */
export function evaluateJob(
  job: BackfillJob,
  answerText: string | null,
  reviewText: string | null,
): Evaluation {
  if (answerText === null) return { state: 'waiting' }
  const rewrite = (problems: string[]): Evaluation => ({
    state: 'rewrite',
    problems,
    rewritePrompt: buildRewritePrompt(job.user, problems),
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
      checked = mergeChecks(out.posts.map((p) => checkFacts(p.text, facts, forbiddenNames, p)))
      textForReview = out.posts.map((p) => `${REPORTERS[p.reporter].name}: ${p.text}`).join('\n\n')
    } else {
      const a = parseArticle(value)
      output = a
      checked = checkArticleFacts(a, facts, forbiddenNames)
      textForReview = [a.headline, a.dek, ...a.paragraphs].join('\n\n')
    }
  } catch (err: unknown) {
    return rewrite([message(err)])
  }
  if (!checked.ok) return rewrite(checked.problems)

  const reviewPrompt = buildReviewPrompt({ facts, text: textForReview })
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

/** Every job with its evaluation, in id order. A review older than its answer is ignored. */
export function evaluateDir(out: string): { job: BackfillJob; evaluation: Evaluation }[] {
  const d = dirs(out)
  return readJobs(out).map((job) => {
    const answer = readIf(join(d.answers, `${job.id}.json`))
    const review = readIf(join(d.reviews, `${job.id}.json`))
    const freshReview = answer !== null && review !== null && review.mtimeMs >= answer.mtimeMs
    return {
      job,
      evaluation: evaluateJob(job, answer?.text ?? null, freshReview ? review.text : null),
    }
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
      rmSync(file, { force: true })
      detail += ' — no answer yet'
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
            createdAt: itemCreatedAt(job, i),
          }),
        )
        inserted++
      }
      log(`${job.id}: ${String(posts.length)} post(s)`)
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
  if (out === null || (command !== 'plan' && command !== 'check' && command !== 'import')) {
    log(USAGE)
    return 2
  }

  if (command === 'plan') {
    const nights = (flag(argv, '--nights') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
    const web = env['WEB_INTERNAL_URL']?.trim().replace(/\/+$/, '') ?? ''
    const token = env['DISCORD_INTERNAL_TOKEN'] ?? ''
    if (nights.length === 0 || web === '' || token === '') {
      log(USAGE)
      return 2
    }
    const plan = await planBackfill({
      nights,
      fetchFacts: (kind, key) =>
        fetchNewsFacts({ webBaseUrl: web, token, kind, key, includeInactive: true }),
    })
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
