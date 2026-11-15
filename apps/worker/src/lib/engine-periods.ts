/**
 * Engine period import (task P1): goals and shots per period, read from recordings by
 * the eanhl-live-engine and written to `match_period_summaries` with
 * `source = 'engine_video'`.
 *
 * This file has NO database code. The planner talks to a small `PeriodStore`, so every
 * rule is testable without a database (see `__tests__/engine-periods.test.ts`).
 *
 * THE RULES (task "done when": a period box teammates see must add up to EA's score)
 *   * Only `complete: true` files are used. Unknown `schema_version`: refused.
 *   * The match must exist in OUR database (game title slug + EA match id).
 *   * The period goals, summed, must equal OUR database's final score on both sides
 *     (`matches.score_for` / `score_against`), not only the file's own `final`. A
 *     mismatch refuses the match: nothing is written for it.
 *   * Rows are written with goals AND shots review = 'reviewed' only because the checks
 *     above passed. Faceoffs stay empty and 'pending_review'. A match that fails a check
 *     gets no rows at all (there is no "pending" engine row).
 *   * Idempotent: a re-run replaces only the same match's `engine_video` rows (delete +
 *     insert in one transaction). Rows of any other source are never touched.
 *   * Nothing is written unless `apply` is set.
 */

/** Spelled once. The wire field names below are the only place they appear. */
export const ENGINE_PERIODS_SCHEMA_VERSION = 1
export const ENGINE_VIDEO_SOURCE = 'engine_video' as const

/** Wire field names of the engine file (agreed shape, schema_version 1). Rename here only. */
export const FIELDS = {
  schemaVersion: 'schema_version',
  gameTitle: 'game_title',
  eaMatchId: 'ea_match_id',
  recording: 'recording',
  game: 'game',
  ourSide: 'our_side',
  ourAbbr: 'our_abbr',
  oppAbbr: 'opp_abbr',
  final: 'final',
  endOfGameCheck: 'end_of_game_check',
  periods: 'periods',
  periodNumber: 'period',
  goals: 'goals',
  shots: 'shots',
  us: 'bm',
  them: 'opp',
  goalList: 'goal_list',
  goalPeriod: 'period',
  goalTeam: 'team',
  goalSure: 'sure',
  sourceCommit: 'source_commit',
  complete: 'complete',
  exportedAt: 'exported_at',
} as const

export const MAX_PERIOD = 6
const PERIOD_LABELS: Record<number, string> = {
  1: '1st',
  2: '2nd',
  3: '3rd',
  4: 'OT',
  5: 'OT2',
  6: 'OT3',
}

// ─── The parsed file ──────────────────────────────────────────────────────────

export interface EnginePeriod {
  period: number
  goalsFor: number
  goalsAgainst: number
  shotsFor: number
  shotsAgainst: number
}

export interface EnginePeriodsFile {
  gameTitle: string
  eaMatchId: string
  ourSide: 'home' | 'away'
  ourAbbr: string
  oppAbbr: string
  finalFor: number
  finalAgainst: number
  periods: EnginePeriod[]
  /** Goals in the goal list, by period and team (step 1 reads counts only). */
  goalListCounts: { period: number; team: 'us' | 'them' }[] | null
  sourceCommit: string
  recording: string | null
  game: number | null
  exportedAt: string | null
}

export type ParseResult =
  | { kind: 'ok'; file: EnginePeriodsFile }
  /** Valid envelope, `complete` is false: skipped, not an error. */
  | { kind: 'incomplete'; gameTitle: string | null; eaMatchId: string | null }
  | { kind: 'invalid'; errors: string[]; eaMatchId: string | null }

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function nonNegInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1000 ? v : null
}

