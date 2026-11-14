import test from 'node:test'
import assert from 'node:assert/strict'
import type { ReporterId } from '@eanhl/db/news'
import { escapeMarkdown } from '../message.ts'
import type { ModelCall } from '../news/writer.ts'
import { oct12Response } from '../news/test-fixtures.ts'
import type { PressConfig } from './config.ts'
import { fallbackPool } from './fallbacks.ts'
import { benchPort, member } from './bench-fakes.ts'
import { onAccept, onScrumCommand, onTalk } from './interactions.ts'
import { runPressPass } from './pass.ts'
import { onThreadMessage } from './replies.ts'
import { onGmTestScrum, type TestScrumOptions } from './test-scrum.ts'
import { isTestScrum } from './test-scrum-rules.ts'
import { GM, NOW, USER_A, USER_B, config, setup } from './test-fakes.ts'

/**
 * T8, `/gm testscrum`: a free test scrum in the bot test channel. The key promise: ZERO model
 * calls (a model that throws is never called, and the model screen never runs), and everything is
 * posted in the test channel only, also while PRESS_MODE=live.
 */

const TEST_CH = 'bot-test'
const GUILD_OK = true
/** Live mode: the game channel is `chel`, the test channel is another one. */
const live = { ...config('live'), testChannelId: TEST_CH, typedAnswers: true }
/** The fixture games, made six weeks old: a real recap of them would be closed for good. */
function oldResponse() {
  const res = oct12Response('game')
  const weeks = 42 * 24 * 3_600_000
  res.facts.games = res.facts.games.map((g) => ({
    ...g,
    playedAt: new Date(new Date(g.playedAt).getTime() - weeks).toISOString(),
  }))
  return res
}
const BENCH_USER = '200000000000000040'

const opts = (over: Partial<TestScrumOptions> = {}): TestScrumOptions => ({
  inGuild: GUILD_OK,
  game: null,
  players: [USER_A],
  bench: null,
  ...over,
})

/** A setup whose model and model screen throw if they are ever used. */
function freeSetup() {
  let modelCalls = 0
  let screenCalls = 0
  const model: ModelCall = () => {
    modelCalls++
    return Promise.reject(new Error('a test scrum must make no model call'))
  }
  const t = setup({
    response: oldResponse(),
    model,
    screen: () => {
      screenCalls++
      return Promise.reject(new Error('a test scrum must not use the model screen'))
    },
  })
  t.deps.bench = benchPort({
    members: { [BENCH_USER]: member({ nick: 'Joey' }) },
  })
  return {
    ...t,
    calls: () => ({ model: modelCalls, screen: screenCalls }),
  }
}

type T = ReturnType<typeof freeSetup>

/** Make the scrum, then run the pass (the people are due at once: no 60 s wait). */
async function made(t: T, o: Partial<TestScrumOptions> = {}) {
  const reply = await onGmTestScrum(t.deps, live, GM, opts(o))
  assert.equal(reply.kind, 'ephemeral')
  await runPressPass(t.deps, live)
  return reply
}

const ping = (t: T, userId: string) =>
  t.sent.find((s) => s.msg.content.includes(`<@${userId}>`) && s.msg.components !== undefined)!

// ── Who may run it, and where ───────────────────────────────────────────────

