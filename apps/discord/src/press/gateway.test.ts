import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANSWER_INPUT_ID,
  FAILED_TEXT,
  commandDefinitions,
  createReactionRouter,
  createRouter,
  modalBody,
  routeCustomId,
  type InteractionInput,
  type InteractionPort,
  type PressHandlers,
} from './gateway.ts'
import type { Reply } from './interactions.ts'
import { config } from './test-fakes.ts'

const USER = '200000000000000001'

test('routeCustomId: every press button, pop-up and select', () => {
  assert.deepEqual(routeCustomId('press:accept:12'), { kind: 'accept', id: 12 })
  assert.deepEqual(routeCustomId('press:talk:7'), { kind: 'talk', id: 7 })
  assert.deepEqual(routeCustomId('press:answer:3'), { kind: 'answer', id: 3 })
  assert.deepEqual(routeCustomId('press:gmfix:44'), { kind: 'gmfix', id: 44 })
  assert.deepEqual(routeCustomId('press:gmcancel:44'), { kind: 'gmcancel', id: 44 })
  assert.deepEqual(routeCustomId('press:modal:5:2:0'), {
    kind: 'modal',
    id: 5,
    questionsAsked: 2,
    followupsAsked: 0,
  })
})

test('routeCustomId: an unknown or malformed id is null', () => {
  for (const id of [
    'press:unknown:1',
    'other:accept:1',
    'press:accept',
    'press:accept:',
    'press:accept:abc',
    'press:accept:0',
    'press:accept:-1',
    'press:accept:1.5',
    'press:accept:1:2',
    'press:modal:5:2',
    'press:modal:5:2:1:9',
    'press:modal:5:x:1',
    'press:accept:99999999999999999999',
    '',
  ]) {
    assert.equal(routeCustomId(id), null, id)
  }
})

test('commandDefinitions: /scrum and the GM-only /gm', () => {
  const defs = commandDefinitions()
  assert.deepEqual(
    defs.map((d) => d.name),
    ['scrum', 'gm'],
  )
  const scrum = defs.find((d) => d.name === 'scrum')!
  assert.equal(scrum.default_member_permissions, undefined)
  assert.deepEqual(
    scrum.options?.map((o) => [o.name, o.type, o.required ?? false]),
    [
      ['player', 6, false],
      ['random', 5, false],
    ],
  )

  const gm = defs.find((d) => d.name === 'gm')!
  assert.equal(gm.default_member_permissions, '0')
  const sub = (name: string) =>
    gm.options?.find((o) => o.name === name) as unknown as {
      type: number
      options: {
        name: string
        type: number
        required?: boolean
        min_value?: number
        choices?: { value: string }[]
      }[]
    }
  const note = sub('note')
  assert.equal(note.type, 1)
  assert.deepEqual(
    note.options.map((o) => [o.name, o.type, o.required ?? false, o.min_value]),
    [
      ['text', 3, true, undefined],
      ['game', 4, false, 1],
    ],
  )
  const heat = sub('heat')
  assert.equal(heat.type, 1)
  assert.deepEqual(
    heat.options.map((o) => [o.name, o.choices?.map((c) => c.value)]),
    [
      ['level', ['cool', 'normal', 'hot']],
      ['scope', ['next', 'night']],
    ],
  )
  // Every name and description fits Discord's limits.
  for (const d of defs) {
    assert.match(d.name, /^[a-z]{1,32}$/)
    assert.ok(d.description.length >= 1 && d.description.length <= 100)
  }
})

test('modalBody: one required paragraph input with the answer limit', () => {
  const body = modalBody({
    kind: 'modal',
    customId: 'press:modal:5:1:0',
    title: 'Wade Barlow asks',
    label: 'How was the third?',
    maxLength: 500,
  })
  assert.deepEqual(body, {
    custom_id: 'press:modal:5:1:0',
    title: 'Wade Barlow asks',
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: ANSWER_INPUT_ID,
            style: 2,
            label: 'How was the third?',
            max_length: 500,
            required: true,
          },
        ],
      },
    ],
  })
})

// ── The router over fake handlers and a fake interaction ─────────────────────

type Call = [string, ...unknown[]]

