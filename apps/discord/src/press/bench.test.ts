import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { REPORTERS } from '@eanhl/db/news'
import { oct12Response } from '../news/test-fixtures.ts'
import { pressRoomBlock } from '../news/prompts.ts'
import { pressForSheet, quoteSpeaker } from '../news/press-material.ts'
import {
  BENCH_WINDOW_AFTER_MS,
  VoiceTracker,
  benchForGame,
  benchGameOf,
  callLine,
  memberDirectory,
  nameBench,
  personColumns,
  setProcessBench,
} from './bench.ts'
import { snapshotOfCache, voiceFromRaw } from './bench-gateway.ts'
import {
  BOT,
  CALL,
  COACH,
  JOEY,
  LURKER,
  OTHER_CALL,
  OUTLIER,
  WATCHER,
  benchPort,
  member,
} from './bench-fakes.ts'
import { CHEL_ROLE_ID, loadPressConfig, parseUserIdList } from './config.ts'
import { fallbackPool } from './fallbacks.ts'
import { onGmAsk, onGmNote } from './gm.ts'
import { interviewModel, interviewSetup } from './interview-fakes.ts'
import { fallbackInterviewQuestion } from './interview-rules.ts'
import { onGmInterview, onInterviewAccept, onInterviewAnswerSubmit } from './interview.ts'
import { onAccept, onAnswerSubmit, onScrumCommand, onTalk } from './interactions.ts'
import { runPressPass } from './pass.ts'
import {
  GM,
  NAMES,
  NIGHT,
  NOW,
  USER_A,
  USER_B,
  config,
  liveRecap,
  setup,
  type FakeStore,
} from './test-fakes.ts'

const ephemeral = (text: string) => ({ kind: 'ephemeral', text })
/** The fixture game 90001 ends at 02:15 UTC; its players have USER_A and USER_B. */
const GAME_END = new Date('2026-10-13T02:15:00.000Z')
const USER_C = '200000000000000003'
const OTHER = '200000000000000015'

const cfg = (): ReturnType<typeof config> => ({
  ...config('live'),
  coachUserIds: [COACH],
  benchRoleId: CHEL_ROLE_ID,
})

/** Joey (player 5, a known player who did not play) and "Outlier" (player 6, Leave me out). */
function withKnownPeople(store: FakeStore): void {
  NAMES.set(5, 'Joey Flopfish')
  NAMES.set(6, 'Outlier')
  store.discordIds.set(5, JOEY)
  store.discordIds.set(6, OUTLIER)
  store.roster.push(
    { playerId: 5, name: 'Joey Flopfish', gamertag: 'joeyf', pressLevel: 'full', aliases: [] },
    { playerId: 6, name: 'Outlier', gamertag: 'outlier', pressLevel: 'out', aliases: [] },
  )
}

const MEMBERS = {
  [JOEY]: member({ nick: 'Joey', username: 'joey' }),
  [COACH]: member({ nick: 'Mike', username: 'mike_coach' }),
  [WATCHER]: member({ nick: 'Wally', username: 'wally' }),
  [LURKER]: member({ username: 'lurker', roles: [] }),
  [BOT]: member({ username: 'somebot', bot: true }),
  [OUTLIER]: member({ nick: 'Outlier' }),
  [OTHER]: member({ nick: 'Elsewhere' }),
}

/** Everyone in the call with the game's players (USER_A, USER_B). */
const CALL_STAYS = [USER_A, USER_B, JOEY, COACH, WATCHER, LURKER, BOT, OUTLIER].map((userId) => ({
  userId,
  channelId: CALL,
}))

type Setup = ReturnType<typeof setup>

function benchSetup(
  opts: { stays?: Parameters<typeof benchPort>[0]['stays']; model?: never } = {},
) {
  const t = setup({ response: oct12Response('night') })
  withKnownPeople(t.store)
  const port = benchPort({ stays: opts.stays ?? CALL_STAYS, members: MEMBERS })
  t.deps.bench = port
  return { t, port }
}

async function game90001(t: Setup) {
  const res = await t.deps.fetchFacts('night', NIGHT)
  return res.facts.games.find((g) => g.matchId === 90001)!
}

// ── Who is on the bench ─────────────────────────────────────────────────────

