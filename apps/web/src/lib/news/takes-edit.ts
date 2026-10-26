import { REPORTER_IDS, type ReporterId } from '@eanhl/db/news'
import { TAKE_SPREADS, type TakeSpread } from '@eanhl/db/schema'

/** What the GM takes editor may change on a take (admin only). */
export interface TakeEdit {
  take: string
  spread: TakeSpread
  critics: ReporterId[]
  defender: ReporterId | null
  dataAngle: string | null
  /** -2..+2: negative softens the take, positive hardens it. */
  intensity: number
  active: boolean
}

export type TakeEditResult =
  | { ok: true; id: number; edit: TakeEdit }
  | { ok: false; reason: string }

export const TAKE_MAX_CHARS = 1000
export const DATA_ANGLE_MAX_CHARS = 500

const isReporter = (v: string): v is ReporterId => (REPORTER_IDS as readonly string[]).includes(v)
const text = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v.trim() : '')

/** Reads and checks the editor's form. Never trusts the browser: every field is validated here. */
export function parseTakeEdit(form: FormData): TakeEditResult {
  const id = Number(text(form.get('id')))
  if (!Number.isInteger(id) || id < 1) return { ok: false, reason: 'bad take id' }

  const take = text(form.get('take'))
  if (take === '') return { ok: false, reason: 'the take text is empty' }
  if (take.length > TAKE_MAX_CHARS) return { ok: false, reason: 'the take text is too long' }

  const spread = text(form.get('spread'))
  if (!(TAKE_SPREADS as readonly string[]).includes(spread)) {
    return { ok: false, reason: 'bad spread' }
  }

  const critics: ReporterId[] = []
  for (const c of form.getAll('critics')) {
    const v = text(c)
    if (!isReporter(v)) return { ok: false, reason: 'a critic is not a reporter' }
    if (!critics.includes(v)) critics.push(v)
  }

  const defenderRaw = text(form.get('defender'))
  let defender: ReporterId | null = null
  if (defenderRaw !== '') {
    if (!isReporter(defenderRaw)) return { ok: false, reason: 'the defender is not a reporter' }
    if (critics.includes(defenderRaw)) {
      return { ok: false, reason: 'the defender is also a critic' }
    }
    defender = defenderRaw
  }

  const angle = text(form.get('dataAngle'))
  if (angle.length > DATA_ANGLE_MAX_CHARS)
    return { ok: false, reason: 'the data angle is too long' }

  const intensity = Number(text(form.get('intensity')))
  if (!Number.isInteger(intensity) || intensity < -2 || intensity > 2) {
    return { ok: false, reason: 'intensity must be a whole number from -2 to 2' }
  }

  return {
    ok: true,
    id,
    edit: {
      take,
      spread: spread as TakeSpread,
      critics,
      defender,
      dataAngle: angle === '' ? null : angle,
      intensity,
      active: form.get('active') !== null,
    },
  }
}