function eaMatchIdOf(v: unknown): string | null {
  if (typeof v === 'string' && /^[0-9]{1,20}$/.test(v)) return v
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return String(v)
  return null
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

function pair(
  parent: Obj,
  key: string,
  where: string,
  errors: string[],
): { us: number; them: number } | null {
  const o = parent[key]
  if (!isObj(o)) {
    errors.push(`${where}.${key}: missing or not an object`)
    return null
  }
  const us = nonNegInt(o[FIELDS.us])
  const them = nonNegInt(o[FIELDS.them])
  if (us === null) errors.push(`${where}.${key}.${FIELDS.us}: not a whole number >= 0`)
  if (them === null) errors.push(`${where}.${key}.${FIELDS.them}: not a whole number >= 0`)
  return us === null || them === null ? null : { us, them }
}

/** Strict parse of one engine file. Never throws. */
export function parseEnginePeriodsFile(raw: unknown): ParseResult {
  if (!isObj(raw))
    return { kind: 'invalid', errors: ['file is not a JSON object'], eaMatchId: null }
  const eaMatchId = eaMatchIdOf(raw[FIELDS.eaMatchId])

  if (raw[FIELDS.schemaVersion] !== ENGINE_PERIODS_SCHEMA_VERSION) {
    return {
      kind: 'invalid',
      errors: [
        `${FIELDS.schemaVersion}: ${JSON.stringify(raw[FIELDS.schemaVersion])} is not supported (this importer reads ${String(ENGINE_PERIODS_SCHEMA_VERSION)})`,
      ],
      eaMatchId,
    }
  }
  const complete = raw[FIELDS.complete]
  if (typeof complete !== 'boolean') {
    return {
      kind: 'invalid',
      errors: [`${FIELDS.complete}: missing or not true/false`],
      eaMatchId,
    }
  }
  if (!complete) {
    return { kind: 'incomplete', gameTitle: nonEmptyString(raw[FIELDS.gameTitle]), eaMatchId }
  }

  const errors: string[] = []
  const gameTitle = nonEmptyString(raw[FIELDS.gameTitle])
  if (gameTitle === null || !/^[a-z0-9_]+$/.test(gameTitle)) {
    errors.push(`${FIELDS.gameTitle}: missing or not a title slug like "nhl27"`)
  }
  if (eaMatchId === null) errors.push(`${FIELDS.eaMatchId}: missing or not a numeric id`)
  const ourSide = raw[FIELDS.ourSide]
  if (ourSide !== 'home' && ourSide !== 'away') {
    errors.push(`${FIELDS.ourSide}: must be "home" or "away"`)
  }
  const ourAbbr = nonEmptyString(raw[FIELDS.ourAbbr])
  const oppAbbr = nonEmptyString(raw[FIELDS.oppAbbr])
  if (ourAbbr === null) errors.push(`${FIELDS.ourAbbr}: missing`)
  if (oppAbbr === null) errors.push(`${FIELDS.oppAbbr}: missing`)
  const sourceCommit = nonEmptyString(raw[FIELDS.sourceCommit])
  if (sourceCommit === null) errors.push(`${FIELDS.sourceCommit}: missing`)

  const finalObj = raw[FIELDS.final]
  let finalFor: number | null = null
  let finalAgainst: number | null = null
  if (!isObj(finalObj)) {
    errors.push(`${FIELDS.final}: missing or not an object`)
  } else {
    finalFor = nonNegInt(finalObj[FIELDS.us])
    finalAgainst = nonNegInt(finalObj[FIELDS.them])
    if (finalFor === null) errors.push(`${FIELDS.final}.${FIELDS.us}: not a whole number >= 0`)
    if (finalAgainst === null)
      errors.push(`${FIELDS.final}.${FIELDS.them}: not a whole number >= 0`)
  }
  // The engine's own END OF GAME check: an explicit false is a refusal. The shape of a
  // passing value is the engine's business (boolean, or an object with a boolean `ok` / `passed`).
  const eog = raw[FIELDS.endOfGameCheck]
  if (eog === false || (isObj(eog) && (eog.ok === false || eog.passed === false))) {
    errors.push(`${FIELDS.endOfGameCheck}: the engine's own check failed`)
  }

  const periods: EnginePeriod[] = []
  const rawPeriods = raw[FIELDS.periods]
  if (!Array.isArray(rawPeriods) || rawPeriods.length === 0) {
    errors.push(`${FIELDS.periods}: missing or empty`)
  } else {
    rawPeriods.forEach((p: unknown, i) => {
      const where = `${FIELDS.periods}[${String(i)}]`
      if (!isObj(p)) {
        errors.push(`${where}: not an object`)
        return
      }
      const n = p[FIELDS.periodNumber]
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_PERIOD) {
        errors.push(
          `${where}.${FIELDS.periodNumber}: must be a whole number 1..${String(MAX_PERIOD)}`,
        )
        return
      }
      const goals = pair(p, FIELDS.goals, where, errors)
      const shots = pair(p, FIELDS.shots, where, errors)
      if (goals === null || shots === null) return
      periods.push({
        period: n,
        goalsFor: goals.us,
        goalsAgainst: goals.them,
        shotsFor: shots.us,
        shotsAgainst: shots.them,
      })
    })
    // Periods 1..N with no gap and no duplicate (N >= 1: a game can end early).
    const sorted = [...periods].map((p) => p.period).sort((a, b) => a - b)
    if (periods.length === rawPeriods.length) {
      sorted.forEach((n, i) => {
        if (n !== i + 1) {
          errors.push(
            `${FIELDS.periods}: periods must be 1..N with no gap or duplicate (got ${sorted.join(',')})`,
          )
        }
      })
    }
  }

  // Goal list: counts only in step 1, and ADVISORY. The agreed shape for `team` is not
  // pinned down yet, so anything unreadable makes the list "not read" (null) instead of an
  // error. The period goal counts above are what the checks and the rows use.
  let goalListCounts: EnginePeriodsFile['goalListCounts'] = null
  const rawGoals = raw[FIELDS.goalList]
  if (Array.isArray(rawGoals)) {
    const counted: { period: number; team: 'us' | 'them' }[] = []
    const usNames = [FIELDS.us, ourAbbr?.toLowerCase()]
    const themNames = [FIELDS.them, oppAbbr?.toLowerCase()]
    let readable = true
    for (const g of rawGoals as unknown[]) {
      const n = isObj(g) ? g[FIELDS.goalPeriod] : undefined
      const rawTeam = isObj(g) ? g[FIELDS.goalTeam] : undefined
      const team = typeof rawTeam === 'string' ? rawTeam.toLowerCase() : null
      if (
        typeof n !== 'number' ||
        !Number.isInteger(n) ||
        n < 1 ||
        n > MAX_PERIOD ||
        team === null
      ) {
        readable = false
        break
      }
      if (usNames.includes(team)) counted.push({ period: n, team: 'us' })
      else if (themNames.includes(team)) counted.push({ period: n, team: 'them' })
      else {
        readable = false
        break
      }
    }
    // An empty list means "not provided" (step 1 does not need it), not "zero goals".
    if (readable && counted.length > 0) goalListCounts = counted
  }

  const game = raw[FIELDS.game]
  if (
    game !== undefined &&
    game !== null &&
    (typeof game !== 'number' || !Number.isInteger(game) || game < 1)
  ) {
    errors.push(`${FIELDS.game}: not a whole number >= 1`)
  }
  const recording = raw[FIELDS.recording]
  const exportedAt = raw[FIELDS.exportedAt]
  if (
    exportedAt !== undefined &&
    exportedAt !== null &&
    (typeof exportedAt !== 'string' || Number.isNaN(Date.parse(exportedAt)))
  ) {
    errors.push(`${FIELDS.exportedAt}: not a date string`)
  }

  if (
    errors.length > 0 ||
    gameTitle === null ||
    eaMatchId === null ||
    (ourSide !== 'home' && ourSide !== 'away') ||
    ourAbbr === null ||
    oppAbbr === null ||
    sourceCommit === null ||
    finalFor === null ||
    finalAgainst === null
  ) {
    return { kind: 'invalid', errors, eaMatchId }
  }

  return {
    kind: 'ok',
    file: {
      gameTitle,
      eaMatchId,
      ourSide,
      ourAbbr,
      oppAbbr,
      finalFor,
      finalAgainst,
      periods: [...periods].sort((a, b) => a.period - b.period),
      goalListCounts,
      sourceCommit,
      recording: typeof recording === 'string' ? recording : null,
      game: typeof game === 'number' ? game : null,
      exportedAt: typeof exportedAt === 'string' ? exportedAt : null,
    },
  }
}