void test('private refusals: outside the guild, not the GM, no test channel, no store support, no game', async () => {
  const t = freeSetup()
  const refuse = async (
    who: string,
    o: Partial<TestScrumOptions>,
    cfg: PressConfig = live,
  ): Promise<string> => {
    const r = await onGmTestScrum(t.deps, cfg, who, opts(o))
    assert.equal(r.kind, 'ephemeral')
    return r.kind === 'ephemeral' ? r.text : ''
  }
  assert.match(await refuse(GM, { inGuild: false }), /only works in the server/)
  assert.match(await refuse(USER_A, {}), /Only the GM/)
  assert.match(await refuse(GM, {}, config('live')), /No test channel is set/)
  t.store.latestNight = null
  assert.match(await refuse(GM, {}), /No game found/)
  t.store.latestNight = '2026-10-12'
  assert.match(await refuse(GM, { game: 123 }), /No game 123 found/)
  // Nothing posted, nothing stored by any refusal.
  assert.equal(t.sent.length, 0)
  assert.equal(t.store.scrums.length, 0)
  assert.equal(t.store.items.length, 0)
  // A store without the test scrum methods (an old fake): fail closed, nothing posted.
  const bare = freeSetup()
  const store = Object.assign(Object.create(bare.store) as typeof bare.store, {
    insertTestRecapItem: undefined,
  })
  const r = await onGmTestScrum({ ...bare.deps, store }, live, GM, opts())
  assert.match(r.kind === 'ephemeral' ? r.text : '', /not available/)
  assert.equal(bare.sent.length, 0)
})

// ── The scrum itself ────────────────────────────────────────────────────────

void test('makes a test scrum on an old game: marked recap with the button, test channel only, open 60 minutes', async () => {
  const t = freeSetup()
  const reply = await onGmTestScrum(
    t.deps,
    live,
    GM,
    opts({ game: 90001, players: [USER_A, USER_B] }),
  )
  assert.equal(reply.kind, 'ephemeral')
  if (reply.kind === 'ephemeral') {
    assert.match(reply.text, /Test scrum made/)
    assert.match(reply.text, new RegExp(`<#${TEST_CH}>`))
    assert.match(reply.text, /No AI is used/)
  }
  // One post: the recap, in the test channel (never in the game channel `chel`).
  assert.equal(t.sent.length, 1)
  const recap = t.sent[0]!
  assert.equal(recap.channelId, TEST_CH)
  assert.match(recap.msg.content, /^\(test scrum\) /)
  assert.deepEqual(recap.msg.allowed_mentions, { parse: [] })
  const scrum = t.store.scrums[0]!
  const item = t.store.items.at(-1)!
  assert.match(JSON.stringify(recap.msg.components), new RegExp(`press:talk:${String(item.id)}`))
  assert.equal(scrum.recapItemId, item.id)
  assert.equal(scrum.channelId, TEST_CH)
  assert.equal(scrum.isTest, true)
  assert.equal(isTestScrum(scrum), true)
  assert.equal(scrum.matchId, 90001)
  // Open for 60 minutes from now, though the game is six weeks old.
  assert.equal(scrum.openUntil.getTime(), NOW.getTime() + 3_600_000)
  // The hidden item is never a recap or a feed post.
  assert.equal(item.isTest, true)
  assert.equal(item.isGameRecap, false)
  assert.notEqual(item.deletedAt, null)
  assert.equal(item.discordMessageId, null)
  // Both named people are in, like a GM request.
  assert.deepEqual(
    t.store.people.map((p) => [p.discordUserId, p.role, p.requestedBy, p.requestedByUserId]),
    [
      [USER_A, 'picked', 'gm', GM],
      [USER_B, 'picked', 'gm', GM],
    ],
  )
  assert.deepEqual(t.calls(), { model: 0, screen: 0 })
})

void test('the default game is the latest one, and the default person is the GM', async () => {
  const t = freeSetup()
  t.store.discordIds.set(1, GM)
  await onGmTestScrum(t.deps, live, GM, opts({ players: [] }))
  assert.equal(t.store.scrums[0]!.matchId, 90002)
  assert.deepEqual(
    t.store.people.map((p) => [p.playerId, p.discordUserId]),
    [[1, GM]],
  )
  // No age limit when looking for the latest game.
  assert.equal(t.store.latestNightSince[0]!.getTime(), 0)
})

