import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORTER_IDS } from '@eanhl/db/news'
import { commandDefinitions, createRouter, type InteractionPort } from './gateway.ts'
import { interviewModel, interviewSetup } from './interview-fakes.ts'
import { interviewCommand, routeInterviewId, withInterviewCommands } from './interview-gateway.ts'
import { INTERVIEW_TEXT } from './interview.ts'
import { GM, USER_A, config } from './test-fakes.ts'

void test('interview custom ids: accept, answer, pop-up; anything else is not ours', () => {
  assert.deepEqual(routeInterviewId('press:iaccept:12'), { kind: 'iaccept', id: 12 })
  assert.deepEqual(routeInterviewId('press:ianswer:3'), { kind: 'ianswer', id: 3 })
  assert.deepEqual(routeInterviewId('press:imodal:3:2:1'), {
    kind: 'imodal',
    id: 3,
    questionsAsked: 2,
    followupsAsked: 1,
  })
  for (const id of [
    'press:accept:1',
    'press:iaccept:0',
    'press:imodal:1:2',
    'x:iaccept:1',
    'press:ianswer:a',
  ]) {
    assert.equal(routeInterviewId(id), null, id)
  }
})

void test('commands: /interview and /gm interview are added; the scrum set is not changed', () => {
  const base = commandDefinitions()
  const before = JSON.stringify(base)
  const all = withInterviewCommands(base)
  assert.equal(JSON.stringify(base), before)
  assert.deepEqual(
    all.map((c) => c.name),
    [...base.map((c) => c.name), 'interview'],
  )
  assert.deepEqual(
    all.find((c) => c.name === 'interview'),
    interviewCommand(),
  )
  const gm = all.find((c) => c.name === 'gm')!
  const sub = (gm.options ?? []).find((o) => o.name === 'interview') as {
    options: { name: string; required?: boolean; choices?: { value: string }[] }[]
  }
  assert.ok(sub, 'gm interview subcommand')
  assert.deepEqual(
    sub.options.map((o) => [o.name, o.required === true]),
    [
      ['player', true],
      ['reporter', false],
      ['topic', false],
    ],
  )
  assert.deepEqual(
    sub.options[1]!.choices!.map((c) => c.value),
    [...REPORTER_IDS],
  )
  // Hidden from non-admins like the rest of /gm.
  assert.equal(gm.default_member_permissions, '0')
  // Idempotent: adding twice adds nothing more.
  assert.equal(withInterviewCommands(all).filter((c) => c.name === 'interview').length, 1)
})

function port() {
  const calls: string[] = []
  const p: InteractionPort = {
    deferReply: () => (calls.push('deferReply'), Promise.resolve()),
    deferUpdate: () => (calls.push('deferUpdate'), Promise.resolve()),
    reply: (text) => (calls.push(`reply:${text}`), Promise.resolve()),
    editReply: (b) => (calls.push(`editReply:${b.content}`), Promise.resolve()),
    deleteReply: () => (calls.push('deleteReply'), Promise.resolve()),
    followUp: (text) => (calls.push(`followUp:${text}`), Promise.resolve()),
    showModal: (b) => (calls.push(`modal:${b.custom_id}`), Promise.resolve()),
  }
  return { p, calls }
}

void test('router: interview commands and buttons reach the interview handlers', async () => {
  const t = interviewSetup({
    model: interviewModel({ questions: ['How did the night go for you?'] }).call,
  })
  const cfg = config('live')
  const route = createRouter({
    deps: t.deps,
    config: cfg,
    log: () => undefined,
    debug: () => undefined,
  })

  const a = port()
  await route(
    {
      type: 'command',
      name: 'gm',
      subcommand: 'interview',
      userId: USER_A,
      options: { player: USER_A },
    },
    a.p,
  )
  assert.deepEqual(a.calls, ['deferReply', `editReply:${INTERVIEW_TEXT.gmOnly}`])

  const b = port()
  await route(
    {
      type: 'command',
      name: 'gm',
      subcommand: 'interview',
      userId: GM,
      options: { player: USER_A, reporter: 'voss' },
    },
    b.p,
  )
  assert.deepEqual(b.calls, [
    'deferReply',
    'editReply:Got it: Talia Voss will offer Skater A an interview (open for 30 minutes).',
  ])
  t.store.interviews[0]!.offeredAt = t.deps.now()
  t.store.interviews[0]!.offerMessageId = 'offer-1'

  const c = port()
  await route({ type: 'button', customId: 'press:iaccept:1', userId: USER_A }, c.p)
  assert.deepEqual(c.calls, ['deferReply', 'deleteReply'])

  const d = port()
  await route({ type: 'button', customId: 'press:ianswer:1', userId: USER_A }, d.p)
  assert.deepEqual(d.calls, ['modal:press:imodal:1:1:0'])
})