void test('bench: same voice channel as the players, Chel role, did not play, no bot, not Leave me out', async () => {
  const { t, port } = benchSetup({
    stays: [
      ...CALL_STAYS,
      // In another channel the whole time: not with the game's players.
      { userId: OTHER, channelId: OTHER_CALL },
      // Left long before the game ended: not around its end.
      {
        userId: '200000000000000016',
        channelId: CALL,
        since: new Date('2026-10-13T00:00:00.000Z'),
        until: new Date('2026-10-13T00:30:00.000Z'),
      },
    ],
  })
  const result = await benchForGame(t.deps, cfg(), await benchGameOf(t.store, await game90001(t)))
  assert.equal(result.available, true)
  assert.deepEqual(
    result.people.map((p) => [p.userId, p.name, p.role, p.playerId]),
    [
      [JOEY, 'Joey Flopfish', 'bench', 5],
      [COACH, 'Coach Mike', 'coach', null],
      [WATCHER, 'Wally', 'bench', null],
    ],
  )
  // Never the players of the game, never a bot, never someone without the role, never "Leave me out".
  const ids = result.people.map((p) => p.userId)
  for (const no of [USER_A, USER_B, BOT, LURKER, OUTLIER, OTHER]) assert.ok(!ids.includes(no), no)
  assert.equal(port.lookups.includes(USER_A), false, 'a player is never looked up')
})

void test('bench: the window runs from 20 minutes before the game end to 30 minutes after it', async () => {
  const end = GAME_END.getTime()
  const at = (ms: number) => new Date(end + ms)
  const { t } = benchSetup({
    stays: [
      { userId: USER_A, channelId: CALL },
      // Joined 10 minutes after the game ended: counts.
      { userId: JOEY, channelId: CALL, since: at(10 * 60_000) },
      // Joined after the window: does not count.
      { userId: WATCHER, channelId: CALL, since: at(BENCH_WINDOW_AFTER_MS + 60_000) },
      // Left 10 minutes before the end: counts (the window starts 20 minutes before).
      { userId: COACH, channelId: CALL, since: at(-3_600_000), until: at(-10 * 60_000) },
    ],
  })
  const result = await benchForGame(t.deps, cfg(), await benchGameOf(t.store, await game90001(t)))
  assert.deepEqual(result.people.map((p) => p.userId).sort(), [JOEY, COACH].sort())
})

void test('bench: a "Go easy" player keeps their level; nobody is on the bench when no player was in a call', async () => {
  const { t } = benchSetup({ stays: [{ userId: JOEY, channelId: CALL }] })
  t.store.roster.find((r) => r.playerId === 5)!.pressLevel = 'easy'
  const game = await benchGameOf(t.store, await game90001(t))
  // Nobody of the game's players is in the call: the call is not theirs.
  assert.deepEqual((await benchForGame(t.deps, cfg(), game)).people, [])
  const both = benchPort({
    stays: [
      { userId: USER_A, channelId: CALL },
      { userId: JOEY, channelId: CALL },
    ],
    members: MEMBERS,
  })
  t.deps.bench = both
  const result = await benchForGame(t.deps, cfg(), game)
  assert.equal(result.people[0]!.pressLevel, 'easy')
})

void test('bench: no voice data (port absent or not ready) = the call check is unavailable', async () => {
  const { t } = benchSetup()
  const game = await benchGameOf(t.store, await game90001(t))
  t.deps.bench = benchPort({ available: false, members: MEMBERS })
  assert.deepEqual(await benchForGame(t.deps, cfg(), game), { available: false, people: [] })
  delete t.deps.bench
  assert.deepEqual(await benchForGame(t.deps, cfg(), game), { available: false, people: [] })
  assert.equal(
    callLine({ available: false, people: [] }),
    'Call check unavailable: no voice data yet.',
  )
  assert.equal(callLine({ available: true, people: [] }), 'In the call, not playing: nobody.')
})

void test('the process bench port is used when the deps have none (the entry point needs no change)', async () => {
  const { t } = benchSetup()
  const game = await benchGameOf(t.store, await game90001(t))
  delete t.deps.bench
  setProcessBench(benchPort({ stays: CALL_STAYS, members: MEMBERS }))
  try {
    const result = await benchForGame(t.deps, cfg(), game)
    assert.equal(result.available, true)
    assert.equal(result.people.length, 3)
  } finally {
    setProcessBench(undefined)
  }
})

