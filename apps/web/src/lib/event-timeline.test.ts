/**
 * Unit tests for the event-timeline data layer. Pure functions, no React/DOM.
 *
 * Tested hardest: chronological order under the countdown clock (larger
 * remaining = earlier), and the completeness gate — a timeline holding fewer
 * goals than the real score must not name a game-winner or imply it told the
 * whole story.
 *
 * Run: node --test apps/web/src/lib/event-timeline.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTimeline,
  clockToSeconds,
  isStoryEvent,
  leadChangeLabel,
  periodCountLabel,
  periodHeadline,
  sideOf,
  sortChronologically,
  toElapsedClock,
  type TimelineEvent,
} from './event-timeline.ts'

/** Indexed access with a real assertion — the web tsconfig sets noUncheckedIndexedAccess. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index]
  assert.ok(item, `expected an item at index ${String(index)}`)
  return item
}

let nextId = 1

function goal(periodNumber: number, clock: string, side: 'for' | 'against'): TimelineEvent {
  return { id: nextId++, periodNumber, clock, eventType: 'goal', teamSide: side }
}

function penalty(periodNumber: number, clock: string, side: 'for' | 'against'): TimelineEvent {
  return { id: nextId++, periodNumber, clock, eventType: 'penalty', teamSide: side }
}

// ─── Clock ──────────────────────────────────────────────────────────────────

void test('clockToSeconds parses MM:SS remaining; junk reads as period end', () => {
  assert.equal(clockToSeconds('13:41'), 821)
  assert.equal(clockToSeconds('0:52'), 52)
  assert.equal(clockToSeconds(null), 0)
  assert.equal(clockToSeconds('--:--'), 0)
})

void test('toElapsedClock converts the countdown to the record-book time of goal', () => {
  assert.equal(toElapsedClock('13:41'), '06:19')
  assert.equal(toElapsedClock('20:00'), '00:00')
  assert.equal(toElapsedClock('0:00'), '20:00')
  assert.equal(toElapsedClock(null), null)
})

void test('toElapsedClock passes through a clock it cannot place in a period', () => {
  // 24:10 remaining is longer than a period — pass it through rather than
  // rendering a negative elapsed mark.
  assert.equal(toElapsedClock('24:10'), '24:10')
})

// ─── Ordering ───────────────────────────────────────────────────────────────

void test('sortChronologically orders by period, then by remaining clock descending', () => {
  const a = goal(3, '11:25', 'against')
  const b = goal(2, '5:07', 'for')
  const c = goal(3, '0:52', 'against')
  const d = goal(2, '13:41', 'for')
  const order = sortChronologically([a, b, c, d]).map((e) => e.id)
  assert.deepEqual(order, [d.id, b.id, a.id, c.id])
})

void test('isStoryEvent keeps goals and penalties, drops the rest', () => {
  assert.equal(isStoryEvent({ eventType: 'goal' }), true)
  assert.equal(isStoryEvent({ eventType: 'penalty' }), true)
  assert.equal(isStoryEvent({ eventType: 'shot' }), false)
  assert.equal(isStoryEvent({ eventType: 'faceoff' }), false)
})

void test('sideOf is BGM-relative', () => {
  assert.equal(sideOf('for'), 'bgm')
  assert.equal(sideOf('against'), 'opp')
  assert.equal(sideOf(null), 'opp')
})

// ─── Labels ─────────────────────────────────────────────────────────────────

void test('periodHeadline derives from the number, including OT (never a shootout)', () => {
  assert.equal(periodHeadline(1), '1ST PERIOD')
  assert.equal(periodHeadline(3), '3RD PERIOD')
  assert.equal(periodHeadline(4), 'OT')
  assert.equal(periodHeadline(6), 'OT3')
})

void test('periodCountLabel mentions penalties only when there are some', () => {
  assert.equal(periodCountLabel(0, 0), 'NO GOALS')
  assert.equal(periodCountLabel(1, 0), '1 GOAL')
  assert.equal(periodCountLabel(3, 0), '3 GOALS')
  assert.equal(periodCountLabel(0, 2), 'NO GOALS · 2 PEN')
  assert.equal(periodCountLabel(2, 1), '2 GOALS · 1 PEN')
})

// ─── Model: match 250 (the OCR pilot) ───────────────────────────────────────

/** Match 250's real story: 4–3 BGM, GWG in OT. */
function match250(): TimelineEvent[] {
  return [
    goal(2, '13:41', 'for'),
    goal(2, '5:07', 'for'),
    goal(3, '11:25', 'against'),
    goal(3, '6:02', 'for'),
    goal(3, '1:09', 'against'),
    goal(3, '0:52', 'against'),
    goal(4, '2:37', 'for'),
  ]
}

