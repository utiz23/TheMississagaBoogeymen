import { REPORTERS, REPORTER_IDS } from '@eanhl/db/news'
import {
  ApplicationCommandOptionType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js'
import type { PressConfig } from './config.ts'
import type { InteractionInput } from './gateway.ts'
import {
  INTERVIEW_TOPIC_MAX_CHARS,
  onGmInterview,
  onInterviewAccept,
  onInterviewAnswerButton,
  onInterviewAnswerSubmit,
  onInterviewCommand,
  onInterviewTypedAnswer,
} from './interview.ts'
import { onTypedAnswer, type Reply } from './interactions.ts'
import type { PressDeps } from './pass.ts'

/**
 * The interviews' side of the gateway: their slash commands (`/interview`,
 * `/gm interview`), their custom ids (`press:iaccept:<id>`,
 * `press:ianswer:<id>`, `press:imodal:<id>:<questionsAsked>:<followupsAsked>`)
 * and their typed answers. Kept out of gateway.ts so the scrum work (T2) and
 * this work touch that file only in three one-line hooks.
 */

/** An interview custom id, parsed; null when it is not one. */
export type InterviewRoute =
  | { kind: 'iaccept' | 'ianswer'; id: number }
  | { kind: 'imodal'; id: number; questionsAsked: number; followupsAsked: number }

const ID_RE = /^[1-9][0-9]{0,14}$/
const COUNT_RE = /^[0-9]{1,6}$/

export function routeInterviewId(customId: string): InterviewRoute | null {
  const [prefix, kind, ...rest] = customId.split(':')
  if (prefix !== 'press') return null
  if (kind === 'imodal') {
    const [id, q, f] = rest
    if (rest.length !== 3 || !ID_RE.test(id!) || !COUNT_RE.test(q!) || !COUNT_RE.test(f!)) {
      return null
    }
    return { kind, id: Number(id), questionsAsked: Number(q), followupsAsked: Number(f) }
  }
  if ((kind === 'iaccept' || kind === 'ianswer') && rest.length === 1 && ID_RE.test(rest[0]!)) {
    return { kind, id: Number(rest[0]) }
  }
  return null
}

/** The `interview` subcommand of `/gm`. */
export function gmInterviewSubcommand() {
  return {
    type: ApplicationCommandOptionType.Subcommand,
    name: 'interview',
    description: 'Offer a player a sit-down interview (about 7 questions, then a Q&A)',
    options: [
      {
        type: ApplicationCommandOptionType.User,
        name: 'player',
        description: 'The player to interview',
        required: true,
      },
      {
        type: ApplicationCommandOptionType.String,
        name: 'reporter',
        description: 'Who asks (default: the rotation)',
        choices: REPORTER_IDS.map((id) => ({ name: REPORTERS[id].name, value: id })),
      },
      {
        type: ApplicationCommandOptionType.String,
        name: 'topic',
        description: 'What the interview should cover',
        max_length: INTERVIEW_TOPIC_MAX_CHARS,
      },
    ],
  } as const
}

/** The `/interview` command: a player asks for their own interview. */
export function interviewCommand(): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return {
    name: 'interview',
    description:
      'Sit down with a reporter: about 7 questions, then a Q&A on the site (once a week)',
  }
}

/**
 * The command set with the interview commands added: `/interview`, and the
 * `interview` subcommand appended to `/gm`. The input is not changed.
 */
export function withInterviewCommands(
  defs: readonly RESTPostAPIChatInputApplicationCommandsJSONBody[],
): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const out = defs.map((d) =>
    d.name === 'gm'
      ? ({
          ...d,
          options: [...(d.options ?? []), gmInterviewSubcommand()],
        } as RESTPostAPIChatInputApplicationCommandsJSONBody)
      : d,
  )
  if (!out.some((d) => d.name === 'interview')) out.push(interviewCommand())
  return out
}

/** How the router opens the response, as in gateway.ts (`reply` = private defer, `none` = the pop-up). */
export interface InterviewPlan {
  kind: string
  open: 'reply' | 'none'
  run: () => Promise<Reply>
}

function option<T extends string>(
  options: Record<string, string | number | boolean>,
  name: string,
): T | null {
  const v = options[name]
  return typeof v === 'string' ? (v as T) : null
}

/**
 * The plan for an interview interaction, or null when it is not one (the
 * scrum router goes on). Used first by `createRouter` in gateway.ts.
 */
export function interviewPlan(
  input: InteractionInput,
  deps: PressDeps,
  config: PressConfig,
): InterviewPlan | null {
  const u = input.userId
  if (input.type === 'command') {
    if (input.name === 'interview' && input.subcommand === null) {
      return { kind: 'interview', open: 'reply', run: () => onInterviewCommand(deps, config, u) }
    }
    if (input.name === 'gm' && input.subcommand === 'interview') {
      const o = input.options
      return {
        kind: 'gm interview',
        open: 'reply',
        run: () =>
          onGmInterview(deps, config, u, {
            player: option(o, 'player'),
            reporter: option(o, 'reporter'),
            topic: option(o, 'topic'),
          }),
      }
    }
    return null
  }
  const r = routeInterviewId(input.customId)
  if (r === null) return null
  if (input.type === 'modal') {
    if (r.kind !== 'imodal') return null
    const seen = { questionsAsked: r.questionsAsked, followupsAsked: r.followupsAsked }
    return {
      kind: 'interview submit',
      open: 'reply',
      run: () => onInterviewAnswerSubmit(deps, config, r.id, u, input.text, seen),
    }
  }
  if (input.type !== 'button') return null
  if (r.kind === 'iaccept') {
    return {
      kind: 'interview accept',
      open: 'reply',
      run: () => onInterviewAccept(deps, config, r.id, u),
    }
  }
  if (r.kind === 'ianswer') {
    return {
      kind: 'interview answer',
      open: 'none',
      run: () => onInterviewAnswerButton(deps, config, r.id, u),
    }
  }
  return null
}

/**
 * A message in a thread (typed answers, `PRESS_TYPED_ANSWERS=1`): an
 * interview answer when this user has an interview question open in this
 * thread, else the scrum path (`onTypedAnswer`, unchanged).
 */
export async function onPressThreadMessage(
  deps: PressDeps,
  config: PressConfig,
  msg: { threadId: string; userId: string; text: string },
): Promise<void> {
  if (await onInterviewTypedAnswer(deps, config, msg)) return
  await onTypedAnswer(deps, config, msg)
}