void test('the voice tracker: in memory only, joins, moves and leaves, old stays pruned', () => {
  const tracker = new VoiceTracker()
  const t0 = new Date('2026-10-13T01:00:00.000Z')
  assert.equal(tracker.available(), false)
  tracker.snapshot([{ userId: 'a', channelId: 'c1' }], t0)
  assert.equal(tracker.available(), true)
  // A move closes the stay in c1 and opens one in c2.
  const t1 = new Date(t0.getTime() + 600_000)
  tracker.update('a', 'c2', t1)
  assert.deepEqual(
    [...tracker.channelsAround(t0, new Date(t0.getTime() + 60_000))],
    [['c1', new Set(['a'])]],
  )
  assert.deepEqual(
    [...tracker.channelsAround(new Date(t1.getTime() + 1), new Date(t1.getTime() + 2))],
    [['c2', new Set(['a'])]],
  )
  // Leaving ends the open stay; a later window no longer sees them.
  const t2 = new Date(t1.getTime() + 600_000)
  tracker.update('a', null, t2)
  assert.equal(
    tracker.channelsAround(new Date(t2.getTime() + 1), new Date(t2.getTime() + 2)).size,
    0,
  )
  // A stay that ended more than 12 hours ago is dropped.
  tracker.update('b', 'c1', new Date(t2.getTime() + 13 * 3_600_000))
  assert.ok(tracker.size() <= 2)
})

void test('voice events from the raw gateway: GUILD_CREATE snapshot and VOICE_STATE_UPDATE, our guild only', () => {
  const guild = '300000000000000001'
  assert.deepEqual(
    voiceFromRaw(
      {
        t: 'GUILD_CREATE',
        d: {
          id: guild,
          voice_states: [
            { user_id: 'u1', channel_id: 'c1' },
            { user_id: 'u2', channel_id: null },
          ],
        },
      },
      guild,
    ),
    { kind: 'snapshot', states: [{ userId: 'u1', channelId: 'c1' }] },
  )
  assert.deepEqual(
    voiceFromRaw(
      { t: 'VOICE_STATE_UPDATE', d: { guild_id: guild, user_id: 'u1', channel_id: null } },
      guild,
    ),
    { kind: 'update', userId: 'u1', channelId: null },
  )
  assert.equal(
    voiceFromRaw(
      { t: 'VOICE_STATE_UPDATE', d: { guild_id: 'other', user_id: 'u1', channel_id: 'c' } },
      guild,
    ),
    null,
  )
  assert.equal(voiceFromRaw({ t: 'MESSAGE_CREATE', d: {} }, guild), null)
  assert.deepEqual(
    snapshotOfCache([
      { id: 'a', channelId: 'c' },
      { id: 'b', channelId: null },
    ]),
    [{ userId: 'a', channelId: 'c' }],
  )
})

void test('the member lookup is cached for a few minutes and never throws', async () => {
  let calls = 0
  let nowMs = 0
  const lookup = memberDirectory({
    fetchMember: () => {
      calls++
      return Promise.reject(new Error('Discord bot HTTP 500'))
    },
    now: () => new Date(nowMs),
  })
  assert.equal(await lookup('u'), null)
  assert.equal(await lookup('u'), null)
  assert.equal(calls, 1)
  nowMs += 6 * 60_000
  await lookup('u')
  assert.equal(calls, 2)
})

void test('no presence is stored: the bench code has no database import, and checking the bench writes nothing', async () => {
  for (const f of ['bench.ts', 'bench-gateway.ts']) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')
    // Type imports only from the db package: no query, no table, no store write.
    const imports = src.match(/^import[^;]*?from '@eanhl\/db[^']*'/gm) ?? []
    for (const line of imports) assert.match(line, /^import type /, `${f}: ${line}`)
    assert.doesNotMatch(src, /store\.(insert|update|set|upsert|claim)/, f)
  }
  const { t } = benchSetup()
  const before = JSON.stringify({
    people: t.store.people,
    asks: t.store.askRows,
    answers: t.store.answerRows,
  })
  await benchForGame(t.deps, cfg(), await benchGameOf(t.store, await game90001(t)))
  assert.equal(
    JSON.stringify({ people: t.store.people, asks: t.store.askRows, answers: t.store.answerRows }),
    before,
  )
})

