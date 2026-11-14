import { BACKGROUND_PARTS, type BackgroundPart } from '@eanhl/db/schema'
import type {
  BackgroundActionResult,
  BackgroundErrorCode,
  DossierKey,
  FactAction,
  PressBoxActor,
} from '@eanhl/db/queries'
import { parseKey } from './dossier-box-actions.ts'

/**
 * The Background actions of a Press Box dossier (task background-b1), written so a test can drive
 * them (the server actions in `actions.ts` pass the real admin check and the real queries). The
 * rule that matters, as in `dossier-box-actions.ts`: `requireAdmin` runs first, before anything
 * else, and every change goes through one query that writes its audit line in the same
 * transaction. A request with a bad field changes nothing.
 */
export interface BackgroundActionDeps {
  /** The admin check: throws (a redirect) when the caller is not the admin. */
  requireAdmin(): Promise<PressBoxActor>
  now(): Date
  addBackgroundFactWithAudit(args: {
    key: DossierKey
    part: BackgroundPart | null
    text: string
    subjectPlayerId: number | null
    questionId: number | null
    actor: PressBoxActor
    now: Date
  }): Promise<BackgroundActionResult>
  decideBackgroundFactWithAudit(args: {
    factId: number
    action: FactAction
    actor: PressBoxActor
    now: Date
  }): Promise<BackgroundActionResult>
  editBackgroundFactWithAudit(args: {
    factId: number
    text: string
    confirm: boolean
    actor: PressBoxActor
    now: Date
  }): Promise<BackgroundActionResult>
}

export type BackgroundNoticeCode =
  | 'bg_added'
  | 'bg_confirmed'
  | 'bg_edited'
  | 'bg_rejected'
  | 'bg_removed'

export type BackgroundNotice =
  | { ok: true; code: BackgroundNoticeCode }
  | { ok: false; code: 'bad_input' | `bg_${BackgroundErrorCode}` }

const str = (v: FormDataEntryValue | null): string | null => (typeof v === 'string' ? v : null)

/** A positive whole number from a form field, or null. */
function idOf(v: FormDataEntryValue | null): number | null {
  const s = str(v)
  return s !== null && /^[1-9]\d{0,9}$/.test(s) ? Number(s) : null
}

const fail = (code: 'bad_input'): BackgroundNotice => ({ ok: false, code })

function done(r: BackgroundActionResult, code: BackgroundNoticeCode): BackgroundNotice {
  return r.ok ? { ok: true, code } : { ok: false, code: `bg_${r.code}` }
}

/** Type a fact (or answer a bank question): the person, the text, optional part, teammate and question. */
export async function addBackgroundBox(
  form: FormData,
  deps: BackgroundActionDeps,
): Promise<BackgroundNotice> {
  const actor = await deps.requireAdmin()
  const raw = str(form.get('key'))
  const key = raw === null ? null : parseKey(raw)
  const text = str(form.get('text'))
  if (key === null || text === null) return fail('bad_input')
  const questionRaw = str(form.get('question'))
  const questionId = questionRaw === null || questionRaw === '' ? null : idOf(form.get('question'))
  if (questionRaw !== null && questionRaw !== '' && questionId === null) return fail('bad_input')
  const subjectRaw = str(form.get('subject'))
  const subjectPlayerId =
    subjectRaw === null || subjectRaw === '' ? null : idOf(form.get('subject'))
  if (subjectRaw !== null && subjectRaw !== '' && subjectPlayerId === null) return fail('bad_input')
  const partRaw = str(form.get('part'))
  const part = BACKGROUND_PARTS.find((p) => p === partRaw) ?? null
  // With a question the part is the question's own; without one the form must name a real part.
  if (questionId === null && part === null) return fail('bad_input')
  return done(
    await deps.addBackgroundFactWithAudit({
      key,
      part,
      text,
      subjectPlayerId,
      questionId,
      actor,
      now: deps.now(),
    }),
    'bg_added',
  )
}

async function decide(
  form: FormData,
  deps: BackgroundActionDeps,
  action: FactAction,
  code: BackgroundNoticeCode,
): Promise<BackgroundNotice> {
  const actor = await deps.requireAdmin()
  const factId = idOf(form.get('fact'))
  if (factId === null) return fail('bad_input')
  return done(
    await deps.decideBackgroundFactWithAudit({ factId, action, actor, now: deps.now() }),
    code,
  )
}

export async function confirmBackgroundBox(
  form: FormData,
  deps: BackgroundActionDeps,
): Promise<BackgroundNotice> {
  return decide(form, deps, 'confirm', 'bg_confirmed')
}

export async function rejectBackgroundBox(
  form: FormData,
  deps: BackgroundActionDeps,
): Promise<BackgroundNotice> {
  return decide(form, deps, 'reject', 'bg_rejected')
}

export async function removeBackgroundBox(
  form: FormData,
  deps: BackgroundActionDeps,
): Promise<BackgroundNotice> {
  return decide(form, deps, 'delete', 'bg_removed')
}

export async function editBackgroundBox(
  form: FormData,
  deps: BackgroundActionDeps,
): Promise<BackgroundNotice> {
  const actor = await deps.requireAdmin()
  const factId = idOf(form.get('fact'))
  const text = str(form.get('text'))
  if (factId === null || text === null) return fail('bad_input')
  return done(
    await deps.editBackgroundFactWithAudit({
      factId,
      text,
      confirm: str(form.get('confirm')) === '1',
      actor,
      now: deps.now(),
    }),
    'bg_edited',
  )
}

/** What the page says for each background notice (fixed text only: no fact text is echoed). */
export const BACKGROUND_NOTICE_TEXT: Readonly<Record<string, string>> = {
  bg_added: 'Fact saved and confirmed. It is in the change log.',
  bg_confirmed: 'Fact confirmed. The profile writer may use it now.',
  bg_edited: 'Fact changed. It is in the change log.',
  bg_rejected: 'Fact rejected. No writer will use it.',
  bg_removed: 'Fact removed. No writer will use it.',
  bg_no_person: 'Nothing changed: no such person.',
  bg_no_fact: 'Nothing changed: no such fact.',
  bg_bad_state: 'Nothing changed: the fact is not in the right state for that (reload the page).',
  bg_bad_fact: 'Nothing changed: a fact is 1 to 400 characters.',
  bg_bad_part: 'Nothing changed: choose a part for the fact.',
  bg_bad_subject: 'Nothing changed: the teammate is not a club player, or is the same person.',
  bg_bad_question: 'Nothing changed: that question is not open for this person.',
}
