import { desc, eq, sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import {
  REL_LABELS,
  REL_LEVELS,
  REL_MAX_POINTS,
  clampToRange,
  decayedPoints,
  dispositionOf,
  isNegative,
  leanOf,
  rangeOf,
  relLevelAt,
  relLevelOf,
  type RelLevel,
} from '../news/relationships.js'
import {
  newsPressBoxAudit,
  newsPressBoxRequests,
  type NewsPressBoxAuditRow,
  type NewsPressBoxRequestRow,
  type PressBoxAuditKind,
  type PressBoxRequestKind,
} from '../schema/news-press-box.js'
import type { NewsReporterId, PressHeat, PressHeatScope, PressLevel } from '../schema/index.js'
import { REPORTERS } from '../news/reporters.js'
import { MEMBER_CONDITION } from './club-members.js'

// Press Box queries (the admin page /admin/press-box, migration 0080, task press-box-l1).
// The pure rules (`effectiveLevel`, `planRelationshipAction`) carry the tests; the async functions
// run them inside one transaction together with the audit row, so a change and its log line are
// written together or not at all.

const num = (v: string | number): number => Number(v)
const toDate = (v: string | Date): Date => (v instanceof Date ? v : new Date(v))
const round2 = (n: number): number => Math.round(n * 100) / 100

/** The GM's reason for a pinned level: 1 to this many characters. */
export const OVERRIDE_REASON_MAX = 200

// ── Relationship rules (pure) ────────────────────────────────────────────────

/** The stored side of a relationship pair, as the rules read it. */
export interface RelationshipState {
  /** The signed total as of `lastEventAt` (not faded). */
  points: number
  lastEventAt: Date
  frozen: boolean
  overrideLevel: RelLevel | null
  overrideReason: string | null
}

/** The points a state shows at `now`: faded, unless frozen (a frozen pair does not fade). */
export function shownPoints(state: RelationshipState, now: Date): number {
  return state.frozen
    ? Math.max(-REL_MAX_POINTS, Math.min(REL_MAX_POINTS, state.points))
    : decayedPoints(state.points, state.lastEventAt, now)
}

/** The level the points give now (the reporter's lean and range applied), ignoring any pinned level. */
export function pointsLevel(
  state: RelationshipState,
  reporter: NewsReporterId,
  now: Date,
): RelLevel {
  if (!state.frozen) return relLevelAt(state, reporter, now)
  const total = Math.max(
    -REL_MAX_POINTS,
    Math.min(REL_MAX_POINTS, shownPoints(state, now) + leanOf(dispositionOf(reporter))),
  )
  return clampToRange(relLevelOf(total), rangeOf(reporter))
}

/**
 * The level the writers and askers see: the GM's pinned level when there is one, else the level the
 * points give. The press level ("Go easy") is applied by the readers afterwards, as before.
 */
export function effectiveLevel(
  state: RelationshipState,
  reporter: NewsReporterId,
  now: Date,
): RelLevel {
  return state.overrideLevel ?? pointsLevel(state, reporter, now)
}

/** The levels a reporter can be pinned to: inside his range (Father Rink never gets the feud side). */
export function allowedLevels(reporter: NewsReporterId): RelLevel[] {
  const { floor, ceiling } = rangeOf(reporter)
  const lo = REL_LEVELS.indexOf(floor)
  const hi = REL_LEVELS.indexOf(ceiling)
  return REL_LEVELS.filter((_, i) => i >= lo && i <= hi)
}

export type RelationshipAction =
  | { kind: 'cooldown' }
  | { kind: 'reset' }
  | { kind: 'freeze' }
  | { kind: 'unfreeze' }
  | { kind: 'level'; level: RelLevel; reason: string }
  | { kind: 'level_clear' }

export const RELATIONSHIP_ACTION_KINDS = [
  'cooldown',
  'reset',
  'freeze',
  'unfreeze',
  'level',
  'level_clear',
] as const

const AUDIT_KIND = {
  cooldown: 'relationship_cooldown',
  reset: 'relationship_reset',
  freeze: 'relationship_freeze',
  unfreeze: 'relationship_unfreeze',
  level: 'relationship_level',
  level_clear: 'relationship_level_clear',
} as const satisfies Record<RelationshipAction['kind'], PressBoxAuditKind>

/** Why an action was refused (the page shows its own text for each code). */
export const RELATIONSHIP_ERROR_CODES = [
  'out',
  'frozen',
  'zero',
  'already_frozen',
  'not_frozen',
  'no_reason',
  'reason_long',
  'bad_level',
  'range',
  'easy',
  'no_pin',
  'no_player',
] as const
export type RelationshipErrorCode = (typeof RELATIONSHIP_ERROR_CODES)[number]

export type RelationshipPlan =
  | { ok: false; code: RelationshipErrorCode; error: string }
  | {
      ok: true
      /** What the row holds after the action. */
      next: RelationshipState
      auditKind: PressBoxAuditKind
      /** The short before/after line for the change log (no message text). */
      summary: string
    }

const pts = (n: number): string => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1))
const show = (state: RelationshipState, reporter: NewsReporterId, now: Date): string => {
  const lvl = effectiveLevel(state, reporter, now)
  const pinned = state.overrideLevel === null ? '' : ', pinned'
  return `${REL_LABELS[lvl]} ${pts(shownPoints(state, now))}${pinned}${state.frozen ? ', frozen' : ''}`
}

