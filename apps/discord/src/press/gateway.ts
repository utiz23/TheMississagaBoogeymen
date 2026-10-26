import { REPORTERS, REPORTER_IDS, type ReporterId } from '@eanhl/db/news'
import {
  ApplicationCommandOptionType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  type CommandInteractionOption,
  type Interaction,
  type InteractionEditReplyOptions,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js'
import {
  deleteBotMessage,
  editBotMessage,
  sendBotMessage,
  sendDirectMessage,
  startThread,
} from '../bot-rest.ts'
import type { PressConfig } from './config.ts'
import { gmNoteComponents, onGmHeat, onGmNote, onGmNoteCancel, onGmNoteCorrect } from './gm.ts'
import {
  onAccept,
  onAnswerButton,
  onAnswerSubmit,
  onScrumCommand,
  onTalk,
  type Reply,
} from './interactions.ts'
import type { PressDeps, PressDiscordOps } from './pass.ts'
import type { Heat } from './rules.ts'

/**
 * The press bots' gateway side: one discord.js client per reporter, the
 * slash commands on Wade Barlow's application, and the router that turns a
 * button, select, pop-up or command into a call of the pure handlers
 * (interactions.ts, gm.ts). The pure part (`routeCustomId`,
 * `commandDefinitions`, `modalBody`, `createRouter`) is tested; the
 * discord.js glue under it only converts. Messages still go out over REST
 * (`restDiscordOps`) with each reporter's token: the clients receive.
 *
 * Discord allows 3 seconds for the first response. Every handler that can
 * call the model or Discord is deferred first (a private "thinking" reply,
 * or `deferUpdate` for the GM note's own controls); only Answer, which opens
 * the pop-up, answers directly. No error leaves a handler: it is logged
 * (`[press] interaction <kind>: <reason>`) and the user gets FAILED_TEXT.
 */

export const FAILED_TEXT = 'Something went wrong — try again.'
/** The custom id of the pop-up's text input. */
export const ANSWER_INPUT_ID = 'answer'

/** A press custom id, parsed. Ids are positive; the counters can be 0. */
export type Route =
  | { kind: 'talk' | 'accept' | 'answer' | 'gmfix' | 'gmcancel'; id: number }
  | { kind: 'modal'; id: number; questionsAsked: number; followupsAsked: number }

const ID_RE = /^[1-9][0-9]{0,14}$/
const COUNT_RE = /^[0-9]{1,6}$/
const SIMPLE_KINDS = new Set(['talk', 'accept', 'answer', 'gmfix', 'gmcancel'])

/** `press:<kind>:<id>` or `press:modal:<personId>:<questionsAsked>:<followupsAsked>`; else null. */
export function routeCustomId(customId: string): Route | null {
  const [prefix, kind, ...rest] = customId.split(':')
  if (prefix !== 'press' || kind === undefined) return null
  if (kind === 'modal') {
    const [id, q, f] = rest
    if (rest.length !== 3 || !ID_RE.test(id!) || !COUNT_RE.test(q!) || !COUNT_RE.test(f!)) {
      return null
    }
    return { kind, id: Number(id), questionsAsked: Number(q), followupsAsked: Number(f) }
  }
  if (!SIMPLE_KINDS.has(kind) || rest.length !== 1 || !ID_RE.test(rest[0]!)) return null
  return { kind: kind as Exclude<Route['kind'], 'modal'>, id: Number(rest[0]) }
}

const HEATS: readonly Heat[] = ['cool', 'normal', 'hot']
const SCOPES = ['next', 'night'] as const

/**
 * The guild commands on Barlow's application. `/gm` is hidden from everyone
 * but admins (`default_member_permissions: '0'`); the handlers still check
 * the GM's id.
 */
export function commandDefinitions(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return [
    {
      name: 'scrum',
      description: 'Talk to the press about your latest game, or send them to a teammate',
      options: [
        {
          type: ApplicationCommandOptionType.User,
          name: 'player',
          description: 'A teammate from that game for the press to ask',
        },
        {
          type: ApplicationCommandOptionType.Boolean,
          name: 'random',
          description: 'The press picks a teammate from that game',
        },
      ],
    },
    {
      name: 'gm',
      description: 'GM tools for the press',
      default_member_permissions: '0',
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: 'note',
          description: 'A note for the reporters about a player',
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: 'text',
              description: 'The note',
              required: true,
              max_length: 1000,
            },
            {
              type: ApplicationCommandOptionType.Integer,
              name: 'game',
              description: "Tonight's game number (1 = the first game)",
              min_value: 1,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: 'heat',
          description: 'How hard the questions are',
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: 'level',
              description: 'The heat',
              required: true,
              choices: [
                { name: 'Cool', value: 'cool' },
                { name: 'Normal', value: 'normal' },
                { name: 'Hot', value: 'hot' },
              ],
            },
            {
              type: ApplicationCommandOptionType.String,
              name: 'scope',
              description: 'For the next scrum or for all of tonight',
              required: true,
              choices: [
                { name: 'Next scrum', value: 'next' },
                { name: 'Tonight', value: 'night' },
              ],
            },
          ],
        },
      ],
    },
  ]
}

