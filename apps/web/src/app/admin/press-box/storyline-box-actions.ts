import { REPORTER_IDS } from '@eanhl/db/news'
import type {
  PressBoxActor,
  StanceTarget,
  StorylineActionResult,
  StorylineErrorCode,
  TakeInput,
} from '@eanhl/db/queries'
import { parseTakeEdit } from '../../../lib/news/takes-edit.ts'

/**
 * The storyline, stance and take actions of the Press Box (task press-box-l3), written so a test
 * can drive them (the server actions in `actions.ts` pass the real admin check and the real
 * queries). The rule that matters, as in `box-actions.ts`: `requireAdmin` runs first, before
 * anything else, and every change goes through one query that checks the text and writes its audit
 * line in the same transaction. A request with a bad field changes nothing.
 */
export interface StorylineActionDeps {
  /** The admin check: throws (a redirect) when the caller is not the admin. */
  requireAdmin(): Promise<PressBoxActor>
  now(): Date
  createStorylineWithAudit(args: {
    title: string
    angle: string
    actor: PressBoxActor
    now: Date
  }): Promise<StorylineActionResult>
  pinStorylineWithAudit(args: StorylineRefArgs): Promise<StorylineActionResult>
  unpinStorylineWithAudit(args: StorylineRefArgs): Promise<StorylineActionResult>
  closeStorylineWithAudit(args: StorylineRefArgs): Promise<StorylineActionResult>
  addStanceWithAudit(args: {
    target: StanceTarget
    reporter: string
    text: string
    actor: PressBoxActor
    now: Date
  }): Promise<StorylineActionResult>
  editStanceWithAudit(args: {
    id: number
    text: string
    actor: PressBoxActor
    now: Date
  }): Promise<StorylineActionResult>
  removeStanceWithAudit(args: {
    id: number
    actor: PressBoxActor
    now: Date
  }): Promise<StorylineActionResult>
  addTakeWithAudit(args: {
    reporter: string
    playerId: number
    input: TakeInput
    actor: PressBoxActor
    now: Date
  }): Promise<StorylineActionResult>
  editTakeWithAudit(args: {
    id: number
    input: TakeInput
    actor: PressBoxActor
    now: Date
  }): Promise<StorylineActionResult>
  removeTakeWithAudit(args: {
    id: number
    actor: PressBoxActor
    now: Date
  }): Promise<StorylineActionResult>
}

interface StorylineRefArgs {
  ref: { id: number } | { threadKey: string }
  actor: PressBoxActor
  now: Date
}

export type StorylineOk =
  | 'sl_ok_new'
  | 'sl_ok_pin'
  | 'sl_ok_unpin'
  | 'sl_ok_close'
  | 'sl_ok_stance_add'
  | 'sl_ok_stance_edit'
  | 'sl_ok_stance_remove'
  | 'sl_ok_take_add'
  | 'sl_ok_take_edit'
  | 'sl_ok_take_remove'

export type StorylineNotice =
  | { ok: true; code: StorylineOk }
  | { ok: false; code: 'bad_input' | `sl_${StorylineErrorCode}` }

const str = (v: FormDataEntryValue | null): string | null => (typeof v === 'string' ? v : null)
const fail = (): StorylineNotice => ({ ok: false, code: 'bad_input' })