void test('config: the coach ids are a comma list of Discord ids; the Chel role has a default', () => {
  assert.deepEqual(parseUserIdList(' 431630903048011777 , nope,447213088828030998,'), [
    '431630903048011777',
    '447213088828030998',
  ])
  assert.deepEqual(parseUserIdList(undefined), [])
  const env: Record<string, string> = {
    PRESS_MODE: 'live',
    PRESS_GUILD_ID: '447213420765380618',
    PRESS_GM_USER_ID: '431630903048011771',
    PRESS_LIVE_CHANNEL_ID: '447213420765380619',
    ANTHROPIC_API_KEY: 'k',
    DISCORD_INTERNAL_TOKEN: 'x'.repeat(16),
    WEB_INTERNAL_URL: 'http://web:3000',
    PRESS_COACH_USER_IDS: '431630903048011777',
  }
  for (const id of Object.keys(REPORTERS)) env[`PRESS_TOKEN_${id.toUpperCase()}`] = 't'
  const loaded = loadPressConfig(env)
  assert.ok(loaded.ok)
  assert.deepEqual(loaded.config.coachUserIds, ['431630903048011777'])
  assert.equal(loaded.config.benchRoleId, '1423500221148696659')
})

// ── Naming a bench person (the GM) ──────────────────────────────────────────

void test('nameBench: the coach always; the call must have held anyone else; never a player of the game', async () => {
  const { t } = benchSetup()
  const game = await benchGameOf(t.store, await game90001(t))
  const ok = async (id: string) => nameBench(t.deps, cfg(), game, id)
  // The coach is not in this test's call at all: still allowed.
  t.deps.bench = benchPort({ stays: [{ userId: USER_A, channelId: CALL }], members: MEMBERS })
  const coach = await ok(COACH)
  assert.ok(coach.ok && coach.person.name === 'Coach Mike' && coach.person.role === 'coach')
  assert.deepEqual(await ok(JOEY), { ok: false, why: 'was not in the call' })
  assert.deepEqual(await ok(USER_B), { ok: false, why: 'played that game' })
  assert.deepEqual(await ok(BOT), { ok: false, why: 'is a bot' })
  // With the call in place, Joey is allowed.
  t.deps.bench = benchPort({ stays: CALL_STAYS, members: MEMBERS })
  const joey = await ok(JOEY)
  assert.ok(joey.ok && joey.person.playerId === 5 && joey.person.role === 'bench')
  assert.deepEqual(await ok(OUTLIER), { ok: false, why: 'is on Leave me out' })
})

void test("nameBench: with the call unavailable the GM's word counts for a known player or a member with the role", async () => {
  const { t } = benchSetup()
  const game = await benchGameOf(t.store, await game90001(t))
  t.deps.bench = benchPort({ available: false, members: MEMBERS })
  const ok = (id: string) => nameBench(t.deps, cfg(), game, id)
  assert.ok((await ok(JOEY)).ok)
  assert.ok((await ok(WATCHER)).ok)
  // No role (and no player row): cannot be found as a member of the team.
  assert.deepEqual(await ok(LURKER), { ok: false, why: 'cannot be found on the server' })
  // Not on the server at all.
  assert.deepEqual(await ok('200000000000000099'), {
    ok: false,
    why: 'cannot be found on the server',
  })
  assert.deepEqual(personColumns(((await ok(WATCHER)) as { ok: true; person: never }).person), {
    personRole: 'bench',
    displayName: 'Wally',
  })
})

// ── GM commands ─────────────────────────────────────────────────────────────

const Q = 'What did you see from the call tonight?'
const ask = (t: Setup, player: string, over: Partial<Parameters<typeof onGmAsk>[3]> = {}) =>
  onGmAsk(t.deps, cfg(), GM, {
    player,
    question: Q,
    reporter: null,
    exact: null,
    game: 1,
    ...over,
  })

