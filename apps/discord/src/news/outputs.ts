import { REPORTER_IDS, type NewsFacts, type ReporterId } from '@eanhl/db/news'

/**
 * JSON schemas for `output_config.format` and the hand-written parsers for
 * what comes back. The schemas are plain JSON Schema: every object is closed
 * (`additionalProperties: false`) and lists all its properties in `required`.
 * Size rules (1-2 posts, 280 characters, 250-450 words, headline 120 and
 * dek 160 characters) are not in the schemas; the parsers and the fact check
 * enforce them.
 */

const STRING_ARRAY = { type: 'array', items: { type: 'string' } } as const
const INTEGER_ARRAY = { type: 'array', items: { type: 'integer' } } as const

/** A stance on a thread of the sheet (C3a.4, spec §12.17-3): stored via `insertStance`. */
const STANCES = {
  type: 'array',
  items: {
    type: 'object',
    properties: { threadKey: { type: 'string' }, stance: { type: 'string' } },
    required: ['threadKey', 'stance'],
    additionalProperties: false,
  },
} as const

/**
 * The fields every piece adds (C3a.4): `zeroCalled` (zero call-outs, spec
 * §12.12-5), `stances` on threads, `takesUsed` (ids of reporter takes, §12.19).
 */
const PIECE_FIELDS = {
  zeroCalled: STRING_ARRAY,
  stances: STANCES,
  takesUsed: INTEGER_ARRAY,
} as const
const PIECE_KEYS = ['zeroCalled', 'stances', 'takesUsed'] as const

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
          ...PIECE_FIELDS,
        },
        required: ['reporter', 'text', 'mentions', 'clubs', 'criticized', ...PIECE_KEYS],
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
    ...PIECE_FIELDS,
  },
  required: [
    'headline',
    'dek',
    'paragraphs',
    'summary',
    'mentions',
    'clubs',
    'criticized',
    ...PIECE_KEYS,
  ],
  additionalProperties: false,
} as const

/** The receipt's verdict as the model writes it: `none` when there was no prediction to judge. */
export const RECEIPT_VERDICT_OUTPUTS = ['hit', 'miss', 'none'] as const

/**
 * A weekly feature (rev 2, B3): the article fields plus `prediction` (one
 * short prediction about next week, no numbers), `receipt` (one or two
 * sentences on last week's prediction, or "" when there was none) and
 * `receiptVerdict` (C3a.4: hit / miss, `none` without a prediction).
 */
