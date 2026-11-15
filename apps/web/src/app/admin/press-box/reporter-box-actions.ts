import { REPORTER_IDS, type ReporterId } from '@eanhl/db/news'
import type {
  PressBoxActor,
  ReporterActionResult,
  ReporterEditInput,
  ReporterErrorCode,
} from '@eanhl/db/queries'

/**
 * The reporter actions of the Press Box (task press-box-l4), written so a test can drive them (the
 * server actions in `actions.ts` pass the real admin check and the real queries). The rule that
 * matters, as in `box-actions.ts`: `requireAdmin` runs first, before anything else, and every change
 * goes through one query that checks the text and writes its audit line in the same transaction. A
 * request with a bad field changes nothing.
 *
 * The on/off switch is NOT built again here: `reporterSwitchBox` calls the existing switch
 * (`setReporterEnabledAction` of /admin/news, the switch the writers read).
 *
 * The locked safety rules are not a form field. Nothing in this file reads one from the request.
 */
export interface ReporterActionDeps {
  /** The admin check: throws (a redirect) when the caller is not the admin. */
  requireAdmin(): Promise<PressBoxActor>
  now(): Date
  saveReporterCharacterWithAudit(args: {
    reporter: string
    input: ReporterEditInput
    actor: PressBoxActor
    now: Date
  }): Promise<ReporterActionResult>
  resetReporterCharacterWithAudit(args: {
    reporter: string
    actor: PressBoxActor
    now: Date
  }): Promise<ReporterActionResult>
  queueReporterPreviewWithAudit(args: {
    reporter: string
    actor: PressBoxActor
    now: Date
  }): Promise<ReporterActionResult>
  /** The existing per-reporter switch (`setReporterEnabled`); it checks the admin again itself. */
  setReporterEnabled(reporter: string, enabled: boolean): Promise<void>
}

export type ReporterOk = 'rp_ok_save' | 'rp_ok_reset' | 'rp_ok_preview' | 'rp_ok_on' | 'rp_ok_off'

export type ReporterNotice =
  | { ok: true; code: ReporterOk }
  | { ok: false; code: 'bad_input' | `rp_${ReporterErrorCode}` }

const str = (v: FormDataEntryValue | null): string | null => (typeof v === 'string' ? v : null)
const fail = (): ReporterNotice => ({ ok: false, code: 'bad_input' })

/** The reporter id in a form, or null. */
export function reporterOf(form: FormData): ReporterId | null {
  const v = str(form.get('reporter'))
  return REPORTER_IDS.find((r) => r === v) ?? null
}

function result(r: ReporterActionResult, ok: ReporterOk): ReporterNotice {
  return r.ok ? { ok: true, code: ok } : { ok: false, code: `rp_${r.code}` }
}

export async function saveReporterBox(
  form: FormData,
  deps: ReporterActionDeps,
): Promise<ReporterNotice> {
  const actor = await deps.requireAdmin()
  const reporter = reporterOf(form)
  const bio = str(form.get('bio'))
  const voiceNotes = str(form.get('voiceNotes'))
  const catchphrases = str(form.get('catchphrases'))
  const disposition = str(form.get('disposition'))
  if (
    reporter === null ||
    bio === null ||
    voiceNotes === null ||
    catchphrases === null ||
    disposition === null
  ) {
    return fail()
  }
  return result(
    await deps.saveReporterCharacterWithAudit({
      reporter,
      input: { bio, voiceNotes, catchphrases, disposition },
      actor,
      now: deps.now(),
    }),
    'rp_ok_save',
  )
}

export async function resetReporterBox(
  form: FormData,
  deps: ReporterActionDeps,
): Promise<ReporterNotice> {
  const actor = await deps.requireAdmin()
  const reporter = reporterOf(form)
  if (reporter === null) return fail()
  return result(
    await deps.resetReporterCharacterWithAudit({ reporter, actor, now: deps.now() }),
    'rp_ok_reset',
  )
}

export async function previewReporterBox(
  form: FormData,
  deps: ReporterActionDeps,
): Promise<ReporterNotice> {
  const actor = await deps.requireAdmin()
  const reporter = reporterOf(form)
  if (reporter === null) return fail()
  return result(
    await deps.queueReporterPreviewWithAudit({ reporter, actor, now: deps.now() }),
    'rp_ok_preview',
  )
}

/** On or off, through the existing switch. `enabled` is "1" or "0". */
export async function reporterSwitchBox(
  form: FormData,
  deps: ReporterActionDeps,
): Promise<ReporterNotice> {
  await deps.requireAdmin()
  const reporter = reporterOf(form)
  const enabled = str(form.get('enabled'))
  if (reporter === null || (enabled !== '1' && enabled !== '0')) return fail()
  await deps.setReporterEnabled(reporter, enabled === '1')
  return { ok: true, code: enabled === '1' ? 'rp_ok_on' : 'rp_ok_off' }
}

/** What the page says for each notice (fixed text only: no typed text is echoed). */
export const REPORTER_NOTICE_TEXT: Readonly<Record<string, string>> = {
  rp_ok_save:
    'Saved. The writers read the new character from their next pass. It is in the change log.',
  rp_ok_reset: 'Reset to the default character. The writers read it from their next pass.',
  rp_ok_preview:
    'Requested. The press service writes one sample line within a minute. Reload this page to see it.',
  rp_ok_on: 'Switched on. The desk gives this reporter new work again.',
  rp_ok_off: 'Switched off. The desk gives this reporter no new work. Old items stay.',
  rp_bad_reporter: 'Nothing changed: that is not a reporter.',
  rp_bad_bio: 'Nothing changed: the bio is 1 to 600 characters, with no digit.',
  rp_bad_voice: 'Nothing changed: the voice notes are 1 to 3000 characters.',
  rp_bad_catchphrases:
    'Nothing changed: give 3 to 16 catchphrases, one per line, up to 40 characters each, letters only (no comma, no digit).',
  rp_bad_disposition:
    'Nothing changed: disposition is a whole number from -2 to 2, or the default.',
  rp_crude:
    'Nothing changed: the text has crude language or a slur. The desk never prints those. Write it clean.',
  rp_names_out: 'Nothing changed: the text names a player who is on Leave me out.',
  rp_rules_text:
    'Nothing changed: the text tries to change or switch off the rules. The locked rules cannot be edited. Describe the character only.',
  rp_no_change: 'Nothing changed: there is nothing different from what is saved.',
  rp_request_open: 'A sample line request is already waiting. Wait for it, then ask again.',
}