void test('/gm ask accepts a bench person (a known player, and one with no player row) and lists the call', async () => {
  const { t } = benchSetup()
  liveRecap(t.store)
  await runPressPass(t.deps, cfg())
  // Joey: a known player who did not play, in the call.
  const joey = await ask(t, JOEY)
  assert.equal(joey.kind, 'ephemeral')
  assert.match(
    (joey as { text: string }).text,
    /^Got it: .* will ask Joey Flopfish: What did you see from the call tonight\?\nIn the call, not playing: Joey Flopfish, Coach Mike, Wally$/,
  )
  // The coach: no player row. The scrum person is keyed by the Discord user.
  assert.match(((await ask(t, COACH)) as { text: string }).text, /will ask Coach Mike: /)
  const rows = t.store.askRows
  assert.deepEqual(
    rows.map((r) => [r.playerId, r.discordUserId, r.personRole, r.displayName, r.status]),
    [
      [5, JOEY, 'bench', null, 'active'],
      [null, COACH, 'coach', 'Coach Mike', 'active'],
    ],
  )
  assert.deepEqual(
    t.store.people.map((p) => [
      p.playerId,
      p.discordUserId,
      p.personRole,
      p.displayName,
      p.role,
      p.requestedBy,
    ]),
    [
      [5, JOEY, 'bench', null, 'picked', 'gm'],
      [null, COACH, 'coach', 'Coach Mike', 'picked', 'gm'],
    ],
  )
  // Asked twice: the person with no player row is in the scrum once.
  await ask(t, COACH)
  assert.equal(t.store.people.length, 2)
})

void test('/gm ask refuses someone who was not in the call, a player of the game is asked as a player', async () => {
  const { t } = benchSetup()
  liveRecap(t.store)
  await runPressPass(t.deps, cfg())
  t.deps.bench = benchPort({ stays: [{ userId: USER_A, channelId: CALL }], members: MEMBERS })
  assert.deepEqual(
    await ask(t, JOEY),
    ephemeral('Joey Flopfish cannot be asked: not in game 1, and was not in the call.'),
  )
  assert.deepEqual(
    await ask(t, WATCHER),
    ephemeral('That person cannot be asked: was not in the call.'),
  )
  // A player of the game is a player, not the bench.
  const a = await ask(t, USER_A)
  assert.match((a as { text: string }).text, /will ask Skater A:/)
  assert.deepEqual(
    t.store.people.map((p) => p.personRole),
    ['player'],
  )
})

void test('/gm ask: a bench person named before the scrum is open joins it when it opens (checked again)', async () => {
  const { t } = benchSetup()
  // No recap yet: the ask waits.
  const reply = await ask(t, COACH)
  assert.match((reply as { text: string }).text, /The scrum is not open yet/)
  liveRecap(t.store)
  await runPressPass(t.deps, cfg())
  assert.deepEqual(
    t.store.people.map((p) => [p.playerId, p.personRole, p.displayName, p.requestedBy]),
    [[null, 'coach', 'Coach Mike', 'gm']],
  )
})

void test('/gm note that asks a bench person adds them to the scrum, and the reply lists the call', async () => {
  const model = interviewModel()
  const t = interviewSetup({ model: model.call })
  withKnownPeople(t.store)
  t.deps.bench = benchPort({ stays: CALL_STAYS, members: MEMBERS })
  // Not used: the note's AI parse is a fake answering "ask Joey".
  t.deps.call = () =>
    Promise.resolve({
      json: {
        nickname: 'Joey',
        playerName: 'Joey Flopfish',
        gameNumber: 1,
        asksPlayer: true,
        critical: false,
        theme: false,
      },
      refused: false,
      model: 'claude-opus-5-5',
      usage: { input_tokens: 1, output_tokens: 1 },
    })
  liveRecap(t.store)
  await runPressPass(t.deps, cfg())
  const reply = await onGmNote(t.deps, cfg(), GM, 'Joey, ask him how the call saw it', 1)
  assert.equal(reply.kind, 'ephemeral')
  const text = (reply as { text: string }).text
  assert.match(text, /Ask: yes\./)
  assert.match(text, /In the call, not playing: Joey Flopfish, Coach Mike, Wally$/)
  assert.deepEqual(
    t.store.people.map((p) => [p.playerId, p.personRole]),
    [[5, 'bench']],
  )
})

// ── The volunteer round ─────────────────────────────────────────────────────