void test('buildTimeline spans every period from the 1st through the highest seen', () => {
  const model = buildTimeline(match250(), { for: 4, against: 3 })
  assert.deepEqual(
    model.periods.map((p) => p.label),
    ['1ST PERIOD', '2ND PERIOD', '3RD PERIOD', 'OT'],
  )
  // The scoreless 1st gets a divider with no rows — not fabricated, just empty.
  assert.equal(at(model.periods, 0).rows.length, 0)
  assert.equal(at(model.periods, 0).goals, 0)
  assert.equal(at(model.periods, 2).goals, 4)
})

void test('buildTimeline never invents a period beyond the highest one seen', () => {
  const model = buildTimeline([goal(1, '10:00', 'for')], { for: 1, against: 0 })
  assert.equal(model.periods.length, 1)
})

void test('running score follows chronological order, not input order', () => {
  const events = match250()
  const shuffled = [6, 2, 0, 5, 3, 1, 4].map((i) => at(events, i))
  const model = buildTimeline(shuffled, { for: 4, against: 3 })
  const inOrder = sortChronologically(events).map((e) => {
    const ctx = model.goalContext.get(e.id)
    assert.ok(ctx)
    return `${String(ctx.bgmAfter)}-${String(ctx.oppAfter)}`
  })
  assert.deepEqual(inOrder, ['1-0', '2-0', '2-1', '3-1', '3-2', '3-3', '4-3'])
})

void test('goal numbers count per side, not overall', () => {
  // The DB's `goal_number_in_game` is unreliable (repeats within a match, and
  // is null on some rows), so the "#N" in "GOAL · BGM #2" is derived here.
  const events = match250()
  const model = buildTimeline(events, { for: 4, against: 3 })
  const perSide = sortChronologically(events).map((e) => {
    const ctx = model.goalContext.get(e.id)
    assert.ok(ctx)
    return `${ctx.scoredBy}#${String(ctx.goalNumberForSide)}`
  })
  assert.deepEqual(perSide, ['bgm#1', 'bgm#2', 'opp#1', 'bgm#3', 'opp#2', 'opp#3', 'bgm#4'])
  assert.equal(model.goalCount, 7)
})

void test('the OT winner is the game-winning goal', () => {
  const events = match250()
  const model = buildTimeline(events, { for: 4, against: 3 })
  const winners = events.filter((e) => model.goalContext.get(e.id)?.isGameWinner)
  assert.equal(winners.length, 1)
  assert.equal(at(winners, 0).periodNumber, 4)
})

void test('final is the real score, and a whole story reports itself complete', () => {
  const model = buildTimeline(match250(), { for: 4, against: 3 })
  assert.deepEqual(model.final, {
    bgm: 4,
    opp: 3,
    winner: 'bgm',
    countedBgm: 4,
    countedOpp: 3,
    complete: true,
  })
})

// ─── Model: incomplete + degraded ───────────────────────────────────────────

void test('a timeline missing goals is incomplete and names no game-winner', () => {
  // OCR caught 3 of BGM's 4; the real score still comes from EA.
  const partial = match250().filter((_, i) => i !== 6)
  const model = buildTimeline(partial, { for: 4, against: 3 })
  assert.equal(model.final.complete, false)
  assert.equal(model.final.bgm, 4)
  assert.equal(model.final.countedBgm, 3)
  assert.equal(
    [...model.goalContext.values()].some((c) => c.isGameWinner),
    false,
  )
})