/**
 * Plans one GM action on a pair. `state` is null when the pair has no row (points 0).
 * Pure: the caller writes `next` and the audit line in one transaction.
 *
 * Rules:
 * - cool down halves the (faded) points toward zero; reset sets them to zero; both need the pair
 *   not frozen and not already at zero;
 * - freeze keeps the points as they are now and stops both new points and fading; unfreeze lets
 *   them move again from now;
 * - set level pins the level the writers see (needs a reason, and a level inside the reporter's
 *   range); clearing it returns to the points' level;
 * - a "Go easy" player is never pinned to the feud side (the readers would ignore it), and a
 *   "Leave me out" player is never touched (nothing is stored for them).
 */
export function planRelationshipAction(args: {
  state: RelationshipState | null
  reporter: NewsReporterId
  pressLevel: PressLevel
  action: RelationshipAction
  now: Date
}): RelationshipPlan {
  const { reporter, pressLevel, action, now } = args
  if (pressLevel === 'out') {
    return {
      ok: false,
      code: 'out',
      error: 'This player is on Leave me out: nothing is stored for them.',
    }
  }
  const state: RelationshipState = args.state ?? {
    points: 0,
    lastEventAt: now,
    frozen: false,
    overrideLevel: null,
    overrideReason: null,
  }
  const before = show(state, reporter, now)
  const done = (next: RelationshipState): RelationshipPlan => ({
    ok: true,
    next,
    auditKind: AUDIT_KIND[action.kind],
    summary: `${before} -> ${show(next, reporter, now)}`,
  })
  const faded = shownPoints(state, now)

  switch (action.kind) {
    case 'cooldown':
    case 'reset': {
      if (state.frozen)
        return { ok: false, code: 'frozen', error: 'This pair is frozen. Unfreeze it first.' }
      if (Math.abs(faded) < 0.005)
        return { ok: false, code: 'zero', error: 'The points are already at zero.' }
      const points = action.kind === 'reset' ? 0 : round2(faded / 2)
      return done({ ...state, points, lastEventAt: now })
    }
    case 'freeze': {
      if (state.frozen)
        return { ok: false, code: 'already_frozen', error: 'This pair is already frozen.' }
      return done({ ...state, points: round2(faded), lastEventAt: now, frozen: true })
    }
    case 'unfreeze': {
      if (!state.frozen) return { ok: false, code: 'not_frozen', error: 'This pair is not frozen.' }
      return done({ ...state, lastEventAt: now, frozen: false })
    }
    case 'level': {
      const reason = action.reason.trim()
      if (reason === '')
        return { ok: false, code: 'no_reason', error: 'Write a reason for the change log.' }
      if (reason.length > OVERRIDE_REASON_MAX) {
        return {
          ok: false,
          code: 'reason_long',
          error: `The reason is longer than ${String(OVERRIDE_REASON_MAX)} characters.`,
        }
      }
      if (!(REL_LEVELS as readonly string[]).includes(action.level)) {
        return { ok: false, code: 'bad_level', error: 'That level does not exist.' }
      }
      if (!allowedLevels(reporter).includes(action.level)) {
        return { ok: false, code: 'range', error: 'That level is outside this reporter’s range.' }
      }
      if (pressLevel === 'easy' && isNegative(action.level)) {
        return {
          ok: false,
          code: 'easy',
          error: 'This player is on Go easy: the feud side is never used for them.',
        }
      }
      return done({ ...state, overrideLevel: action.level, overrideReason: reason })
    }
    case 'level_clear': {
      if (state.overrideLevel === null)
        return { ok: false, code: 'no_pin', error: 'No level is pinned.' }
      return done({ ...state, overrideLevel: null, overrideReason: null })
    }
  }
}