void test('the pings go out at once, each person gets a thread of their own, in the test channel', async () => {
  const t = freeSetup()
  await made(t, { players: [USER_A, USER_B] })
  const pings = t.sent.slice(1)
  assert.equal(pings.length, 2)
  for (const p of pings) {
    assert.equal(p.channelId, TEST_CH)
    assert.match(p.msg.content, /^\(test scrum\) <@/)
    assert.equal(p.msg.message_reference?.message_id, t.store.scrums[0]!.messageId)
  }
  const a = t.store.people.find((p) => p.discordUserId === USER_A)!
  const b = t.store.people.find((p) => p.discordUserId === USER_B)!
  await onAccept(t.deps, live, a.id, USER_A)
  await onAccept(t.deps, live, b.id, USER_B)
  assert.deepEqual(
    t.threads.map((x) => [x.channelId, x.messageId, x.name]),
    [
      [TEST_CH, a.pingMessageId, 'Skater A — press scrum'],
      [TEST_CH, b.pingMessageId, 'Skater B — press scrum'],
    ],
  )
  assert.notEqual(a.pingMessageId, b.pingMessageId)
  // Nothing anywhere but the test channel; no model, no model screen.
  assert.ok(
    t.sent.every(
      (s) =>
        s.channelId === TEST_CH ||
        s.channelId === a.pingMessageId ||
        s.channelId === b.pingMessageId,
    ),
  )
  assert.ok(t.sent.every((s) => s.channelId !== 'chel'))
  assert.deepEqual(t.calls(), { model: 0, screen: 0 })
})

// ── The whole round: no AI at all ───────────────────────────────────────────

void test('a full round with typed answers: canned lines only, varied, no Answer button, zero model calls', async () => {
  const t = freeSetup()
  // The extras budget is spent: a real scrum would be off, a test scrum is free.
  t.store.spend = 1000
  await made(t, { game: 90001, players: [USER_A] })
  const a = t.store.people[0]!
  assert.deepEqual(await onAccept(t.deps, live, a.id, USER_A), { kind: 'ack' })
  const thread = a.pingMessageId!
  assert.equal(a.panel.length, 3)
  const said = (text: string, messageId: string) =>
    onThreadMessage(t.deps, live, { threadId: thread, userId: USER_A, text, messageId })
  let n = 0
  while (t.store.people[0]!.status === 'asking' && n++ < 20) {
    await said(`Answer number ${String(n)}.`, `typed-${String(n)}`)
  }
  assert.equal(t.store.people[0]!.status, 'done')
  const lines = t.sent.filter((s) => s.channelId === thread)
  assert.ok(lines.length >= 4, 'questions plus a closing')
  // Every line is a line of its reporter's fixed pools, addressed to the player, with no Answer button.
  for (const s of lines) {
    assert.equal(s.msg.components, undefined)
    const ok = (['question', 'followup', 'closing', 'ack'] as const).some((k) =>
      fallbackPool(k, s.reporter, 'Skater A').some(
        (l) => s.msg.content === `<@${USER_A}> ${escapeMarkdown(l)}`,
      ),
    )
    assert.ok(ok, `not a pool line: ${s.msg.content}`)
  }
  // Never the same line twice in the thread.
  const texts = lines.map((s) => s.msg.content)
  assert.equal(new Set(texts).size, texts.length)
  // The answers are stored as test and usable, and nothing was judged, screened or recorded.
  assert.equal(t.store.answerRows.length, n)
  assert.ok(t.store.answerRows.every((r) => r.isTest === true && r.usability === 'usable'))
  assert.deepEqual(t.calls(), { model: 0, screen: 0 })
  assert.equal(t.store.usage.length, 0)
  assert.equal(t.store.relRows.length, 0)
  assert.equal(t.modelCalls.length, 0)
})

