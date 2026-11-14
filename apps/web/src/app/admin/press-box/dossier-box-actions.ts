import { PRESS_LEVELS, REPORTER_IDS, type PressLevel, type ReporterId } from '@eanhl/db/news'
import type {
  DossierActionResult,
  DossierErrorCode,
  DossierKey,
  PressBoxActor,
} from '@eanhl/db/queries'

/**
 * The player-dossier actions of the Press Box (task press-box-l2), written so a test can drive them
 * (the server actions in `actions.ts` pass the real admin check and the real queries). The rule
 * that matters, as in `box-actions.ts`: `requireAdmin` runs first, before anything else, and every
 * change goes through one query that writes its audit line in the same transaction. A request with
 * a bad field changes nothing.
 *
 * The web app has no Anthropic key and no bot tokens: "Write/Refresh profile" and "Start an
 * interview" only queue a request (`queueProfileRequest`, `queueInterviewRequest`); the press
 * service does the model call or the interview and counts the cost in the monthly spend.
 */
export interface DossierActionDeps {
  /** The admin check: throws (a redirect) when the caller is not the admin. */
  requireAdmin(): Promise<PressBoxActor>
  now(): Date
  /** The night a GM note is for (the newest game within 6 h, else now). */
  tonight(now: Date): Promise<string>
  setPressLevelWithAudit(args: {
    playerId: number
    level: PressLevel
    actor: PressBoxActor
    now: Date
  }): Promise<DossierActionResult>
  addNicknameWithAudit(args: {
    playerId: number
    nickname: string
    actor: PressBoxActor
    now: Date
  }): Promise<DossierActionResult>
  removeNicknameWithAudit(args: {
    playerId: number
    nickname: string
    actor: PressBoxActor
    now: Date
  }): Promise<DossierActionResult>
  addGmNoteWithAudit(args: {
    playerId: number
    note: string
    night: string
    actor: PressBoxActor
    now: Date
  }): Promise<DossierActionResult>
  queueProfileRequest(args: {
    key: DossierKey
    actor: PressBoxActor
    now: Date
  }): Promise<DossierActionResult>
  queueInterviewRequest(args: {
    key: DossierKey
    reporter: ReporterId | null
    topic: string | null
    actor: PressBoxActor
    now: Date
  }): Promise<DossierActionResult>
}

export type DossierNoticeCode =
  | 'level'
  | 'nick_added'
  | 'nick_removed'
  | 'note'
  | 'profile_queued'
  | 'interview_queued'

export type DossierNotice =
  | { ok: true; code: DossierNoticeCode }
  | { ok: false; code: 'bad_input' | DossierErrorCode }

/**
 * The person of a dossier form: "12" for a member, "u<Discord id>" for a bench person. The same
 * rule as `parseDossierKey` in `@eanhl/db/queries`, repeated here because that module opens the
 * database connection when it is loaded (a test cross-checks the two).
 */
export function parseKey(raw: string): DossierKey | null {
  if (/^[1-9]\d{0,9}$/.test(raw)) return { playerId: Number(raw) }
  const m = /^u(\d{17,20})$/.exec(raw)
  return m === null ? null : { discordUserId: m[1]! }
}

const str = (v: FormDataEntryValue | null): string | null => (typeof v === 'string' ? v : null)

/** The person of a dossier form: a member (`key` = "12") or a bench person (`key` = "u<id>"). */
function keyOf(form: FormData): DossierKey | null {
  const raw = str(form.get('key'))
  return raw === null ? null : parseKey(raw)
}

/** The member id of a form that only a member can use (a bench person has no press level, nicknames or notes). */
function memberOf(form: FormData): number | null {
  const key = keyOf(form)
  return key !== null && 'playerId' in key ? key.playerId : null
}

const fail = (code: 'bad_input' | DossierErrorCode): DossierNotice => ({ ok: false, code })
const done = (r: DossierActionResult, code: DossierNoticeCode): DossierNotice =>
  r.ok ? { ok: true, code } : { ok: false, code: r.code }

export async function pressLevelBox(
  form: FormData,
  deps: DossierActionDeps,
): Promise<DossierNotice> {
  const actor = await deps.requireAdmin()
  const playerId = memberOf(form)
  const level = PRESS_LEVELS.find((l) => l === str(form.get('level')))
  if (playerId === null || level === undefined) return fail('bad_input')
  return done(
    await deps.setPressLevelWithAudit({ playerId, level, actor, now: deps.now() }),
    'level',
  )
}

