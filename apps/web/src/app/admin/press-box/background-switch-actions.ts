import type { PressBoxActor } from '@eanhl/db/queries'

/**
 * The "background questions on/off" switch of the Press Box (task background-b2), written so a test
 * can drive it (the server action in `actions.ts` passes the real admin check and the real query).
 * The rule that matters, as in the other Press Box actions: `requireAdmin` runs first, before
 * anything else, and the change goes through one query that writes its audit line in the same
 * transaction. The switch is OFF by default; only the admin turns it on.
 */
export interface BackgroundSwitchDeps {
  /** The admin check: throws (a redirect) when the caller is not the admin. */
  requireAdmin(): Promise<PressBoxActor>
  now(): Date
  setBackgroundQuestionsWithAudit(args: {
    on: boolean
    actor: PressBoxActor
    now: Date
  }): Promise<void>
}

export type BackgroundSwitchNotice =
  | { ok: true; code: 'bgq_on' | 'bgq_off' }
  | { ok: false; code: 'bad_input' }

export async function setBackgroundQuestionsBox(
  form: FormData,
  deps: BackgroundSwitchDeps,
): Promise<BackgroundSwitchNotice> {
  const actor = await deps.requireAdmin()
  const raw = form.get('on')
  if (raw !== '1' && raw !== '0') return { ok: false, code: 'bad_input' }
  const on = raw === '1'
  await deps.setBackgroundQuestionsWithAudit({ on, actor, now: deps.now() })
  return { ok: true, code: on ? 'bgq_on' : 'bgq_off' }
}

/** What the page says for each notice (fixed text only). */
export const BACKGROUND_SWITCH_NOTICE_TEXT: Readonly<Record<string, string>> = {
  bgq_on:
    'Background questions are ON. The reporters may now ask one background question in an interview or a scrum. Every fact they propose waits for you to confirm it.',
  bgq_off: 'Background questions are OFF. The reporters ask none.',
}
