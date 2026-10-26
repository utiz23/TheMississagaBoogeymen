import Anthropic from '@anthropic-ai/sdk'
import type { NewsFacts, NewsTake } from '@eanhl/db/news'
import type { Usage } from './cost.ts'
import { REVIEW_SYSTEM_PROMPT, buildReviewPrompt, buildRewritePrompt } from './prompts.ts'
import { REVIEW_SCHEMA, parseReview } from './outputs.ts'
import { redactTakes } from './redact.ts'

/**
 * The Claude writer: one structured call to write, a program check, a second
 * Claude call to review, up to two rewrites on any failure (`MAX_WRITES`
 * writes in all). Nothing is returned unless it passed both checks. `anthropicModelCall` is the only code here
 * that touches the SDK; tests pass a fake `ModelCall`.
 */

export interface ModelCall {
  (req: {
    purpose: 'write' | 'review'
    system: string
    user: string
    schema: object
    effort: 'low' | 'medium'
  }): Promise<{ json: unknown; refused: boolean; model: string; usage: Usage }>
}

/** The pass must stop: the key is wrong or not allowed. Retrying cannot help. */
export class NewsStopError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NewsStopError'
  }
}

/** The job failed for a reason that may pass (rate limit, outage, network). */
export class NewsRetryableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NewsRetryableError'
  }
}

/** The API rejected the request itself (400), for example when credits are out. */
export class NewsJobError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NewsJobError'
  }
}

const MAX_TOKENS = 16000

/** The first write plus two rewrites. Worst case per article: 3 writes + 3 reviews. */
export const MAX_WRITES = 3

/** `json` is null when the answer has no text block, was cut off, or is not JSON. */
export function anthropicModelCall(client: Anthropic, model: string): ModelCall {
  return async ({ system, user, schema, effort }) => {
    let res
    try {
      res = await client.beta.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
        output_config: {
          effort,
          format: { type: 'json_schema', schema: schema as Record<string, unknown> },
        },
      })
    } catch (e) {
      throw mapSdkError(e)
    }

    const usage: Usage = {
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      cache_read_input_tokens: res.usage.cache_read_input_tokens,
      cache_creation_input_tokens: res.usage.cache_creation_input_tokens,
    }
    const refused = res.stop_reason === 'refusal'
    let json: unknown = null
    if (!refused && res.stop_reason !== 'max_tokens') {
      const block = res.content.find((b) => b.type === 'text')
      if (block?.type === 'text') {
        try {
          json = JSON.parse(block.text)
        } catch {
          json = null
        }
      }
    }
    return { json, refused, model: res.model, usage }
  }
}

/** Typed SDK errors, most specific first. The message never carries the key. */
function mapSdkError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new NewsStopError(`Anthropic API refused the key (${String(e.status)}): ${e.message}`)
  }
  if (
    e instanceof Anthropic.RateLimitError ||
    e instanceof Anthropic.InternalServerError ||
    e instanceof Anthropic.APIConnectionError
  ) {
    return new NewsRetryableError(`Anthropic API unavailable: ${e.message}`)
  }
  if (e instanceof Anthropic.BadRequestError) {
    return new NewsJobError(`Anthropic API rejected the request: ${e.message}`)
  }
  if (e instanceof Anthropic.APIError) {
    return new NewsRetryableError(`Anthropic API error (${String(e.status)}): ${e.message}`)
  }
  return e instanceof Error ? e : new Error(String(e))
}

/** The desk writes nothing new once this month's spend is within 0.50 USD of the limit. */
export function budgetLeft(spent: number, limitUsd: number): boolean {
  return spent < limitUsd - 0.5
}

export async function writeChecked<T>(args: {
  call: ModelCall
  system: string
  user: string
  schema: object
  parse: (v: unknown) => T
  check: (out: T) => { ok: true } | { ok: false; problems: string[] }
  textForReview: (out: T) => string
  /** The people the output lists as criticised harshly (shown to the review). */
  criticizedForReview?: (out: T) => string[]
  /** The reporter takes the piece was offered (shown to the review, C3a.10). */
  takesForReview?: readonly NewsTake[]
  facts: NewsFacts
  record: (purpose: 'write' | 'review', model: string, usage: Usage) => Promise<void>
}): Promise<{ ok: true; out: T } | { ok: false; reason: string }> {
  let problems: string[] = []

  for (let attempt = 0; attempt < MAX_WRITES; attempt++) {
    const user = attempt === 0 ? args.user : buildRewritePrompt(args.user, problems)

    const written = await args.call({
      purpose: 'write',
      system: args.system,
      user,
      schema: args.schema,
      effort: 'medium',
    })
    await args.record('write', written.model, written.usage)
    if (written.refused) return { ok: false, reason: 'refused' }
    if (written.json === null) {
      problems = ['The answer was empty, cut off, or not valid JSON.']
      continue
    }

    let out: T
    try {
      out = args.parse(written.json)
    } catch (e) {
      problems = [e instanceof Error ? e.message : String(e)]
      continue
    }

    const checked = args.check(out)
    if (!checked.ok) {
      problems = checked.problems
      continue
    }

    const reviewed = await args.call({
      purpose: 'review',
      system: REVIEW_SYSTEM_PROMPT,
      user: buildReviewPrompt({
        facts: args.facts,
        text: args.textForReview(out),
        criticized: args.criticizedForReview?.(out) ?? [],
        takes: args.takesForReview ?? [],
      }),
      schema: REVIEW_SCHEMA,
      effort: 'low',
    })
    await args.record('review', reviewed.model, reviewed.usage)
    if (reviewed.refused) return { ok: false, reason: 'refused' }
    if (reviewed.json === null) {
      problems = ['The review gave no usable answer.']
      continue
    }
    let verdict: { ok: boolean; problems: string[] }
    try {
      verdict = parseReview(reviewed.json)
    } catch (e) {
      problems = [e instanceof Error ? e.message : String(e)]
      continue
    }
    if (!verdict.ok) {
      problems = verdict.problems.length > 0 ? verdict.problems : ['The review rejected the text.']
      continue
    }
    return { ok: true, out }
  }

  // C3a fix I1: a take's words never reach the job's error or a log line.
  const reason = `failed after ${String(MAX_WRITES)} writes: ${problems.join('; ')}`
  return { ok: false, reason: redactTakes(reason, args.takesForReview ?? []) }
}