function fakePort(calls: Call[], fail: Partial<Record<keyof InteractionPort, Error>> = {}) {
  const op =
    (name: keyof InteractionPort) =>
    async (...args: unknown[]): Promise<void> => {
      calls.push([name, ...args])
      const err = fail[name]
      if (err !== undefined) throw err
    }
  const port: InteractionPort = {
    deferReply: op('deferReply'),
    deferUpdate: op('deferUpdate'),
    reply: op('reply'),
    editReply: op('editReply'),
    deleteReply: op('deleteReply'),
    followUp: op('followUp'),
    showModal: op('showModal'),
  }
  return port
}

const say = (text: string): Reply => ({ kind: 'ephemeral', text })

function harness(overrides: Partial<PressHandlers> = {}) {
  const calls: Call[] = []
  const logs: string[] = []
  const debugs: string[] = []
  const record =
    (name: string, reply: Reply) =>
    async (...args: unknown[]) => {
      // The deps and config are the first two arguments: leave them out.
      calls.push([`handler:${name}`, ...args.slice(2)])
      return reply
    }
  const handlers: PressHandlers = {
    onTalk: record('talk', say('talk done')),
    onAccept: record('accept', say('accept done')),
    onAnswerButton: record('answer', {
      kind: 'modal',
      customId: 'press:modal:3:1:0',
      title: 'T',
      label: 'Q?',
      maxLength: 500,
    }),
    onAnswerSubmit: record('submit', { kind: 'ack' }),
    onScrumCommand: record('scrum', say('scrum done')),
    onGmNote: record('gmnote', say('note done')),
    onGmNoteCorrect: record('gmfix', say('fixed')),
    onGmNoteCancel: record('gmcancel', say('cancelled')),
    onGmHeat: record('gmheat', say('heat set')),
    ...overrides,
  }
  const route = createRouter({
    deps: {} as never,
    config: config('live'),
    log: (m) => logs.push(m),
    debug: (m) => debugs.push(m),
    handlers,
  })
  const run = (input: InteractionInput, fail?: Partial<Record<keyof InteractionPort, Error>>) =>
    route(input, fakePort(calls, fail))
  return { calls, logs, debugs, run }
}

test('router: Talk defers privately first, then edits in the result', async () => {
  const h = harness()
  await h.run({ type: 'button', customId: 'press:talk:7', userId: USER })
  assert.deepEqual(h.calls, [
    ['deferReply'],
    ['handler:talk', 7, USER],
    ['editReply', { content: 'talk done' }],
  ])
})

test('router: Accept defers, an ack deletes the deferred reply', async () => {
  const h = harness({ onAccept: async () => ({ kind: 'ack' }) })
  await h.run({ type: 'button', customId: 'press:accept:12', userId: USER })
  assert.deepEqual(h.calls, [['deferReply'], ['deleteReply']])
})

test('router: Answer opens the pop-up without deferring', async () => {
  const h = harness()
  await h.run({ type: 'button', customId: 'press:answer:3', userId: USER })
  assert.equal(h.calls[0]![0], 'handler:answer')
  assert.deepEqual(h.calls[0], ['handler:answer', 3, USER])
  assert.equal(h.calls[1]![0], 'showModal')
  assert.equal((h.calls[1]![1] as { custom_id: string }).custom_id, 'press:modal:3:1:0')
  assert.equal(h.calls.length, 2)
})

test('router: an Answer refusal is a private reply', async () => {
  const h = harness({ onAnswerButton: async () => say('Too late') })
  await h.run({ type: 'button', customId: 'press:answer:3', userId: USER })
  assert.deepEqual(h.calls, [['reply', 'Too late']])
})

test('router: the pop-up submit passes the text and the counters it was opened with', async () => {
  const h = harness()
  await h.run({
    type: 'modal',
    customId: 'press:modal:5:2:1',
    userId: USER,
    text: 'We stuck to the plan.',
  })
  assert.deepEqual(h.calls, [
    ['deferReply'],
    ['handler:submit', 5, USER, 'We stuck to the plan.', { questionsAsked: 2, followupsAsked: 1 }],
    ['deleteReply'],
  ])
})