// ── Audit ────────────────────────────────────────────────────────────────────

/** Who made a change: the admin's player id (may be null) and the name shown in the log. */
export interface PressBoxActor {
  playerId: number | null
  name: string
}

export interface PressBoxAuditEntry {
  kind: PressBoxAuditKind
  target: string
  summary: string
}

export async function listPressBoxAudit(limit: number): Promise<NewsPressBoxAuditRow[]> {
  return db
    .select()
    .from(newsPressBoxAudit)
    .orderBy(desc(newsPressBoxAudit.at), desc(newsPressBoxAudit.id))
    .limit(Math.max(1, Math.min(200, limit)))
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function writeAudit(tx: Tx, actor: PressBoxActor, entry: PressBoxAuditEntry, at: Date) {
  await tx.insert(newsPressBoxAudit).values({
    at,
    actorPlayerId: actor.playerId,
    actorName: actor.name,
    kind: entry.kind,
    target: entry.target,
    summary: entry.summary,
  })
}

// ── Relationship actions (database) ──────────────────────────────────────────

type RawRelRow = {
  points: string | number
  last_event_at: Date | string
  frozen: boolean
  override_level: RelLevel | null
  override_reason: string | null
}

/** Locks the pair's row (when it exists) and the player's press level. */
export function lockRelationshipSql(playerId: number, reporter: NewsReporterId): SQL {
  return sql`
    select r.points, r.last_event_at, r.frozen, r.override_level, r.override_reason
    from news_press_relationships r
    where r.player_id = ${playerId} and r.reporter = ${reporter}
    for update`
}

export function upsertRelationshipStateSql(args: {
  playerId: number
  reporter: NewsReporterId
  next: RelationshipState
  at: Date
}): SQL {
  const at = args.at.toISOString()
  return sql`
    insert into news_press_relationships
      (player_id, reporter, points, last_event_at, updated_at, frozen, override_level, override_reason)
    values (${args.playerId}, ${args.reporter}, ${args.next.points}::numeric,
      ${args.next.lastEventAt.toISOString()}::timestamptz, ${at}::timestamptz, ${args.next.frozen},
      ${args.next.overrideLevel}, ${args.next.overrideReason})
    on conflict (player_id, reporter) do update set
      points = excluded.points,
      last_event_at = excluded.last_event_at,
      updated_at = excluded.updated_at,
      frozen = excluded.frozen,
      override_level = excluded.override_level,
      override_reason = excluded.override_reason`
}

export type RelationshipActionResult =
  | { ok: true; summary: string }
  | { ok: false; code: RelationshipErrorCode; error: string }

/**
 * Runs one GM action on a player-reporter pair and writes its audit line, in one transaction. The
 * pair's row is locked, so a press service point landing at the same moment waits.
 */
export async function applyRelationshipAction(args: {
  playerId: number
  reporter: NewsReporterId
  action: RelationshipAction
  actor: PressBoxActor
  now: Date
}): Promise<RelationshipActionResult> {
  return db.transaction(async (tx) => {
    const who = await tx.execute<{ name: string; press_level: PressLevel }>(sql`
      select coalesce(nullif(btrim(pp.player_name), ''), p.gamertag) as name,
        coalesce(pp.press_level, 'full') as press_level
      from players p left join player_profiles pp on pp.player_id = p.id
      where p.id = ${args.playerId}`)
    const player = who[0]
    if (player === undefined) return { ok: false, code: 'no_player', error: 'No such player.' }
    const rows = await tx.execute<RawRelRow>(lockRelationshipSql(args.playerId, args.reporter))
    const raw = rows[0]
    const state: RelationshipState | null =
      raw === undefined
        ? null
        : {
            points: num(raw.points),
            lastEventAt: toDate(raw.last_event_at),
            frozen: raw.frozen,
            overrideLevel: raw.override_level,
            overrideReason: raw.override_reason,
          }
    const plan = planRelationshipAction({
      state,
      reporter: args.reporter,
      pressLevel: player.press_level,
      action: args.action,
      now: args.now,
    })
    if (!plan.ok) return plan
    await tx.execute(
      upsertRelationshipStateSql({
        playerId: args.playerId,
        reporter: args.reporter,
        next: plan.next,
        at: args.now,
      }),
    )
    const reason = args.action.kind === 'level' ? ` (reason: ${args.action.reason.trim()})` : ''
    await writeAudit(
      tx,
      args.actor,
      {
        kind: plan.auditKind,
        target: `${player.name} x ${REPORTERS[args.reporter].name}`,
        summary: `${plan.summary}${reason}`,
      },
      args.now,
    )
    return { ok: true, summary: plan.summary }
  })
}

// ── Heat with its audit line ─────────────────────────────────────────────────

/** Sets the press heat and writes the audit line together (same write as `setHeat`). */
export async function setHeatWithAudit(args: {
  heat: PressHeat
  scope: PressHeatScope
  night: string | null
  actor: PressBoxActor
  now: Date
}): Promise<void> {
  const heatNight = args.scope === 'night' ? args.night : null
  await db.transaction(async (tx) => {
    const before = await tx.execute<{ heat: PressHeat; heat_scope: PressHeatScope }>(
      sql`select heat, heat_scope from news_press_settings where id = 1`,
    )
    await tx.execute(sql`
      insert into news_press_settings (id, heat, heat_scope, heat_night)
      values (1, ${args.heat}, ${args.scope}, ${heatNight})
      on conflict (id) do update
        set heat = excluded.heat, heat_scope = excluded.heat_scope,
          heat_night = excluded.heat_night, updated_at = now()`)
    const was = before[0] === undefined ? 'normal' : `${before[0].heat} (${before[0].heat_scope})`
    await writeAudit(
      tx,
      args.actor,
      {
        kind: 'heat',
        target: args.scope === 'next' ? 'next scrum' : 'tonight',
        summary: `${was} -> ${args.heat} (${args.scope})`,
      },
      args.now,
    )
  })
}

// ── Press settings for the page ──────────────────────────────────────────────

export interface PressBoxSettings {
  heat: PressHeat
  heatScope: PressHeatScope
  heatNight: string | null
  pressMode: 'trial' | 'live' | null
  pressSeenAt: Date | null
}

/**
 * The settings row for the page. Before migration 0080 is applied the two press columns do not
 * exist: the page still renders (mode unknown), as the other admin pages do for a missing table.
 */
export async function getPressBoxSettings(): Promise<PressBoxSettings> {
  const read = async (withPress: boolean) => {
    const rows = await db.execute<{
      heat: PressHeat
      heat_scope: PressHeatScope
      heat_night: string | null
      press_mode?: 'trial' | 'live' | null
      press_seen_at?: Date | string | null
    }>(
      withPress
        ? sql`select heat, heat_scope, heat_night, press_mode, press_seen_at from news_press_settings where id = 1`
        : sql`select heat, heat_scope, heat_night from news_press_settings where id = 1`,
    )
    return rows[0]
  }
  let row: Awaited<ReturnType<typeof read>>
  try {
    row = await read(true)
  } catch {
    row = await read(false)
  }
  return {
    heat: row?.heat ?? 'normal',
    heatScope: row?.heat_scope ?? 'night',
    heatNight: row?.heat_night ?? null,
    pressMode: row?.press_mode ?? null,
    pressSeenAt:
      row?.press_seen_at === undefined || row.press_seen_at === null
        ? null
        : toDate(row.press_seen_at),
  }
}

// ── Requests to the press service ────────────────────────────────────────────

/** Queues a request for the press service and writes the audit line. Returns the request id. */
export async function queuePressBoxRequest(args: {
  kind: PressBoxRequestKind
  actor: PressBoxActor
  now: Date
}): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(newsPressBoxRequests)
      .values({ kind: args.kind, requestedBy: args.actor.name, requestedAt: args.now })
      .returning({ id: newsPressBoxRequests.id })
    const id = rows[0]?.id
    if (id === undefined) throw new Error('queuePressBoxRequest: no row returned')
    await writeAudit(
      tx,
      args.actor,
      {
        kind: 'testscrum',
        target: 'press service',
        summary: `requested a free test scrum (request ${String(id)})`,
      },
      args.now,
    )
    return id
  })
}