/** A positive whole number written in digits, else null. */
function idOf(v: FormDataEntryValue | null): number | null {
  const s = str(v)
  if (s === null || !/^[1-9]\d{0,9}$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : null
}

/** `s<id>` (a stored storyline) or `t:<thread key>` (a reporter-system thread). The query checks the key again (its own parser and the stances table). */
export function parseRef(raw: string | null): { id: number } | { threadKey: string } | null {
  if (raw === null) return null
  const s = /^s([1-9]\d{0,9})$/.exec(raw)
  if (s !== null) return { id: Number(s[1]) }
  const t = /^t:([^\r\n]{3,150})$/.exec(raw)
  return t?.[1] === undefined ? null : { threadKey: t[1] }
}

function result(r: StorylineActionResult, ok: StorylineOk): StorylineNotice {
  return r.ok ? { ok: true, code: ok } : { ok: false, code: `sl_${r.code}` }
}

export async function createStorylineBox(
  form: FormData,
  deps: StorylineActionDeps,
): Promise<StorylineNotice> {
  const actor = await deps.requireAdmin()
  const title = str(form.get('title'))
  const angle = str(form.get('angle')) ?? ''
  if (title === null) return fail()
  return result(
    await deps.createStorylineWithAudit({ title, angle, actor, now: deps.now() }),
    'sl_ok_new',
  )
}

async function refAction(
  form: FormData,
  deps: StorylineActionDeps,
  run: (args: StorylineRefArgs) => Promise<StorylineActionResult>,
  ok: StorylineOk,
): Promise<StorylineNotice> {
  const actor = await deps.requireAdmin()
  const ref = parseRef(str(form.get('ref')))
  if (ref === null) return fail()
  return result(await run({ ref, actor, now: deps.now() }), ok)
}

export const pinStorylineBox = (form: FormData, deps: StorylineActionDeps) =>
  refAction(form, deps, (a) => deps.pinStorylineWithAudit(a), 'sl_ok_pin')
export const unpinStorylineBox = (form: FormData, deps: StorylineActionDeps) =>
  refAction(form, deps, (a) => deps.unpinStorylineWithAudit(a), 'sl_ok_unpin')
export const closeStorylineBox = (form: FormData, deps: StorylineActionDeps) =>
  refAction(form, deps, (a) => deps.closeStorylineWithAudit(a), 'sl_ok_close')

export async function addStanceBox(
  form: FormData,
  deps: StorylineActionDeps,
): Promise<StorylineNotice> {
  const actor = await deps.requireAdmin()
  // `s<id>` = a storyline typed on the page; `t:<key>` = a reporter thread (stored or not).
  const ref = parseRef(str(form.get('target')))
  const reporter = str(form.get('reporter'))
  const text = str(form.get('text'))
  if (ref === null || reporter === null || text === null) return fail()
  const target: StanceTarget = 'id' in ref ? { storylineId: ref.id } : { threadKey: ref.threadKey }
  return result(
    await deps.addStanceWithAudit({ target, reporter, text, actor, now: deps.now() }),
    'sl_ok_stance_add',
  )
}

export async function editStanceBox(
  form: FormData,
  deps: StorylineActionDeps,
): Promise<StorylineNotice> {
  const actor = await deps.requireAdmin()
  const id = idOf(form.get('stance'))
  const text = str(form.get('text'))
  if (id === null || text === null) return fail()
  return result(
    await deps.editStanceWithAudit({ id, text, actor, now: deps.now() }),
    'sl_ok_stance_edit',
  )
}

export async function removeStanceBox(
  form: FormData,
  deps: StorylineActionDeps,
): Promise<StorylineNotice> {
  const actor = await deps.requireAdmin()
  const id = idOf(form.get('stance'))
  if (id === null) return fail()
  return result(
    await deps.removeStanceWithAudit({ id, actor, now: deps.now() }),
    'sl_ok_stance_remove',
  )
}

/** The take fields of the editor form, checked by the existing parser (`takes-edit.ts`). */
function takeFields(form: FormData): TakeInput | null {
  const copy = new FormData()
  for (const [k, v] of form.entries()) copy.append(k, v)
  copy.set('id', '1')
  const parsed = parseTakeEdit(copy)
  return parsed.ok ? parsed.edit : null
}

export async function addTakeBox(
  form: FormData,
  deps: StorylineActionDeps,
): Promise<StorylineNotice> {
  const actor = await deps.requireAdmin()
  const reporter = REPORTER_IDS.find((r) => r === str(form.get('reporter')))
  const playerId = idOf(form.get('playerId'))
  const input = takeFields(form)
  if (reporter === undefined || playerId === null || input === null) return fail()
  return result(
    await deps.addTakeWithAudit({ reporter, playerId, input, actor, now: deps.now() }),
    'sl_ok_take_add',
  )
}

export async function editTakeBox(
  form: FormData,
  deps: StorylineActionDeps,
): Promise<StorylineNotice> {
  const actor = await deps.requireAdmin()
  const id = idOf(form.get('id'))
  const input = takeFields(form)
  if (id === null || input === null) return fail()
  return result(
    await deps.editTakeWithAudit({ id, input, actor, now: deps.now() }),
    'sl_ok_take_edit',
  )
}

export async function removeTakeBox(
  form: FormData,
  deps: StorylineActionDeps,
): Promise<StorylineNotice> {
  const actor = await deps.requireAdmin()
  const id = idOf(form.get('id'))
  if (id === null) return fail()
  return result(await deps.removeTakeWithAudit({ id, actor, now: deps.now() }), 'sl_ok_take_remove')
}

/** What the page says for each notice (fixed text only: no typed text is echoed). */
export const STORYLINE_NOTICE_TEXT: Readonly<Record<string, string>> = {
  sl_ok_new: 'Storyline opened. It is in the change log.',
  sl_ok_pin: 'Pinned. The writers get it as a suggested angle for the next recap and scrums.',
  sl_ok_unpin: 'Unpinned. The writers get no suggested angle.',
  sl_ok_close: 'Storyline closed. No writer reads it.',
  sl_ok_stance_add: 'Stance saved. It is in the change log.',
  sl_ok_stance_edit: 'Stance changed. It is in the change log.',
  sl_ok_stance_remove: 'Stance removed.',
  sl_ok_take_add: 'Take saved. It is in the change log.',
  sl_ok_take_edit: 'Take changed. It is in the change log.',
  sl_ok_take_remove: 'Take removed.',
  sl_bad_title: 'Nothing changed: a title is 1 to 80 characters.',
  sl_bad_angle: 'Nothing changed: the angle is at most 300 characters.',
  sl_bad_stance: 'Nothing changed: a stance is 1 to 400 characters.',
  sl_bad_take: 'Nothing changed: a take is 1 to 1000 characters.',
  sl_bad_data_angle: 'Nothing changed: the data angle is at most 500 characters.',
  sl_crude:
    'Nothing changed: the text has crude language or a slur. The desk never prints those. Write it clean and about hockey only.',
  sl_digits:
    'Nothing changed: a title, an angle or a stance may not hold a digit. The writers only use numbers from the fact sheet.',
  sl_names_out: 'Nothing changed: the text names a player who is on Leave me out.',
  sl_no_storyline: 'Nothing changed: no such storyline (reload the page).',
  sl_closed: 'Nothing changed: that storyline is closed.',
  sl_already_pinned: 'Nothing changed: that storyline is already pinned.',
  sl_not_pinned: 'Nothing changed: that storyline is not pinned.',
  sl_bad_thread: 'Nothing changed: no reporter stance has used that thread.',
  sl_out: 'Nothing changed: that player is on Leave me out.',
  sl_no_player: 'Nothing changed: no such player.',
  sl_bad_reporter: 'Nothing changed: that is not a reporter.',
  sl_bad_spread: 'Nothing changed: choose how many share the take.',
  sl_bad_intensity: 'Nothing changed: intensity is a whole number from -2 to 2.',
  sl_bad_defender: 'Nothing changed: the defender cannot hold the take or be a critic.',
  sl_no_take: 'Nothing changed: no such take (reload the page).',
  sl_take_exists: 'Nothing changed: that reporter already has a take on that player. Edit it.',
  sl_no_stance: 'Nothing changed: no such stance (reload the page).',
}