void test('follow-ups come from the fixed pool when the round needs them (target above the panel)', async () => {
  const t = freeSetup()
  await made(t, { game: 90001, players: [USER_A] })
  const a = t.store.people[0]!
  await onAccept(t.deps, live, a.id, USER_A)
  // Force a round that needs 3 follow-ups: "must" after the first answer.
  a.targetTotal = 6
  const thread = a.pingMessageId!
  await onThreadMessage(t.deps, live, {
    threadId: thread,
    userId: USER_A,
    text: 'We took too many penalties.',
    messageId: 'typed-1',
  })
  const post = t.sent.at(-1)!
  const asker = post.reporter as ReporterId
  assert.ok(
    fallbackPool('followup', asker).some(
      (l) => post.msg.content === `<@${USER_A}> ${escapeMarkdown(l)}`,
    ),
    post.msg.content,
  )
  assert.equal(t.store.people[0]!.followupsAsked, 1)
  assert.deepEqual(t.calls(), { model: 0, screen: 0 })
})

void test('the screen is the code layer only: a slur gets no reaction, a rude word at a reporter is fine and gives no feud points', async () => {
  const t = freeSetup()
  await made(t, { game: 90001, players: [USER_A] })
  const a = t.store.people[0]!
  await onAccept(t.deps, live, a.id, USER_A)
  const thread = a.pingMessageId!
  const before = t.sent.length
  // A slur: off-limits by the slur list, nothing back, the question stays open.
  await onThreadMessage(t.deps, live, {
    threadId: thread,
    userId: USER_A,
    text: 'you are a nigger',
    messageId: 'm1',
  })
  assert.equal(t.sent.length, before)
  assert.equal(t.store.answerRows.length, 0)
  assert.equal(t.store.people[0]!.status, 'asking')
  // Rude at a reporter: it still answers (no model screen to say otherwise) and no feud points.
  await onThreadMessage(t.deps, live, {
    threadId: thread,
    userId: USER_A,
    text: 'gord ur an asshole',
    messageId: 'm2',
  })
  assert.equal(t.store.answerRows.length, 1)
  assert.equal(t.store.relRows.length, 0)
  assert.deepEqual(t.calls(), { model: 0, screen: 0 })
})

void test("another user's message and a non-answer insult or thanks in a test thread: ignored, no relationship points", async () => {
  const t = freeSetup()
  await made(t, { game: 90001, players: [USER_A] })
  const a = t.store.people[0]!
  await onAccept(t.deps, live, a.id, USER_A)
  const thread = a.pingMessageId!
  const before = t.sent.length
  await onThreadMessage(t.deps, live, {
    threadId: thread,
    userId: USER_B,
    text: 'gord ur an asshole',
    messageId: 'h1',
  })
  // The owner's insult with no question open: the feud check leaves a test thread alone.
  t.store.people[0]!.currentQuestion = null
  await onThreadMessage(t.deps, live, {
    threadId: thread,
    userId: USER_A,
    text: 'gord ur an asshole',
    messageId: 'h2',
  })
  // Thanks to a reporter: a test scrum moves nothing up either.
  await onThreadMessage(t.deps, live, {
    threadId: thread,
    userId: USER_A,
    text: 'thanks wade, good question',
    messageId: 'h3',
  })
  assert.equal(t.sent.length, before)
  assert.equal(t.store.answerRows.length, 0)
  assert.equal(t.store.relRows.length, 0)
})

void test('Talk to the press on the test recap: a volunteer round, free; a closed or no-game user is refused as usual', async () => {
  const t = freeSetup()
  t.store.spend = 1000
  await made(t, { game: 90001, players: [USER_A] })
  const itemId = t.store.scrums[0]!.recapItemId
  const before = t.sent.length
  assert.deepEqual(await onTalk(t.deps, live, itemId, USER_B), { kind: 'ack' })
  // The step-up line, then the first question: both in the test channel, then B's own thread.
  const [stepUp, question] = t.sent.slice(before)
  assert.equal(stepUp!.channelId, TEST_CH)
  assert.match(stepUp!.msg.content, new RegExp(`^<@${USER_B}> `))
  assert.equal(question!.channelId, `sent-${String(before + 1)}`)
  assert.ok(
    fallbackPool('question', question!.reporter, 'Skater B').some(
      (l) => question!.msg.content === `<@${USER_B}> ${escapeMarkdown(l)}`,
    ),
  )
  // After the hour the button says the press has left.
  t.deps.now = () => new Date(NOW.getTime() + 3_600_001)
  const late = await onTalk(t.deps, live, itemId, USER_A)
  assert.equal(late.kind === 'ephemeral' && /left/.test(late.text), true)
  assert.deepEqual(t.calls(), { model: 0, screen: 0 })
})