/** True when a request of this kind is waiting or running (the page offers one at a time). */
export async function hasOpenPressBoxRequest(kind: PressBoxRequestKind): Promise<boolean> {
  const rows = await db.execute<{ n: string | number }>(sql`
    select count(*) as n from news_press_box_requests
    where kind = ${kind} and status in ('pending', 'running')`)
  return num(rows[0]?.n ?? 0) > 0
}

export async function listRecentPressBoxRequests(limit: number): Promise<NewsPressBoxRequestRow[]> {
  return db
    .select()
    .from(newsPressBoxRequests)
    .orderBy(desc(newsPressBoxRequests.id))
    .limit(Math.max(1, Math.min(20, limit)))
}

/**
 * The press service takes the oldest pending request (one at a time, atomically), marking it
 * running. Null when none waits.
 */
export function claimPressBoxRequestSql(): SQL {
  return sql`
    update news_press_box_requests r
    set status = 'running'
    where r.id = (
      select id from news_press_box_requests
      where status = 'pending' order by id limit 1
      for update skip locked)
    returning r.id, r.kind, r.requested_by`
}

export async function claimPressBoxRequest(): Promise<{
  id: number
  kind: PressBoxRequestKind
  requestedBy: string
} | null> {
  const rows = await db.execute<{
    id: string | number
    kind: PressBoxRequestKind
    requested_by: string
  }>(claimPressBoxRequestSql())
  const r = rows[0]
  return r === undefined ? null : { id: num(r.id), kind: r.kind, requestedBy: r.requested_by }
}

