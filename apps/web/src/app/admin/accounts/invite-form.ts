/** Shared between the create-invite Server Action and its form. */

/** Link lifetimes on offer, in hours: a day or a week. */
export const INVITE_LIFETIMES: Readonly<Record<string, number>> = { '24': 24, '168': 168 }

export type CreateInviteState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'ok'; url: string; gamertag: string; expires: string }