void test('an empty event set yields an empty model that still knows the score', () => {
  const model = buildTimeline([], { for: 5, against: 1 })
  assert.equal(model.isEmpty, true)
  assert.deepEqual(model.periods, [])
  assert.equal(model.goalCount, 0)
  assert.equal(model.final.bgm, 5)
  assert.equal(model.final.complete, false)
})

void test('a real 0-0 tie reads as complete with no winner', () => {
  const model = buildTimeline([penalty(2, '10:00', 'for')], { for: 0, against: 0 })
  assert.equal(model.final.complete, true)
  assert.equal(model.final.winner, null)
  assert.equal(model.isEmpty, false)
  assert.equal(model.penaltyCount, 1)
})

void test('penalties count toward periods and totals without touching the score', () => {
  const events = [goal(1, '12:00', 'for'), penalty(1, '8:00', 'against'), penalty(2, '4:00', 'for')]
  const model = buildTimeline(events, { for: 1, against: 0 })
  assert.equal(model.goalCount, 1)
  assert.equal(model.penaltyCount, 2)
  assert.equal(at(model.periods, 0).goals, 1)
  assert.equal(at(model.periods, 0).penalties, 1)
  assert.equal(at(model.periods, 1).goals, 0)
  assert.equal(at(model.periods, 1).penalties, 1)
  assert.equal(model.final.complete, true)
})

// ─── Lead-change captions ───────────────────────────────────────────────────

function ctxOf(events: TimelineEvent[], index: number, score: { for: number; against: number }) {
  const model = buildTimeline(events, score)
  const ordered = sortChronologically(events.filter((e) => e.eventType === 'goal'))
  const ctx = model.goalContext.get(at(ordered, index).id)
  assert.ok(ctx)
  return ctx
}

void test('lead-change captions describe the swing', () => {
  const events = match250()
  const score = { for: 4, against: 3 }
  assert.equal(leadChangeLabel(ctxOf(events, 0, score), '4L'), '↑ BGM TAKES LEAD')
  assert.equal(leadChangeLabel(ctxOf(events, 1, score), '4L'), '↑ BGM +2 LEAD')
  assert.equal(leadChangeLabel(ctxOf(events, 2, score), '4L'), '4L CLOSES')
  assert.equal(leadChangeLabel(ctxOf(events, 5, score), '4L'), '— TIED')
  assert.equal(leadChangeLabel(ctxOf(events, 6, score), '4L'), '↑ BGM WINS')
})

void test('regaining the lead reads differently from taking it', () => {
  // BGM leads, gives it up, then goes back in front. A lead only ever changes
  // hands through a tie, so "regains" has to be decided from who led earlier —
  // never from a leader-to-leader flip, which cannot happen.
  const events = [
    goal(1, '15:00', 'for'),
    goal(1, '10:00', 'against'),
    goal(2, '10:00', 'against'),
    goal(3, '10:00', 'for'),
    goal(3, '5:00', 'for'),
  ]
  const score = { for: 3, against: 2 }
  assert.equal(leadChangeLabel(ctxOf(events, 0, score), 'NA'), '↑ BGM TAKES LEAD')
  assert.equal(leadChangeLabel(ctxOf(events, 2, score), 'NA'), '↑ NA TAKES LEAD')
  assert.equal(leadChangeLabel(ctxOf(events, 3, score), 'NA'), '— TIED')
  assert.equal(leadChangeLabel(ctxOf(events, 4, score), 'NA'), '↑ BGM REGAINS LEAD')
})

void test('an OT goal only says WINS when it is the confirmed game-winner', () => {
  // Same OT goal, but the timeline is missing one of 4L's regulation goals —
  // no winner can be named, so the caption falls back to the lead move.
  const partial = match250().filter((_, i) => i !== 4)
  const model = buildTimeline(partial, { for: 4, against: 3 })
  const otGoal = sortChronologically(partial).at(-1)
  assert.ok(otGoal)
  const ctx = model.goalContext.get(otGoal.id)
  assert.ok(ctx)
  assert.equal(ctx.isOt, true)
  assert.equal(ctx.isGameWinner, false)
  assert.equal(leadChangeLabel(ctx, '4L'), '↑ BGM +2 LEAD')
})