void test('"Talk to the press": a bench person steps up; others are refused as before', async () => {
  const { t } = benchSetup()
  liveRecap(t.store)
  await runPressPass(t.deps, cfg())
  // Joey (known, not a player of the game) and Wally (no player row) are on the bench.
  assert.equal((await onTalk(t.deps, cfg(), 10, JOEY)).kind, 'ack')
  assert.equal((await onTalk(t.deps, cfg(), 10, WATCHER)).kind, 'ack')
  assert.deepEqual(
    t.store.people.map((p) => [p.playerId, p.personRole, p.displayName, p.role, p.status]),
    [
      [5, 'bench', null, 'volunteer', 'asking'],
      [null, 'bench', 'Wally', 'volunteer', 'asking'],
    ],
  )
  // Twice (T10): answered by state, for the person with a player row and for the one without.
  for (const [user, index] of [
    [JOEY, 0],
    [WATCHER, 1],
  ] as const) {
    const again = await onTalk(t.deps, cfg(), 10, user)
    assert.equal(
      again.kind === 'ephemeral' && again.text.startsWith('Your questions are in your thread'),
      true,
    )
    t.store.people[index]!.status = 'done'
    assert.deepEqual(
      await onTalk(t.deps, cfg(), 10, user),
      ephemeral("You've already talked to the press about this game."),
    )
  }
  // Not in the call (has the role? no): a linked player gets the old refusal, an unlinked one the link text.
  t.store.discordIds.set(4, USER_C)
  assert.deepEqual(
    await onTalk(t.deps, cfg(), 10, USER_C),
    ephemeral('This scrum is for players of this game.'),
  )
  assert.deepEqual(
    await onTalk(t.deps, cfg(), 10, LURKER),
    ephemeral('Link your Discord on boogeymen.app (sign in) to talk to the press.'),
  )
  assert.equal(t.store.people.length, 2)
})

