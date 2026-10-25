import { REPORTER_IDS, type ReporterId } from '@eanhl/db/news'

/**
 * JSON schemas for `output_config.format` and the hand-written parsers for
 * what comes back. The schemas are plain JSON Schema: every object is closed
 * (`additionalProperties: false`) and lists all its properties in `required`.
 * Size rules (1-2 posts, 280 characters, 250-450 words, headline 120 and
 * dek 160 characters) are not in the schemas; the parsers and the fact check
 * enforce them.
 */

const STRING_ARRAY = { type: 'array', items: { type: 'string' } } as const

export const GAME_POSTS_SCHEMA = {
  type: 'object',
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          reporter: { type: 'string', enum: [...REPORTER_IDS] },
          text: { type: 'string' },
          mentions: STRING_ARRAY,
          clubs: STRING_ARRAY,
          criticized: STRING_ARRAY,
        },
        required: ['reporter', 'text', 'mentions', 'clubs', 'criticized'],
        additionalProperties: false,
      },
    },
  },
  required: ['posts'],
  additionalProperties: false,
} as const

export const ARTICLE_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    dek: { type: 'string' },
    paragraphs: STRING_ARRAY,
    summary: { type: 'string' },
    mentions: STRING_ARRAY,
    clubs: STRING_ARRAY,
    criticized: STRING_ARRAY,
  },
  required: ['headline', 'dek', 'paragraphs', 'summary', 'mentions', 'clubs', 'criticized'],
  additionalProperties: false,
} as const

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    problems: STRING_ARRAY,
  },
  required: ['ok', 'problems'],
  additionalProperties: false,
} as const

function fail(path: string, why: string): never {
  throw new Error(`news output: ${path} ${why}`)
}

function closedObject(v: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'is not an object')
  const o = v as Record<string, unknown>
  for (const k of Object.keys(o)) {
    if (!keys.includes(k)) fail(path, `has an unexpected field "${k}"`)
  }
  for (const k of keys) {
    if (!(k in o)) fail(path, `is missing "${k}"`)
  }
  return o
}

function text(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.trim() === '') fail(path, 'is not a non-empty string')
  return v
}

function strings(v: unknown, path: string): string[] {
  if (!Array.isArray(v)) fail(path, 'is not an array')
  return v.map((x, i) => {
    if (typeof x !== 'string') fail(`${path}[${String(i)}]`, 'is not a string')
    return x
  })
}

export interface GamePost {
  reporter: ReporterId
  text: string
  mentions: string[]
  clubs: string[]
  /** People the post criticises harshly (the pile-on limit, rev 2 B4). */
  criticized: string[]
}

/**
 * `expected` is the assignment: one reporter per post, in order. The model
 * must return exactly those posts (so 1 or 2, never more).
 */
export function parseGamePosts(v: unknown, expected: readonly ReporterId[]): { posts: GamePost[] } {
  const root = closedObject(v, 'root', ['posts'])
  const raw = root['posts']
  if (!Array.isArray(raw)) fail('posts', 'is not an array')
  if (expected.length < 1 || expected.length > 2) fail('posts', 'must be assigned 1 or 2 reporters')
  if (raw.length !== expected.length) {
    fail('posts', `has ${String(raw.length)} posts, expected ${String(expected.length)}`)
  }
  const posts = raw.map((item: unknown, i): GamePost => {
    const p = `posts[${String(i)}]`
    const o = closedObject(item, p, ['reporter', 'text', 'mentions', 'clubs', 'criticized'])
    const reporter = expected[i]!
    if (o['reporter'] !== reporter)
      fail(`${p}.reporter`, `is not the assigned reporter "${reporter}"`)
    return {
      reporter,
      text: text(o['text'], `${p}.text`),
      mentions: strings(o['mentions'], `${p}.mentions`),
      clubs: strings(o['clubs'], `${p}.clubs`),
      criticized: strings(o['criticized'], `${p}.criticized`),
    }
  })
  return { posts }
}

/** Longest headline and dek, in characters: the Discord message stays far below 2000. */
export const HEADLINE_MAX_CHARS = 120
export const DEK_MAX_CHARS = 160

function limited(v: string, path: string, max: number): string {
  const chars = Array.from(v).length
  if (chars > max) fail(path, `has ${String(chars)} characters; the limit is ${String(max)}`)
  return v
}

export interface Article {
  headline: string
  dek: string
  paragraphs: string[]
  summary: string
  mentions: string[]
  clubs: string[]
  /** People the article criticises harshly (the pile-on limit, rev 2 B4). */
  criticized: string[]
}

const ARTICLE_KEYS = [
  'headline',
  'dek',
  'paragraphs',
  'summary',
  'mentions',
  'clubs',
  'criticized',
] as const

function articleFields(o: Record<string, unknown>): Article {
  const raw = o['paragraphs']
  if (!Array.isArray(raw) || raw.length === 0) fail('paragraphs', 'is not a non-empty array')
  return {
    headline: limited(text(o['headline'], 'headline'), 'headline', HEADLINE_MAX_CHARS),
    dek: limited(text(o['dek'], 'dek'), 'dek', DEK_MAX_CHARS),
    paragraphs: raw.map((x: unknown, i) => text(x, `paragraphs[${String(i)}]`)),
    summary: text(o['summary'], 'summary'),
    mentions: strings(o['mentions'], 'mentions'),
    clubs: strings(o['clubs'], 'clubs'),
    criticized: strings(o['criticized'], 'criticized'),
  }
}

export function parseArticle(v: unknown): Article {
  return articleFields(closedObject(v, 'root', ARTICLE_KEYS))
}

export function parseReview(v: unknown): { ok: boolean; problems: string[] } {
  const o = closedObject(v, 'root', ['ok', 'problems'])
  if (typeof o['ok'] !== 'boolean') fail('ok', 'is not a boolean')
  return { ok: o['ok'], problems: strings(o['problems'], 'problems') }
}
