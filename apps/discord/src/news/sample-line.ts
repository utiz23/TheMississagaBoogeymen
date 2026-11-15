import { REPORTERS, type ReporterId } from '@eanhl/db/news'
import { costUsd, type Usage } from './cost.ts'
import { crudeHit } from './crude.ts'
import { numberTokens } from './fact-check.ts'
import { buildSystemPrompt } from './prompts.ts'
import type { ModelCall } from './writer.ts'

/**
 * "Preview a sample line" on the Press Box Reporters page (task press-box-l4): ONE short post in
 * one reporter's voice, so the admin can hear an edited character before the writers use it.
 *
 * Exactly one model call through the desk's `ModelCall` (the same writer the desk uses, with the same
 * system prompt: the rules, the reporter's merged character and the locked rules), counted in the
 * monthly spend through `record`. No rewrite, no review: a line that fails the code checks below is
 * thrown away, not retried (the admin clicks again). The line is a SAMPLE: it is never posted, never
 * stored as a news item, and it has no fact sheet, so the request asks for no numbers, no names of
 * people or clubs and no scores. It is only shown on the admin page.
 */

export const SAMPLE_MAX_CHARS = 320

export const SAMPLE_SCHEMA = {
  type: 'object',
  properties: { line: { type: 'string' } },
  required: ['line'],
  additionalProperties: false,
} as const

/** The request (the system prompt carries the rules and the character). */
export function samplePrompt(reporter: ReporterId): string {
  const r = REPORTERS[reporter]
  return [
    `Write ONE sample post as ${r.name} (id "${r.id}"): one to three sentences, a general reaction to a club game, in your voice.`,
    'This is a voice sample for the admin to read; it is never posted. There is no fact sheet for it, so: no numbers at all (digits or number words), no scores, no dates, no names of people, no opponent names. Write about hockey in general terms only.',
    `At most ${String(SAMPLE_MAX_CHARS)} characters. Plain text: no @ mentions, no links, no hashtags, no emoji, no markdown.`,
    'Answer only in the JSON format you are given.',
  ].join('\n')
}

/** The code check of a sample line. Returns the problem, or null when the line may be shown. */
export function sampleProblem(text: string): string | null {
  const line = text.trim()
  if (line === '') return 'empty'
  if (Array.from(line).length > SAMPLE_MAX_CHARS) return 'too long'
  if (crudeHit(line)) return 'crude'
  if (numberTokens(line) > 0) return 'numbers'
  if (/[@#]|https?:|www\.|[*_`~]|<[^>]*>/.test(line)) return 'format'
  if (/\p{Extended_Pictographic}/u.test(line)) return 'emoji'
  return null
}

export type SampleResult =
  | { ok: true; text: string; model: string; costUsd: number }
  | { ok: false; reason: string; costUsd: number }

/** One call, one line. Never throws: a failure is a short fixed reason. */
export async function writeSampleLine(
  call: ModelCall,
  reporter: ReporterId,
  record: (purpose: 'write' | 'review', model: string, usage: Usage) => Promise<void>,
): Promise<SampleResult> {
  let spent = 0
  try {
    const res = await call({
      purpose: 'write',
      system: buildSystemPrompt([REPORTERS[reporter]]),
      user: samplePrompt(reporter),
      schema: SAMPLE_SCHEMA,
      effort: 'low',
    })
    spent = costUsd(res.model, res.usage)
    await record('write', res.model, res.usage)
    if (res.refused) return { ok: false, reason: 'the model refused', costUsd: spent }
    const json = res.json as { line?: unknown } | null
    if (json === null || typeof json !== 'object' || typeof json.line !== 'string') {
      return { ok: false, reason: 'the answer was not readable', costUsd: spent }
    }
    const problem = sampleProblem(json.line)
    if (problem !== null) {
      return { ok: false, reason: `the line failed the desk checks (${problem})`, costUsd: spent }
    }
    return { ok: true, text: json.line.trim(), model: res.model, costUsd: spent }
  } catch (err: unknown) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message.slice(0, 120) : 'failed',
      costUsd: spent,
    }
  }
}