/** Writes the outcome of a request (a short private line; no message text). */
export async function finishPressBoxRequest(
  id: number,
  status: 'done' | 'failed',
  result: string,
  at: Date,
): Promise<void> {
  await db
    .update(newsPressBoxRequests)
    .set({ status, result: result.slice(0, 500), handledAt: at })
    .where(eq(newsPressBoxRequests.id, id))
}

/**
 * Requests left `running` by a press service that stopped mid-request are marked failed
 * (a test scrum is never retried: it may have posted).
 */
export async function failStuckPressBoxRequests(before: Date): Promise<number> {
  const rows = await db.execute<{ id: string | number }>(sql`
    update news_press_box_requests
    set status = 'failed', handled_at = now(), result = 'The press service stopped before it finished.'
    where status = 'running' and requested_at < ${before.toISOString()}::timestamptz
    returning id`)
  return rows.length
}

/** The press service reports its mode and that it is alive (every pass). */
export async function reportPressMode(mode: 'trial' | 'live', at: Date): Promise<void> {
  await db.execute(sql`
    insert into news_press_settings (id, press_mode, press_seen_at)
    values (1, ${mode}, ${at.toISOString()}::timestamptz)
    on conflict (id) do update
      set press_mode = excluded.press_mode, press_seen_at = excluded.press_seen_at`)
}

// ── Relationship board (read) ────────────────────────────────────────────────

export interface BoardPlayer {
  playerId: number
  name: string
  gamertag: string
  pressLevel: PressLevel
}