export const FEATURE_SCHEMA = {
  type: 'object',
  properties: {
    ...ARTICLE_SCHEMA.properties,
    prediction: { type: 'string' },
    receipt: { type: 'string' },
    receiptVerdict: { type: 'string', enum: [...RECEIPT_VERDICT_OUTPUTS] },
  },
  required: [...ARTICLE_SCHEMA.required, 'prediction', 'receipt', 'receiptVerdict'],
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

/** A stance on a thread, as written (C3a.4). */
export interface PieceStance {
  threadKey: string
  stance: string
}

/** The fields every piece adds (C3a.4). */
export interface PieceExtras {
  /** Players the piece calls out for a zero (spec §12.12-5). */
  zeroCalled: string[]
  stances: PieceStance[]
  /** Ids of the reporter takes the piece voiced (spec §12.19). */
  takesUsed: number[]
}

function pieceExtras(o: Record<string, unknown>, path: string): PieceExtras {
  const at = (k: string) => (path === '' ? k : `${path}.${k}`)
  const rawStances = o['stances']
  if (!Array.isArray(rawStances)) fail(at('stances'), 'is not an array')
  const stances = rawStances.map((x: unknown, i): PieceStance => {
    const p = `${at('stances')}[${String(i)}]`
    const so = closedObject(x, p, ['threadKey', 'stance'])
    return {
      threadKey: text(so['threadKey'], `${p}.threadKey`),
      stance: text(so['stance'], `${p}.stance`),
    }
  })
  const rawTakes = o['takesUsed']
  if (!Array.isArray(rawTakes)) fail(at('takesUsed'), 'is not an array')
  const takesUsed = rawTakes.map((x: unknown, i) => {
    if (typeof x !== 'number' || !Number.isSafeInteger(x) || x <= 0) {
      fail(`${at('takesUsed')}[${String(i)}]`, 'is not a take id')
    }
    return x
  })
  return { zeroCalled: strings(o['zeroCalled'], at('zeroCalled')), stances, takesUsed }
}

function strings(v: unknown, path: string): string[] {
  if (!Array.isArray(v)) fail(path, 'is not an array')
  return v.map((x, i) => {
    if (typeof x !== 'string') fail(`${path}[${String(i)}]`, 'is not a string')
    return x
  })
}

export interface GamePost extends PieceExtras {
  reporter: ReporterId
  text: string
  mentions: string[]
  clubs: string[]
  /** People the post criticises harshly (the pile-on limit, rev 2 B4). */
  criticized: string[]
}

/** At most one post per reporter of the cast (a historic game, spec §12.14). */
export const MAX_GAME_POSTS = REPORTER_IDS.length

/**
 * `expected` is the assignment: one reporter per post, in order (the buzz
 * count, 1 to 9). The model must return exactly those posts.
 */
export function parseGamePosts(v: unknown, expected: readonly ReporterId[]): { posts: GamePost[] } {
  const root = closedObject(v, 'root', ['posts'])
  const raw = root['posts']
  if (!Array.isArray(raw)) fail('posts', 'is not an array')
  if (expected.length < 1 || expected.length > MAX_GAME_POSTS) {
    fail('posts', `must be assigned 1 to ${String(MAX_GAME_POSTS)} reporters`)
  }
  if (raw.length !== expected.length) {
    fail('posts', `has ${String(raw.length)} posts, expected ${String(expected.length)}`)
  }
  const posts = raw.map((item: unknown, i): GamePost => {
    const p = `posts[${String(i)}]`
    const o = closedObject(item, p, [
      'reporter',
      'text',
      'mentions',
      'clubs',
      'criticized',
      ...PIECE_KEYS,
    ])
    const reporter = expected[i]!
    if (o['reporter'] !== reporter)
      fail(`${p}.reporter`, `is not the assigned reporter "${reporter}"`)
    return {
      reporter,
      text: text(o['text'], `${p}.text`),
      mentions: strings(o['mentions'], `${p}.mentions`),
      clubs: strings(o['clubs'], `${p}.clubs`),
      criticized: strings(o['criticized'], `${p}.criticized`),
      ...pieceExtras(o, p),
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

export interface Article extends PieceExtras {
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
  ...PIECE_KEYS,
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
    ...pieceExtras(o, ''),
  }
}

export function parseArticle(v: unknown): Article {
  return articleFields(closedObject(v, 'root', ARTICLE_KEYS))
}

export interface Feature extends Article {
  prediction: string
  /** "" when there was no previous prediction. */
  receipt: string
  /** The receipt's verdict (C3a.4); null when there was no prediction ("none"). */
  receiptVerdict: 'hit' | 'miss' | null
}

export function parseFeature(v: unknown): Feature {
  const o = closedObject(v, 'root', [...ARTICLE_KEYS, 'prediction', 'receipt', 'receiptVerdict'])
  const receipt = o['receipt']
  if (typeof receipt !== 'string') fail('receipt', 'is not a string')
  const verdict = o['receiptVerdict']
  if (!(RECEIPT_VERDICT_OUTPUTS as readonly unknown[]).includes(verdict)) {
    fail('receiptVerdict', 'is not hit, miss or none')
  }
  return {
    ...articleFields(o),
    prediction: text(o['prediction'], 'prediction'),
    receipt,
    receiptVerdict: verdict === 'none' ? null : (verdict as 'hit' | 'miss'),
  }
}

export function parseReview(v: unknown): { ok: boolean; problems: string[] } {
  const o = closedObject(v, 'root', ['ok', 'problems'])
  if (typeof o['ok'] !== 'boolean') fail('ok', 'is not a boolean')
  return { ok: o['ok'], problems: strings(o['problems'], 'problems') }
}

/**
 * A feature's stored body (rev 2, B3): the receipt opens it (when there is
 * one), the prediction closes it; the web shows the body as it is.
 */
export function featureBody(
  a: { paragraphs: string[] },
  closing: { prediction: string; receipt: string },
): string {
  return [closing.receipt, ...a.paragraphs, closing.prediction]
    .filter((x) => x.trim() !== '')
    .join('\n\n')
}

const nameKey = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** `zeroCalled` as stored (C3a.4): the same spelling rule as `criticizedAsOnSheet`. */
export function zeroCalledAsOnSheet(names: readonly string[], facts: NewsFacts): string[] {
  return criticizedAsOnSheet(names, facts)
}

/**
 * `criticized` as stored (Part C1.9, Q7): each name in the sheet's
 * `people[].name` spelling (case and spacing ignored, as the fact check
 * compares them), each person once. A name not on the sheet, which the fact
 * check already rejects, stays as written (trimmed); blanks are dropped.
 */
export function criticizedAsOnSheet(names: readonly string[], facts: NewsFacts): string[] {
  const out: string[] = []
  for (const n of names) {
    const person = facts.people.find((p) => nameKey(p.name) === nameKey(n))
    const name = person?.name ?? n.trim()
    if (name !== '' && !out.includes(name)) out.push(name)
  }
  return out
}
