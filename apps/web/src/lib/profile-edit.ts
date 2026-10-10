/**
 * Profile self-edit rules (member logins step B; operator 2026-10-09).
 * A member edits their own display name, jersey, nationality and bio; an
 * admin edits those plus preferred position, archetype and club role on any
 * player. Pure, so the form and the Server Action share one set of rules.
 */
import { PLAYER_ARCHETYPES, type PlayerArchetype } from '@eanhl/db/schema'
import type { ProfilePatch } from '@eanhl/db/queries'

export const NAME_MAX = 24
export const BIO_MAX = 280
export const ROLE_MAX = 24

/** Stored as the display text the flags already understand (player-meta-icons.tsx). */
export const NATIONALITIES = ['Canada', 'USA'] as const

export const POSITIONS = [
  { value: 'center', label: 'Center' },
  { value: 'leftWing', label: 'Left wing' },
  { value: 'rightWing', label: 'Right wing' },
  { value: 'leftDefenseMen', label: 'Left defense' },
  { value: 'rightDefenseMen', label: 'Right defense' },
  { value: 'defenseMen', label: 'Defense' },
  { value: 'goalie', label: 'Goalie' },
] as const

export const ARCHETYPE_LABELS: Readonly<Record<PlayerArchetype, string>> = {
  playmaker: 'Playmaker',
  sniper: 'Sniper',
  'power-forward': 'Power forward',
  grinder: 'Grinder',
  'two-way-fwd': 'Two-way forward',
  enforcer: 'Enforcer',
  'defensive-d': 'Defensive D',
  'offensive-d': 'Offensive D',
  'two-way-d': 'Two-way D',
  'enforcer-d': 'Enforcer D',
  puckmover: 'Puck mover',
}

export const SELF_FIELDS = ['playerName', 'jerseyNumber', 'nationality', 'bio'] as const
export const ADMIN_ONLY_FIELDS = ['preferredPosition', 'archetype', 'clubRoleLabel'] as const
export type ProfileField = (typeof SELF_FIELDS)[number] | (typeof ADMIN_ONLY_FIELDS)[number]

export type ProfileFormResult =
  | { ok: true; patch: ProfilePatch }
  | { ok: false; errors: Partial<Record<ProfileField, string>> }

// Control characters (incl. newlines) never belong in a one-line field.
const CONTROL = /[\u0000-\u001f\u007f]/g

function oneLine(value: string | null): string | null {
  const v = (value ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
  return v === '' ? null : v
}

function paragraph(value: string | null): string | null {
  const v = (value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return v === '' ? null : v
}

/**
 * Read and check a submitted profile form. `get` returns a field's raw value
 * (null when absent). Admin-only fields are read only for an admin, so a
 * member's tampered form can't change them.
 */
export function parseProfileForm(
  get: (name: string) => string | null,
  isAdmin: boolean,
): ProfileFormResult {
  const errors: Partial<Record<ProfileField, string>> = {}
  const patch: ProfilePatch = {}

  const name = oneLine(get('playerName'))
  if (name !== null && name.length > NAME_MAX) {
    errors.playerName = `Up to ${String(NAME_MAX)} characters.`
  } else patch.playerName = name

  const jersey = (get('jerseyNumber') ?? '').trim()
  if (jersey === '') patch.jerseyNumber = null
  else if (/^\d{1,2}$/.test(jersey)) patch.jerseyNumber = Number(jersey)
  else errors.jerseyNumber = 'A number from 0 to 99.'

  const nation = (get('nationality') ?? '').trim()
  if (nation === '') patch.nationality = null
  else if ((NATIONALITIES as readonly string[]).includes(nation)) patch.nationality = nation
  else errors.nationality = 'Pick Canada, USA or none.'

  const bio = paragraph(get('bio'))
  if (bio !== null && bio.length > BIO_MAX) errors.bio = `Up to ${String(BIO_MAX)} characters.`
  else patch.bio = bio

  if (isAdmin) {
    const pos = (get('preferredPosition') ?? '').trim()
    if (pos === '') patch.preferredPosition = null
    else if (POSITIONS.some((p) => p.value === pos)) patch.preferredPosition = pos
    else errors.preferredPosition = 'Pick a position from the list.'

    const arch = (get('archetype') ?? '').trim()
    if (arch === '') patch.archetype = null
    else if (!(PLAYER_ARCHETYPES as readonly string[]).includes(arch)) {
      errors.archetype = 'Pick an archetype from the list.'
    } else if (pos === 'goalie') errors.archetype = 'Goalies have no archetype.'
    else patch.archetype = arch as PlayerArchetype

    const role = oneLine(get('clubRoleLabel'))
    if (role !== null && role.length > ROLE_MAX) {
      errors.clubRoleLabel = `Up to ${String(ROLE_MAX)} characters.`
    } else patch.clubRoleLabel = role
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, patch }
}

/** What the profile form shows after a submit. */
export type ProfileFormState =
  | { status: 'idle' }
  | { status: 'saved'; at: number }
  | { status: 'error'; message: string; errors: Partial<Record<ProfileField, string>> }