export interface BoardCell {
  playerId: number
  reporter: NewsReporterId
  /** Faded points (frozen pairs are not faded). */
  points: number
  /** The level the writers see (a pinned level wins). */
  level: RelLevel
  /** The level the points give, without the pin. */
  pointsLevel: RelLevel
  frozen: boolean
  overrideLevel: RelLevel | null
  overrideReason: string | null
  lastEventAt: Date
}

export function listBoardPlayersSql(): SQL {
  return sql`
    select p.id, coalesce(nullif(btrim(pp.player_name), ''), p.gamertag) as name, p.gamertag,
      coalesce(pp.press_level, 'full') as press_level
    from players p
    left join player_profiles pp on pp.player_id = p.id
    where p.ai_goalie_side is null
      and (${MEMBER_CONDITION}
        or exists (select 1 from news_press_relationships r where r.player_id = p.id))
    order by lower(p.gamertag), p.id`
}

export function listBoardCellsSql(): SQL {
  return sql`
    select r.player_id, r.reporter, r.points, r.last_event_at, r.frozen,
      r.override_level, r.override_reason
    from news_press_relationships r`
}

/** The same read before migration 0080 (no freeze or pin columns yet). */
export function listBoardCellsLegacySql(): SQL {
  return sql`
    select r.player_id, r.reporter, r.points, r.last_event_at, false as frozen,
      null::text as override_level, null::text as override_reason
    from news_press_relationships r`
}

type RawCell = {
  player_id: string | number
  reporter: NewsReporterId
  points: string | number
  last_event_at: Date | string
  frozen: boolean
  override_level: RelLevel | null
  override_reason: string | null
}

async function readCells() {
  try {
    return await db.execute<RawCell>(listBoardCellsSql())
  } catch {
    return await db.execute<RawCell>(listBoardCellsLegacySql())
  }
}

/**
 * The board: every club member (and anyone with a relationship row) and every stored pair with
 * its level now. Pairs not in `cells` are "none". "Leave me out" players are left off the board.
 */
export async function listRelationshipBoard(
  now: Date,
): Promise<{ players: BoardPlayer[]; cells: BoardCell[] }> {
  const [players, cells] = await Promise.all([
    db.execute<{ id: string | number; name: string; gamertag: string; press_level: PressLevel }>(
      listBoardPlayersSql(),
    ),
    readCells(),
  ])
  return {
    players: players
      .map((p) => ({
        playerId: num(p.id),
        name: p.name,
        gamertag: p.gamertag,
        pressLevel: p.press_level,
      }))
      .filter((p) => p.pressLevel !== 'out'),
    cells: cells.map((c): BoardCell => {
      const state: RelationshipState = {
        points: num(c.points),
        lastEventAt: toDate(c.last_event_at),
        frozen: c.frozen,
        overrideLevel: c.override_level,
        overrideReason: c.override_reason,
      }
      return {
        playerId: num(c.player_id),
        reporter: c.reporter,
        points: shownPoints(state, now),
        level: effectiveLevel(state, c.reporter, now),
        pointsLevel: pointsLevel(state, c.reporter, now),
        frozen: c.frozen,
        overrideLevel: c.override_level,
        overrideReason: c.override_reason,
        lastEventAt: state.lastEventAt,
      }
    }),
  }
}

// ── "Now" and storylines (read) ──────────────────────────────────────────────

export interface PressBoxNow {
  scrums: {
    id: number
    night: string
    reporter: NewsReporterId
    isTest: boolean
    openUntil: Date
    people: number
    done: number
  }[]
  interviews: {
    id: number
    name: string
    reporter: NewsReporterId
    status: 'offered' | 'active'
  }[]
  asks: { id: number; name: string; reporter: NewsReporterId | null; createdAt: Date }[]
}

export function listOpenScrumsSql(now: Date): SQL {
  return sql`
    select s.id, s.night, s.reporter, s.is_test, s.open_until,
      count(sp.id) as people,
      count(sp.id) filter (where sp.status in ('done', 'expired')) as done
    from news_scrums s
    left join news_scrum_people sp on sp.scrum_id = s.id
    where s.open_until > ${now.toISOString()}::timestamptz
    group by s.id
    order by s.open_until desc
    limit 10`
}