/** The answer pop-up for a `modal` reply: one required paragraph input. */
export function modalBody(reply: Extract<Reply, { kind: 'modal' }>) {
  return {
    custom_id: reply.customId,
    title: reply.title,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: ANSWER_INPUT_ID,
            style: 2,
            label: reply.label,
            max_length: reply.maxLength,
            required: true,
          },
        ],
      },
    ],
  }
}

// ── The router (pure over a port) ────────────────────────────────────────────

/** One interaction, without discord.js. A user option's value is the user's id. */
export type InteractionInput =
  | { type: 'button'; customId: string; userId: string }
  | { type: 'select'; customId: string; userId: string; values: string[] }
  | { type: 'modal'; customId: string; userId: string; text: string }
  | {
      type: 'command'
      name: string
      subcommand: string | null
      userId: string
      options: Record<string, string | number | boolean>
    }

/** The responses the router uses. Every reply is private (ephemeral). */
export interface InteractionPort {
  deferReply(): Promise<void>
  deferUpdate(): Promise<void>
  reply(text: string): Promise<void>
  /** After `deferReply`: the private reply. After `deferUpdate`: the message the control is on. */
  editReply(body: { content: string; components?: unknown[] }): Promise<void>
  deleteReply(): Promise<void>
  followUp(text: string): Promise<void>
  showModal(body: ReturnType<typeof modalBody>): Promise<void>
}

export interface PressHandlers {
  onTalk: typeof onTalk
  onAccept: typeof onAccept
  onAnswerButton: typeof onAnswerButton
  onAnswerSubmit: typeof onAnswerSubmit
  onScrumCommand: typeof onScrumCommand
  onGmNote: typeof onGmNote
  onGmNoteCorrect: typeof onGmNoteCorrect
  onGmNoteCancel: typeof onGmNoteCancel
  onGmHeat: typeof onGmHeat
}

const HANDLERS: PressHandlers = {
  onTalk,
  onAccept,
  onAnswerButton,
  onAnswerSubmit,
  onScrumCommand,
  onGmNote,
  onGmNoteCorrect,
  onGmNoteCancel,
  onGmHeat,
}

/** How the first response is made: a private defer, an update defer, or none (Answer). */
type Open = 'reply' | 'update' | 'none'

