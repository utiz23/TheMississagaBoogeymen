/**
 * Live smoke test of the news writer. It makes real Claude calls (about
 * 0.12 USD) and writes nothing to the database. Not part of the service.
 *
 *   ANTHROPIC_API_KEY=… node apps/discord/src/news/smoke-cli.ts /path/to/night.json
 *
 * The JSON file is the answer of the night fact-sheet route:
 * `{ "facts": {…kind "night"…}, "forbiddenNames": […] }`.
 * The key is read from the environment only; this script never prints it.
 */
import { readFileSync } from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'
import { REPORTERS, parseNewsFactsResponse } from '@eanhl/db/news'
import { costUsd } from './cost.ts'
import { checkArticleFacts } from './fact-check.ts'
import { ARTICLE_SCHEMA, parseArticle } from './outputs.ts'
import { buildArticleUserPrompt, buildSystemPrompt } from './prompts.ts'
import { anthropicModelCall, writeChecked } from './writer.ts'

const file = process.argv[2]
const apiKey = process.env['ANTHROPIC_API_KEY'] ?? ''
if (file === undefined || apiKey === '') {
  console.error('usage: ANTHROPIC_API_KEY=… node smoke-cli.ts <night.json>')
  process.exit(2)
}

const model = process.env['NEWS_MODEL'] ?? 'claude-opus-5-5'
const { facts, forbiddenNames } = parseNewsFactsResponse(JSON.parse(readFileSync(file, 'utf8')))
if (facts.kind !== 'night') {
  console.error(`expected a "night" fact sheet, got "${facts.kind}"`)
  process.exit(2)
}

const reporter = REPORTERS.barlow
const call = anthropicModelCall(new Anthropic({ apiKey }), model)
let total = 0
let calls = 0

try {
  const result = await writeChecked({
    call,
    system: buildSystemPrompt(Object.values(REPORTERS)),
    user: buildArticleUserPrompt({ facts, reporter, kind: 'night', ownRecent: [] }),
    schema: ARTICLE_SCHEMA,
    parse: parseArticle,
    check: (a) => checkArticleFacts(a, facts, forbiddenNames),
    textForReview: (a) => [a.headline, a.dek, ...a.paragraphs].join('\n\n'),
    facts,
    record: (purpose, usedModel, usage) => {
      const c = costUsd(usedModel, usage)
      total += c
      calls += 1
      console.log(
        `call ${String(calls)} (${purpose}, ${usedModel}): in ${String(usage.input_tokens)}, out ${String(usage.output_tokens)}, cache read ${String(usage.cache_read_input_tokens ?? 0)}, cache write ${String(usage.cache_creation_input_tokens ?? 0)}, $${c.toFixed(4)}`,
      )
      return Promise.resolve()
    },
  })

  if (result.ok) {
    const a = result.out
    console.log(
      `\n${a.headline}\n${a.dek}\n\n${a.paragraphs.join('\n\n')}\n\nsummary: ${a.summary}`,
    )
    console.log(`mentions: ${a.mentions.join(', ')} | clubs: ${a.clubs.join(', ')}`)
  } else {
    console.log(`\nNOT ACCEPTED: ${result.reason}`)
  }
} catch (e) {
  console.error(`smoke failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
  process.exitCode = 1
}
console.log(`\ntotal cost: $${total.toFixed(4)} in ${String(calls)} calls`)