export function listOpenInterviewsSql(): SQL {
  return sql`
    select i.id, i.status, i.reporter,
      coalesce(nullif(btrim(pp.player_name), ''), p.gamertag, i.display_name, 'someone') as name
    from news_interviews i
    left join players p on p.id = i.player_id
    left join player_profiles pp on pp.player_id = i.player_id
    where i.status in ('offered', 'active')
    order by i.id desc
    limit 10`
}

export function listWaitingAsksSql(now: Date): SQL {
  return sql`
    select a.id, a.reporter, a.created_at,
      coalesce(nullif(btrim(pp.player_name), ''), p.gamertag, a.display_name, 'someone') as name
    from news_gm_asks a
    left join players p on p.id = a.player_id
    left join player_profiles pp on pp.player_id = a.player_id
    where a.status = 'active' and a.is_test = false
      and a.created_at > ${now.toISOString()}::timestamptz - interval '12 hours'
      and not exists (
        select 1 from news_scrum_people sp
        join news_scrums s on s.id = sp.scrum_id
        where s.match_id = a.match_id and sp.requested_by = 'gm'
          and (sp.player_id = a.player_id or sp.discord_user_id = a.discord_user_id))
    order by a.id desc
    limit 10`
}

/** Open scrums, open interviews and GM asks not yet turned into a scrum person. */
export async function getPressBoxNow(now: Date): Promise<PressBoxNow> {
  const [scrums, interviews, asks] = await Promise.all([
    db.execute<{
      id: string | number
      night: string
      reporter: NewsReporterId
      is_test: boolean
      open_until: Date | string
      people: string | number
      done: string | number
    }>(listOpenScrumsSql(now)),
    db.execute<{
      id: string | number
      status: 'offered' | 'active'
      reporter: NewsReporterId
      name: string
    }>(listOpenInterviewsSql()),
    db.execute<{
      id: string | number
      reporter: NewsReporterId | null
      created_at: Date | string
      name: string
    }>(listWaitingAsksSql(now)),
  ])
  return {
    scrums: scrums.map((s) => ({
      id: num(s.id),
      night: s.night,
      reporter: s.reporter,
      isTest: s.is_test,
      openUntil: toDate(s.open_until),
      people: num(s.people),
      done: num(s.done),
    })),
    interviews: interviews.map((i) => ({
      id: num(i.id),
      name: i.name,
      reporter: i.reporter,
      status: i.status,
    })),
    asks: asks.map((a) => ({
      id: num(a.id),
      name: a.name,
      reporter: a.reporter,
      createdAt: toDate(a.created_at),
    })),
  }
}

export interface PressBoxStoryline {
  threadKey: string
  stances: number
  reporters: number
  lastMovedAt: Date
}

export function listRecentStorylinesSql(now: Date, limit: number): SQL {
  return sql`
    select st.thread_key, count(*) as stances, count(distinct st.reporter) as reporters,
      max(st.created_at) as last_moved
    from news_stances st
    join news_items i on i.id = st.item_id
    where i.deleted_at is null and i.is_test = false
    group by st.thread_key
    having max(st.created_at) > ${now.toISOString()}::timestamptz - interval '14 days'
    order by count(*) desc, max(st.created_at) desc
    limit ${limit}`
}

/** Threads with a stance in the last 14 days, most stances first (read only until L3). */
export async function listRecentStorylines(now: Date, limit = 5): Promise<PressBoxStoryline[]> {
  const rows = await db.execute<{
    thread_key: string
    stances: string | number
    reporters: string | number
    last_moved: Date | string
  }>(listRecentStorylinesSql(now, Math.max(1, Math.min(20, limit))))
  return rows.map((r) => ({
    threadKey: r.thread_key,
    stances: num(r.stances),
    reporters: num(r.reporters),
    lastMovedAt: toDate(r.last_moved),
  }))
}

/** The newest match id (any title), the end point for the form and milestone reads. */
export async function getLatestMatchId(): Promise<number | null> {
  const rows = await db.execute<{ id: string | number }>(
    sql`select m.id from matches m order by m.played_at desc, m.id desc limit 1`,
  )
  return rows[0] === undefined ? null : num(rows[0].id)
}
