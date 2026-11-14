import { REPORTER_IDS, REL_LEVELS, type RelLevel, type ReporterId } from '@eanhl/db/news'
import type {
  PressBoxActor,
  RelationshipAction,
  RelationshipActionResult,
  RelationshipErrorCode,
} from '@eanhl/db/queries'

/**
 * The Press Box actions, written so a test can drive them (the server actions in `actions.ts`
 * pass the real admin check and the real queries). The rule that matters: `requireAdmin` runs
 * first, before anything else, and every change goes through one query that writes its audit line
 * in the same transaction. A request with a bad field changes nothing.
 */
export interface PressBoxActionDeps {
  /** The admin check: throws (a redirect) when the caller is not the admin. */
  requireAdmin(): Promise<PressBoxActor>
  now(): Date
  setHeatWithAudit(args: {
    heat: 'cool' | 'normal' | 'hot'
    scope: 'next' | 'night'
    night: string | null
    actor: PressBoxActor
    now: Date
  }): Promise<void>
  /** The night key a "tonight" heat is tied to (the newest game within 6 h, else now). */
  tonight(now: Date): Promise<string>
  hasOpenTestScrum(): Promise<boolean>
  queueTestScrum(args: { actor: PressBoxActor; now: Date }): Promise<number>
  applyRelationshipAction(args: {
    playerId: number
    reporter: ReporterId
    action: RelationshipAction
    actor: PressBoxActor
    now: Date
  }): Promise<RelationshipActionResult>
}

export type ActionNotice =
  | { ok: true; code: 'heat' | 'testscrum' | 'relationship' }
  | { ok: false; code: 'bad_input' | 'test_scrum_open' | RelationshipErrorCode }

const HEATS = ['cool', 'normal', 'hot'] as const
const SCOPES = ['next', 'night'] as const

const str = (v: FormDataEntryValue | null): string | null => (typeof v === 'string' ? v : null)

/** A positive whole number written in digits, else null. */
export function parseId(raw: string | null): number | null {
  if (raw === null || !/^[1-9]\d{0,9}$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : null
}

export async function setHeatBox(form: FormData, deps: PressBoxActionDeps): Promise<ActionNotice> {
  const actor = await deps.requireAdmin()
  const heat = HEATS.find((h) => h === str(form.get('heat')))
  const scope = SCOPES.find((s) => s === str(form.get('scope')))
  if (heat === undefined || scope === undefined) return { ok: false, code: 'bad_input' }
  const now = deps.now()
  const night = scope === 'night' ? await deps.tonight(now) : null
  await deps.setHeatWithAudit({ heat, scope, night, actor, now })
  return { ok: true, code: 'heat' }
}

export async function runTestScrumBox(deps: PressBoxActionDeps): Promise<ActionNotice> {
  const actor = await deps.requireAdmin()
  if (await deps.hasOpenTestScrum()) return { ok: false, code: 'test_scrum_open' }
  await deps.queueTestScrum({ actor, now: deps.now() })
  return { ok: true, code: 'testscrum' }
}

/** Reads the relationship form's action; null when a field is missing or wrong. */
export function parseRelationshipForm(form: FormData): {
  playerId: number
  reporter: ReporterId
  action: RelationshipAction
} | null {
  const playerId = parseId(str(form.get('playerId')))
  const reporterRaw = str(form.get('reporter'))
  const reporter = REPORTER_IDS.find((r) => r === reporterRaw)
  if (playerId === null || reporter === undefined) return null
  const kind = str(form.get('kind'))
  switch (kind) {
    case 'cooldown':
    case 'reset':
    case 'freeze':
    case 'unfreeze':
    case 'level_clear':
      return { playerId, reporter, action: { kind } }
    case 'level': {
      const level = REL_LEVELS.find((l) => l === str(form.get('level')))
      const reason = str(form.get('reason'))
      if (level === undefined || reason === null) return null
      return { playerId, reporter, action: { kind, level: level as RelLevel, reason } }
    }
    default:
      return null
  }
}

export async function relationshipBox(
  form: FormData,
  deps: PressBoxActionDeps,
): Promise<ActionNotice> {
  const actor = await deps.requireAdmin()
  const parsed = parseRelationshipForm(form)
  if (parsed === null) return { ok: false, code: 'bad_input' }
  const result = await deps.applyRelationshipAction({ ...parsed, actor, now: deps.now() })
  return result.ok ? { ok: true, code: 'relationship' } : { ok: false, code: result.code }
}

/** What the page says for each notice (fixed text only: nothing from the request is echoed). */
export const NOTICE_TEXT: Readonly<Record<string, string>> = {
  heat: 'Heat saved.',
  testscrum: 'Test scrum requested. The press service starts it within a minute.',
  relationship: 'Saved.',
  bad_input: 'Nothing changed: the form was not complete.',
  test_scrum_open: 'A test scrum request is already waiting.',
  out: 'Nothing changed: this player is on Leave me out.',
  frozen: 'Nothing changed: this pair is frozen. Unfreeze it first.',
  zero: 'Nothing changed: the points are already at zero.',
  already_frozen: 'Nothing changed: this pair is already frozen.',
  not_frozen: 'Nothing changed: this pair is not frozen.',
  no_reason: 'Nothing changed: write a reason for the change log.',
  reason_long: 'Nothing changed: the reason is too long.',
  bad_level: 'Nothing changed: that level does not exist.',
  range: 'Nothing changed: that level is outside this reporter’s range.',
  easy: 'Nothing changed: this player is on Go easy, so the feud side is never used.',
  no_pin: 'Nothing changed: no level is pinned.',
  no_player: 'Nothing changed: no such player.',
}

/** The notice code from a query string, or null when it is none of ours. */
export function noticeFromQuery(value: string | undefined): string | null {
  return value !== undefined && Object.prototype.hasOwnProperty.call(NOTICE_TEXT, value)
    ? value
    : null
}