interface Plan {
  kind: string
  open: Open
  /** Remove the note message's controls (Cancel). */
  clearComponents?: boolean
  run: () => Promise<Reply & { noteId?: number; choices?: { playerId: number; name: string }[] }>
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** A select's single value as a player id; anything else throws (FAILED_TEXT). */
function playerIdOf(values: readonly string[]): number {
  const v = values[0] ?? ''
  if (values.length !== 1 || !ID_RE.test(v)) throw new Error('bad player value')
  return Number(v)
}

function option<T extends string | number | boolean>(
  options: Record<string, string | number | boolean>,
  name: string,
  type: 'string' | 'number' | 'boolean',
): T | null {
  const v = options[name]
  return typeof v === type ? (v as T) : null
}

/**
 * The interaction router. One per process, shared by all nine clients (a
 * reporter's own messages carry the buttons, so any client can receive
 * one). Never throws.
 */
export function createRouter(args: {
  deps: PressDeps
  config: PressConfig
  log: (m: string) => void
  debug: (m: string) => void
  handlers?: PressHandlers
}): (input: InteractionInput, port: InteractionPort) => Promise<void> {
  const { deps, config, log, debug, handlers: h = HANDLERS } = args
  const ignored = new Set<string>()

  function plan(input: InteractionInput): Plan | null {
    const u = input.userId
    if (input.type === 'command') {
      const o = input.options
      if (input.name === 'scrum' && input.subcommand === null) {
        return {
          kind: 'scrum',
          open: 'reply',
          run: () =>
            h.onScrumCommand(deps, config, u, {
              player: option<string>(o, 'player', 'string'),
              random: option<boolean>(o, 'random', 'boolean') === true,
            }),
        }
      }
      if (input.name === 'gm' && input.subcommand === 'note') {
        return {
          kind: 'gm note',
          open: 'reply',
          run: () =>
            h.onGmNote(
              deps,
              config,
              u,
              option<string>(o, 'text', 'string') ?? '',
              option<number>(o, 'game', 'number'),
            ),
        }
      }
      if (input.name === 'gm' && input.subcommand === 'heat') {
        return {
          kind: 'gm heat',
          open: 'reply',
          run: () => {
            const level = option<string>(o, 'level', 'string')
            const scope = option<string>(o, 'scope', 'string')
            const heat = HEATS.find((x) => x === level)
            const sc = SCOPES.find((x) => x === scope)
            if (heat === undefined || sc === undefined) throw new Error('bad heat option')
            return h.onGmHeat(deps, config, u, heat, sc)
          },
        }
      }
      return null
    }

    const r = routeCustomId(input.customId)
    if (r === null) return null
    if (input.type === 'modal') {
      if (r.kind !== 'modal') return null
      const seen = { questionsAsked: r.questionsAsked, followupsAsked: r.followupsAsked }
      return {
        kind: 'submit',
        open: 'reply',
        run: () => h.onAnswerSubmit(deps, config, r.id, u, input.text, seen),
      }
    }
    if (input.type === 'select') {
      if (r.kind !== 'gmfix') return null
      const values = input.values
      return {
        kind: 'gmfix',
        open: 'update',
        run: () => h.onGmNoteCorrect(deps, config, u, r.id, playerIdOf(values)),
      }
    }
    switch (r.kind) {
      case 'talk':
        return { kind: 'talk', open: 'reply', run: () => h.onTalk(deps, config, r.id, u) }
      case 'accept':
        return { kind: 'accept', open: 'reply', run: () => h.onAccept(deps, config, r.id, u) }
      case 'answer':
        return {
          kind: 'answer',
          open: 'none',
          run: () => h.onAnswerButton(deps, config, r.id, u),
        }
      case 'gmcancel':
        return {
          kind: 'gmcancel',
          open: 'update',
          clearComponents: true,
          run: () => h.onGmNoteCancel(deps, config, u, r.id),
        }
      default:
        return null
    }
  }

  return async (input, port) => {
    const p = plan(input)
    if (p === null) {
      const what =
        input.type === 'command'
          ? `command ${input.name}`
          : `${input.type} ${input.customId.split(':').slice(0, 2).join(':')}`
      if (!ignored.has(what)) {
        ignored.add(what)
        debug(`[press] ignored interaction: ${what}`)
      }
      return
    }

    // What has been sent: nothing, a private defer, or an update defer; `done` = answered.
    let state: Open = 'none'
    let done = false
    try {
      if (p.open === 'reply') await port.deferReply()
      if (p.open === 'update') await port.deferUpdate()
      state = p.open
      const reply = await p.run()
      if (reply.kind === 'modal') {
        if (state !== 'none') throw new Error('a pop-up cannot follow a defer')
        await port.showModal(modalBody(reply))
      } else if (reply.kind === 'ack') {
        if (state === 'reply') await port.deleteReply()
        // A plain ack on an undeferred control: acknowledge with no change.
        if (state === 'none') await port.deferUpdate()
      } else if (state === 'none') {
        await port.reply(reply.text)
      } else {
        const body: { content: string; components?: unknown[] } = { content: reply.text }
        if (p.clearComponents === true) body.components = []
        else if (reply.noteId !== undefined) {
          body.components = gmNoteComponents(reply.noteId, reply.choices ?? [])
        }
        await port.editReply(body)
      }
      done = true
    } catch (err: unknown) {
      log(`[press] interaction ${p.kind}: ${reason(err)}`)
      if (done) return
      try {
        if (state === 'none') await port.reply(FAILED_TEXT)
        else if (state === 'reply') await port.editReply({ content: FAILED_TEXT })
        else await port.followUp(FAILED_TEXT)
      } catch (err2: unknown) {
        log(`[press] interaction ${p.kind}: error reply failed: ${reason(err2)}`)
      }
    }
  }
}

// ── discord.js glue (not unit-tested: it only converts) ──────────────────────

const EPHEMERAL = MessageFlags.Ephemeral
const NO_MENTIONS = { parse: [] as never[] }

function flatOptions(
  data: readonly CommandInteractionOption[],
  into: Record<string, string | number | boolean> = {},
): Record<string, string | number | boolean> {
  for (const o of data) {
    if (o.options !== undefined) flatOptions(o.options, into)
    else if (o.value !== undefined) into[o.name] = o.value
  }
  return into
}

/** A discord.js interaction as router input and port; null = not ours (autocomplete, …). */
function adapt(i: Interaction): { input: InteractionInput; port: InteractionPort } | null {
  if (!(i.isButton() || i.isStringSelectMenu() || i.isModalSubmit() || i.isChatInputCommand())) {
    return null
  }
  const userId = i.user.id
  let input: InteractionInput
  if (i.isButton()) input = { type: 'button', customId: i.customId, userId }
  else if (i.isStringSelectMenu()) {
    input = { type: 'select', customId: i.customId, userId, values: [...i.values] }
  } else if (i.isModalSubmit()) {
    let text = ''
    try {
      text = i.fields.getTextInputValue(ANSWER_INPUT_ID)
    } catch {
      // No such input: an empty answer, which the handler refuses.
    }
    input = { type: 'modal', customId: i.customId, userId, text }
  } else {
    input = {
      type: 'command',
      name: i.commandName,
      subcommand: i.options.getSubcommand(false),
      userId,
      options: flatOptions(i.options.data),
    }
  }

  const port: InteractionPort = {
    deferReply: async () => {
      await i.deferReply({ flags: EPHEMERAL })
    },
    deferUpdate: async () => {
      if (!(i.isMessageComponent() || i.isModalSubmit())) throw new Error('no message to update')
      await i.deferUpdate()
    },
    reply: async (text) => {
      await i.reply({ content: text, flags: EPHEMERAL, allowedMentions: NO_MENTIONS })
    },
    editReply: async (body) => {
      await i.editReply({
        content: body.content,
        allowedMentions: NO_MENTIONS,
        ...(body.components === undefined
          ? {}
          : {
              components: body.components as NonNullable<InteractionEditReplyOptions['components']>,
            }),
      })
    },
    deleteReply: async () => {
      await i.deleteReply()
    },
    followUp: async (text) => {
      await i.followUp({ content: text, flags: EPHEMERAL, allowedMentions: NO_MENTIONS })
    },
    showModal: async (body) => {
      if (i.isModalSubmit()) throw new Error('a pop-up cannot open a pop-up')
      await i.showModal(body as Parameters<typeof i.showModal>[0])
    },
  }
  return { input, port }
}

/** Wire the router to a client's `interactionCreate`. */
export function attachRouter(
  client: Client,
  route: (input: InteractionInput, port: InteractionPort) => Promise<void>,
): void {
  client.on(Events.InteractionCreate, (i) => {
    const a = adapt(i)
    if (a !== null) void route(a.input, a.port)
  })
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const LOGIN_RETRY_FIRST_MS = 30_000
const LOGIN_RETRY_MAX_MS = 600_000

/** An error message with the token cut out, in case a library ever echoes it. */
function safe(err: unknown, token: string): string {
  const m = reason(err)
  return token === '' ? m : m.split(token).join('<token>')
}

/**
 * One client per reporter: intent Guilds (all), plus GuildMessageReactions
 * and the Message/Reaction/User partials on Barlow (reactions on the
 * reporters' posts, Task 12). Errors and disconnects are logged; discord.js
 * reconnects by itself. A failed login is logged and tried again (30 s,
 * doubling to 10 min); the returned promise waits only for the first try
 * of each, so the press loop never waits on Discord.
 */
export async function startClients(
  config: PressConfig,
  log: (m: string) => void,
): Promise<Map<ReporterId, Client>> {
  const clients = new Map<ReporterId, Client>()
  const first: Promise<void>[] = []
  for (const id of REPORTER_IDS) {
    const barlow = id === 'barlow'
    const client = new Client({
      intents: barlow
        ? [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessageReactions]
        : [GatewayIntentBits.Guilds],
      partials: barlow ? [Partials.Message, Partials.Reaction, Partials.User] : [],
    })
    const token = config.tokens[id]
    const name = REPORTERS[id].name
    client.on(Events.Error, (err) => log(`[press] ${name}: client error: ${safe(err, token)}`))
    client.on(Events.ShardDisconnect, (ev) =>
      log(`[press] ${name}: disconnected (${String(ev.code)})`),
    )
    client.on(Events.ShardResume, () => log(`[press] ${name}: reconnected`))
    clients.set(id, client)

    const loginLoop = async (): Promise<void> => {
      let wait = LOGIN_RETRY_FIRST_MS
      for (;;) {
        await sleep(wait)
        try {
          await client.login(token)
          log(`[press] ${name}: logged in`)
          return
        } catch (err: unknown) {
          wait = Math.min(wait * 2, LOGIN_RETRY_MAX_MS)
          log(`[press] ${name}: login failed: ${safe(err, token)}`)
        }
      }
    }
    first.push(
      client.login(token).then(
        () => undefined,
        (err: unknown) => {
          log(`[press] ${name}: login failed: ${safe(err, token)}`)
          void loginLoop()
        },
      ),
    )
  }
  await Promise.all(first)
  return clients
}

/**
 * Put the full command set on the guild (one PUT: a restart is idempotent,
 * an old command is removed). Waits for Barlow's first ready; logged.
 */
export function registerCommands(barlow: Client, guildId: string, log: (m: string) => void): void {
  const put = (c: Client<true>) => {
    c.application.commands.set(commandDefinitions(), guildId).then(
      (set) => log(`[press] commands registered (${String(set.size)})`),
      (err: unknown) => log(`[press] command registration failed: ${reason(err)}`),
    )
  }
  if (barlow.isReady()) put(barlow)
  else barlow.once(Events.ClientReady, put)
}

/** The deps' Discord side over REST, with each reporter's token; DMs come from Barlow. */
export function restDiscordOps(tokens: Record<ReporterId, string>): PressDiscordOps {
  return {
    send: (r, channelId, msg) => sendBotMessage(tokens[r], channelId, msg),
    edit: (r, channelId, messageId, msg) => editBotMessage(tokens[r], channelId, messageId, msg),
    remove: (r, channelId, messageId) => deleteBotMessage(tokens[r], channelId, messageId),
    thread: (r, channelId, messageId, name) => startThread(tokens[r], channelId, messageId, name),
    dm: (userId, content) => sendDirectMessage(tokens.barlow, userId, content),
  }
}