// ─── The store seam and the planner ───────────────────────────────────────────

export interface MatchRef {
  id: number
  scoreFor: number
  scoreAgainst: number
  shotsFor: number
  shotsAgainst: number
  result: string
  bgmWasHome: boolean | null
}

/** The row values the importer writes for one period. */
export interface EnginePeriodRowValues {
  periodNumber: number
  periodLabel: string
  goalsFor: number
  goalsAgainst: number
  shotsFor: number
  shotsAgainst: number
  /** Set on rows read back from the store: false when goals or shots are not 'reviewed'. */
  reviewed?: boolean
}

export interface PeriodStore {
  /** `titleKnown` false: the slug is not in game_titles. `match` null: no such match. */
  findMatch(
    gameTitleSlug: string,
    eaMatchId: string,
  ): Promise<{ titleKnown: boolean; match: MatchRef | null }>
  /** This match's existing `engine_video` rows only. */
  getEngineRows(matchId: number): Promise<EnginePeriodRowValues[]>
  /**
   * Replace this match's `engine_video` rows with `rows`, in ONE transaction: delete the
   * `engine_video` rows of `matchId`, insert `rows` with the review columns set (goals and
   * shots 'reviewed', faceoffs empty and 'pending_review'). Never touches another source.
   */
  replaceEngineRows(
    matchId: number,
    rows: EnginePeriodRowValues[],
  ): Promise<{ deleted: number; inserted: number }>
}