test('router: /scrum maps its options', async () => {
  const h = harness()
  await h.run({ type: 'command', name: 'scrum', subcommand: null, userId: USER, options: {} })
  await h.run({
    type: 'command',
    name: 'scrum',
    subcommand: null,
    userId: USER,
    options: { player: '200000000000000002', random: true },
  })
  assert.deepEqual(h.calls, [
    ['deferReply'],
    ['handler:scrum', USER, { player: null, random: false }],
    ['editReply', { content: 'scrum done' }],
    ['deferReply'],
    ['handler:scrum', USER, { player: '200000000000000002', random: true }],
    ['editReply', { content: 'scrum done' }],
  ])
})

test('router: /gm note shows the select and Cancel only with a note id', async () => {
  const choices = [{ playerId: 2, name: 'Silky' }]
  const h = harness({
    onGmNote: async (_d, _c, _u, text) =>
      text === 'store it' ? { ...say('Got it.'), noteId: 9, choices } : say('No game tonight.'),
  })
  await h.run({
    type: 'command',
    name: 'gm',
    subcommand: 'note',
    userId: USER,
    options: { text: 'store it', game: 2 },
  })
  await h.run({
    type: 'command',
    name: 'gm',
    subcommand: 'note',
    userId: USER,
    options: { text: 'nothing' },
  })
  assert.deepEqual(h.calls[0], ['deferReply'])
  const edit = h.calls[1] as [string, { content: string; components: unknown[] }]
  assert.equal(edit[0], 'editReply')
  assert.equal(edit[1].content, 'Got it.')
  const ids = JSON.stringify(edit[1].components)
  assert.match(ids, /press:gmfix:9/)
  assert.match(ids, /press:gmcancel:9/)
  assert.deepEqual(h.calls.slice(2), [
    ['deferReply'],
    ['editReply', { content: 'No game tonight.' }],
  ])
})

test('router: /gm note passes the game number or null', async () => {
  const seen: unknown[] = []
  const h = harness({
    onGmNote: async (_d, _c, userId, text, game) => {
      seen.push([userId, text, game])
      return say('ok')
    },
  })
  await h.run({
    type: 'command',
    name: 'gm',
    subcommand: 'note',
    userId: USER,
    options: { text: 'a', game: 2 },
  })
  await h.run({
    type: 'command',
    name: 'gm',
    subcommand: 'note',
    userId: USER,
    options: { text: 'b' },
  })
  assert.deepEqual(seen, [
    [USER, 'a', 2],
    [USER, 'b', null],
  ])
})

test('router: /gm heat passes level and scope', async () => {
  const h = harness()
  await h.run({
    type: 'command',
    name: 'gm',
    subcommand: 'heat',
    userId: USER,
    options: { level: 'hot', scope: 'night' },
  })
  assert.deepEqual(h.calls, [
    ['deferReply'],
    ['handler:gmheat', USER, 'hot', 'night'],
    ['editReply', { content: 'heat set' }],
  ])
})

test('router: /gm heat with a level outside the choices fails safely', async () => {
  const h = harness()
  await h.run({
    type: 'command',
    name: 'gm',
    subcommand: 'heat',
    userId: USER,
    options: { level: 'lava', scope: 'night' },
  })
  assert.deepEqual(h.calls, [['deferReply'], ['editReply', { content: FAILED_TEXT }]])
  assert.equal(h.logs.length, 1)
  assert.match(h.logs[0]!, /^\[press\] interaction gm heat: /)
})

test('router: the correction select updates the note message and keeps its controls', async () => {
  const h = harness()
  await h.run({ type: 'select', customId: 'press:gmfix:9', userId: USER, values: ['14'] })
  assert.deepEqual(h.calls, [
    ['deferUpdate'],
    ['handler:gmfix', USER, 9, 14],
    ['editReply', { content: 'fixed' }],
  ])
})

test('router: Cancel updates the note message and removes its controls', async () => {
  const h = harness()
  await h.run({ type: 'button', customId: 'press:gmcancel:9', userId: USER })
  assert.deepEqual(h.calls, [
    ['deferUpdate'],
    ['handler:gmcancel', USER, 9],
    ['editReply', { content: 'cancelled', components: [] }],
  ])
})

test('router: a select on a button id (or a button on a select id) is ignored', async () => {
  const h = harness()
  await h.run({ type: 'select', customId: 'press:talk:7', userId: USER, values: ['1'] })
  await h.run({ type: 'button', customId: 'press:gmfix:9', userId: USER })
  await h.run({ type: 'button', customId: 'press:modal:5:2:1', userId: USER })
  assert.deepEqual(h.calls, [])
})