void test('the coach steps up with /scrum: named "Coach Mike", asked as the coach, never as a player', async () => {
  const m = interviewModel({
    questions: ['How did the plan hold up in the first game?'],
    judgements: [
      { usability: 'usable', chase: 'none', followUp: '', closing: 'Thanks, Coach. Noted.' },
    ],
  })
  const t = interviewSetup({ model: m.call })
  withKnownPeople(t.store)
  t.deps.bench = benchPort({ stays: CALL_STAYS, members: MEMBERS })
  liveRecap(t.store)
  await runPressPass(t.deps, cfg())
  const reply = await onScrumCommand(t.deps, cfg(), COACH, { player: null, random: false })
  assert.deepEqual(reply, ephemeral("The reporter's question is in the scrum thread."))
  const person = t.store.people[0]!
  assert.deepEqual(
    [person.playerId, person.personRole, person.displayName, person.requestedBy],
    [null, 'coach', 'Coach Mike', 'self'],
  )
  // The person's own thread, named for them, and a question that never pretends they played.
  assert.match(t.threads.at(-1)!.name, /^Coach Mike — press scrum$/)
  const prompt = m.reqs.find((r) => r.purpose === 'write')!.user
  assert.match(prompt, /Coach Mike is the club's coach\. Coach Mike did not play in this game\./)
  assert.match(prompt, /Never say or suggest that Coach Mike played/)
  // The scripted question reaches the thread, mentioning the coach.
  const posted = t.sent.at(-1)!
  assert.match(posted.msg.content, new RegExp(`^<@${COACH}> How did the plan hold up`))
})

void test('a bench question the model could not write is a bench line, never "your game"', async () => {
  const { t } = benchSetup()
  liveRecap(t.store)
  await runPressPass(t.deps, cfg())
  await onTalk(t.deps, cfg(), 10, JOEY)
  const posted = t.sent.at(-1)!.msg.content
  const pool = fallbackPool('question', 'voss', 'Joey Flopfish', 'bench').map(
    (q) => `<@${JOEY}> ${q}`,
  )
  const all = (
    [
      'voss',
      'barlow',
      'mercer',
      'halberd',
      'vale',
      'quill',
      'rink',
      'pettibone',
      'bergstrom',
    ] as const
  )
    .flatMap((r) => fallbackPool('question', r, 'Joey Flopfish', 'bench'))
    .map((q) => `<@${JOEY}> ${q}`)
  assert.ok(all.includes(posted) || pool.includes(posted), posted)
  assert.doesNotMatch(posted, /your game|your best|your play/i)
})

void test('/scrum for someone with no game of their own: the bench steps up; others get "no game"', async () => {
  const { t } = benchSetup()
  liveRecap(t.store)
  await runPressPass(t.deps, cfg())
  assert.deepEqual(
    await onScrumCommand(t.deps, cfg(), JOEY, { player: null, random: false }),
    ephemeral("The reporter's question is in the scrum thread."),
  )
  t.store.discordIds.set(4, USER_C)
  assert.deepEqual(
    await onScrumCommand(t.deps, cfg(), USER_C, { player: null, random: false }),
    ephemeral('No game with the press in the last 6 hours.'),
  )
  // The bench cannot send the press to a teammate: that is for players of the game.
  assert.deepEqual(
    await onScrumCommand(t.deps, cfg(), JOEY, { player: USER_A, random: false }),
    ephemeral('No game with the press in the last 6 hours.'),
  )
})

// ── A non-player end to end: ask, accept, answer, store, quote ──────────────

void test('done when: the coach (no player row) goes from /gm ask to a stored answer and a quote "said Coach Mike"', async () => {
  const m = interviewModel({
    judgements: [
      { usability: 'usable', chase: 'none', followUp: '', closing: 'Thanks, Coach. Noted.' },
    ],
  })
  const t = interviewSetup({ model: m.call })
  withKnownPeople(t.store)
  t.deps.bench = benchPort({ stays: CALL_STAYS, members: MEMBERS })
  liveRecap(t.store)
  await runPressPass(t.deps, cfg())
  // The GM's exact question first; the coach gets the usual ping after 60 s.
  const reply = await ask(t, COACH, { reporter: 'barlow' })
  assert.match(
    (reply as { text: string }).text,
    /^Got it: Wade Barlow will ask Coach Mike: What did you see/,
  )
  t.deps.now = () => new Date(NOW.getTime() + 61_000)
  await runPressPass(t.deps, cfg())
  const ping = t.sent.at(-1)!
  // The scrum's own reporter pings; the GM's chosen reporter asks first in the thread.
  assert.match(
    ping.msg.content,
    new RegExp(`<@${COACH}> — ${REPORTERS[t.store.scrums[0]!.reporter].name} has a question`),
  )
  const personId = t.store.people[0]!.id
  assert.equal((await onAccept(t.deps, cfg(), personId, COACH)).kind, 'ack')
  assert.equal(t.store.people[0]!.currentQuestion, Q)
  // A teammate cannot answer for the coach.
  const seen = { questionsAsked: 1, followupsAsked: 0 }
  assert.deepEqual(
    await onAnswerSubmit(t.deps, cfg(), personId, USER_A, 'x', seen),
    ephemeral('This one is for Coach Mike.'),
  )
  const out = await onAnswerSubmit(
    t.deps,
    cfg(),
    personId,
    COACH,
    'The team stuck to the plan until the third period, then we lost the middle of the ice.',
    seen,
  )
  assert.equal(out.kind, 'ack')
  const stored = t.store.answerRows[0]!
  assert.equal(stored.playerId ?? null, null)
  assert.equal(stored.usability, 'usable')
  // The night recap's material: the answer is offered, attributed to the coach, who did not play.
  const material = await t.store.nightPressMaterial()
  assert.deepEqual(
    material.quotes.map((q) => [q.name, q.personRole, q.playerId]),
    [['Coach Mike', 'coach', null]],
  )
  const facts = oct12Response('night').facts
  const offered = pressForSheet(material, facts)
  assert.equal(offered.quotes.length, 1, 'a bench answer is not dropped for being off the sheet')
  assert.equal(quoteSpeaker(offered.quotes[0]!), 'Coach Mike (the coach; did not play)')
  const room = pressRoomBlock({ quotes: offered.quotes, gmNotes: [] })!
  assert.match(room, /Coach Mike \(the coach; did not play\), asked "What did you see/)
  assert.match(
    room,
    /quote them as from the bench \("said Joey, watching from the call"; "said Coach Mike"\)/,
  )
  assert.match(room, /never list them in "mentions"/)
})

void test('a known player who answers from the bench is quoted as watching from the call', () => {
  const facts = oct12Response('night').facts
  const quote = {
    answerId: 3,
    playerId: 5,
    name: 'Joey Flopfish',
    personRole: 'bench' as const,
    question: 'How did the team look?',
    answer: 'Tired legs in the second, but the goalie held us in.',
    usability: 'usable' as const,
    reporter: 'voss' as const,
  }
  const offered = pressForSheet({ quotes: [quote], gmNotes: [] }, facts)
  assert.equal(offered.quotes.length, 1)
  assert.equal(
    quoteSpeaker(offered.quotes[0]!),
    "Joey Flopfish (did not play; watched from the team's voice call)",
  )
  // The same answer with the player role is dropped: Joey is not on the sheet as a player.
  const asPlayer = pressForSheet(
    { quotes: [{ ...quote, personRole: 'player' }], gmNotes: [] },
    facts,
  )
  assert.equal(asPlayer.quotes.length, 0)
  // A crude bench answer is dropped like any other.
  const crude = pressForSheet(
    { quotes: [{ ...quote, answer: 'Honestly we played like shit tonight.' }], gmNotes: [] },
    facts,
  )
  assert.equal(crude.quotes.length, 0)
})

// ── Interviews ──────────────────────────────────────────────────────────────

void test('/gm interview accepts the coach: a row with no player, asked as the coach, a bench Q&A', async () => {
  const m = interviewModel({
    questions: ['How did the plan hold up over the night?'],
    judgements: [{ usability: 'usable', chase: 'none', followUp: '', closing: 'Thanks, Coach.' }],
  })
  const t = interviewSetup({ model: m.call })
  withKnownPeople(t.store)
  t.deps.bench = benchPort({ stays: CALL_STAYS, members: MEMBERS })
  // The night of the newest game (the fake's latest night is NIGHT).
  const reply = await onGmInterview(t.deps, cfg(), GM, {
    player: COACH,
    reporter: 'barlow',
    topic: null,
  })
  assert.equal(reply.kind, 'ephemeral')
  assert.match(
    (reply as { text: string }).text,
    /^Got it: Wade Barlow will offer Coach Mike an interview \(open for 30 minutes\)\.\nIn the call, not playing: Joey Flopfish, Coach Mike, Wally$/,
  )
  const iv = t.store.interviews[0]!
  assert.deepEqual(
    [iv.playerId, iv.discordUserId, iv.personRole, iv.displayName, iv.trigger, iv.night],
    [null, COACH, 'coach', 'Coach Mike', 'gm', NIGHT],
  )
  // A second offer for the same Discord user conflicts.
  assert.deepEqual(
    await onGmInterview(t.deps, cfg(), GM, { player: COACH, reporter: 'barlow', topic: null }),
    ephemeral('Coach Mike already has an interview open.'),
  )
  await runPressPass(t.deps, cfg())
  assert.match(t.sent[0]!.msg.content, new RegExp(`^<@${COACH}> — Wade Barlow would like`))
  assert.equal((await onInterviewAccept(t.deps, cfg(), iv.id, COACH)).kind, 'ack')
  const prompt = m.reqs.find((r) => r.purpose === 'write')!.user
  assert.match(prompt, /Coach Mike is the club's coach/)
  assert.match(prompt, /questions are about the team and the night, seen from outside/)
  const seen = { questionsAsked: 1, followupsAsked: 0 }
  const done = await onInterviewAnswerSubmit(
    t.deps,
    cfg(),
    iv.id,
    COACH,
    'We stuck to the plan until the third, then the middle of the ice opened up.',
    seen,
  )
  assert.equal(done.kind, 'ack')
  assert.equal(t.store.ivAnswers[0]!.playerId ?? null, null)
})

void test('/gm interview: a person who was not in the call is refused; with the call unavailable a known player is accepted', async () => {
  const t2 = interviewSetup()
  withKnownPeople(t2.store)
  t2.deps.bench = benchPort({ stays: [{ userId: USER_A, channelId: CALL }], members: MEMBERS })
  // Joey has no game of his own in the lookback (the fake says so): the bench route, not in the call.
  assert.deepEqual(
    await onGmInterview(t2.deps, cfg(), GM, { player: JOEY, reporter: null, topic: null }),
    ephemeral('That person cannot be interviewed: was not in the call.'),
  )
  t2.deps.bench = benchPort({ available: false, members: MEMBERS })
  const ok = await onGmInterview(t2.deps, cfg(), GM, {
    player: JOEY,
    reporter: 'barlow',
    topic: null,
  })
  assert.match(
    (ok as { text: string }).text,
    /^Got it: Wade Barlow will offer Joey Flopfish an interview/,
  )
  assert.deepEqual(
    [
      t2.store.interviews[0]!.playerId,
      t2.store.interviews[0]!.personRole,
      t2.store.interviews[0]!.displayName,
    ],
    [5, 'bench', null],
  )
})

void test('the bench interview fallback question never presumes a play', () => {
  const lines = [1, 2, 3, 4, 5, 6, 7].map((i) =>
    fallbackInterviewQuestion(i, 'Coach Mike', 'coach'),
  )
  for (const l of lines) assert.doesNotMatch(l, /your game|your role|for you on the ice/i)
})