export type Action = 'insert' | 'replace' | 'unchanged' | 'skipped' | 'refused'

export interface MatchOutcome {
  source: string
  eaMatchId: string | null
  gameTitle: string | null
  action: Action
  reason: string
  matchId: number | null
  /** EA's final in our database, for the table. */
  eaFinal: string | null
  /** The sum of the period goals, for the table. */
  periodSum: string | null
  periods: number | null
  /** Informational only: period shots summed vs EA's whole-game shots. Never a gate. */
  shots: string | null
  warnings: string[]
  rows: EnginePeriodRowValues[]
  deleted: number
  inserted: number
}

function blank(source: string): MatchOutcome {
  return {
    source,
    eaMatchId: null,
    gameTitle: null,
    action: 'refused',
    reason: '',
    matchId: null,
    eaFinal: null,
    periodSum: null,
    periods: null,
    shots: null,
    warnings: [],
    rows: [],
    deleted: 0,
    inserted: 0,
  }
}

export function toRowValues(periods: readonly EnginePeriod[]): EnginePeriodRowValues[] {
  return periods.map((p) => ({
    periodNumber: p.period,
    periodLabel: PERIOD_LABELS[p.period] ?? `P${String(p.period)}`,
    goalsFor: p.goalsFor,
    goalsAgainst: p.goalsAgainst,
    shotsFor: p.shotsFor,
    shotsAgainst: p.shotsAgainst,
  }))
}

function sameRows(
  a: readonly EnginePeriodRowValues[],
  b: readonly EnginePeriodRowValues[],
): boolean {
  if (a.length !== b.length) return false
  // An existing row whose goals or shots review was changed is not "the same": re-write it.
  if (a.some((r) => r.reviewed === false) || b.some((r) => r.reviewed === false)) return false
  const key = (r: EnginePeriodRowValues) =>
    [r.periodNumber, r.periodLabel, r.goalsFor, r.goalsAgainst, r.shotsFor, r.shotsAgainst].join(
      '|',
    )
  const as = a.map(key).sort()
  const bs = b.map(key).sort()
  return as.every((k, i) => k === bs[i])
}

/**
 * Decide what to do with one parsed result. Reads the store; writes only when `apply`
 * is true AND every check passed.
 */
