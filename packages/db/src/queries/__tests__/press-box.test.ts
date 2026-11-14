/**
 * Press Box rules and SQL shapes (task press-box-l1, migration 0080). No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/press-box.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import { newsPressBoxAudit, newsPressBoxRequests, newsPressSettings } from '../../schema/index.js'

process.env.DATABASE_URL = 'postgresql://news-test:unused@127.0.0.1:1/unused'

const q = await import('../press-box.js')
const dialect = new PgDialect()
const flat = (s: string) => s.replace(/\s+/g, ' ')
const NOW = new Date('2026-11-14T12:00:00Z')
const DAY = 86_400_000

const state = (over: Partial<import('../press-box.js').RelationshipState> = {}) => ({
  points: -8,
  lastEventAt: NOW,
  frozen: false,
  overrideLevel: null,
  overrideReason: null,
  ...over,
})

void test('effectiveLevel: the points give the level; a pinned level wins', () => {
  // Pettibone (disposition -2, lean -1): -8 + -1 = -9 -> feud (open war needs <= -10).
  assert.equal(q.effectiveLevel(state(), 'pettibone', NOW), 'feud')
  assert.equal(q.effectiveLevel(state({ overrideLevel: 'warm' }), 'pettibone', NOW), 'warm')
  assert.equal(q.pointsLevel(state({ overrideLevel: 'warm' }), 'pettibone', NOW), 'feud')
})

void test('a frozen pair does not fade; an unfrozen one halves in 7 days', () => {
  const later = new Date(NOW.getTime() + 7 * DAY)
  assert.equal(q.shownPoints(state({ frozen: true }), later), -8)
  assert.ok(Math.abs(q.shownPoints(state(), later) - -4) < 1e-9)
  assert.equal(q.pointsLevel(state({ frozen: true }), 'pettibone', later), 'feud')
})

void test('cool down halves the faded points and stamps now; reset zeroes them', () => {
  const at = new Date(NOW.getTime() + 7 * DAY)
  const cool = q.planRelationshipAction({
    state: state(),
    reporter: 'pettibone',
    pressLevel: 'full',
    action: { kind: 'cooldown' },
    now: at,
  })
  assert.ok(cool.ok)
  // -8 faded for 7 days = -4, halved = -2.
  assert.equal(cool.next.points, -2)
  assert.equal(cool.next.lastEventAt.getTime(), at.getTime())
  assert.equal(cool.auditKind, 'relationship_cooldown')
  assert.match(cool.summary, /feud -4\.0.* -> simmering -2\.0/)
  const reset = q.planRelationshipAction({
    state: state(),
    reporter: 'pettibone',
    pressLevel: 'full',
    action: { kind: 'reset' },
    now: NOW,
  })
  assert.ok(reset.ok)
  assert.equal(reset.next.points, 0)
  assert.equal(reset.auditKind, 'relationship_reset')
})

void test('cool down and reset: refused when frozen or already at zero', () => {
  for (const kind of ['cooldown', 'reset'] as const) {
    const frozen = q.planRelationshipAction({
      state: state({ frozen: true }),
      reporter: 'mercer',
      pressLevel: 'full',
      action: { kind },
      now: NOW,
    })
    assert.equal(frozen.ok, false)
    const none = q.planRelationshipAction({
      state: null,
      reporter: 'mercer',
      pressLevel: 'full',
      action: { kind },
      now: NOW,
    })
    assert.equal(none.ok, false)
  }
})

void test('freeze keeps the faded points as they are now; unfreeze lets them move again', () => {
  const at = new Date(NOW.getTime() + 7 * DAY)
  const frozen = q.planRelationshipAction({
    state: state(),
    reporter: 'mercer',
    pressLevel: 'full',
    action: { kind: 'freeze' },
    now: at,
  })
  assert.ok(frozen.ok)
  assert.equal(frozen.next.frozen, true)
  assert.equal(frozen.next.points, -4)
  assert.equal(frozen.auditKind, 'relationship_freeze')
  const again = q.planRelationshipAction({
    state: frozen.next,
    reporter: 'mercer',
    pressLevel: 'full',
    action: { kind: 'freeze' },
    now: at,
  })
  assert.equal(again.ok, false)
  const later = new Date(at.getTime() + 30 * DAY)
  const unfrozen = q.planRelationshipAction({
    state: frozen.next,
    reporter: 'mercer',
    pressLevel: 'full',
    action: { kind: 'unfreeze' },
    now: later,
  })
  assert.ok(unfrozen.ok)
  assert.equal(unfrozen.next.frozen, false)
  assert.equal(unfrozen.next.points, -4, 'points unchanged: they fade from the unfreeze on')
  assert.equal(unfrozen.next.lastEventAt.getTime(), later.getTime())
  assert.equal(unfrozen.auditKind, 'relationship_unfreeze')
  assert.equal(
    q.planRelationshipAction({
      state: state(),
      reporter: 'mercer',
      pressLevel: 'full',
      action: { kind: 'unfreeze' },
      now: NOW,
    }).ok,
    false,
  )
})

void test('freezing a pair with no row makes a frozen row at zero', () => {
  const plan = q.planRelationshipAction({
    state: null,
    reporter: 'vale',
    pressLevel: 'full',
    action: { kind: 'freeze' },
    now: NOW,
  })
  assert.ok(plan.ok)
  assert.deepEqual(
    { points: plan.next.points, frozen: plan.next.frozen },
    { points: 0, frozen: true },
  )
})

void test('set level: needs a reason, a level in the reporter range; clear returns to the points', () => {
  const set = (
    level: string,
    reason: string,
    reporter = 'vale' as const,
    pressLevel = 'full' as const,
  ) =>
    q.planRelationshipAction({
      state: null,
      reporter,
      pressLevel,
      action: { kind: 'level', level: level as never, reason },
      now: NOW,
    })
  const ok = set('glazing', ' playoffs run ')
  assert.ok(ok.ok)
  assert.equal(ok.next.overrideLevel, 'glazing')
  assert.equal(ok.next.overrideReason, 'playoffs run')
  assert.equal(ok.auditKind, 'relationship_level')
  assert.equal(set('glazing', '   ').ok, false, 'a reason is required')
  assert.equal(set('glazing', 'x'.repeat(q.OVERRIDE_REASON_MAX + 1)).ok, false)
  assert.equal(set('banana', 'x').ok, false)
  // Vale's range is feud..glazing: open war is outside it.
  assert.equal(set('war', 'x').ok, false)
  const cleared = q.planRelationshipAction({
    state: ok.next,
    reporter: 'vale',
    pressLevel: 'full',
    action: { kind: 'level_clear' },
    now: NOW,
  })
  assert.ok(cleared.ok)
  assert.equal(cleared.next.overrideLevel, null)
  assert.equal(cleared.next.overrideReason, null)
  assert.equal(cleared.auditKind, 'relationship_level_clear')
  assert.equal(
    q.planRelationshipAction({
      state: null,
      reporter: 'vale',
      pressLevel: 'full',
      action: { kind: 'level_clear' },
      now: NOW,
    }).ok,
    false,
  )
})

void test('Father Rink can never be pinned to the feud side (his floor is neutral)', () => {
  assert.deepEqual(q.allowedLevels('rink'), ['neutral', 'warm', 'fan', 'glazing'])
  for (const level of ['war', 'feud', 'simmering'] as const) {
    const plan = q.planRelationshipAction({
      state: null,
      reporter: 'rink',
      pressLevel: 'full',
      action: { kind: 'level', level, reason: 'try' },
      now: NOW,
    })
    assert.equal(plan.ok, false)
  }
})

void test('press levels: Go easy never gets the feud side; Leave me out is never touched', () => {
  const easy = q.planRelationshipAction({
    state: null,
    reporter: 'pettibone',
    pressLevel: 'easy',
    action: { kind: 'level', level: 'feud', reason: 'try' },
    now: NOW,
  })
  assert.equal(easy.ok, false)
  const easyPositive = q.planRelationshipAction({
    state: null,
    reporter: 'vale',
    pressLevel: 'easy',
    action: { kind: 'level', level: 'fan', reason: 'try' },
    now: NOW,
  })
  assert.ok(easyPositive.ok)
  for (const kind of ['cooldown', 'reset', 'freeze', 'unfreeze', 'level_clear'] as const) {
    assert.equal(
      q.planRelationshipAction({
        state: state(),
        reporter: 'vale',
        pressLevel: 'out',
        action: { kind },
        now: NOW,
      }).ok,
      false,
      kind,
    )
  }
})

void test('every action kind maps to an audit kind of its own', () => {
  const kinds = new Set<string>()
  for (const kind of q.RELATIONSHIP_ACTION_KINDS) {
    const action =
      kind === 'level' ? { kind, level: 'warm' as const, reason: 'r' } : ({ kind } as never)
    const plan = q.planRelationshipAction({
      state: state({
        frozen: kind === 'unfreeze',
        overrideLevel: kind === 'level_clear' ? 'warm' : null,
      }),
      reporter: 'vale',
      pressLevel: 'full',
      action,
      now: NOW,
    })
    assert.ok(plan.ok, kind)
    kinds.add(plan.auditKind)
  }
  assert.equal(kinds.size, q.RELATIONSHIP_ACTION_KINDS.length)
})

void test('upsertRelationshipStateSql writes all five state columns and the audit sits beside it', () => {
  const { sql: text, params } = dialect.sqlToQuery(
    q.upsertRelationshipStateSql({
      playerId: 4,
      reporter: 'mercer',
      next: state({ frozen: true, overrideLevel: 'feud', overrideReason: 'why' }),
      at: NOW,
    }),
  )
  const f = flat(text)
  assert.match(f, /insert into news_press_relationships/)
  assert.match(f, /on conflict \(player_id, reporter\) do update set/)
  for (const col of ['points', 'last_event_at', 'frozen', 'override_level', 'override_reason']) {
    assert.match(f, new RegExp(`${col} = excluded\\.${col}`))
  }
  assert.ok(params.includes('feud') && params.includes('why') && params.includes(true))
})

void test('lockRelationshipSql locks the pair; the claim skips locked rows', () => {
  const lock = flat(dialect.sqlToQuery(q.lockRelationshipSql(4, 'vale')).sql)
  assert.match(lock, /for update$/)
  const claim = flat(dialect.sqlToQuery(q.claimPressBoxRequestSql()).sql)
  assert.match(claim, /set status = 'running'/)
  assert.match(claim, /where status = 'pending' order by id limit 1 for update skip locked/)
})

void test('board and now queries read only what the page shows', () => {
  const players = flat(dialect.sqlToQuery(q.listBoardPlayersSql()).sql)
  assert.match(players, /p\.ai_goalie_side is null/)
  const cells = flat(dialect.sqlToQuery(q.listBoardCellsSql()).sql)
  assert.match(cells, /r\.frozen, r\.override_level, r\.override_reason/)
  const scrums = flat(dialect.sqlToQuery(q.listOpenScrumsSql(NOW)).sql)
  assert.match(scrums, /s\.open_until > \$1::timestamptz/)
  const asks = flat(dialect.sqlToQuery(q.listWaitingAsksSql(NOW)).sql)
  assert.match(asks, /a\.status = 'active' and a\.is_test = false/)
  const stories = flat(dialect.sqlToQuery(q.listRecentStorylinesSql(NOW, 5)).sql)
  assert.match(stories, /i\.deleted_at is null and i\.is_test = false/)
})

void test('schema: audit and request tables; the press settings carry the service mode', () => {
  const audit = getTableConfig(newsPressBoxAudit)
  assert.equal(audit.name, 'news_press_box_audit')
  assert.deepEqual(audit.columns.map((c) => c.name).sort(), [
    'actor_name',
    'actor_player_id',
    'at',
    'id',
    'kind',
    'summary',
    'target',
  ])
  const req = getTableConfig(newsPressBoxRequests)
  assert.deepEqual(req.checks.map((c) => c.name).sort(), [
    'news_press_box_requests_kind_check',
    'news_press_box_requests_status_check',
    // Release L2 (migration 0081): a profile or interview request names its person.
    'news_press_box_requests_target_check',
  ])
  const cols = getTableConfig(newsPressSettings).columns.map((c) => c.name)
  assert.ok(cols.includes('press_mode') && cols.includes('press_seen_at'))
})

void test('migration 0080: idempotent, rollback in the header, nothing destructive', () => {
  const file = readFileSync(
    new URL('../../../migrations/0080_press_box.sql', import.meta.url),
    'utf8',
  )
  const [header, body] = file.split('\nBEGIN;') as [string, string]
  assert.match(header, /ROLLBACK/)
  assert.match(header, /DROP TABLE IF EXISTS "news_press_box_audit"/)
  assert.match(header, /DROP COLUMN IF EXISTS "frozen"/)
  assert.match(body, /CREATE TABLE IF NOT EXISTS "news_press_box_audit"/)
  assert.match(body, /CREATE TABLE IF NOT EXISTS "news_press_box_requests"/)
  for (const col of ['frozen', 'override_level', 'override_reason']) {
    assert.match(body, new RegExp(`ADD COLUMN IF NOT EXISTS "${col}"`))
  }
  assert.match(body, /ADD COLUMN IF NOT EXISTS "press_mode"/)
  assert.match(body, /"frozen" boolean DEFAULT false NOT NULL/)
  // The body drops constraints only to re-add them by name; it never drops a table or a column.
  assert.doesNotMatch(body, /DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/)
})
