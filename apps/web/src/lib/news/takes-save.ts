import type { ReporterId } from '@eanhl/db/news'
import { parseTakeEdit, type TakeEdit } from './takes-edit.ts'

export const GENERIC_SAVE_ERROR = 'The take could not be saved. Try again later.'

export interface SaveTakeDeps {
  /** The reporter who holds the take, or null when there is no such take. */
  holderOf(id: number): Promise<ReporterId | null>
  update(id: number, edit: TakeEdit): Promise<boolean>
  log(message: string): void
}

export type SaveTakeResult = { ok: true } | { ok: false; error: string }

/**
 * Validates and saves the GM takes editor's form. A take text is a secret: nothing
 * here returns or logs it. A database error (its message can quote the row) is
 * reduced to a generic error for the page and an error code for the log.
 */
export async function saveTake(form: FormData, deps: SaveTakeDeps): Promise<SaveTakeResult> {
  const parsed = parseTakeEdit(form)
  if (!parsed.ok) return { ok: false, error: `The take was not saved: ${parsed.reason}.` }
  try {
    const holder = await deps.holderOf(parsed.id)
    if (holder === null) return { ok: false, error: 'The take was not saved: it no longer exists.' }
    if (parsed.edit.defender === holder) {
      return { ok: false, error: 'The defender cannot be the reporter who holds the take.' }
    }
    if (!(await deps.update(parsed.id, parsed.edit))) {
      return { ok: false, error: 'The take was not saved: it no longer exists.' }
    }
    return { ok: true }
  } catch (err: unknown) {
    const code = (err as { code?: unknown } | null)?.code
    deps.log(
      `saving a take failed (${typeof code === 'string' ? code : err instanceof Error ? err.name : 'error'})`,
    )
    return { ok: false, error: GENERIC_SAVE_ERROR }
  }
}