export async function processParsed(
  source: string,
  parsed: ParseResult,
  store: PeriodStore,
  opts: { apply: boolean; expectedEaMatchId?: string | null },
): Promise<MatchOutcome> {
  const out = blank(source)

  if (parsed.kind === 'invalid') {
    out.eaMatchId = parsed.eaMatchId
    out.reason = `invalid file: ${parsed.errors.join('; ')}`
    return out
  }
  if (parsed.kind === 'incomplete') {
    out.eaMatchId = parsed.eaMatchId
    out.gameTitle = parsed.gameTitle
    out.action = 'skipped'
    out.reason = 'not complete (engine says complete = false)'
    return out
  }

  const f = parsed.file
  out.eaMatchId = f.eaMatchId
  out.gameTitle = f.gameTitle
  out.periods = f.periods.length

  if (
    opts.expectedEaMatchId !== undefined &&
    opts.expectedEaMatchId !== null &&
    opts.expectedEaMatchId !== f.eaMatchId
  ) {
    out.reason = `file name says match ${opts.expectedEaMatchId} but the content says ${f.eaMatchId}`
    return out
  }

  const sumFor = f.periods.reduce((n, p) => n + p.goalsFor, 0)
  const sumAgainst = f.periods.reduce((n, p) => n + p.goalsAgainst, 0)
  out.periodSum = `${String(sumFor)}-${String(sumAgainst)}`
  const shotsFor = f.periods.reduce((n, p) => n + p.shotsFor, 0)
  const shotsAgainst = f.periods.reduce((n, p) => n + p.shotsAgainst, 0)

  const { titleKnown, match } = await store.findMatch(f.gameTitle, f.eaMatchId)
  if (!titleKnown) {
    out.reason = `game title "${f.gameTitle}" is not in the database`
    return out
  }
  if (match === null) {
    out.reason = `no match ${f.eaMatchId} in ${f.gameTitle} (not ingested from EA yet?)`
    return out
  }
  out.matchId = match.id
  out.eaFinal = `${String(match.scoreFor)}-${String(match.scoreAgainst)}`
  out.shots = `${String(shotsFor)}-${String(shotsAgainst)} vs EA ${String(match.shotsFor)}-${String(match.shotsAgainst)}`

  // THE RULE: the period goals must add up to OUR database's EA final score.
  if (sumFor !== match.scoreFor || sumAgainst !== match.scoreAgainst) {
    out.reason = `period goals ${out.periodSum} do not add up to EA final ${out.eaFinal}`
    return out
  }
  // The file's own final must agree too (a file that contradicts itself is not trusted).
  if (f.finalFor !== sumFor || f.finalAgainst !== sumAgainst) {
    out.reason = `the file's own final ${String(f.finalFor)}-${String(f.finalAgainst)} differs from its period goals ${out.periodSum}`
    return out
  }

  // Warnings: never a gate.
  if (match.bgmWasHome !== null && match.bgmWasHome !== (f.ourSide === 'home')) {
    out.warnings.push(`our_side "${f.ourSide}" differs from EA home/away`)
  }
  for (const p of f.periods) {
    if (p.goalsFor > p.shotsFor || p.goalsAgainst > p.shotsAgainst) {
      out.warnings.push(`period ${String(p.period)}: more goals than shots`)
    }
  }
  if (f.goalListCounts !== null) {
    for (const p of f.periods) {
      const listFor = f.goalListCounts.filter(
        (g) => g.period === p.period && g.team === 'us',
      ).length
      const listAgainst = f.goalListCounts.filter(
        (g) => g.period === p.period && g.team === 'them',
      ).length
      if (listFor !== p.goalsFor || listAgainst !== p.goalsAgainst) {
        out.warnings.push(`period ${String(p.period)}: goal list differs from goal counts`)
      }
    }
  }
  if (match.result === 'DNF') out.warnings.push('EA result is DNF')

  const rows = toRowValues(f.periods)
  out.rows = rows
  const existing = await store.getEngineRows(match.id)
  if (existing.length > 0 && sameRows(existing, rows)) {
    out.action = 'unchanged'
    out.reason = 'already imported, same numbers'
    return out
  }
  out.action = existing.length === 0 ? 'insert' : 'replace'
  out.reason = opts.apply ? 'written' : 'would write (dry run)'
  if (opts.apply) {
    const res = await store.replaceEngineRows(match.id, rows)
    out.deleted = res.deleted
    out.inserted = res.inserted
  }
  return out
}