// ── The bench ───────────────────────────────────────────────────────────────

void test('the bench: a user who did not play, and the bench option, take the bench path with bench questions', async () => {
  const t = freeSetup()
  const reply = await made(t, { game: 90001, players: [], bench: BENCH_USER })
  assert.match(reply.kind === 'ephemeral' ? reply.text : '', /Joey \(bench\)/)
  const p = t.store.people[0]!
  assert.equal(p.personRole, 'bench')
  assert.equal(p.playerId, null)
  assert.equal(p.displayName, 'Joey')
  await onAccept(t.deps, live, p.id, BENCH_USER)
  const q = t.sent.at(-1)!
  assert.ok(
    fallbackPool('question', q.reporter, 'Joey', 'bench').some(
      (l) => q.msg.content === `<@${BENCH_USER}> ${escapeMarkdown(l)}`,
    ),
    q.msg.content,
  )
  assert.deepEqual(t.calls(), { model: 0, screen: 0 })
})

void test('a named player who did not play is asked as bench; an unknown user and a "Leave me out" player are not added', async () => {
  const t = freeSetup()
  // Player 3 is linked but not on the roster list of the game's candidates once removed.
  t.store.discordIds.set(4, '200000000000000044')
  const r = await onGmTestScrum(
    t.deps,
    live,
    GM,
    opts({ game: 90001, players: [USER_A, '200000000000000044', '200000000000000099'] }),
  )
  assert.equal(r.kind, 'ephemeral')
  const text = r.kind === 'ephemeral' ? r.text : ''
  // Hidden Hank (player 4) is "Leave me out"; the unknown user cannot be found.
  assert.match(
    text,
    /Not added: <@200000000000000044> is on Leave me out; <@200000000000000099> cannot be found/,
  )
  assert.equal(t.store.people.length, 1)
  assert.equal(t.store.people[0]!.discordUserId, USER_A)
  // Nobody can be asked: nothing is posted at all.
  const t2 = freeSetup()
  const none = await onGmTestScrum(t2.deps, live, GM, opts({ players: ['200000000000000099'] }))
  assert.match(none.kind === 'ephemeral' ? none.text : '', /nobody can be asked/)
  assert.equal(t2.sent.length, 0)
  assert.equal(t2.store.items.length, 0)
})

// ── Failure and isolation ───────────────────────────────────────────────────

void test('a failed post removes the hidden item and makes no scrum', async () => {
  const t = freeSetup()
  t.failSendWhen(() => true)
  const r = await onGmTestScrum(t.deps, live, GM, opts())
  assert.match(r.kind === 'ephemeral' ? r.text : '', /could not be made/)
  assert.equal(t.store.items.length, 0)
  assert.equal(t.store.scrums.length, 0)
})

void test('a real scrum is not touched: /scrum does not pick a test scrum, and a real recap pass makes its own scrum', async () => {
  const t = freeSetup()
  await made(t, { game: 90001, players: [USER_A] })
  assert.equal(t.store.scrums.length, 1)
  assert.equal(isTestScrum({ isTest: true, buzzLevel: 'big' }), false)
  assert.equal(isTestScrum({ isTest: false, buzzLevel: 'testscrum' }), false)
  // The hidden item is not a recap item without a scrum: the timer pass makes nothing new from it.
  const scrums = t.store.scrums.length
  await runPressPass(t.deps, live)
  assert.equal(t.store.scrums.length, scrums)
  // `/scrum` in live mode only sees real scrums: nothing to talk to here.
  const r = await onScrumCommand(t.deps, live, USER_A, { player: null, random: false })
  assert.equal(r.kind, 'ephemeral')
})