export async function addNicknameBox(
  form: FormData,
  deps: DossierActionDeps,
): Promise<DossierNotice> {
  const actor = await deps.requireAdmin()
  const playerId = memberOf(form)
  const nickname = str(form.get('nickname'))
  if (playerId === null || nickname === null) return fail('bad_input')
  return done(
    await deps.addNicknameWithAudit({ playerId, nickname, actor, now: deps.now() }),
    'nick_added',
  )
}

export async function removeNicknameBox(
  form: FormData,
  deps: DossierActionDeps,
): Promise<DossierNotice> {
  const actor = await deps.requireAdmin()
  const playerId = memberOf(form)
  const nickname = str(form.get('nickname'))
  if (playerId === null || nickname === null) return fail('bad_input')
  return done(
    await deps.removeNicknameWithAudit({ playerId, nickname, actor, now: deps.now() }),
    'nick_removed',
  )
}

export async function gmNoteBox(form: FormData, deps: DossierActionDeps): Promise<DossierNotice> {
  const actor = await deps.requireAdmin()
  const playerId = memberOf(form)
  const note = str(form.get('note'))
  if (playerId === null || note === null) return fail('bad_input')
  const now = deps.now()
  const night = await deps.tonight(now)
  return done(await deps.addGmNoteWithAudit({ playerId, note, night, actor, now }), 'note')
}

export async function profileBox(form: FormData, deps: DossierActionDeps): Promise<DossierNotice> {
  const actor = await deps.requireAdmin()
  const key = keyOf(form)
  if (key === null) return fail('bad_input')
  return done(await deps.queueProfileRequest({ key, actor, now: deps.now() }), 'profile_queued')
}

export async function interviewBox(
  form: FormData,
  deps: DossierActionDeps,
): Promise<DossierNotice> {
  const actor = await deps.requireAdmin()
  const key = keyOf(form)
  if (key === null) return fail('bad_input')
  const reporterRaw = str(form.get('reporter'))
  // An empty choice means "the press service chooses"; anything else must be a real reporter.
  const reporter =
    reporterRaw === null || reporterRaw === '' ? null : REPORTER_IDS.find((r) => r === reporterRaw)
  if (reporter === undefined) return fail('bad_reporter')
  const topicRaw = str(form.get('topic'))
  const topic = topicRaw === null || topicRaw.trim() === '' ? null : topicRaw
  return done(
    await deps.queueInterviewRequest({ key, reporter, topic, actor, now: deps.now() }),
    'interview_queued',
  )
}

/** What the page says for each dossier notice (fixed text only: nothing from the request is echoed). */
export const DOSSIER_NOTICE_TEXT: Readonly<Record<string, string>> = {
  level: 'Press level saved on the player’s behalf. It is in the change log.',
  nick_added: 'Nickname added.',
  nick_removed: 'Nickname removed.',
  note: 'GM note saved for tonight’s night. The next recap may use it.',
  profile_queued:
    'Profile requested. The press service writes it within a minute; reload to see it.',
  interview_queued:
    'Interview requested. The press service posts the offer within a minute (open for 30 minutes).',
  bad_nickname: 'Nothing changed: a nickname is 2 to 24 letters or digits, and not a filler word.',
  nick_taken: 'Nothing changed: that nickname already belongs to another player.',
  nick_exists: 'Nothing changed: this player already has that nickname.',
  nick_missing: 'Nothing changed: this player has no such nickname.',
  bad_note: 'Nothing changed: a GM note is 1 to 500 characters.',
  note_names_out: 'Nothing changed: the note names a player who is on Leave me out.',
  note_easy:
    'Nothing changed: this player is on Go easy. A note about them needs the criticism check: use /gm note in Discord.',
  request_open: 'Nothing changed: the same request for this person is already waiting.',
  not_linked:
    'Nothing changed: this player has no linked Discord account, so no interview can be offered.',
  bad_reporter: 'Nothing changed: that reporter does not exist.',
  bad_topic: 'Nothing changed: the topic is too long (300 characters at most).',
}