/** A folder entry, read from disk by the CLI (or built by a test). */
export interface FolderEntry {
  name: string
  /** Parsed JSON, or an error string when the file was not valid JSON. */
  json: { ok: true; value: unknown } | { ok: false; error: string }
}

/**
 * Process a whole folder. Two files for the same match are both refused (the engine
 * writes one file per match; two means something is wrong and the Lead should look).
 */
export async function importFolder(
  entries: readonly FolderEntry[],
  store: PeriodStore,
  opts: { apply: boolean },
): Promise<MatchOutcome[]> {
  const parsed = entries.map((e) => ({
    e,
    p: e.json.ok
      ? parseEnginePeriodsFile(e.json.value)
      : ({
          kind: 'invalid',
          errors: [`not valid JSON: ${e.json.error}`],
          eaMatchId: null,
        } as ParseResult),
  }))
  const keyOf = (p: ParseResult): string | null =>
    p.kind === 'ok'
      ? `${p.file.gameTitle}/${p.file.eaMatchId}`
      : p.kind === 'incomplete' && p.gameTitle !== null && p.eaMatchId !== null
        ? `${p.gameTitle}/${p.eaMatchId}`
        : null
  const counts = new Map<string, number>()
  for (const { p } of parsed) {
    const k = keyOf(p)
    if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const results: MatchOutcome[] = []
  for (const { e, p } of parsed) {
    const k = keyOf(p)
    if (k !== null && (counts.get(k) ?? 0) > 1) {
      const o = blank(e.name)
      o.eaMatchId =
        p.kind === 'ok' ? p.file.eaMatchId : p.kind === 'incomplete' ? p.eaMatchId : null
      o.gameTitle =
        p.kind === 'ok' ? p.file.gameTitle : p.kind === 'incomplete' ? p.gameTitle : null
      o.reason = `more than one file for ${k} in the folder`
      results.push(o)
      continue
    }
    const stem = e.name.replace(/\.json$/i, '')
    results.push(
      await processParsed(e.name, p, store, {
        apply: opts.apply,
        expectedEaMatchId: /^[0-9]+$/.test(stem) ? stem : null,
      }),
    )
  }
  return results
}

// ─── The table ────────────────────────────────────────────────────────────────

export function formatTable(outcomes: readonly MatchOutcome[]): string {
  const head = [
    'file',
    'match',
    'EA final',
    'period sum',
    'periods',
    'shots (info)',
    'action',
    'note',
  ]
  const body = outcomes.map((o) => [
    o.source,
    o.matchId === null ? '-' : String(o.matchId),
    o.eaFinal ?? '-',
    o.periodSum ?? '-',
    o.periods === null ? '-' : String(o.periods),
    o.shots ?? '-',
    o.action.toUpperCase(),
    [o.reason, ...o.warnings.map((w) => `warning: ${w}`)].filter((s) => s !== '').join(' | '),
  ])
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => (r[i] ?? '').length)))
  const line = (r: string[]) =>
    r
      .map((c, i) => c.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd()
  return [line(head), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n')
}

export function summarize(outcomes: readonly MatchOutcome[], apply: boolean): string {
  const n = (a: Action) => outcomes.filter((o) => o.action === a).length
  const verb = apply ? 'written' : 'would be written'
  return `${String(outcomes.length)} files: ${String(n('insert'))} new + ${String(n('replace'))} replaced ${verb}, ${String(n('unchanged'))} unchanged, ${String(n('skipped'))} skipped (not complete), ${String(n('refused'))} refused`
}