test('router: an unknown id or command gets no reply, logged once at debug level', async () => {
  const h = harness()
  await h.run({ type: 'button', customId: 'press:nope:1', userId: USER })
  await h.run({ type: 'button', customId: 'press:nope:2', userId: USER })
  await h.run({ type: 'command', name: 'other', subcommand: null, userId: USER, options: {} })
  assert.deepEqual(h.calls, [])
  assert.deepEqual(h.logs, [])
  assert.equal(h.debugs.length, 2)
  assert.match(h.debugs[0]!, /^\[press\] ignored interaction: button press:nope/)
})

test('router: a handler error is logged and answered once', async () => {
  const h = harness({
    onTalk: async () => {
      throw new Error('db down')
    },
  })
  await h.run({ type: 'button', customId: 'press:talk:7', userId: USER })
  assert.deepEqual(h.calls, [['deferReply'], ['editReply', { content: FAILED_TEXT }]])
  assert.deepEqual(h.logs, ['[press] interaction talk: db down'])
})

test('router: an error before the defer replies privately', async () => {
  const h = harness({
    onAnswerButton: async () => {
      throw new Error('db down')
    },
  })
  await h.run({ type: 'button', customId: 'press:answer:3', userId: USER })
  assert.deepEqual(h.calls, [['reply', FAILED_TEXT]])
  assert.deepEqual(h.logs, ['[press] interaction answer: db down'])
})

test('router: an error after deferUpdate answers with a private follow-up', async () => {
  const h = harness({
    onGmNoteCancel: async () => {
      throw new Error('db down')
    },
  })
  await h.run({ type: 'button', customId: 'press:gmcancel:9', userId: USER })
  assert.deepEqual(h.calls, [['deferUpdate'], ['followUp', FAILED_TEXT]])
})

test('router: a failed defer and a failed error reply never throw', async () => {
  const h = harness()
  await h.run(
    { type: 'button', customId: 'press:talk:7', userId: USER },
    { deferReply: new Error('Unknown interaction'), reply: new Error('Unknown interaction') },
  )
  assert.deepEqual(h.calls, [['deferReply'], ['reply', FAILED_TEXT]])
  assert.deepEqual(h.logs, [
    '[press] interaction talk: Unknown interaction',
    '[press] interaction talk: error reply failed: Unknown interaction',
  ])
})

test('router: a correction value that is not a player id fails safely', async () => {
  const h = harness()
  await h.run({ type: 'select', customId: 'press:gmfix:9', userId: USER, values: ['abc'] })
  assert.deepEqual(h.calls, [['deferUpdate'], ['followUp', FAILED_TEXT]])
})

test('router: a modal reply after a defer is a logged failure, not a crash', async () => {
  const h = harness({
    onTalk: async () => ({ kind: 'modal', customId: 'x', title: 't', label: 'l', maxLength: 500 }),
  })
  await h.run({ type: 'button', customId: 'press:talk:7', userId: USER })
  assert.deepEqual(h.calls, [['deferReply'], ['editReply', { content: FAILED_TEXT }]])
  assert.equal(h.logs.length, 1)
})

test('reaction router: one reaction at a time; an error is logged and never thrown', async () => {
  const logs: string[] = []
  const order: string[] = []
  let release: () => void = () => undefined
  const first = new Promise<void>((resolve) => (release = resolve))
  const route = createReactionRouter({
    deps: {} as never,
    config: config('live'),
    log: (m) => logs.push(m),
    handler: async (_d, _c, args) => {
      order.push(`start:${args.userId}`)
      if (args.userId === 'a') await first
      if (args.userId === 'b') throw new Error('db down')
      order.push(`end:${args.userId}`)
    },
  })
  const input = (userId: string) => ({
    channelId: 'chel',
    messageId: 'm',
    userId,
    userIsBot: false,
  })
  const a = route(input('a'))
  const b = route(input('b'))
  const c = route(input('c'))
  await Promise.resolve()
  assert.deepEqual(order, ['start:a'])
  release()
  await Promise.all([a, b, c])
  assert.deepEqual(order, ['start:a', 'end:a', 'start:b', 'start:c', 'end:c'])
  assert.deepEqual(logs, ['[press] reaction: db down'])
})
