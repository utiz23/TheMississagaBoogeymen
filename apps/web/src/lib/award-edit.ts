/**
 * Trophy case editor rules (admin tools C3). Pure, so the forms and the
 * Server Actions share them. A trophy is MVP / Defense / Rookie, from a club
 * vote or picked from the archive stats (with a reason shown on the page); a
 * banner is a championship. Every award belongs to one game title and at
 * least one team member.
 */
import type { ClubAwardInput } from '@eanhl/db/queries'

export const REASON_MAX = 300

export const TROPHIES = [
  { value: 'mvp', label: 'MVP' },
  { value: 'defense', label: 'Defensive player' },
  { value: 'rookie', label: 'Rookie' },
] as const

export const BANNER_MODES = [
  { value: '3s', label: '3s championship' },
  { value: '6s', label: '6s championship' },
  { value: 'arcade', label: 'Arcade championship' },
] as const

export type AwardFormResult = { ok: true; input: ClubAwardInput } | { ok: false; message: string }

/**
 * Read a submitted award form. `getAll('playerIds')` keeps the order the
 * checkboxes were in, which is the display order.
 */
export function parseAwardForm(
  get: (name: string) => string | null,
  getAll: (name: string) => string[],
  allowed: { titleIds: readonly number[]; memberIds: readonly number[] },
): AwardFormResult {
  const gameTitleId = Number(get('gameTitleId'))
  if (!allowed.titleIds.includes(gameTitleId)) return { ok: false, message: 'Pick a season.' }

  const playerIds = [...new Set(getAll('playerIds').map(Number))]
  if (playerIds.length === 0) return { ok: false, message: 'Pick at least one player.' }
  if (!playerIds.every((id) => allowed.memberIds.includes(id))) {
    return { ok: false, message: 'Only team members can receive awards.' }
  }

  const kind = get('kind')
  if (kind === 'banner') {
    const mode = get('mode')
    if (mode !== '3s' && mode !== '6s' && mode !== 'arcade') {
      return { ok: false, message: 'Pick the championship.' }
    }
    return { ok: true, input: { kind: 'banner', mode, gameTitleId, playerIds } }
  }
  if (kind !== 'trophy') return { ok: false, message: 'Unknown award type.' }

  const trophy = get('trophy')
  if (trophy !== 'mvp' && trophy !== 'defense' && trophy !== 'rookie') {
    return { ok: false, message: 'Pick the trophy.' }
  }
  const source = get('source')
  if (source === 'vote') {
    return { ok: true, input: { kind, trophy, gameTitleId, source, reason: null, playerIds } }
  }
  if (source !== 'stats') return { ok: false, message: 'Pick club vote or archive stats.' }
  const reason = (get('reason') ?? '').replace(/\s+/g, ' ').trim()
  if (reason === '') return { ok: false, message: 'An archive-stats trophy needs a reason.' }
  if (reason.length > REASON_MAX) {
    return { ok: false, message: `The reason is limited to ${String(REASON_MAX)} characters.` }
  }
  return { ok: true, input: { kind, trophy, gameTitleId, source, reason, playerIds } }
}
