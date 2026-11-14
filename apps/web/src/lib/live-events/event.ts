import {
  LIVE_EVENT_ID_MAX,
  LIVE_EVENT_SOURCES,
  LIVE_EVENT_TYPES,
  type LiveEventSource,
  type LiveEventType,
} from '@eanhl/db/schema'

/**
 * Live event v1 validation (E1). Shape: docs/superpowers/specs/2026-11-14-live-events-interface.md §3.
 * Required: `v` (1), `id`, `type` (a known type), `source`, `at` (ISO time with a zone). Every other
 * field is optional (absent or null) and checked when present. Unknown fields are refused: v1 is a
 * fixed shape; a new field comes with a new `v`. `match_type` (optional: `gameType5` | `gameType10` |
 * `club_private`) is an E1 addition to §3: when it is there the worker's quick check reads one EA
 * match list instead of three.
 */

export interface LiveEventV1 {
  v: 1
  id: string
  type: LiveEventType
  source: LiveEventSource
  at: string
  [field: string]: unknown
}

export type ParseResult = { ok: true; event: LiveEventV1; at: Date } | { ok: false; error: string }

const ID_PATTERN = /^[A-Za-z0-9._:@+-]+$/
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/
const NAME_MAX = 64

type Check = (value: unknown) => boolean

const isInt =
  (min: number, max: number): Check =>
  (v) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const isStr =
  (max: number, pattern?: RegExp): Check =>
  (v) =>
    typeof v === 'string' && v.length >= 1 && v.length <= max && (!pattern || pattern.test(v))
const oneOf =
  (...values: string[]): Check =>
  (v) =>
    typeof v === 'string' && values.includes(v)
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const arrayOf =
  (max: number, item: Check): Check =>
  (v) =>
    Array.isArray(v) && v.length <= max && v.every(item)

/** Optional fields: absent or null, else this check. */
const OPTIONAL: Record<string, Check> = {
  game_title: isStr(32, /^[a-z0-9_-]+$/),
  period: isInt(1, 6),
  clock_left_ds: isInt(0, 36_000),
  score: (v) =>
    isPlainObject(v) &&
    Object.keys(v).every((k) => k === 'bgm' || k === 'opp') &&
    isInt(0, 99)(v['bgm']) &&
    isInt(0, 99)(v['opp']),
  team: oneOf('bgm', 'opp'),
  team_abbr: isStr(8),
  side: oneOf('home', 'away'),
  scorer_name: isStr(NAME_MAX),
  scorer_gamertag: isStr(NAME_MAX),
  assist_names: arrayOf(4, isStr(NAME_MAX)),
  assist_gamertags: arrayOf(4, (v) => v === null || isStr(NAME_MAX)(v)),
  strength: oneOf('ev', 'pp', 'sh'),
  // The EA match type played (task E1 item 4: the quick check then calls 1 match list, not 3).
  match_type: oneOf('gameType5', 'gameType10', 'club_private'),
  ea_match_id: (v) => isStr(32, /^\d+$/)(v) || isInt(0, Number.MAX_SAFE_INTEGER)(v),
  sure: (v) => typeof v === 'boolean',
}

const REQUIRED = ['v', 'id', 'type', 'source', 'at'] as const

/** Parses and validates one raw JSON body. Error texts name the field, never echo its value. */
export function parseLiveEvent(raw: string): ParseResult {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'body is not JSON' }
  }
  if (!isPlainObject(value)) return { ok: false, error: 'body is not a JSON object' }

  for (const key of REQUIRED) {
    if (!(key in value)) return { ok: false, error: `missing field: ${key}` }
  }
  if (value['v'] !== 1) return { ok: false, error: 'unsupported version: v must be 1' }
  if (!isStr(LIVE_EVENT_ID_MAX, ID_PATTERN)(value['id'])) {
    return {
      ok: false,
      error: `bad field: id (1-${String(LIVE_EVENT_ID_MAX)} of A-Z a-z 0-9 . _ : @ + -)`,
    }
  }
  if (!(LIVE_EVENT_TYPES as readonly unknown[]).includes(value['type'])) {
    return { ok: false, error: 'unknown type' }
  }
  if (!(LIVE_EVENT_SOURCES as readonly unknown[]).includes(value['source'])) {
    return { ok: false, error: 'unknown source' }
  }
  const atRaw = value['at']
  const at = typeof atRaw === 'string' && ISO_PATTERN.test(atRaw) ? new Date(atRaw) : null
  if (at === null || Number.isNaN(at.getTime())) {
    return { ok: false, error: 'bad field: at (ISO 8601 time with Z or an offset)' }
  }

  for (const [key, field] of Object.entries(value)) {
    if ((REQUIRED as readonly string[]).includes(key)) continue
    const check = OPTIONAL[key]
    if (!check) return { ok: false, error: `unknown field: ${key.slice(0, 40)}` }
    if (field !== null && !check(field)) return { ok: false, error: `bad field: ${key}` }
  }

  return { ok: true, event: value as LiveEventV1, at }
}
